// DB-driven generation queue. Survives restarts: queued work is picked up again,
// and in-flight Seedance tasks keep being polled by task id.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, MEDIA_DIR } from './config.js';
import { query, queryOne, getSession, updateSession, logEvent, db } from './db.js';
import { generateImage, submitVideo, getVideoTask } from './providers/ark.js';
import { sendTrailerReady } from './providers/kakao.js';

const runningPosters = new Set();
let videoPolling = false;
let submitting = 0;

function saveMedia(buffer, ext) {
  const name = `${crypto.randomBytes(16).toString('base64url')}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buffer);
  return name;
}

export function saveFinalPoster(sessionId, buffer) {
  const s = getSession(sessionId);
  if (s.poster_final_file) fs.rmSync(path.join(MEDIA_DIR, s.poster_final_file), { force: true });
  return updateSession(sessionId, { poster_final_file: saveMedia(buffer, 'jpg') });
}

// ───────────── Poster (Seedream) ─────────────
// A new poster/video replaces what was submitted to the big screens, so the visitor
// submits again. Items an operator hid stay hidden.
const unlessHidden = (v) => (v === 'hidden' ? 'hidden' : null);

export function enqueuePoster(sessionId) {
  const prev = getSession(sessionId);
  updateSession(sessionId, {
    screen_poster: unlessHidden(prev.screen_poster),
    screen_video: unlessHidden(prev.screen_video),
    poster_status: 'queued',
    poster_requested_at: Date.now(),
    poster_error: null,
    poster_final_file: null,
    video_status: 'idle',
    video_error: null,
  });
  setImmediate(tick);
}

async function runPoster(s) {
  runningPosters.add(s.id);
  const started = Date.now();
  updateSession(s.id, { poster_status: 'running' });
  try {
    const { buffer, ext } = await generateImage({ prompt: s.poster_prompt, seed: s.seed, genreId: s.genre });
    const file = saveMedia(buffer, ext);
    if (s.poster_file) fs.rmSync(path.join(MEDIA_DIR, s.poster_file), { force: true });
    // Only successful generations count towards the per-session limit.
    updateSession(s.id, { poster_status: 'done', poster_file: file, poster_count: (getSession(s.id).poster_count || 0) + 1 });
    logEvent(s.id, 'poster_done', { ms: Date.now() - started });
  } catch (e) {
    console.warn(`[poster] ${s.id} failed:`, e.message);
    updateSession(s.id, { poster_status: 'failed', poster_error: e.userMessage || '포스터를 만들지 못했어요. 다시 시도해 주세요.' });
    logEvent(s.id, 'poster_failed', { error: String(e.message).slice(0, 300) });
  } finally {
    runningPosters.delete(s.id);
    setImmediate(tick);
  }
}

// ───────────── Video (Seedance) ─────────────
export function enqueueVideo(sessionId) {
  const prev = getSession(sessionId);
  updateSession(sessionId, {
    screen_video: unlessHidden(prev.screen_video),
    video_status: 'queued',
    video_requested_at: Date.now(),
    video_error: null,
    video_task_id: null,
    kakao_status: null,
  });
  setImmediate(tick);
}

async function submit(s) {
  submitting++;
  updateSession(s.id, { video_status: 'submitting' });
  try {
    const taskId = await submitVideo({ prompt: s.video_prompt, imageFile: s.poster_file, seed: s.seed });
    updateSession(s.id, { video_status: 'running', video_task_id: taskId, video_submitted_at: Date.now() });
    logEvent(s.id, 'video_submitted', { taskId });
  } catch (e) {
    console.warn(`[video] submit ${s.id} failed:`, e.message);
    updateSession(s.id, { video_status: 'failed', video_error: e.userMessage || '영상 생성 요청에 실패했어요. 다시 시도해 주세요.' });
    logEvent(s.id, 'video_failed', { stage: 'submit', error: String(e.message).slice(0, 300) });
  } finally {
    submitting--;
  }
}

async function pollVideos() {
  if (videoPolling) return;
  videoPolling = true;
  try {
    const rows = query("SELECT * FROM sessions WHERE video_status = 'running' AND video_task_id IS NOT NULL");
    for (const s of rows) {
      try {
        const r = await getVideoTask(s.video_task_id);
        if (r.status === 'succeeded') {
          const file = r.buffer ? saveMedia(r.buffer, 'mp4') : null;
          if (s.video_file) fs.rmSync(path.join(MEDIA_DIR, s.video_file), { force: true });
          const done = updateSession(s.id, {
            video_status: 'done', video_file: file, video_done_at: Date.now(), video_count: (s.video_count || 0) + 1,
          });
          logEvent(s.id, 'video_done', { ms: Date.now() - s.video_requested_at });
          const k = await sendTrailerReady(done);
          updateSession(s.id, { kakao_status: k });
        } else if (r.status === 'failed') {
          updateSession(s.id, { video_status: 'failed', video_error: r.userMessage || '영상 생성에 실패했어요. 다시 시도해 주세요.' });
          logEvent(s.id, 'video_failed', { stage: 'task', error: String(r.error).slice(0, 300) });
        }
      } catch (e) {
        // Transient polling error: keep the task, try again next round.
        console.warn(`[video] poll ${s.id}:`, e.message);
      }
    }
  } finally {
    videoPolling = false;
  }
}

// ───────────── Dispatcher ─────────────
function tick() {
  const freePoster = config.queue.posterConcurrency - runningPosters.size;
  if (freePoster > 0) {
    const next = query("SELECT * FROM sessions WHERE poster_status = 'queued' ORDER BY poster_requested_at LIMIT ?", freePoster);
    for (const s of next) if (!runningPosters.has(s.id)) runPoster(s);
  }
  const inflight = queryOne("SELECT COUNT(*) AS n FROM sessions WHERE video_status IN ('running','submitting')").n;
  const freeVideo = config.queue.videoMaxInflight - inflight;
  if (freeVideo > 0 && submitting < 3) {
    const next = query("SELECT * FROM sessions WHERE video_status = 'queued' ORDER BY video_requested_at LIMIT ?", Math.min(freeVideo, 3 - submitting));
    for (const s of next) submit(s);
  }
}

export function queuePosition(kind, s) {
  if (kind === 'poster' && s.poster_status === 'queued') {
    return queryOne("SELECT COUNT(*) AS n FROM sessions WHERE poster_status = 'queued' AND poster_requested_at <= ?", s.poster_requested_at).n;
  }
  if (kind === 'video' && s.video_status === 'queued') {
    return queryOne("SELECT COUNT(*) AS n FROM sessions WHERE video_status = 'queued' AND video_requested_at <= ?", s.video_requested_at).n;
  }
  return 0;
}

export function queueStats() {
  const c = (sql) => queryOne(sql).n;
  return {
    posterQueued: c("SELECT COUNT(*) AS n FROM sessions WHERE poster_status = 'queued'"),
    posterRunning: runningPosters.size,
    videoQueued: c("SELECT COUNT(*) AS n FROM sessions WHERE video_status = 'queued'"),
    videoRunning: c("SELECT COUNT(*) AS n FROM sessions WHERE video_status IN ('running','submitting')"),
  };
}

function cleanup() {
  const cutoff = Date.now() - config.retentionDays * 86400000;
  const r = db.prepare('UPDATE sessions SET phone_enc = NULL, phone_hash = NULL WHERE created_at < ? AND phone_enc IS NOT NULL').run(cutoff);
  if (r.changes) console.log(`[retention] cleared phone numbers of ${r.changes} sessions older than ${config.retentionDays} days`);
}

export function startJobs() {
  // Work that was in memory when the process stopped goes back to the queue.
  db.prepare("UPDATE sessions SET poster_status = 'queued' WHERE poster_status = 'running'").run();
  db.prepare("UPDATE sessions SET video_status = 'queued' WHERE video_status = 'submitting'").run();
  setInterval(tick, 1000);
  setInterval(pollVideos, config.queue.videoPollSec * 1000);
  setInterval(cleanup, 6 * 3600 * 1000);
  cleanup();
  tick();
}
