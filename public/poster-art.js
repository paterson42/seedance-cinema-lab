// The lettering on the poster: billing block, tagline, title, credits. One drawing routine for both
// sides. The server makes the titled poster as soon as Seedream is done (server/poster-art.js); the
// browser draws it itself only when the server could not, and then just for display.
export const POSTER_W = 1080, POSTER_H = 1920; // 9:16 like the booth screens and the trailer

export function spaced(ctx, text, x, y, font, spacing, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  if ('letterSpacing' in ctx) { ctx.letterSpacing = `${spacing}px`; ctx.fillText(text, x + spacing / 2, y); ctx.letterSpacing = '0px'; }
  else ctx.fillText(text, x, y);
}

export function wrapLines(ctx, text, maxW, sep = ' ') {
  const words = text.split(sep);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line}${sep}${w}` : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws the picture and the lettering on a POSTER_W x POSTER_H 2D context.
 * img: a decoded image; info: { title, tagline, director, genre: { en } };
 * credits: [{ label, value }] (content.json event.credits, shared with the trailer screen).
 */
export function drawPoster(x, img, info, credits = []) {
  // Laid out on a 1125x2000 grid, drawn at POSTER_W x POSTER_H.
  const W = 1125, H = 2000;
  x.save();
  x.scale(POSTER_W / W, POSTER_W / W);
  const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
  const r = Math.max(W / nw, H / nh);
  const iw = nw * r, ih = nh * r;
  x.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);

  let g = x.createLinearGradient(0, 0, 0, H * 0.2);
  g.addColorStop(0, 'rgba(0,0,0,.72)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H * 0.2);
  g = x.createLinearGradient(0, H * 0.48, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.42, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,.95)');
  x.fillStyle = g; x.fillRect(0, H * 0.48, W, H * 0.52);

  const accent = '#d4ff3a';
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  // Billing block: 제작 / 배급 / 상영관 from content.json (event.credits), shared with the trailer screen.
  const LAB = '500 25px "Noto Sans KR", sans-serif', VAL = '700 27px "Noto Sans KR", sans-serif';
  x.textAlign = 'left';
  x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 12;
  credits.forEach((cr, i) => {
    const y = 76 + i * 42;
    const lab = `${cr.label}: `;
    x.font = LAB; const lw = x.measureText(lab).width;
    x.font = VAL; const vw = x.measureText(cr.value).width;
    const x0 = (W - lw - vw) / 2;
    x.font = LAB; x.fillStyle = 'rgba(255,255,255,.66)'; x.fillText(lab, x0, y);
    x.font = VAL; x.fillStyle = '#fff'; x.fillText(cr.value, x0 + lw, y);
  });
  x.shadowBlur = 0;
  x.textAlign = 'center';

  // Title (auto-fit, up to 2 lines)
  const title = info.title;
  let size = 176;
  const setT = () => (x.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`);
  setT();
  while (x.measureText(title).width > W * 0.86 && size > 96) { size -= 4; setT(); }
  let tLines = [title];
  if (x.measureText(title).width > W * 0.86) tLines = wrapLines(x, title, W * 0.86).slice(0, 2);
  const titleBottom = H - 300;
  x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 30;
  x.fillStyle = '#fff';
  tLines.forEach((l, i) => x.fillText(l, W / 2, titleBottom - (tLines.length - 1 - i) * size * 1.02));
  x.shadowBlur = 0;

  // Tagline above title
  x.font = '500 36px "Noto Sans KR", sans-serif';
  const tag = wrapLines(x, info.tagline || '', W * 0.8).slice(0, 2);
  const tagBottom = titleBottom - tLines.length * size * 1.02 - 26;
  x.fillStyle = 'rgba(255,255,255,.9)';
  tag.forEach((l, i) => x.fillText(l, W / 2, tagBottom - (tag.length - 1 - i) * 50));

  // Credits
  spaced(x, `A FILM BY ${String(info.director || 'YOU').toUpperCase()}`, W / 2, H - 196, '50px "Bebas Neue", "Noto Sans KR", sans-serif', 10, '#fff');
  x.globalAlpha = 0.6;
  spaced(x, 'STORY BY SEED   ·   KEY ART BY SEEDREAM   ·   MOTION BY SEEDANCE', W / 2, H - 132, '24px "Bebas Neue", sans-serif', 3, '#fff');
  x.globalAlpha = 1;

  x.fillStyle = 'rgba(255,255,255,.25)';
  x.fillRect(80, H - 72, W - 160, 1);
  x.textAlign = 'left';
  spaced(x, String(info.genre?.en || 'FILM').toUpperCase(), 80, H - 34, '30px "Bebas Neue", sans-serif', 4, accent);
  x.textAlign = 'right';
  spaced(x, 'SEOUL 2026', W - 84, H - 34, '30px "Bebas Neue", sans-serif', 4, '#fff');
  x.textAlign = 'center';
  spaced(x, 'COMING SOON', W / 2, H - 34, '30px "Bebas Neue", sans-serif', 6, 'rgba(255,255,255,.7)');
  x.restore();
}
