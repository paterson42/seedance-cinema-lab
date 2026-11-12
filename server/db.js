import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from './config.js';

export const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;

CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  phone_enc         TEXT,
  phone_hash        TEXT,
  phone_masked      TEXT,
  consent_at        INTEGER,
  consent_marketing INTEGER DEFAULT 0,
  genre             TEXT,
  keywords          TEXT,
  director          TEXT,
  seed              INTEGER,
  story             TEXT,
  poster_prompt     TEXT,
  video_prompt      TEXT,
  poster_status     TEXT DEFAULT 'idle',
  poster_requested_at INTEGER,
  poster_file       TEXT,
  poster_final_file TEXT,
  poster_error      TEXT,
  poster_count      INTEGER DEFAULT 0,
  video_status      TEXT DEFAULT 'idle',
  video_requested_at INTEGER,
  video_task_id     TEXT,
  video_submitted_at INTEGER,
  video_done_at     INTEGER,
  video_file        TEXT,
  video_error       TEXT,
  video_count       INTEGER DEFAULT 0,
  result_token      TEXT UNIQUE,
  result_expires_at INTEGER,
  kakao_status      TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_phone ON sessions(phone_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_poster ON sessions(poster_status, poster_requested_at);
CREATE INDEX IF NOT EXISTS idx_sessions_video ON sessions(video_status, video_requested_at);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  name       TEXT NOT NULL,
  meta       TEXT,
  ts         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);

CREATE TABLE IF NOT EXISTS kakao_outbox (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT,
  phone_masked TEXT,
  template     TEXT,
  payload      TEXT,
  status       TEXT,
  error        TEXT,
  ts           INTEGER NOT NULL
);
`);

// Lightweight migrations for columns added after the first release.
const MIGRATIONS = {
  screen_id: 'TEXT',
  screen_poster: 'TEXT',      // null | pending | live | hidden  (lobby poster wall)
  screen_poster_at: 'INTEGER',
  screen_video: 'TEXT',       // null | pending | live | hidden  (trailer screen)
  screen_video_at: 'INTEGER',
};
const have = new Set(db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name));
for (const [col, type] of Object.entries(MIGRATIONS)) if (!have.has(col)) db.exec(`ALTER TABLE sessions ADD COLUMN ${col} ${type}`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_screen ON sessions(screen_id)');

const JSON_COLS = new Set(['keywords', 'story']);

function decode(row) {
  if (!row) return null;
  for (const k of JSON_COLS) if (row[k]) row[k] = JSON.parse(row[k]);
  return { ...row };
}

export function createSession(id) {
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)').run(id, now, now);
  return getSession(id);
}

export function getSession(id) {
  if (!id) return null;
  return decode(db.prepare('SELECT * FROM sessions WHERE id = ?').get(id));
}

export function getSessionByToken(token) {
  if (!token) return null;
  return decode(db.prepare('SELECT * FROM sessions WHERE result_token = ?').get(token));
}

export function updateSession(id, patch) {
  const keys = Object.keys(patch);
  if (!keys.length) return getSession(id);
  const vals = keys.map((k) => (JSON_COLS.has(k) && patch[k] != null ? JSON.stringify(patch[k]) : patch[k]));
  db.prepare(`UPDATE sessions SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...vals,
    Date.now(),
    id,
  );
  return getSession(id);
}

export function query(sql, ...params) {
  return db.prepare(sql).all(...params).map(decode);
}

export function queryOne(sql, ...params) {
  return decode(db.prepare(sql).get(...params));
}

export function logEvent(sessionId, name, meta) {
  db.prepare('INSERT INTO events (session_id, name, meta, ts) VALUES (?, ?, ?, ?)').run(
    sessionId || null,
    name,
    meta ? JSON.stringify(meta) : null,
    Date.now(),
  );
}
