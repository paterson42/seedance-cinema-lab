// DB-driven generation queue. Survives restarts: queued work is picked up again,
// and in-flight Seedance tasks keep being polled by task id.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, MEDIA_DIR } from './config.js';
import { query, queryOne, getSession, updateSession, logEvent, db } from './db.js';
import { generateImage, submitVideo, getVideoTask } from './providers/ark.js';
import { sendTrailerReady } from './providers/kakao.js';
import { token } from './privacy.js';
import { burnOverlay } from './overlay.js';

const runningPosters = new Set();
let videoPolling = false;
let submitting = 0;

function saveMedia(buffer, ext) {
  let id;
  do id = crypto.randomBytes(16).toString('base64url'); while (id.startsWith('_')); // "_" marks temp files
  const name = `${id}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buffer);
  return name;
}

const dropMedia = (file) => file && fs.rmSync(path.join(MEDIA_DIR, file), { force: true });

// overlay: the same lettering on a transparent background, burnt onto the video later.
export function saveFinalPoster(sessionId, buffer, overlay) {
  const s = getSession(sessionId);
  dropMedia(s.poster_final_file);
  const patch = { poster_final_file: saveMedia(buffer, 'jpg') };
  if (overlay) { dropMedia(s.poster_overlay_file); patch.poster_overlay_file = saveMedia(overlay, 'png'); }
  return updateSession(sessionId, patch);
}

// ───────────── Poster (Seedream) ─────────────
// Every finished poster goes on the booth poster screen by itself (staff can hide it in /admin).
// The phone uploads the titled version a few seconds after "done"; that upload posts it. If it
// never arrives (visitor closed the page), the raw poster is posted after this delay.
const AUTO_POST_FALLBACK_MS = 20000;
// Finished trailers go on the booth trailer screen by themselves too.
export function postTrailerToScreen(sessionId) {
  const s = getSession(sessionId);
  if (!s || s.video_status !== 'done' || !s.video_file || s.screen_video) return s;
  logEvent(sessionId, 'screen_trailer_submitted', { auto: true });
  return updateSession(sessionId, {
    screen_id: s.screen_id || token(8),
    screen_video: config.screen.autoApprove ? 'live' : 'pending',
    screen_video_at: Date.now(),
  });
}

export function postPosterToScreen(sessionId) {
  const s = getSession(sessionId);
  if (!s || s.poster_status !== 'done' || s.screen_poster) return s;
  logEvent(sessionId, 'screen_poster_submitted', { auto: true });
  return updateSession(sessionId, {
    screen_id: s.screen_id || token(8),
    screen_poster: config.screen.autoApprove ? 'live' : 'pending',
    screen_poster_at: Date.now(),
  });
}

// A new poster/video replaces what was on the big screens; the new one is posted again
// automatically when it is done. Items an operator hid stay hidden.
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
    poster_overlay_file: null,
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
    setTimeout(() => postPosterToScreen(s.id), AUTO_POST_FALLBACK_MS);
  } catch (e) {
    console.warn(`[poster] ${s.id} failed:`, e.message);
    updateSession(s.id, { poster_status: 'failed', poster_error: e.userMessage || '키비주얼을 만들지 못했어요. 다시 시도해 주세요.' });
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
          // Lay the key visual's lettering over the clip; the clean clip is kept beside it.
          const titled = r.buffer ? await burnOverlay(r.buffer, getSession(s.id).poster_overlay_file) : null;
          const raw = r.buffer ? saveMedia(r.buffer, 'mp4') : null;
          const file = titled ? saveMedia(titled, 'mp4') : raw;
          dropMedia(s.video_file);
          if (s.video_raw_file !== s.video_file) dropMedia(s.video_raw_file);
          logEvent(s.id, 'video_overlay', { ok: !!titled });
          const done = updateSession(s.id, {
            video_status: 'done', video_file: file, video_raw_file: raw, video_done_at: Date.now(), video_count: (s.video_count || 0) + 1,
          });
          logEvent(s.id, 'video_done', { ms: Date.now() - s.video_requested_at });
          postTrailerToScreen(s.id);
          const k = await sendTrailerReady(done);
          updateSession(s.id, { kakao_status: k });
        } else if (r.status === 'failed') {
          console.warn(`[video] task ${s.id} failed:`, r.error);
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
