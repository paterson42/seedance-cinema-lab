// BytePlus ModelArk adapters: Seed (LLM), Seedream (image), Seedance (video).
// When config.mock is true, every call is served locally (ffmpeg if available) so the
// whole booth flow can be rehearsed without an API key.
// "poster" = the ad key visual (2:3), "video" = the short-form ad made from it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, MEDIA_DIR } from '../config.js';
import { getContent } from '../content.js';

export class ProviderError extends Error {
  constructor(message, { code, status, retryable = false, userMessage } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.userMessage = userMessage;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ark(pathname, { method = 'POST', body, timeoutMs = 60000, attempts = 3 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(config.ark.baseUrl + pathname, {
        method,
        headers: { Authorization: `Bearer ${config.ark.apiKey}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      if (res.ok) return json;
      const code = json?.error?.code || `HTTP_${res.status}`;
      const msg = json?.error?.message || json?.raw || res.statusText;
      const retryable = res.status === 429 || res.status >= 500;
      lastErr = new ProviderError(`${code}: ${msg}`, { code, status: res.status, retryable, userMessage: friendly(code, res.status) });
      if (!retryable) throw lastErr;
    } catch (e) {
      if (e instanceof ProviderError && !e.retryable) throw e;
      lastErr = e instanceof ProviderError ? e : new ProviderError(e.message, { retryable: true, userMessage: '네트워크가 불안정해요. 잠시 후 다시 시도해 주세요.' });
    }
    await sleep(1500 * 2 ** i + Math.random() * 500);
  }
  throw lastErr;
}

function friendly(code = '', status) {
  // The generated soundtrack (not the visitor's keywords) tripped the copyright check; a retry usually passes.
  if (/OutputAudio/i.test(code)) return '영상에 들어간 AI 배경음이 저작권 검사에 걸렸어요. 키워드는 문제없으니 그대로 다시 시도해 주세요.';
  if (/Sensitive|risk|moderation|Inappropriate|PolicyViolation/i.test(code)) return '안전 정책에 걸려 생성하지 못했어요. 키워드를 바꿔서 다시 시도해 주세요.';
  if (status === 429 || /RateLimit|QuotaExceeded|ServerOverloaded/i.test(code)) return '지금 체험하는 분이 많아요. 잠시 후 다시 시도해 주세요.';
  if (status === 401 || status === 403) return '생성 서버 인증에 문제가 있어요. 부스 스태프에게 알려주세요.';
  return '생성 중 문제가 생겼어요. 다시 시도해 주세요.';
}

function sniffExt(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf[0] === 0x52 && buf[1] === 0x49) return 'webp';
  return 'jpg';
}

async function download(url, timeoutMs = 120000) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new ProviderError(`download failed ${res.status}`, { retryable: true });
  return Buffer.from(await res.arrayBuffer());
}

// ───────────────────────── Seed LLM ─────────────────────────
export async function chatJSON(system, user) {
  const r = await ark('/chat/completions', {
    timeoutMs: config.ark.llmTimeoutSec * 1000,
    attempts: 1,
    body: {
      model: config.ark.llmModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.9,
      max_tokens: 1200,
      thinking: { type: 'disabled' },
    },
  });
  const text = r?.choices?.[0]?.message?.content || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('LLM returned no JSON');
  return JSON.parse(m[0]);
}

// ───────────────────────── Seedream ─────────────────────────
/** @returns {Promise<{buffer: Buffer, ext: string}>} */
export async function generateImage({ prompt, seed, genreId }) {
  if (config.mock) return mockImage({ seed, genreId });
  const body = {
    model: config.ark.imageModel,
    prompt,
    size: config.ark.imageSize,
    response_format: 'b64_json',
    watermark: false,
  };
  if (config.ark.imageSendSeed) body.seed = seed;
  const r = await ark('/images/generations', { body, timeoutMs: 120000 });
  const d = r?.data?.[0];
  if (!d) throw new ProviderError(`no image in response: ${JSON.stringify(r?.error || r).slice(0, 200)}`, { userMessage: friendly(r?.error?.code) });
  const buffer = d.b64_json ? Buffer.from(d.b64_json, 'base64') : await download(d.url);
  return toJpeg(buffer, sniffExt(buffer));
}

// Seedream 5.5 returns ~3 MB PNGs. Visitors' phones download the raw poster to add the title and
// the screens may show it, so store a high-quality JPEG instead (about a fifth of the size).
// Without ffmpeg, or if conversion fails, the original is kept.
async function toJpeg(buffer, ext) {
  if (ext === 'jpg' || !(await hasFfmpeg())) return { buffer, ext };
  const tmp = path.join(MEDIA_DIR, `_conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  try {
    fs.writeFileSync(`${tmp}.${ext}`, buffer);
    await run('ffmpeg', ['-y', '-v', 'error', '-i', `${tmp}.${ext}`, '-q:v', '2', '-pix_fmt', 'yuvj420p', `${tmp}.jpg`], 30000);
    return { buffer: fs.readFileSync(`${tmp}.jpg`), ext: 'jpg' };
  } catch (e) {
    console.warn(`[poster] JPEG conversion failed, keeping ${ext}:`, e.message);
    return { buffer, ext };
  } finally {
    fs.rmSync(`${tmp}.${ext}`, { force: true });
    fs.rmSync(`${tmp}.jpg`, { force: true });
  }
}

// ───────────────────────── Seedance ─────────────────────────
export async function submitVideo({ prompt, imageFile, seed }) {
  if (config.mock) return mockSubmitVideo({ imageFile });
  const buf = fs.readFileSync(path.join(MEDIA_DIR, imageFile));
  const ext = sniffExt(buf);
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  // No --ratio: for first-frame video Seedance follows the image, which is already 9:16.
  const flags = [
    `--resolution ${config.ark.videoResolution}`,
    `--duration ${config.ark.videoDuration}`,
    '--camerafixed false',
    '--watermark false',
  ];
  if (config.ark.videoSendSeed) flags.push(`--seed ${seed}`);
  const r = await ark('/contents/generations/tasks', {
    timeoutMs: 60000,
    body: {
      model: config.ark.videoModel,
      generate_audio: config.ark.videoAudio,
      content: [
        { type: 'text', text: `${prompt} ${flags.join(' ')}` },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } },
      ],
    },
  });
  if (!r?.id) throw new ProviderError('no task id returned');
  return r.id;
}

/** @returns {Promise<{status: 'queued'|'running'|'succeeded'|'failed', buffer?: Buffer, error?: string, userMessage?: string}>} */
export async function getVideoTask(taskId) {
  if (config.mock) return mockGetVideo(taskId);
  const r = await ark(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, { method: 'GET', timeoutMs: 20000 });
  const status = r?.status;
  if (status === 'succeeded') {
    const url = r?.content?.video_url;
    if (!url) return { status: 'failed', error: 'no video_url', userMessage: friendly() };
    return { status, buffer: await download(url) };
  }
  if (status === 'failed' || status === 'cancelled' || status === 'expired') {
    const code = r?.error?.code || status;
    return { status: 'failed', error: `${code}: ${r?.error?.message || ''}`, userMessage: friendly(code) };
  }
  return { status: status === 'queued' ? 'queued' : 'running' };
}

// ───────────────────────── Mock (demo) mode ─────────────────────────
let ffmpegOk = null;
function run(cmd, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => { clearTimeout(t); code === 0 ? resolve() : reject(new Error(err)); });
  });
}
async function hasFfmpeg() {
  if (ffmpegOk === null) ffmpegOk = await run('ffmpeg', ['-version'], 5000).then(() => true, () => false);
  return ffmpegOk;
}

const rgb = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

async function mockImage({ seed, genreId }) {
  await sleep(config.mockPosterDelaySec * 1000);
  const g = getContent().genres.find((x) => x.id === genreId) || getContent().genres[0];
  const [accent, dark] = g.palette;
  const out = path.join(MEDIA_DIR, `_mock_${seed}_${Date.now()}.jpg`);
  if (await hasFfmpeg()) {
    // Studio backdrop + spotlight, a podium, and a product silhouette (bottle / can / box by seed).
    const W = 720, H = 1280;
    const [ar, ag, ab] = rgb(accent), [dr, dg, db] = rgb(dark);
    const cx = W / 2, gy = H * 0.3;
    const shape = seed % 3;
    const bw = [150, 210, 280][shape], bh = [400, 330, 300][shape];
    const capW = [70, 190, 0][shape], capH = [70, 18, 0][shape];
    const floorY = H * 0.56, top = floorY - bh, pr = 250, pe = 46;
    const t = 'pow(1-Y/H,1.4)';
    const glow = `exp(-(pow(X-${cx},2)+pow(Y-${gy},2))/${Math.round((W * 0.5) ** 2)})`;
    const bg = (a, d) => `'min(255,${a}*${t}*0.45+${d}*(1-${t})+${a}*0.75*${glow})'`;
    const inTop = `lte(pow((X-${cx})/${pr},2)+pow((Y-${floorY})/${pe},2),1)`;
    const inBase = `lte(pow((X-${cx})/${pr},2)+pow((Y-${floorY + 90})/${pe},2),1)`;
    const inSide = `between(X,${cx - pr},${cx + pr})*between(Y,${floorY},${floorY + 90})`;
    const pod = (a, d) => `'if(${inTop},${Math.round(a * 0.55 + 110)},${Math.round(a * 0.25 + d)}*(1-0.5*pow((X-${cx})/${pr},2)))'`;
    const inBody = `between(X,${cx - bw / 2},${cx + bw / 2})*between(Y,${top},${floorY})`;
    const inCap = capW ? `between(X,${cx - capW / 2},${cx + capW / 2})*between(Y,${top - capH},${top})` : '0';
    const inLabel = `between(Y,${top + bh * 0.3},${top + bh * 0.68})`;
    const shade = `(1-0.45*pow((X-${cx})/${bw / 2},2))`;
    const prod = (a) => `'if(${inCap},70,if(${inLabel},${a},238)*${shade})'`;
    const filter = [
      `color=c=black:s=${W}x${H}:d=1,format=rgb24,geq=r=${bg(ar, dr)}:g=${bg(ag, dg)}:b=${bg(ab, db)}[bg]`,
      `color=c=black@0:s=${W}x${H}:d=1,format=rgba,geq=r=${pod(ar, dr)}:g=${pod(ag, dg)}:b=${pod(ab, db)}:a='255*gt(${inTop}+${inBase}+${inSide},0)'[pod]`,
      `color=c=black@0:s=${W}x${H}:d=1,format=rgba,geq=r=${prod(ar)}:g=${prod(ag)}:b=${prod(ab)}:a='255*gt(${inBody}+${inCap},0)'[prod]`,
      '[bg][pod]overlay[a];[a][prod]overlay,noise=alls=10:allf=t,vignette=PI/3.6[out]',
    ].join(';');
    await run('ffmpeg', ['-y', '-v', 'error', '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
    const buffer = fs.readFileSync(out);
    fs.unlinkSync(out);
    return { buffer, ext: 'jpg' };
  }
  // No ffmpeg: a simple SVG key-visual background (product on a podium).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280" viewBox="0 0 720 1280">
<defs><radialGradient id="g" cx="50%" cy="32%" r="80%"><stop offset="0" stop-color="${accent}"/><stop offset=".55" stop-color="${dark}"/><stop offset="1" stop-color="#000"/></radialGradient></defs>
<rect width="720" height="1280" fill="url(#g)"/>
<ellipse cx="360" cy="806" rx="250" ry="46" fill="#000" opacity=".55"/><rect x="110" y="716" width="500" height="90" fill="#000" opacity=".55"/>
<ellipse cx="360" cy="716" rx="250" ry="46" fill="#fff" opacity=".5"/>
<rect x="${285 - (seed % 3) * 30}" y="364" width="${150 + (seed % 3) * 60}" height="352" rx="14" fill="#eeeee6"/>
<rect x="${285 - (seed % 3) * 30}" y="474" width="${150 + (seed % 3) * 60}" height="130" fill="${accent}"/></svg>`;
  return { buffer: Buffer.from(svg), ext: 'svg' };
}

const mockTasks = new Map();
async function mockSubmitVideo({ imageFile }) {
  const id = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const task = { readyAt: Date.now() + config.mockVideoDelaySec * 1000, file: null, error: null };
  mockTasks.set(id, task);
  const src = path.join(MEDIA_DIR, imageFile);
  const out = path.join(MEDIA_DIR, `_mock_${id}.mp4`);
  if (imageFile.endsWith('.svg') || !(await hasFfmpeg())) {
    task.error = 'NO_FFMPEG';
  } else {
    const fps = 24, secs = 6, frames = fps * secs;
    run('ffmpeg', [
      '-y', '-v', 'error', '-loop', '1', '-i', src,
      '-vf', `scale=1440:2560,zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)-on*0.4':d=${frames}:s=720x1280:fps=${fps},fade=t=in:st=0:d=0.6,fade=t=out:st=${secs - 0.6}:d=0.6`,
      '-t', String(secs), '-c:v', 'libx264', '-crf', '24', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
    ], 120000).then(() => (task.file = out), (e) => (task.error = e.message.slice(0, 200)));
  }
  return id;
}

async function mockGetVideo(id) {
  const t = mockTasks.get(id);
  if (!t) return { status: 'failed', error: 'mock task lost (server restarted)', userMessage: '서버가 재시작되어 데모 영상을 다시 만들어야 해요.' };
  if (Date.now() < t.readyAt || (!t.file && !t.error)) return { status: 'running' };
  mockTasks.delete(id);
  if (t.error === 'NO_FFMPEG') return { status: 'succeeded', buffer: null, noVideo: true };
  if (t.error) return { status: 'failed', error: t.error, userMessage: '데모 영상 생성에 실패했어요.' };
  const buffer = fs.readFileSync(t.file);
  fs.unlinkSync(t.file);
  return { status: 'succeeded', buffer };
}
