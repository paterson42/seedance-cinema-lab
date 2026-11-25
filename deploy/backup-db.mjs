#!/usr/bin/env node
// Copies each app's database into a backup folder. The copy is a consistent snapshot taken with
// SQLite's online backup, so it is safe while the app is running; the app's files are only read.
// The database is the record rewards are handed out from (see phone-report.mjs).
//
//   node deploy/backup-db.mjs film=/opt/seedance-cinema-lab ad=/opt/seedance-commerce-lab
//   ... --to /var/backups/seedance     where the copies go (default)
//   ... --keep-days 7                  older copies are deleted (default 7)
//
// Copies hold the same (encrypted) phone numbers as the database, so they are private (mode 600)
// and short-lived. They cannot be read without APP_SECRET from the app's .env.
// Restore: stop the service, copy a backup over data/app.db, delete data/app.db-wal and -shm, start.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

const args = process.argv.slice(2);
const opt = (name, d) => (args.includes(name) ? args[args.indexOf(name) + 1] : d);
const to = path.resolve(opt('--to', '/var/backups/seedance'));
const keepDays = Number(opt('--keep-days', 7));
const apps = args.filter((a, i) => !a.startsWith('--') && !['--to', '--keep-days'].includes(args[i - 1])).map((a) => a.split('='));
if (!apps.length || apps.some((a) => a.length !== 2) || !(keepDays > 0)) { console.error('usage: backup-db.mjs name=/app/dir [name=/app/dir ...] [--to dir] [--keep-days n]'); process.exit(1); }

fs.mkdirSync(to, { recursive: true, mode: 0o700 });
fs.chmodSync(to, 0o700);
const stamp = new Date(Date.now() + 9 * 3600000).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // Seoul time
let failed = 0;
for (const [name, dir] of apps) {
  const file = path.join(to, `${name}-${stamp}.db`);
  try {
    const src = new DatabaseSync(path.join(dir, 'data', 'app.db'), { readOnly: true });
    await backup(src, file);
    src.close();
    fs.chmodSync(file, 0o600);
    const copy = new DatabaseSync(file, { readOnly: true });
    const ok = copy.prepare('PRAGMA integrity_check').get().integrity_check;
    const n = (t) => copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const line = `${n('sessions')} sessions, ${n('events')} events, ${n('allowlist')} listed numbers`;
    copy.close();
    for (const x of ['-wal', '-shm']) fs.rmSync(file + x, { force: true }); // left by opening the copy; it is complete without them
    if (ok !== 'ok') throw new Error(`integrity check: ${ok}`);
    console.log(`${stamp} ${name}: ${path.basename(file)} ${Math.round(fs.statSync(file).size / 1024)} KB · ${line}`);
  } catch (e) {
    failed++;
    fs.rmSync(file, { force: true });
    console.error(`${stamp} ${name}: BACKUP FAILED — ${e.message}`);
  }
}
// old copies of the apps named above
const cutoff = Date.now() - keepDays * 86400000;
for (const f of fs.readdirSync(to)) {
  if (!apps.some(([name]) => new RegExp(`^${name}-\\d{8}-\\d{6}\\.db$`).test(f))) continue;
  const p = path.join(to, f);
  if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
}
process.exit(failed ? 1 : 0);
