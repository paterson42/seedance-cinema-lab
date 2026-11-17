// Per-phone daily limits. The per-session limits reset whenever a visitor starts over, so the
// real cap is per phone number per day (Seoul time), counted across all of that number's sessions
// from the event log. Failed generations do not count against the visitor.
import { config } from './config.js';
import { queryOne } from './db.js';

const DAY_MS = 86400000;
const KST_MS = 9 * 3600000;
const kstDayStart = (t = Date.now()) => Math.floor((t + KST_MS) / DAY_MS) * DAY_MS - KST_MS;

const KINDS = {
  story: {
    used: 'story_built',
    max: () => config.limits.phoneDailyStories,
    message: '오늘 이 번호로 쓸 수 있는 시나리오 수를 모두 사용했어요. 내일 다시 참여해 주세요.',
  },
  poster: {
    used: 'poster_requested',
    failed: 'poster_failed',
    max: () => config.limits.phoneDailyPosters,
    message: '오늘 이 번호로 만들 수 있는 포스터 수를 모두 사용했어요. 내일 다시 참여해 주세요.',
  },
  video: {
    used: 'video_requested',
    failed: 'video_failed',
    max: () => config.limits.phoneDailyVideos,
    message: `트레일러는 번호당 하루 ${config.limits.phoneDailyVideos}편까지 만들 수 있어요. 오늘은 모두 만들었어요!`,
  },
};

function countToday(phoneHash, name) {
  return queryOne(
    'SELECT COUNT(*) AS n FROM events WHERE name = ? AND ts >= ? AND session_id IN (SELECT id FROM sessions WHERE phone_hash = ?)',
    name, kstDayStart(), phoneHash,
  ).n;
}

/** How many more of this kind the session's phone number may start today. */
export function dailyLeft(s, kind) {
  const k = KINDS[kind];
  if (!s?.phone_hash) return k.max();
  const used = countToday(s.phone_hash, k.used) - (k.failed ? countToday(s.phone_hash, k.failed) : 0);
  return Math.max(0, k.max() - Math.max(0, used));
}

/** Throws 429 DAILY_LIMIT when the phone number has used up today's allowance. */
export function assertDaily(s, kind, fail) {
  if (dailyLeft(s, kind) <= 0) fail(429, KINDS[kind].message, 'DAILY_LIMIT');
}
