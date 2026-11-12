// BytePlus ModelArk adapters: Seed (LLM), Seedream (image), Seedance (video).
// When config.mock is true, every call is served locally (ffmpeg if available) so the
// whole booth flow can be rehearsed without an API key.
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
    timeoutMs: 15000,
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
  return { buffer, ext: sniffExt(buffer) };
}

// ───────────────────────── Seedance ─────────────────────────
export async function submitVideo({ prompt, imageFile, seed }) {
  if (config.mock) return mockSubmitVideo({ imageFile });
  const buf = fs.readFileSync(path.join(MEDIA_DIR, imageFile));
  const ext = sniffExt(buf);
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
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
    const W = 800, H = 1200;
    const s = seed % 1000;
    const cx = 0.25 + ((seed % 97) / 97) * 0.5;
    const cy = 0.18 + ((seed % 53) / 53) * 0.2;
    // Gradient sky + glowing orb + layered ridge silhouettes, then grain + vignette.
    const [ar, ag, ab] = rgb(accent), [dr, dg, db] = rgb(dark);
    const t = `pow(1-Y/H\\,1.6)`;
    const glow = `exp(-(pow(X-${W * cx}\\,2)+pow(Y-${H * cy}\\,2))/${Math.round((W * 0.45) ** 2)})`;
    const ch = (a, d) => `'min(255\\,${a}*${t}*0.75+${d}*(1-${t})+${a}*0.6*${glow})'`;
    const filter = [
      `color=c=black:s=${W}x${H}:d=1,format=rgb24,geq=r=${ch(ar, dr)}:g=${ch(ag, dg)}:b=${ch(ab, db)}[sky]`,
      `color=c=black@0:s=${W}x${H}:d=1,format=rgba,geq=r=255:g=255:b=235:a='255*exp(-(pow(X-${W * cx}\\,2)+pow(Y-${H * cy}\\,2))/${Math.round((W * 0.07) ** 2)})'[orb]`,
      `color=c=black@0:s=${W}x${H}:d=1,format=rgba,geq=r=8:g=8:b=12:a='if(gt(Y,${H * 0.62}+${H * 0.05}*sin(X/${61 + (s % 30)}+${s})+${H * 0.02}*sin(X/${19 + (s % 11)})),200,0)'[ridge1]`,
      `color=c=black@0:s=${W}x${H}:d=1,format=rgba,geq=r=0:g=0:b=0:a='if(gt(Y,${H * 0.74}+${H * 0.04}*sin(X/${43 + (s % 20)}+${s * 2})+${H * 0.012}*sin(X/7)),255,0)'[ridge2]`,
      `[sky][orb]overlay[a];[a][ridge1]overlay[b];[b][ridge2]overlay,noise=alls=14:allf=t,vignette=PI/3.2[out]`,
    ].join(';');
    await run('ffmpeg', ['-y', '-v', 'error', '-filter_complex', filter, '-map', '[out]', '-frames:v', '1', '-q:v', '3', out]);
    const buffer = fs.readFileSync(out);
    fs.unlinkSync(out);
    return { buffer, ext: 'jpg' };
  }
  // No ffmpeg: a simple SVG poster background.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200" viewBox="0 0 800 1200">
<defs><radialGradient id="g" cx="50%" cy="25%" r="80%"><stop offset="0" stop-color="${accent}"/><stop offset=".55" stop-color="${dark}"/><stop offset="1" stop-color="#000"/></radialGradient></defs>
<rect width="800" height="1200" fill="url(#g)"/><circle cx="${300 + (seed % 200)}" cy="300" r="90" fill="#fff" opacity=".85"/>
<path d="M0 820 Q200 700 400 800 T800 760 V1200 H0Z" fill="#000" opacity=".8"/><path d="M0 930 Q250 850 500 930 T800 900 V1200 H0Z" fill="#000"/></svg>`;
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
      '-vf', `scale=1440:2160,zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)-on*0.4':d=${frames}:s=720x1080:fps=${fps},fade=t=in:st=0:d=0.6,fade=t=out:st=${secs - 0.6}:d=0.6`,
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
