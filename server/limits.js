// Per-phone rules: daily generation limits, the pre-registered number list and the number of
// experiences per person. Per-phone daily limits: the per-session limits reset whenever a visitor starts over, so the
// real cap is per phone number per day (Seoul time), counted across all of that number's sessions
// from the event log. Failed generations do not count against the visitor.
import { config } from './config.js';
import { db, queryOne, query } from './db.js';
import { normalizePhone, maskPhone, hashPhone } from './privacy.js';

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

// ───────────── Pre-registered numbers (allowlist) ─────────────
// When switched on in /admin, only listed numbers can enter and generate. Only the HMAC hash and a
// masked form are stored, never the raw number.
export function allowlistEnabled() {
  return queryOne("SELECT value FROM settings WHERE key = 'allowlist_enabled'")?.value === '1';
}
export function setAllowlistEnabled(on) {
  db.prepare("INSERT INTO settings (key, value) VALUES ('allowlist_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(on ? '1' : '0');
}
const listedRow = (hash) => (hash ? queryOne('SELECT * FROM allowlist WHERE phone_hash = ?', hash) : null);
export const allowlistCount = () => queryOne('SELECT COUNT(*) AS n FROM allowlist').n;
export const allowlistRecent = (n = 30) => query('SELECT phone_masked, extra_flows, added_at FROM allowlist ORDER BY added_at DESC LIMIT ?', n);

/** Pulls every Korean mobile number out of pasted text / CSV. */
export function parseNumbers(text) {
  const found = new Map();
  const invalid = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const hits = line.match(/(?:\+?82[\s-]?)?0?1[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/g) || [];
    let ok = false;
    for (const h of hits) {
      // Excel often drops the leading 0 (1012345678)
      const d = h.replace(/\D/g, '');
      const p = normalizePhone(h) || (/^1[016789]\d{7,8}$/.test(d) ? normalizePhone(`0${d}`) : null);
      if (p) { found.set(p, true); ok = true; }
    }
    if (!ok && /\d{6,}/.test(line.replace(/[\s.-]/g, ''))) invalid.push(line.trim().slice(0, 40));
  }
  return { numbers: [...found.keys()], invalid };
}

/** mode 'add' keeps existing numbers; 'replace' keeps only these (extra flows kept for numbers that stay). */
export function saveAllowlist(numbers, mode) {
  const hashes = numbers.map(hashPhone);
  const before = allowlistCount();
  db.exec('BEGIN');
  try {
    if (mode === 'replace') {
      db.exec('CREATE TEMP TABLE IF NOT EXISTS keep (h TEXT PRIMARY KEY)');
      db.exec('DELETE FROM keep');
      const k = db.prepare('INSERT OR IGNORE INTO keep (h) VALUES (?)');
      for (const h of hashes) k.run(h);
      db.exec('DELETE FROM allowlist WHERE phone_hash NOT IN (SELECT h FROM keep)');
    }
    const ins = db.prepare('INSERT OR IGNORE INTO allowlist (phone_hash, phone_masked, extra_flows, added_at) VALUES (?, ?, 0, ?)');
    const now = Date.now();
    numbers.forEach((p, i) => ins.run(hashes[i], maskPhone(p), now));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return { before, after: allowlistCount() };
}
export function clearAllowlist() { db.exec('DELETE FROM allowlist'); }

// ───────────── Experiences per person ─────────────
// One "experience" = one session of that number in which a poster was made (or is being made).
// Regenerating inside the same session is the same experience; failed attempts do not count.
const COUNTED = "(poster_count > 0 OR poster_status IN ('queued', 'running'))";
const sessionCounted = (s) => (s.poster_count || 0) > 0 || ['queued', 'running'].includes(s.poster_status);

export function flowInfo(s) {
  if (!s?.phone_hash) return null;
  const used = queryOne(`SELECT COUNT(*) AS n FROM sessions WHERE phone_hash = ? AND ${COUNTED}`, s.phone_hash).n;
  const max = config.limits.phoneMaxFlows + (listedRow(s.phone_hash)?.extra_flows || 0);
  return { used, max, left: Math.max(0, max - used), counted: sessionCounted(s) };
}

const MSG = {
  NOT_ALLOWED: '사전 등록된 번호만 체험할 수 있어요. 신청할 때 입력한 번호인지 확인해 주세요.',
  FLOW_LIMIT: (max) => `체험은 1인 ${max}회까지예요. 이 번호로는 모두 체험했어요! ‘내 결과 다시 보기’에서 작품을 볼 수 있어요.`,
};

/** Entry check for a number that is about to join (before it is saved on the session). */
export function assertPhoneMayEnter(phone, fail) {
  const hash = hashPhone(phone);
  if (allowlistEnabled() && !listedRow(hash)) fail(403, MSG.NOT_ALLOWED, 'NOT_ALLOWED');
  const f = flowInfo({ phone_hash: hash });
  if (config.limits.phoneMaxFlows > 0 && f.left <= 0) fail(429, MSG.FLOW_LIMIT(f.max), 'FLOW_LIMIT');
}

/** Checks on every generation step. A session that already started its experience may finish it. */
export function assertMayGenerate(s, fail) {
  if (allowlistEnabled() && !listedRow(s.phone_hash)) fail(403, MSG.NOT_ALLOWED, 'NOT_ALLOWED');
  if (config.limits.phoneMaxFlows <= 0) return;
  const f = flowInfo(s);
  if (!f.counted && f.left <= 0) fail(429, MSG.FLOW_LIMIT(f.max), 'FLOW_LIMIT');
}

/** For staff: what is the state of this number? */
export function phoneStatus(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const hash = hashPhone(p);
  const row = listedRow(hash);
  const f = flowInfo({ phone_hash: hash });
  const s = { phone_hash: hash };
  return { masked: maskPhone(p), listed: !!row, extraFlows: row?.extra_flows || 0, flowsUsed: f.used, flowsMax: f.max, trailersLeftToday: dailyLeft(s, 'video') };
}
export function grantExtraFlow(phone) {
  const p = normalizePhone(phone);
  if (!p) return false;
  const r = db.prepare('UPDATE allowlist SET extra_flows = extra_flows + 1 WHERE phone_hash = ?').run(hashPhone(p));
  return r.changes > 0;
}
