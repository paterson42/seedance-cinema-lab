#!/usr/bin/env node
// Per phone number: which generations were asked for (story = Seed, poster = Seedream, trailer =
// Seedance) and whether a trailer was finished. For handing out rewards after the event.
// Backend only: reads the apps' databases read-only, shows nothing to visitors and leaves the
// running services alone. Works for the film app and the ads app (same tables), merged by number.
//
//   node deploy/phone-report.mjs                          this app, numbers masked, CSV on stdout
//   node deploy/phone-report.mjs film=/opt/seedance-cinema-lab ad=/opt/seedance-commerce-lab
//   ... --full --out /root/rewards.csv                    real numbers, into a file only (mode 600)
//
// Phone numbers are cleared RETENTION_DAYS (30) after a session started: export before then.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const KINDS = { seed: 'story_built', seedream: 'poster_requested', seedreamDone: 'poster_done', seedance: 'video_requested', seedanceDone: 'video_done' };
const COUNTS = [...Object.keys(KINDS), 'seedanceRunning', 'sessions'];

// ── one app (child process: each app loads its own .env and secret, which must not mix) ──
async function readApp(dir) {
  if (!fs.existsSync(path.join(dir, 'data', 'app.db'))) throw new Error(`no database in ${dir}`);
  const at = (f) => pathToFileURL(path.join(dir, 'server', f)).href;
  const { DATA_DIR } = await import(at('config.js'));
  const { decrypt, isTestPhone } = await import(at('privacy.js'));
  const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'), { readOnly: true });

  const names = Object.values(KINDS);
  const events = new Map(); // session id -> { event name: { n, last } }
  for (const e of db.prepare(`SELECT session_id AS id, name, COUNT(*) AS n, MAX(ts) AS last FROM events WHERE name IN (${names.map(() => '?').join(',')}) GROUP BY session_id, name`).all(...names)) {
    if (!events.has(e.id)) events.set(e.id, {});
    events.get(e.id)[e.name] = e;
  }

  const byHash = new Map();
  let unreadable = 0;
  for (const s of db.prepare('SELECT id, phone_enc, phone_hash, created_at, video_status FROM sessions WHERE phone_hash IS NOT NULL ORDER BY created_at').all()) {
    let r = byHash.get(s.phone_hash);
    if (!r) {
      let phone;
      try { phone = decrypt(s.phone_enc); } catch { unreadable++; byHash.set(s.phone_hash, null); continue; }
      r = { phone, test: isTestPhone(phone), first: s.created_at, videoAt: null };
      for (const k of COUNTS) r[k] = 0;
      byHash.set(s.phone_hash, r);
    }
    r.sessions++;
    const ev = events.get(s.id) || {};
    for (const [k, name] of Object.entries(KINDS)) r[k] += ev[name]?.n || 0;
    if (ev.video_done) r.videoAt = Math.max(r.videoAt || 0, ev.video_done.last);
    if (['queued', 'submitting', 'running'].includes(s.video_status)) r.seedanceRunning++;
  }
  // sessions whose number has already been cleared by the retention job cannot be credited to anyone
  const cleared = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE phone_hash IS NULL AND phone_masked IS NOT NULL').get().n;
  return { rows: [...byHash.values()].filter(Boolean), unreadable, cleared };
}

if (process.argv[2] === '--read') {
  try { process.stdout.write(JSON.stringify(await readApp(process.argv[3]))); } catch (e) { console.error(e.message); process.exit(1); }
  process.exit(0);
}

// ── report ──
const args = process.argv.slice(2);
const full = args.includes('--full');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const apps = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--out').map((a) => {
  const i = a.indexOf('=');
  return i > 0 ? [a.slice(0, i), path.resolve(a.slice(i + 1))] : [path.basename(path.resolve(a)), path.resolve(a)];
});
if (!apps.length) apps.push(['film', path.resolve(path.dirname(SELF), '..')]);
if (full && !out) { console.error('--full writes real phone numbers: give a file with --out <file>'); process.exit(1); }

const people = new Map(); // phone -> { test, first, videoAt, per: { app: counts } }
for (const [app, dir] of apps) {
  const r = spawnSync(process.execPath, ['--no-warnings=ExperimentalWarning', SELF, '--read', dir], { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(`${app}: ${(r.stderr || '').trim().split('\n').pop() || 'failed'}`); process.exit(1); }
  const { rows, unreadable, cleared } = JSON.parse(r.stdout);
  for (const x of rows) {
    const p = people.get(x.phone) || { test: x.test, first: x.first, videoAt: null, per: {} };
    p.test ||= x.test;
    p.first = Math.min(p.first, x.first);
    if (x.videoAt) p.videoAt = Math.max(p.videoAt || 0, x.videoAt);
    p.per[app] = x;
    people.set(x.phone, p);
  }
  console.error(`${app}: ${rows.length} numbers` + (cleared ? ` · ${cleared} older sessions already have their number cleared (not in the report)` : '') + (unreadable ? ` · ${unreadable} NUMBERS COULD NOT BE READ (wrong APP_SECRET?)` : ''));
}

const kst = (t) => (t ? new Date(t + 9 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '');
const show = (p) => (full
  ? (p.length === 11 ? `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}` : p.length === 10 ? `${p.slice(0, 3)}-${p.slice(3, 6)}-${p.slice(6)}` : p)
  : `${p.slice(0, 3)}-****-${p.slice(-4)}`);
const sum = (p, k) => apps.reduce((n, [app]) => n + (p.per[app]?.[k] || 0), 0);
const yn = (b) => (b ? 'Y' : 'N');

const head = ['phone', 'test_number', 'seed_requested', 'seedream_requested', 'seedance_requested', 'video_ok',
  'seed_count', 'seedream_count', 'seedream_done', 'seedance_count', 'seedance_done', 'seedance_in_progress', 'first_seen_kst', 'last_video_kst'];
if (apps.length > 1) for (const [app] of apps) head.push(`${app}_seed`, `${app}_seedream`, `${app}_seedance`, `${app}_video_done`);

const list = [...people].map(([phone, p]) => ({ phone, p, ok: sum(p, 'seedanceDone') > 0 }))
  .sort((a, b) => a.p.test - b.p.test || b.ok - a.ok || a.p.first - b.p.first);
const lines = [head.join(',')];
for (const { phone, p, ok } of list) {
  const row = [show(phone), yn(p.test), yn(sum(p, 'seed')), yn(sum(p, 'seedream')), yn(sum(p, 'seedance')), yn(ok),
    sum(p, 'seed'), sum(p, 'seedream'), sum(p, 'seedreamDone'), sum(p, 'seedance'), sum(p, 'seedanceDone'), sum(p, 'seedanceRunning'), kst(p.first), kst(p.videoAt)];
  if (apps.length > 1) for (const [app] of apps) { const x = p.per[app] || {}; row.push(x.seed || 0, x.seedream || 0, x.seedance || 0, x.seedanceDone || 0); }
  lines.push(row.join(','));
}
const csv = lines.join('\n') + '\n';
if (out) { fs.writeFileSync(out, csv, { mode: 0o600 }); fs.chmodSync(out, 0o600); } else process.stdout.write(csv);

const real = list.filter((x) => !x.p.test);
const n = (k) => real.filter((x) => sum(x.p, k) > 0).length;
console.error(`${real.length} numbers (+${list.length - real.length} test) · seed ${n('seed')} · seedream ${n('seedream')} · seedance ${n('seedance')} · video ok ${n('seedanceDone')}` + (out ? ` → ${out}${full ? ' (real numbers: keep this file private)' : ''}` : ''));
