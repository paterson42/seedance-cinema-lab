// Lets the app live under a path prefix (BASE_PATH=/ad) so several demos can share one domain:
//   https://demo.example.com/ad/          the visitor site
//   https://demo.example.com/ad/poster    key-visual screen   (also /ad/screen/poster)
//   https://demo.example.com/ad/trailer   ad-video screen     (also /ad/screen/trailer)
// With BASE_PATH empty nothing changes and the app sits at the domain root as before.
//
// The pages are written with root-absolute links ("/api/...", "/screen/screen.css"). Instead of
// touching every one of them, HTML/JS/CSS files get the prefix added as they are served.
import fs from 'node:fs';
import path from 'node:path';
import { config, PUBLIC_DIR } from './config.js';

export const BASE = config.basePath; // '' or '/ad'

/** Prefix a root-absolute path the server hands to the browser ("/media/x.jpg" -> "/ad/media/x.jpg"). */
export const withBase = (p) => (p && BASE && p.startsWith('/') ? BASE + p : p);

/**
 * The request path inside the app. Returns { path } or { redirect } when the prefix is missing
 * (someone opened http://localhost:3000/ while BASE_PATH is set) or lacks its trailing slash.
 */
export function insideBase(pathname, search = '') {
  if (!BASE) return { path: pathname };
  if (pathname === BASE) return { redirect: `${BASE}/${search}` };
  if (pathname.startsWith(`${BASE}/`)) return { path: pathname.slice(BASE.length) };
  return { redirect: `${BASE}${pathname}${search}` };
}

// Top-level names a root-absolute link can start with: the routes plus whatever is in public/.
const ROUTES = ['api', 'media', 'r', 'admin', 'screen', 'poster', 'trailer'];
let linkRe = null;
function linkPattern() {
  if (!linkRe) {
    const names = [...new Set([...ROUTES, ...fs.readdirSync(PUBLIC_DIR)])]
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // a quote, backtick, "(" or "=" directly before "/name", and a word boundary after it
    linkRe = new RegExp(`(["'\`(=])/(?=(?:${names.join('|')})(?:[/?"'\`)#]|$))`, 'gm');
  }
  return linkRe;
}

const TEXT = new Set(['.html', '.js', '.css', '.webmanifest']);
const cache = new Map(); // file -> { mtimeMs, body }

/** Text of a page/script/stylesheet with the prefix applied, or null when the file is served as is. */
export function rebased(file) {
  if (!BASE || !TEXT.has(path.extname(file).toLowerCase())) return null;
  const { mtimeMs } = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.body;
  const body = rebaseText(fs.readFileSync(file, 'utf8'), path.extname(file).toLowerCase() === '.html');
  cache.set(file, { mtimeMs, body });
  return body;
}

export function rebaseText(text, isHtml) {
  if (!BASE) return text;
  let out = text.replace(linkPattern(), `$1${BASE}/`);
  // Scripts read the prefix from here for the few places that look at location.pathname.
  if (isHtml) out = out.replace(/href="\/"/g, `href="${BASE}/"`); // the home link
  if (isHtml) out = out.replace(/<head([^>]*)>/i, `<head$1>\n<script>window.__BASE__=${JSON.stringify(BASE)}</script>`);
  return out;
}
