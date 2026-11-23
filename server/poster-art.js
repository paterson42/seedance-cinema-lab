// Makes the titled poster on the server: the Seedream picture plus the lettering (billing block,
// tagline, title, credits), drawn with the same routine the browser used to run
// (public/poster-art.js). Visitors' phones no longer take part, so every poster on the booth
// screen is one the server made itself.
//
// Needs the @napi-rs/canvas package (npm install) and the fonts in server/fonts. Without them the
// server still runs: composePoster() returns null and the plain picture is used.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { POSTER_W, POSTER_H, drawPoster } from '../public/poster-art.js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');
// family name used in the drawing code -> font file (Noto Sans KR is a variable font: all weights)
const FONTS = {
  'Black Han Sans': 'BlackHanSans-Regular.ttf',
  'Bebas Neue': 'BebasNeue-Regular.ttf',
  'Noto Sans KR': 'NotoSansKR-wght.ttf',
};

let kit; // undefined = not tried yet, null = unavailable
async function canvasKit() {
  if (kit !== undefined) return kit;
  try {
    const mod = await import('@napi-rs/canvas');
    for (const [family, file] of Object.entries(FONTS)) {
      const f = path.join(FONT_DIR, file);
      if (!fs.existsSync(f) || !mod.GlobalFonts.registerFromPath(f, family)) throw new Error(`font missing: ${file}`);
    }
    kit = mod;
  } catch (e) {
    console.warn('[poster-art] titled posters are off (run "npm install"):', e.message);
    kit = null;
  }
  return kit;
}

/** True when titled posters can be made here. */
export const posterArtReady = async () => !!(await canvasKit());

/**
 * picture: image bytes (JPEG / PNG / SVG); info: { title, tagline, director, genre: { en } };
 * credits: [{ label, value }]. Returns a JPEG buffer, or null when it could not be made.
 */
export async function composePoster(picture, info, credits = []) {
  const k = await canvasKit();
  if (!k) return null;
  try {
    const img = await k.loadImage(picture);
    const canvas = k.createCanvas(POSTER_W, POSTER_H);
    drawPoster(canvas.getContext('2d'), img, info, credits);
    return await canvas.encode('jpeg', 90);
  } catch (e) {
    console.warn('[poster-art] compose failed:', e.message);
    return null;
  }
}
