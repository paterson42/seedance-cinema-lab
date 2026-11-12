import fs from 'node:fs';
import { CONTENT_FILE } from './config.js';

let cache = null;

export function getContent() {
  if (!cache) cache = JSON.parse(fs.readFileSync(CONTENT_FILE, 'utf8'));
  return cache;
}

export function validateContent(c) {
  const errs = [];
  if (!Array.isArray(c?.genres) || c.genres.length < 2) errs.push('genres: 2개 이상 필요');
  for (const g of c?.genres || []) {
    for (const k of ['id', 'ko', 'en', 'style', 'motion']) if (!g[k]) errs.push(`genre ${g.id || '?'}: ${k} 누락`);
    if (!g.titles?.length || !g.taglines?.length) errs.push(`genre ${g.id}: titles/taglines 필요`);
  }
  const ids = (c?.categories || []).map((x) => x.id).join(',');
  if (ids !== 'who,when,where,what,how,why') errs.push('categories: who,when,where,what,how,why 순서로 6개 필요');
  for (const cat of c?.categories || []) {
    if (!cat.keywords?.length) errs.push(`${cat.id}: 키워드 1개 이상 필요`);
    for (const k of cat.keywords || []) {
      if (!k.ko || !k.en) errs.push(`${cat.id}: ko/en 누락 키워드`);
      if (cat.id === 'what' && !k.n) errs.push(`what "${k.ko}": 제목용 명사(n) 누락`);
    }
  }
  return errs;
}

export function saveContent(c) {
  const errs = validateContent(c);
  if (errs.length) return errs;
  fs.writeFileSync(CONTENT_FILE + '.bak', fs.readFileSync(CONTENT_FILE));
  fs.writeFileSync(CONTENT_FILE, JSON.stringify(c, null, 2));
  cache = c;
  return [];
}

/** What the browser needs (no prompt-engineering internals). */
export function publicContent() {
  const c = getContent();
  return {
    event: c.event,
    copy: c.copy,
    genres: c.genres.map(({ id, ko, en, desc, palette }) => ({ id, ko, en, desc, palette })),
    categories: c.categories.map(({ id, ko, en, keywords }) => ({ id, ko, en, keywords: keywords.map((k) => k.ko) })),
  };
}

export function containsBanned(text) {
  const t = String(text || '').toLowerCase().replace(/\s/g, '');
  return (getContent().bannedWords || []).some((w) => t.includes(w.toLowerCase()));
}
