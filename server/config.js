import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const MEDIA_DIR = path.join(DATA_DIR, 'media');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const CONTENT_FILE = path.join(ROOT, 'config', 'content.json');

fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Minimal .env loader (no dependency). Real environment variables win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const env = (k, d = '') => (process.env[k] ?? '').trim() || d;
const num = (k, d) => {
  const v = Number(env(k, ''));
  return Number.isFinite(v) && env(k, '') !== '' ? v : d;
};
const bool = (k, d) => {
  const v = env(k, '');
  return v === '' ? d : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

function persistentSecret(file, bytes) {
  const p = path.join(DATA_DIR, file);
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  const s = crypto.randomBytes(bytes).toString('base64url');
  fs.writeFileSync(p, s, { mode: 0o600 });
  return s;
}

const port = num('PORT', 3000);
const arkKey = env('ARK_API_KEY');

export const config = {
  port,
  publicBaseUrl: env('PUBLIC_BASE_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  publicBaseUrlSet: !!env('PUBLIC_BASE_URL'),
  appSecret: env('APP_SECRET') || persistentSecret('.secret', 32),
  adminToken: env('ADMIN_TOKEN') || persistentSecret('.admin-token', 12),
  mock: !arkKey || bool('MOCK', false),
  ark: {
    apiKey: arkKey,
    baseUrl: env('ARK_BASE_URL', 'https://ark.ap-southeast.bytepluses.com/api/v3').replace(/\/$/, ''),
    llmModel: env('SEED_LLM_MODEL', 'seed-1-6-250615'),
    llmEnabled: bool('SEED_LLM_ENABLED', true),
    imageModel: env('SEEDREAM_MODEL', 'seedream-4-0-250828'),
    imageSize: env('SEEDREAM_SIZE', '1280x1920'),
    imageSendSeed: bool('SEEDREAM_SEND_SEED', true),
    videoModel: env('SEEDANCE_MODEL', 'seedance-1-0-pro-250528'),
    videoResolution: env('SEEDANCE_RESOLUTION', '720p'),
    videoDuration: num('SEEDANCE_DURATION', 10),
    videoSendSeed: bool('SEEDANCE_SEND_SEED', true),
  },
  queue: {
    posterConcurrency: num('POSTER_CONCURRENCY', 6),
    videoMaxInflight: num('VIDEO_MAX_INFLIGHT', 10),
    videoPollSec: num('VIDEO_POLL_SEC', 8),
    videoEtaSec: num('VIDEO_ETA_SEC', 240),
    posterMaxPerSession: num('POSTER_MAX_PER_SESSION', 3),
    videoMaxPerSession: num('VIDEO_MAX_PER_SESSION', 2),
  },
  kakao: {
    provider: env('KAKAO_PROVIDER', 'mock'),
    webhookUrl: env('KAKAO_WEBHOOK_URL'),
    webhookToken: env('KAKAO_WEBHOOK_TOKEN'),
    templateCode: env('KAKAO_TEMPLATE_CODE', 'SCL_TRAILER_READY'),
    jsKey: env('KAKAO_JS_KEY'),
  },
  screen: {
    autoApprove: bool('SCREEN_AUTO_APPROVE', true),
    key: env('SCREEN_KEY'),
  },
  resultTtlDays: num('RESULT_TTL_DAYS', 14),
  retentionDays: num('RETENTION_DAYS', 30),
  mockPosterDelaySec: num('MOCK_POSTER_DELAY_SEC', 4),
  mockVideoDelaySec: num('MOCK_VIDEO_DELAY_SEC', 25),
};
