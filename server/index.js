import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, PUBLIC_DIR, MEDIA_DIR } from './config.js';
import { createSession, getSession, getSessionByToken, updateSession, query, queryOne, logEvent } from './db.js';
import { publicContent, getContent, saveContent, containsBanned } from './content.js';
import { normalizePhone, maskPhone, hashPhone, encrypt, token } from './privacy.js';
import { buildStory } from './story.js';
import {
  dailyLeft, assertDaily, isTestSession, assertPhoneMayEnter, assertMayGenerate, flowInfo, allowlistEnabled, setAllowlistEnabled,
  allowlistCount, allowlistRecent, parseNumbers, saveAllowlist, clearAllowlist, phoneStatus, grantExtraFlow,
} from './limits.js';
import { enqueuePoster, enqueueVideo, queuePosition, queueStats, startJobs } from './jobs.js';
import { kakaoEnabled } from './providers/kakao.js';
import { etaSec } from './eta.js';
import { BASE, withBase, insideBase, rebased, rebaseText } from './basepath.js';

// ───────────── tiny HTTP toolkit ─────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, message, code, extra) { super(message); this.status = status; this.code = code; this.extra = extra; }
}
const fail = (status, message, code, extra) => { throw new HttpError(status, message, code, extra); };

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, '요청이 너무 커요.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, '잘못된 요청이에요.')); }
    });
    req.on('error', reject);
  });
}

// All values of one cookie, most specific first. A browser can hold the same name for several paths:
// before BASE_PATH existed the session cookie was set on Path=/, now on Path=/film, and both get sent.
function cookieAll(req, name) {
  const out = [];
  for (const c of (req.headers.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i > 0 && c.slice(0, i).trim() === name) { try { out.push(decodeURIComponent(c.slice(i + 1).trim())); } catch {} }
  }
  return out;
}

const SECURE = config.publicBaseUrl.startsWith('https');
function sessionCookie(id) {
  const c = `scl_sid=${id}; Path=${BASE || '/'}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${SECURE ? '; Secure' : ''}`;
  // Also drop a leftover cookie from before BASE_PATH (Path=/), which would otherwise shadow this one.
  return BASE ? [c, `scl_sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${SECURE ? '; Secure' : ''}`] : c;
}

const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler });
}

// Simple in-memory rate limiter (per key, sliding window).
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (arr.length > max) fail(429, '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 600000)) hits.delete(k); }, 600000).unref();

const ip = (req) => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

// ───────────── view models ─────────────
const media = (f) => (f ? withBase(`/media/${f}`) : null);
// What the visitor sees about their big-screen submission (an operator hiding it reads as "pending").
const screenState = (v) => (v === 'hidden' ? 'pending' : v || null);
const screenView = (s) => ({ poster: screenState(s.screen_poster), trailer: screenState(s.screen_video) });

function sessionView(s) {
  if (!s) return null;
  const posterQ = queuePosition('poster', s);
  const videoQ = queuePosition('video', s);
  return {
    id: s.id,
    phoneMasked: s.phone_masked,
    hasPhone: !!s.phone_hash,
    genre: s.genre,
    keywords: s.keywords,
    director: s.director,
    seed: s.seed,
    story: s.story,
    posterPrompt: s.poster_prompt,
    videoPrompt: s.video_prompt,
    poster: {
      status: s.poster_status,
      url: media(s.poster_file),
      finalUrl: media(s.poster_final_file),
      error: s.poster_error,
      queuePos: posterQ,
      requestedAt: s.poster_requested_at,
      etaSec: etaSec('poster', posterQ),
      remaining: isTestSession(s) ? 99 : Math.min(dailyLeft(s, 'poster'), Math.max(0, config.queue.posterMaxPerSession - (s.poster_count || 0))),
    },
    video: {
      status: s.video_status,
      url: media(s.video_file),
      error: s.video_error,
      queuePos: videoQ,
      requestedAt: s.video_requested_at,
      etaSec: etaSec('video', videoQ),
      dailyLeft: dailyLeft(s, 'video'),
      dailyMax: config.limits.phoneDailyVideos,
      remaining: isTestSession(s) ? 99 : Math.min(dailyLeft(s, 'video'), Math.max(0, config.queue.videoMaxPerSession - (s.video_count || 0))),
    },
    flows: flowInfo(s),
    resultUrl: s.result_token ? withBase(`/r/${s.result_token}`) : null,
    kakaoStatus: s.kakao_status,
    screen: screenView(s),
  };
}

function resultView(s) {
  return {
    title: s.story?.title,
    tagline: s.story?.tagline,
    logline: s.story?.logline,
    genre: s.story?.genre,
    director: s.director,
    seed: s.seed,
    keywords: s.keywords,
    posterUrl: media(s.poster_file),
    posterFinalUrl: media(s.poster_final_file),
    videoStatus: s.video_status,
    videoUrl: media(s.video_file),
    videoError: s.video_error,
    videoRequestedAt: s.video_requested_at,
    videoQueuePos: queuePosition('video', s),
    etaSec: etaSec('video', queuePosition('video', s)),
    createdAt: s.created_at,
    expiresAt: s.result_expires_at,
    screen: screenView(s),
  };
}

// ───────────── session helpers ─────────────
function current(req) {
  for (const id of cookieAll(req, 'scl_sid')) { const s = id && getSession(id); if (s) return s; }
  return null;
}
function requireSession(req, { phone = true } = {}) {
  const s = current(req);
  if (!s) fail(401, '세션이 만료되었어요. 처음부터 다시 시작해 주세요.', 'NO_SESSION');
  if (phone && !s.phone_hash) fail(403, '휴대폰 번호를 먼저 입력해 주세요.', 'NO_PHONE');
  return s;
}

// ───────────── API ─────────────
route('GET', '/api/bootstrap', async (req, res) => {
  const s = current(req);
  json(res, 200, {
    content: publicContent(),
    mode: config.mock ? 'mock' : 'live',
    kakao: { enabled: kakaoEnabled(), provider: config.kakao.provider, jsKey: config.kakao.jsKey || null },
    videoEtaSec: etaSec('video'),
    publicBaseUrl: config.publicBaseUrlSet ? config.publicBaseUrl : null,
    allowlist: allowlistEnabled(), // the ticket page then reminds visitors to use their registered number
    session: sessionView(s),
  });
});

route('POST', '/api/session', async (req, res) => {
  rateLimit(`sess:${ip(req)}`, 1500, 600000);
  const body = await readBody(req);
  const prev = current(req);
  const id = token(18);
  let s = createSession(id);
  // "다시 체험하기": carry over the verified phone so the visitor doesn't retype it.
  if (body.keepPhone && prev?.phone_hash) {
    s = updateSession(id, {
      phone_enc: prev.phone_enc, phone_hash: prev.phone_hash, phone_masked: prev.phone_masked,
      consent_at: prev.consent_at, consent_marketing: prev.consent_marketing, director: prev.director,
    });
  }
  logEvent(id, 'session_start', { ua: String(req.headers['user-agent'] || '').slice(0, 120), entry: body.entry || 'qr', restart: !!prev });
  json(res, 200, { session: sessionView(s) }, { 'Set-Cookie': sessionCookie(id) });
});

route('POST', '/api/session/phone', async (req, res) => {
  const s = requireSession(req, { phone: false });
  rateLimit(`phone:${ip(req)}`, 1000, 600000);
  const { phone, consentPrivacy } = await readBody(req);
  const p = normalizePhone(phone);
  if (!p) fail(400, '휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)', 'BAD_PHONE');
  if (!consentPrivacy) fail(400, '개인정보 수집·이용에 동의해야 결과를 받아볼 수 있어요.', 'NO_CONSENT');
  assertPhoneMayEnter(p, fail); // pre-registered list + experiences per person
  const updated = updateSession(s.id, {
    phone_enc: encrypt(p), phone_hash: hashPhone(p), phone_masked: maskPhone(p),
    consent_at: Date.now(), consent_marketing: 0, // phone numbers are not used for marketing
  });
  logEvent(s.id, 'phone_ok');
  json(res, 200, { session: sessionView(updated) });
});

// One generation at a time per visitor. While a poster or trailer is being made, any request that
// would start or change one answers 409 BUSY with the current session, and the phone goes back to
// the waiting screen. Repeating the same request (double tap, network retry) is answered with the
// session as-is (see /api/poster and /api/video), which also lands on the waiting screen.
const POSTER_BUSY = ['queued', 'running'];
const VIDEO_BUSY = ['queued', 'submitting', 'running'];
function busyWith(s) {
  if (POSTER_BUSY.includes(s.poster_status)) return 'poster';
  if (VIDEO_BUSY.includes(s.video_status)) return 'video';
  return null;
}
function assertNotBusy(s) {
  const b = busyWith(s);
  if (!b) return;
  fail(409, b === 'poster' ? '포스터를 만들고 있어요. 완성될 때까지 조금만 기다려 주세요.' : '트레일러를 만들고 있어요. 완성될 때까지 조금만 기다려 주세요.',
    'BUSY', { busy: b, session: sessionView(s) });
}

route('POST', '/api/session/genre', async (req, res) => {
  const s = requireSession(req);
  assertNotBusy(s);
  assertMayGenerate(s, fail);
  const { genre } = await readBody(req);
  if (!getContent().genres.some((g) => g.id === genre)) fail(400, '장르를 다시 선택해 주세요.');
  const updated = updateSession(s.id, { genre });
  logEvent(s.id, 'genre_selected', { genre });
  json(res, 200, { session: sessionView(updated) });
});

route('POST', '/api/story', async (req, res) => {
  const s = requireSession(req);
  if (!s.genre) fail(400, '장르를 먼저 선택해 주세요.');
  assertNotBusy(s);
  assertMayGenerate(s, fail);
  rateLimit(`story:${s.id}`, 30, 600000);
  assertDaily(s, 'story', fail);
  const { keywords, director: rawDirector } = await readBody(req);
  const director = String(rawDirector || '').replace(/[<>"'`\\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12);
  if (!director) fail(400, '감독 이름을 입력해 주세요.', 'NO_DIRECTOR');
  if (containsBanned(director)) fail(400, '다른 이름을 입력해 주세요.', 'BANNED');
  const seed = crypto.randomInt(1, 1000000);
  const built = await buildStory({ genreId: s.genre, keywordIdx: keywords, director, seed });
  if (built.error) fail(400, built.error);
  assertNotBusy(getSession(s.id)); // a generation may have started during the LLM call
  const updated = updateSession(s.id, {
    keywords: built.keywords, director, seed, story: built.story,
    poster_prompt: built.posterPrompt, video_prompt: built.videoPrompt,
  });
  logEvent(s.id, 'story_built', { source: built.story.source, genre: s.genre });
  json(res, 200, { session: sessionView(updated) });
});

route('POST', '/api/poster', async (req, res) => {
  const s = requireSession(req);
  if (!s.poster_prompt) fail(400, '먼저 키워드를 뽑아 이야기를 만들어 주세요.');
  if (POSTER_BUSY.includes(s.poster_status)) return json(res, 200, { session: sessionView(s) }); // already making it
  assertNotBusy(s); // a trailer is being made from the current poster
  assertMayGenerate(s, fail);
  assertDaily(s, 'poster', fail);
  if ((s.poster_count || 0) >= config.queue.posterMaxPerSession && !isTestSession(s)) fail(429, '이 체험에서 만들 수 있는 포스터 수를 모두 사용했어요. 새로 체험을 시작해 주세요.', 'LIMIT');
  if (!s.result_token) {
    updateSession(s.id, { result_token: token(16), result_expires_at: Date.now() + config.resultTtlDays * 86400000 });
  }
  enqueuePoster(s.id);
  logEvent(s.id, 'poster_requested');
  json(res, 200, { session: sessionView(getSession(s.id)) });
});

route('POST', '/api/video', async (req, res) => {
  const s = requireSession(req);
  if (VIDEO_BUSY.includes(s.video_status)) return json(res, 200, { session: sessionView(s) }); // already making it
  assertNotBusy(s); // a poster is being (re)made
  if (s.poster_status !== 'done' || !s.poster_file) fail(400, '포스터를 먼저 만들어 주세요.');
  assertMayGenerate(s, fail);
  assertDaily(s, 'video', fail);
  if ((s.video_count || 0) >= config.queue.videoMaxPerSession && !isTestSession(s)) fail(429, '이 체험에서 만들 수 있는 영상 수를 모두 사용했어요.', 'LIMIT');
  enqueueVideo(s.id);
  logEvent(s.id, 'video_requested');
  json(res, 200, { session: sessionView(getSession(s.id)) });
});

route('GET', '/api/session', async (req, res) => {
  json(res, 200, { session: sessionView(current(req)) });
});

route('GET', '/api/result/:token', async (req, res, { token: t }) => {
  const s = getSessionByToken(t);
  if (!s || s.poster_status !== 'done') fail(404, '결과를 찾을 수 없어요.', 'NOT_FOUND');
  if (s.result_expires_at && s.result_expires_at < Date.now()) fail(410, '결과 링크 보관 기간이 지났어요.', 'EXPIRED');
  const own = cookieAll(req, 'scl_sid').includes(s.id);
  json(res, 200, { result: resultView(s), own });
});

route('POST', '/api/lookup', async (req, res) => {
  rateLimit(`lookup:${ip(req)}`, 60, 600000);
  const { phone, director } = await readBody(req);
  const p = normalizePhone(phone);
  if (!p) fail(400, '휴대폰 번호 형식을 확인해 주세요.', 'BAD_PHONE');
  const name = String(director || '').replace(/\s+/g, ' ').trim();
  if (!name) fail(400, '체험할 때 입력한 감독 이름을 입력해 주세요.');
  const rows = query(
    "SELECT * FROM sessions WHERE phone_hash = ? AND poster_status = 'done' AND result_token IS NOT NULL ORDER BY created_at DESC LIMIT 10",
    hashPhone(p),
  ).filter((s) => (s.director || '').toLowerCase() === name.toLowerCase() && (!s.result_expires_at || s.result_expires_at > Date.now()));
  logEvent(null, rows.length ? 'lookup_ok' : 'lookup_miss');
  if (!rows.length) fail(404, '일치하는 결과가 없어요. 번호와 감독 이름을 다시 확인해 주세요.', 'NOT_FOUND');
  json(res, 200, {
    results: rows.map((s) => ({
      url: `/r/${s.result_token}`, title: s.story?.title, genre: s.story?.genre?.ko,
      poster: media(s.poster_final_file || s.poster_file), videoStatus: s.video_status, createdAt: s.created_at,
    })),
  });
});

// ───────────── Big screens (lobby poster wall / trailer screen) ─────────────
const SCREEN_KINDS = { poster: ['screen_poster', 'screen_poster_at'], trailer: ['screen_video', 'screen_video_at'] };

route('POST', '/api/screen/submit', async (req, res) => {
  const { kind, token: t } = await readBody(req);
  const cols = SCREEN_KINDS[kind];
  if (!cols) fail(400, '잘못된 요청이에요.');
  // From the booth browser (cookie) or from the KakaoTalk result link (token).
  const s = t ? getSessionByToken(String(t)) : current(req);
  if (!s) fail(401, '세션이 만료되었어요. 결과 링크로 다시 들어와 주세요.', 'NO_SESSION');
  if (t && s.result_expires_at && s.result_expires_at < Date.now()) fail(410, '결과 링크 보관 기간이 지났어요.', 'EXPIRED');
  rateLimit(`screen:${s.id}`, 20, 600000);
  if (s.poster_status !== 'done') fail(400, '포스터가 아직 준비되지 않았어요.');
  if (kind === 'trailer' && s.video_status !== 'done') fail(400, '트레일러가 완성되면 상영할 수 있어요.');
  const [col, atCol] = cols;
  if (!s[col]) {
    updateSession(s.id, {
      screen_id: s.screen_id || token(8),
      [col]: config.screen.autoApprove ? 'live' : 'pending',
      [atCol]: Date.now(),
    });
    logEvent(s.id, `screen_${kind}_submitted`);
  }
  json(res, 200, { screen: screenView(getSession(s.id)) });
});

function screenItem(s, kind) {
  const g = getContent().genres.find((x) => x.id === s.genre);
  return {
    id: s.screen_id,
    title: s.story?.title,
    tagline: s.story?.tagline,
    logline: s.story?.logline,
    director: s.director,
    seed: s.seed,
    genre: { id: s.genre, ko: s.story?.genre?.ko, en: s.story?.genre?.en, color: g?.palette?.[0] || '#d4ff3a' },
    keywords: Object.values(s.keywords || {}).map((k) => k.ko),
    poster: media(s.poster_final_file || s.poster_file),
    video: kind === 'trailer' ? media(s.video_file) : null,
    at: kind === 'trailer' ? s.screen_video_at : s.screen_poster_at,
  };
}

route('GET', '/api/screen/feed', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (config.screen.key && u.searchParams.get('key') !== config.screen.key) fail(401, 'screen key required');
  const kind = u.searchParams.get('kind') === 'trailer' ? 'trailer' : 'poster';
  const rows = kind === 'trailer'
    ? query("SELECT * FROM sessions WHERE screen_video = 'live' AND video_status = 'done' AND video_file IS NOT NULL ORDER BY screen_video_at DESC LIMIT 60")
    : query("SELECT * FROM sessions WHERE screen_poster = 'live' AND poster_status = 'done' ORDER BY screen_poster_at DESC LIMIT 60");
  json(res, 200, { kind, items: rows.map((s) => screenItem(s, kind)), credits: getContent().event?.credits || [], now: Date.now() });
});

const EVENT_NAMES = new Set([
  'view_landing', 'view_genre', 'view_cast', 'view_story', 'view_poster', 'view_trailer', 'view_waiting', 'view_done', 'view_lookup',
  'keywords_drawn', 'keyword_reroll', 'prompt_opened', 'prompt_copied', 'poster_saved', 'poster_shared',
  'video_downloaded', 'video_shared', 'ticket_saved', 'ticket_shared', 'summary_copied', 'kakao_share', 'result_viewed', 'restart', 'lookup_open',
]);
route('POST', '/api/event', async (req, res) => {
  const { name, meta } = await readBody(req, 4096);
  if (!EVENT_NAMES.has(name)) fail(400, 'unknown event');
  const s = current(req);
  rateLimit(`ev:${s?.id || ip(req)}`, 200, 600000);
  logEvent(s?.id, name, meta && typeof meta === 'object' ? meta : null);
  json(res, 200, { ok: true });
});

// ───────────── Admin ─────────────
function requireAdmin(req) {
  const t = req.headers['x-admin-token'] || new URL(req.url, 'http://x').searchParams.get('token');
  const a = Buffer.from(String(t || '')), b = Buffer.from(config.adminToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(401, 'admin token required');
}

route('GET', '/api/admin/stats', async (req, res) => {
  requireAdmin(req);
  const funnelSteps = ['session_start', 'phone_ok', 'genre_selected', 'story_built', 'poster_requested', 'poster_done', 'video_requested', 'video_done', 'kakao_sent', 'result_viewed'];
  const funnel = funnelSteps.map((name) => ({ name, sessions: queryOne('SELECT COUNT(DISTINCT session_id) AS n FROM events WHERE name = ?', name).n }));
  const avg = (name) => {
    const rows = query('SELECT meta FROM events WHERE name = ? ORDER BY id DESC LIMIT 200', name).map((r) => JSON.parse(r.meta || '{}').ms).filter(Number.isFinite);
    return rows.length ? Math.round(rows.reduce((a, b) => a + b, 0) / rows.length / 1000) : null;
  };
  const failures = query("SELECT name, meta, ts FROM events WHERE name IN ('poster_failed','video_failed') ORDER BY id DESC LIMIT 20");
  const recent = query('SELECT * FROM sessions WHERE phone_masked IS NOT NULL ORDER BY created_at DESC LIMIT 50').map((s) => ({
    created: s.created_at, phone: s.phone_masked, director: s.director, genre: s.genre, title: s.story?.title,
    poster: s.poster_status, video: s.video_status, kakao: s.kakao_status, marketing: !!s.consent_marketing,
    result: s.result_token ? `/r/${s.result_token}` : null,
  }));
  const outbox = query('SELECT id, phone_masked, template, status, error, ts, payload FROM kakao_outbox ORDER BY id DESC LIMIT 30');
  json(res, 200, {
    mode: config.mock ? 'mock' : 'live', models: { llm: config.ark.llmModel, image: config.ark.imageModel, video: config.ark.videoModel },
    kakaoProvider: config.kakao.provider, queue: queueStats(), funnel,
    avgPosterSec: avg('poster_done'), avgVideoSec: avg('video_done'), failures, recent, outbox,
    leads: queryOne('SELECT COUNT(*) AS n FROM sessions WHERE phone_hash IS NOT NULL').n,
    uniquePhones: queryOne('SELECT COUNT(DISTINCT phone_hash) AS n FROM sessions WHERE phone_hash IS NOT NULL').n,
  });
});

route('GET', '/api/admin/screen', async (req, res) => {
  requireAdmin(req);
  const rows = query('SELECT * FROM sessions WHERE screen_poster IS NOT NULL OR screen_video IS NOT NULL ORDER BY MAX(COALESCE(screen_poster_at,0), COALESCE(screen_video_at,0)) DESC LIMIT 100');
  json(res, 200, {
    autoApprove: config.screen.autoApprove,
    items: rows.map((s) => ({
      ...screenItem(s, 'trailer'),
      poster: media(s.poster_final_file || s.poster_file),
      posterStatus: s.screen_poster, posterAt: s.screen_poster_at,
      trailerStatus: s.screen_video, trailerAt: s.screen_video_at,
    })),
  });
});

route('POST', '/api/admin/screen', async (req, res) => {
  requireAdmin(req);
  const { id, kind, status } = await readBody(req);
  const cols = SCREEN_KINDS[kind];
  if (!cols || !['live', 'hidden'].includes(status)) fail(400, 'bad request');
  const s = queryOne('SELECT * FROM sessions WHERE screen_id = ?', String(id || ''));
  if (!s || !s[cols[0]]) fail(404, 'not found');
  updateSession(s.id, { [cols[0]]: status });
  logEvent(s.id, `screen_${kind}_${status}`);
  json(res, 200, { ok: true });
});

// Pre-registered numbers & experiences per person
route('GET', '/api/admin/allowlist', async (req, res) => {
  requireAdmin(req);
  json(res, 200, { enabled: allowlistEnabled(), count: allowlistCount(), recent: allowlistRecent(30), maxFlows: config.limits.phoneMaxFlows });
});
route('POST', '/api/admin/allowlist', async (req, res) => {
  requireAdmin(req);
  const { action, text, mode, enabled, phone } = await readBody(req, 4 * 1024 * 1024);
  if (action === 'toggle') {
    if (enabled && !allowlistCount()) fail(400, '명단이 비어 있어요. 번호를 먼저 올린 뒤 켜 주세요.');
    setAllowlistEnabled(!!enabled);
    console.log(`[admin] allowlist ${enabled ? 'ON' : 'OFF'}`);
    return json(res, 200, { enabled: allowlistEnabled() });
  }
  if (action === 'upload') {
    const { numbers, invalid } = parseNumbers(text);
    if (!numbers.length) fail(400, '올바른 휴대폰 번호를 찾지 못했어요.');
    const r = saveAllowlist(numbers, mode === 'replace' ? 'replace' : 'add');
    console.log(`[admin] allowlist ${mode}: ${numbers.length} numbers, total ${r.after}`);
    return json(res, 200, { parsed: numbers.length, invalid: invalid.slice(0, 50), invalidCount: invalid.length, ...r });
  }
  if (action === 'clear') {
    clearAllowlist();
    setAllowlistEnabled(false);
    console.log('[admin] allowlist cleared and switched off');
    return json(res, 200, { count: 0, enabled: false });
  }
  if (action === 'check' || action === 'grant') {
    if (action === 'grant' && !grantExtraFlow(phone)) fail(400, '명단에 있는 번호만 횟수를 추가할 수 있어요.');
    const st = phoneStatus(phone);
    if (!st) fail(400, '휴대폰 번호 형식을 확인해 주세요.');
    return json(res, 200, st);
  }
  fail(400, 'bad request');
});

route('GET', '/api/admin/content', async (req, res) => {
  requireAdmin(req);
  json(res, 200, getContent());
});

route('PUT', '/api/admin/content', async (req, res) => {
  requireAdmin(req);
  const body = await readBody(req, 512 * 1024);
  const errs = saveContent(body);
  if (errs.length) return json(res, 400, { error: errs.join('\n') });
  json(res, 200, { ok: true });
});

// ───────────── static + media ─────────────
function serveFile(req, res, file, { cache = 'no-cache', download } = {}) {
  let stat;
  try { stat = fs.statSync(file); } catch { return false; }
  if (!stat.isFile()) return false;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const text = rebased(file); // pages, scripts and styles get the BASE_PATH prefix on their links
  if (text != null) {
    const buf = Buffer.from(text);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache, 'Content-Length': buf.length });
    res.end(req.method === 'HEAD' ? undefined : buf);
    return true;
  }
  const headers = { 'Content-Type': type, 'Cache-Control': cache, 'Accept-Ranges': 'bytes' };
  if (download) headers['Content-Disposition'] = `attachment; filename="${download}"`;
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start < 0 || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return true;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file, { start, end }).pipe(res);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(file).pipe(res);
  return true;
}

function serveIndex(res, meta) {
  let html = rebaseText(fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8'), true);
  if (meta) {
    const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    html = html.replace('<!--OG-->', [
      `<meta property="og:title" content="${esc(meta.title)}">`,
      `<meta property="og:description" content="${esc(meta.description)}">`,
      meta.image ? `<meta property="og:image" content="${esc(config.publicBaseUrl + meta.image)}">` : '',
    ].join('\n'));
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const at = insideBase(decodeURIComponent(url.pathname), url.search);
  if (at.redirect) { res.writeHead(302, { Location: at.redirect }); return res.end(); }
  const p = at.path;
  try {
    if (p.startsWith('/api/')) {
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(p);
        if (m) return await r.handler(req, res, Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]])));
      }
      fail(404, 'not found');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'method not allowed');

    if (p.startsWith('/media/')) {
      const name = path.basename(p);
      // Only our temp files are private (_mock_*, _conv_*). Random names can start with "_" too
      // (base64url), so blocking every leading underscore hid about 1 in 64 real posters/trailers.
      if (/^_(mock|conv)_/.test(name) || !serveFile(req, res, path.join(MEDIA_DIR, name), {
        cache: 'public, max-age=604800, immutable',
        download: url.searchParams.get('dl') ? `seedance-cinema-${name.slice(0, 6)}${path.extname(name)}` : undefined,
      })) fail(404, 'not found');
      return;
    }
    if (p === '/admin') return serveFile(req, res, path.join(PUBLIC_DIR, 'admin.html'));
    if (p === '/screen' || p === '/screen/') return serveFile(req, res, path.join(PUBLIC_DIR, 'screen', 'index.html'));
    if (p === '/screen/poster' || p === '/screen/trailer') return serveFile(req, res, path.join(PUBLIC_DIR, 'screen', `${p.slice(8)}.html`));
    if (p === '/poster' || p === '/trailer') return serveFile(req, res, path.join(PUBLIC_DIR, 'screen', `${p.slice(1)}.html`)); // short screen addresses
    if (p.startsWith('/r/')) {
      const s = getSessionByToken(p.slice(3));
      return serveIndex(res, s?.story ? {
        title: `${s.story.title} — A FILM BY ${s.director}`,
        description: s.story.tagline,
        image: media(s.poster_final_file || s.poster_file),
      } : null);
    }
    const file = path.join(PUBLIC_DIR, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (file.startsWith(PUBLIC_DIR) && p !== '/' && serveFile(req, res, file)) return;
    return serveIndex(res, null);
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) json(res, status, { ...(status !== 500 && e.extra), error: status === 500 ? '서버에 일시적인 문제가 생겼어요.' : e.message, code: e.code });
    else res.end();
  }
});

startJobs();
server.listen(config.port, () => {
  console.log(`\n🎬 Seedance @ Seoul AI Film Festival  →  http://localhost:${config.port}${BASE}/`);
  console.log(`   mode: ${config.mock ? 'MOCK (데모 — ARK_API_KEY 미설정)' : 'LIVE'}  ·  kakao: ${config.kakao.provider}`);
  console.log(`   admin: http://localhost:${config.port}${BASE}/admin?token=${config.adminToken}`);
  console.log(`   screens: http://localhost:${config.port}${BASE}/screen/poster  ·  /screen/trailer\n`);
});
