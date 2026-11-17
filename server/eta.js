// Wait-time estimates for the countdowns. ModelArk returns no progress or ETA, so we
// learn from recent real runs: the median of the last few successful jobs (last 3h),
// falling back to POSTER_ETA_SEC / VIDEO_ETA_SEC until enough runs exist.
import { config } from './config.js';
import { query } from './db.js';

const WINDOW_MS = 3 * 3600 * 1000;
const SAMPLE = 8;
const MIN_SAMPLES = 2;
const CACHE_MS = 15000;
let cache = { at: 0, poster: 0, video: 0 };

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function learn() {
  const since = Date.now() - WINDOW_MS;
  // Poster: pure generation time (queue wait is added separately from the queue position).
  const p = query("SELECT meta FROM events WHERE name = 'poster_done' AND ts > ? ORDER BY ts DESC LIMIT ?", since, SAMPLE)
    .map((r) => JSON.parse(r.meta || '{}').ms / 1000)
    .filter((x) => x > 0);
  // Video: request → done, the same origin the waiting screen counts from.
  const v = query(
    "SELECT (video_done_at - video_requested_at) AS ms FROM sessions WHERE video_status = 'done' AND video_done_at > ? AND video_requested_at IS NOT NULL ORDER BY video_done_at DESC LIMIT ?",
    since, SAMPLE,
  ).map((r) => r.ms / 1000).filter((x) => x > 0);
  const fallbackP = config.mock ? config.mockPosterDelaySec + 1 : config.queue.posterEtaSec;
  const fallbackV = config.mock ? config.mockVideoDelaySec + 5 : config.queue.videoEtaSec;
  cache = {
    at: Date.now(),
    poster: Math.round(p.length >= MIN_SAMPLES ? median(p) : fallbackP),
    video: Math.round(v.length >= MIN_SAMPLES ? median(v) : fallbackV),
  };
}

/** Estimated seconds from request to done for one job, including the wait for a free slot. */
export function etaSec(kind, queuePos = 0) {
  if (Date.now() - cache.at > CACHE_MS) learn();
  const base = cache[kind];
  const slots = kind === 'poster' ? config.queue.posterConcurrency : config.queue.videoMaxInflight;
  const ahead = Math.max(0, queuePos - 1);
  return base * (1 + Math.floor(ahead / Math.max(1, slots)));
}
