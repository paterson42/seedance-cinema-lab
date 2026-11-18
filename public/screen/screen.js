// Shared helpers for the on-site big screens (/screen/poster = ad wall, /screen/trailer = ad showcase).
export const $ = (sel, el = document) => el.querySelector(sel);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const pad = (n, w = 6) => String(n ?? 0).padStart(w, '0');
export const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
// Same fictional price tag the booth client prints on the key visual (derived from the ad ID / seed).
export function offer(seed) {
  const s = Number(seed) || 1;
  const off = [15, 20, 25, 30, 35, 40, 50][s % 7];
  const price = (9 + (s % 90)) * 1000 + 900;
  return { off, price, was: Math.round(price / (1 - off / 100) / 1000) * 1000 };
}

const params = new URLSearchParams(location.search);
const key = params.get('key');

// Polls the feed; calls onItems(items, response) after every successful fetch. Keeps the last
// good list while the network is down and shows a small OFFLINE marker.
export function watchFeed(kind, onItems, everyMs = 6000) {
  const dot = document.createElement('div');
  dot.className = 'scr-offline';
  dot.textContent = '오프라인: 마지막 목록으로 송출 중';
  dot.hidden = true;
  document.body.append(dot);
  (async function loop() {
    for (;;) {
      try {
        const q = new URLSearchParams({ kind, ...(key ? { key } : {}) });
        const r = await fetch(`/api/screen/feed?${q}`, { cache: 'no-store' });
        if (r.status === 401) { dot.textContent = 'SCREEN KEY 필요 — 주소에 ?key= 를 붙여 주세요'; dot.hidden = false; }
        else if (r.ok) { dot.hidden = true; const d = await r.json(); onItems(d.items || [], d); }
        else dot.hidden = false;
      } catch { dot.hidden = false; }
      await sleep(everyMs);
    }
  })();
}

// Click anywhere / press F for fullscreen. Cursor hides when idle. Screen stays awake.
export function screenChrome() {
  const hint = document.createElement('div');
  hint.className = 'scr-hint';
  hint.textContent = '화면을 클릭하거나 F 키를 누르면 전체 화면으로 전환돼요';
  document.body.append(hint);
  setTimeout(() => hint.classList.add('out'), 7000);
  const full = () => {
    hint.classList.add('out');
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
  };
  document.addEventListener('click', full);
  document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') full(); });

  let t;
  const wake = () => {
    document.body.classList.remove('no-cursor');
    clearTimeout(t);
    t = setTimeout(() => document.body.classList.add('no-cursor'), 3000);
  };
  document.addEventListener('mousemove', wake);
  wake();

  const lock = () => navigator.wakeLock?.request('screen').catch(() => {});
  lock();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && lock());

  // Long-running kiosk tabs: reload every few hours when it is safe to do so.
  const bootAt = Date.now();
  return { stale: () => Date.now() - bootAt > 4 * 3600 * 1000 };
}

export function clock(el) {
  const tick = () => {
    const d = new Date();
    el.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  tick();
  setInterval(tick, 10000);
}

export function preload(src) {
  return new Promise((res) => {
    if (!src) return res(false);
    const i = new Image();
    i.onload = () => res(true);
    i.onerror = () => res(false);
    i.src = src;
  });
}
