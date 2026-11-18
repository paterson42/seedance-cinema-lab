// Burns the key visual's text layer (name, product, price, button, footer) onto the finished
// Seedance clip with ffmpeg. The phone draws that layer as a transparent PNG and uploads it with
// the titled key visual, so the video carries exactly the same lettering, and it stays sharp
// because the model never has to animate text.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config, MEDIA_DIR } from './config.js';

function ffmpeg(args, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-6000)));
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); resolve({ code, err }); });
  });
}

// Frame size of a video, read from ffmpeg's own stream description (no ffprobe needed).
async function frameSize(file) {
  const { err } = await ffmpeg(['-hide_banner', '-i', file], 15000);
  const m = /Video:.*?\b(\d{2,5})x(\d{2,5})\b/.exec(err);
  return m ? { w: +m[1] & ~1, h: +m[2] & ~1 } : null;
}

// Returns a new mp4 buffer with the text layer on top, or null when it could not be made
// (no ffmpeg, bad input): the caller then keeps the clean clip.
export async function burnOverlay(videoBuffer, overlayFile) {
  if (!config.video.overlay || !overlayFile) return null;
  const png = path.join(MEDIA_DIR, overlayFile);
  if (!fs.existsSync(png)) return null;
  const tmp = path.join(MEDIA_DIR, `_ov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const src = `${tmp}_in.mp4`, out = `${tmp}_out.mp4`;
  try {
    fs.writeFileSync(src, videoBuffer);
    const size = await frameSize(src);
    if (!size) return null;
    const { fadeAt, fadeSec } = config.video;
    // The layer is 9:16; cover the frame and crop the middle if the clip has another shape.
    const filter = `[1:v]format=rgba,scale=${size.w}:${size.h}:force_original_aspect_ratio=increase,crop=${size.w}:${size.h}`
      + (fadeSec > 0 ? `,fade=t=in:st=${fadeAt}:d=${fadeSec}:alpha=1` : '')
      + `[ov];[0:v][ov]overlay=0:0:shortest=1,scale=${size.w}:${size.h},format=yuv420p[v]`;
    const r = await ffmpeg([
      '-y', '-v', 'error', '-i', src, '-loop', '1', '-i', png,
      '-filter_complex', filter, '-map', '[v]', '-map', '0:a?',
      '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-c:a', 'copy', '-movflags', '+faststart', out,
    ]);
    if (r.code !== 0) { console.warn('[overlay] ffmpeg failed:', r.err.slice(-300)); return null; }
    return fs.readFileSync(out);
  } catch (e) {
    console.warn('[overlay]', e.message);
    return null;
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(out, { force: true });
  }
}
