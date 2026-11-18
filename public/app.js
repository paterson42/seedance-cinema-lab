// Seedance Seoul Commerce Lab — booth client (vanilla JS, mobile first)
// Internal names follow the original flow: genre = ad mood, director = the visitor's name (credited as 기획),
// poster = ad key visual, trailer/video = short-form ad, ticket = product card.
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n, w = 6) => String(n ?? 0).padStart(w, '0');
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
// Playful, fictional price tag derived from the ad ID / seed (same on key visual, card and big screens).
function offer(seed) {
  const s = Number(seed) || 1;
  const off = [15, 20, 25, 30, 35, 40, 50][s % 7];
  const price = (9 + (s % 90)) * 1000 + 900;
  return { off, price, was: Math.round(price / (1 - off / 100) / 1000) * 1000 };
}
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ───────────────────────── icons ─────────────────────────
const ICONS = {
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  share: '<path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/><path d="M12 14V3"/><path d="m8 7 4-4 4 4"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/>',
  ticket: '<path d="M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4z"/><path d="M14 6v2M14 11v2M14 16v2"/>',
  screen: '<rect x="2.5" y="4" width="19" height="12.5" rx="1.5"/><path d="M8 20.5h8M12 16.5v4"/><path d="M10.400 7.500l4.800 2.750-4.800 2.750z" fill="currentColor" stroke="none"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" fill="currentColor" stroke="none"/>',
};
const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const app = $('#app');
const S = {
  boot: null,
  content: null,
  session: null,
  view: null,
  cast: {},
  director: '',
  pollId: 0,
  posterData: null, // composed poster dataURL
  posterFor: null,  // raw url the composition was made from
  booth: false,
};

try {
  const q = new URLSearchParams(location.search);
  if (q.has('booth')) localStorage.setItem('scm_booth', q.get('booth') === '0' ? '0' : '1');
  S.booth = localStorage.getItem('scm_booth') === '1';
} catch {}

// ───────────────────────── network ─────────────────────────
function net(ok) { $('#netBanner').hidden = ok; }

async function api(path, { method = 'GET', body, retries } = {}) {
  retries ??= method === 'GET' ? 4 : 2;
  for (let i = 0; ; i++) {
    let res, data;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
      data = await res.json().catch(() => ({}));
    } catch {
      net(false);
      if (i >= retries) throw Object.assign(new Error('인터넷 연결을 확인한 뒤 다시 시도해 주세요.'), { network: true });
      await sleep(700 * 2 ** i);
      continue;
    }
    net(true);
    if (res.status >= 500 && i < retries) { await sleep(700 * 2 ** i); continue; }
    if (!res.ok) {
      if (data.session !== undefined) S.session = data.session;
      throw Object.assign(new Error(data.error || '문제가 생겼어요. 다시 시도해 주세요.'), { status: res.status, code: data.code });
    }
    if (data.session !== undefined) S.session = data.session;
    return data;
  }
}

function track(name, meta) {
  try {
    fetch('/api/event', { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, meta }) });
  } catch {}
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.append(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

function handleError(e, fallbackView) {
  if (e.code === 'NO_SESSION' || e.code === 'NO_PHONE') { toast(e.message); return go('landing'); }
  if (e.code === 'NOT_ALLOWED' || e.code === 'FLOW_LIMIT') { S.limit = { code: e.code, message: e.message }; return go('limit'); }
  if (e.code === 'BUSY') { toast(e.message); return resume({ slate: false }); } // already generating: back to its waiting screen
  toast(e.message || '문제가 생겼어요.');
  if (fallbackView) go(fallbackView);
}

// ───────────────────────── routing ─────────────────────────
const STEP_OF = { landing: 1, lookup: 1, genre: 2, cast: 3, story: 4, poster: 5, trailer: 6, waiting: 6, done: 6 };

// Ad-production names for each step, plus the order-tracking stop shown on the
// step-transition card (`ship`). `action` steps get the "주문 완료!" stamp.
const SCENES = {
  genre: { n: 1, ko: '브리프', en: 'BRIEF', ship: '주문 접수' },
  cast: { n: 2, ko: '컨셉', en: 'CONCEPT', ship: '상품 준비' },
  story: { n: 3, ko: '카피', en: 'COPY', ship: '포장' },
  poster: { n: 4, ko: '촬영', en: 'SHOOTING', ship: '출고', action: true },
  trailer: { n: 5, ko: '편집', en: 'EDITING', ship: '배송 중' },
  waiting: { n: 5, ko: '편집', en: 'EDITING', ship: '배송 중', action: true },
  done: { n: 6, ko: '온에어', en: 'ON AIR', ship: '배송 완료' },
};
const STOPS = ['접수', '준비', '포장', '출고', '배송', '완료'];
const ORDER = ['landing', 'lookup', 'genre', 'cast', 'story', 'poster', 'trailer', 'waiting', 'done'];
const sceneLabel = (view) => { const sc = SCENES[view]; return `${sc.n}단계 ${sc.ko}`; };

const today = () => { const d = new Date(); return `${d.getFullYear()}.${pad(d.getMonth() + 1, 2)}.${pad(d.getDate(), 2)}`; };
let slateTimer = 0;
// Order-tracking transition: the parcel moves from the previous stop to this step's stop.
async function trackingCard(view) {
  const sc = SCENES[view];
  if (!sc || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = $('#slate');
  const last = STOPS.length - 1;
  $('#slScene').textContent = `${sc.n} / ${STOPS.length} 단계`;
  $('#slTitle').textContent = sc.ship;
  $('#slSub').textContent = sc.ko;
  $('#slDir').textContent = (S.session?.director || S.director || '나');
  $('#slDate').textContent = today();
  $('#slStops').innerHTML = STOPS.map((t, i) => `<span class="${i === sc.n - 1 ? 'now' : i < sc.n - 1 ? 'done' : ''}">${t}</span>`).join('');
  el.style.setProperty('--from', `${(Math.max(0, sc.n - 2) / last) * 100}%`);
  el.style.setProperty('--to', `${((sc.n - 1) / last) * 100}%`);
  const my = ++slateTimer;
  el.classList.remove('show', 'clap', 'action');
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('show');
  await sleep(360);
  if (my !== slateTimer) return;
  el.classList.add('clap'); // parcel travels to the new stop
  await sleep(430);
  if (my !== slateTimer) return;
  navigator.vibrate?.(15);
  if (sc.action) el.classList.add('action');
  await sleep(sc.action ? 760 : 420);
  if (my !== slateTimer) return;
  el.classList.remove('show');
  await sleep(260);
  if (my === slateTimer) { el.hidden = true; el.classList.remove('clap', 'action'); }
}

// Where the header's "이전" button leads from each screen (no entry = no button).
const BACK_OF = { lookup: 'landing', genre: 'landing', cast: 'genre', story: 'cast', poster: 'story', trailer: 'poster', done: 'poster' };
function goBack() {
  const to = BACK_OF[S.view];
  if (!to || $('#topBack').hidden) return;
  if (S.view === 'poster' && ['queued', 'running'].includes(S.session?.poster?.status)) return toast('키비주얼을 만드는 중이에요. 완성되면 돌아갈 수 있어요');
  go(to);
}

// While this visitor's poster or trailer is being made, every step of the flow shows that waiting
// screen instead (browser back, stale pages, repeated taps). The server enforces the same rule.
const FLOW_VIEWS = new Set(['genre', 'cast', 'story', 'poster', 'trailer', 'waiting', 'done']);
function busyView(s = S.session) {
  if (['queued', 'running'].includes(s?.poster?.status)) return 'poster';
  if (['queued', 'submitting', 'running'].includes(s?.video?.status)) return 'waiting';
  return null;
}

function go(view, { push = true, slate } = {}) {
  const bv = FLOW_VIEWS.has(view) && busyView();
  if (bv && bv !== view) { view = bv; slate = false; }
  S.pollId++; // cancels any running poll loop
  const prev = S.view;
  // Show the tracking card on forward moves (and when explicitly asked), never on back/restore.
  const forward = prev && ORDER.indexOf(view) > ORDER.indexOf(prev);
  if (slate ?? forward) trackingCard(view);
  S.view = view;
  const step = STEP_OF[view];
  $('#stepCount').textContent = step ? `${pad(step, 2)} / 06` : '';
  $('#progressBar').style.width = step ? `${(step / 6) * 100}%` : '0';
  $('#topBack').hidden = !BACK_OF[view] || (view === 'genre' && !!S.session?.story);
  if (push && location.pathname === '/' && history.state?.view !== view) history.pushState({ view }, '', '/');
  (VIEWS[view] || VIEWS.landing)();
  window.scrollTo({ top: 0 });
  track(`view_${view}`);
}

window.addEventListener('popstate', (e) => {
  const v = e.state?.view;
  if (!v || !S.session?.hasPhone) return go('landing', { push: false, slate: false });
  const allowed = { genre: true, cast: !!S.session.genre, story: !!S.session.story, poster: !!S.session.story, trailer: S.session.poster.status === 'done' };
  if (allowed[v]) go(v, { push: false, slate: false });
  else resume({ push: false, slate: false });
});

function resume(opts) {
  const s = S.session;
  if (!s?.hasPhone) return go('landing', opts);
  if (['queued', 'submitting', 'running'].includes(s.video.status)) return go('waiting', opts);
  if (s.video.status === 'done') return go('done', opts);
  if (s.poster.status === 'done') return go(s.video.status === 'failed' ? 'trailer' : 'poster', opts);
  if (['queued', 'running', 'failed'].includes(s.poster.status)) return go('poster', opts);
  if (s.story) return go('story', opts);
  if (s.genre) return go('cast', opts);
  return go('genre', opts);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action="home"]');
  if (a) { e.preventDefault(); if (location.pathname !== '/') location.href = '/'; else resume(); }
});
$('#topBack').onclick = goBack;

// Every in-progress step gets a small "start over" link; it only acts after a confirmation.
const RESTART_VIEWS = new Set(['genre', 'cast', 'story', 'poster', 'trailer', 'waiting']);
const render = (html, { restart = true } = {}) => {
  const row = restart && RESTART_VIEWS.has(S.view)
    ? '<div class="restart-row"><button type="button" class="restart-link" data-restart>↺ 처음부터 다시 만들기</button></div>'
    : '';
  app.innerHTML = `<section class="view">${row}${html}</section>`;
  return app.firstElementChild;
};

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-restart]')) confirmRestart();
});

let confirming = false;
async function confirmRestart() {
  if (confirming) return;
  confirming = true;
  const s = S.session || {};
  const hasPoster = s.poster?.status === 'done';
  const videoBusy = ['queued', 'submitting', 'running'].includes(s.video?.status);
  const hasVideo = videoBusy || s.video?.status === 'done';
  const lines = [
    S.booth ? '첫 화면으로 돌아가 새로 시작해요.' : '광고 무드 선택부터 새로 시작해요.',
    `지금 고른 무드와 키워드${s.story ? ', 광고 카피' : ''}는 이 화면에서 사라져요.`,
  ];
  if (hasPoster) {
    lines.push(`이미 만든 키비주얼${hasVideo ? '과 광고 영상' : ''}은 <b>‘내 결과 다시 보기’</b>에서 휴대폰 번호와 이름으로 다시 찾을 수 있어요.${videoBusy ? ' 만들고 있는 광고 영상도 계속 완성돼요.' : ''}`);
  }
  const fl = s.flows;
  if (fl && fl.max > 0 && fl.left <= 0 && !S.booth) {
    const v = await confirmSheet({
      title: '체험 횟수를 모두 사용했어요',
      body: `체험은 1인 ${fl.max}회까지예요. 지금 광고는 계속 볼 수 있고, ‘내 결과 다시 보기’에서도 찾을 수 있어요.<br>다른 사람이 이 휴대폰으로 체험하려면 아래에서 번호를 바꿔 시작하세요.`,
      cancel: '계속 보기',
      alt: '다른 번호로 새로 시작하기',
    });
    confirming = false;
    if (v === 'alt') restart({ newNumber: true });
    return;
  }
  if (fl && fl.max > 0 && !S.booth) lines.push(`새 광고는 키비주얼을 만들 때 체험 1회로 세어져요. (1인 ${fl.max}회, 남은 횟수 ${fl.left}회)`);
  const v = await confirmSheet({ title: '처음부터 다시 만들까요?', body: lines.join('<br>'), ok: S.booth ? '처음부터 다시' : '같은 번호로 처음부터', cancel: '계속 만들기', alt: S.booth ? null : '다른 번호로 새로 시작하기' });
  confirming = false;
  if (v === 'alt') restart({ newNumber: true });
  else if (v) restart();
}

// Bottom-sheet confirmation. The safe choice is the big primary button; backdrop / Esc cancel.
function confirmSheet({ title, body, ok, cancel, alt }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="alertdialog" aria-modal="true" aria-labelledby="shT" aria-describedby="shB">
      <h3 id="shT">${esc(title)}</h3><p id="shB">${body}</p>
      <div class="sheet-btns"><button type="button" class="btn btn-primary btn-block" data-no>${esc(cancel)}</button>
      ${ok ? `<button type="button" class="btn btn-ghost btn-block sheet-danger" data-yes>${esc(ok)}</button>` : ''}
      ${alt ? `<button type="button" class="linkish sheet-alt" data-alt>${esc(alt)}</button>` : ''}</div></div>`;
    document.body.append(wrap);
    const back = document.activeElement;
    let done = false;
    const close = (v) => {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      wrap.classList.remove('show');
      setTimeout(() => wrap.remove(), 250);
      back?.focus?.();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(false); });
    wrap.querySelector('[data-no]').onclick = () => close(false);
    wrap.querySelector('[data-yes]')?.addEventListener('click', () => close(true));
    wrap.querySelector('[data-alt]')?.addEventListener('click', () => close('alt'));
    requestAnimationFrame(() => { wrap.classList.add('show'); wrap.querySelector('[data-no]').focus(); });
  });
}

// ───────────────────────── views ─────────────────────────
const VIEWS = {};

VIEWS.landing = () => {
  const c = S.content.copy;
  const title = esc(c.heroTitle).replace(/광고\./, '<em>광고.</em>');
  const el = render(`
    <p class="eyebrow">${esc(S.content.event.name)} ${esc(S.content.event.city)} ${esc(S.content.event.year)}</p>
    <h1 class="h1">${title}</h1>
    <p class="lead">${esc(c.heroSub)}</p>
    <div class="hero-strip">
      <div><b>01 SEED</b><span>광고 카피</span></div>
      <div><b>02 SEEDREAM</b><span>키비주얼</span></div>
      <div><b>03 SEEDANCE</b><span>광고 영상</span></div>
    </div>
    <form class="ticket" id="phoneForm" novalidate>
      <div class="ticket-head">
        <div class="ticket-top"><span>참가 패스</span><span>№ ${pad(Math.floor(Math.random() * 9999), 4)}</span></div>
        <div class="ticket-name">SEEDANCE COMMERCE LAB</div>
        <div class="ticket-meta">
          <div><small>부스</small><b>01</b></div>
          <div><small>날짜</small><b>${today()}</b></div>
          <div><small>기획자</small><b>나</b></div>
        </div>
      </div>
      <div class="ticket-perf"></div>
      <div class="ticket-body">
      <label class="field">
        <span>${S.boot.kakao.enabled ? "결과를 받을 휴대폰 번호" : "내 결과를 다시 찾을 휴대폰 번호"}</span>
        <input class="input" id="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" maxlength="13" required>
        <div class="input-hint" id="phoneHint"></div>
      </label>
      <div class="check">
        <input type="checkbox" id="cPrivacy">
        <label for="cPrivacy"><span class="req">[필수]</span>개인정보 수집 및 이용 동의
          <details><summary>자세히 보기</summary><pre>${esc(c.consentPrivacy)}</pre></details>
        </label>
      </div>
      <button class="btn btn-primary btn-block" id="startBtn" type="submit" style="margin-top:8px">참가 패스 받고 시작하기 ${ic('arrow')}</button>
      </div>
      <div class="ticket-perf"></div>
      <div class="ticket-stub"><span class="barcode" aria-hidden="true"></span><span>양도 불가<br>SEOUL 2026</span></div>
    </form>
    <p style="text-align:center;margin-top:18px"><button class="linkish" id="toLookup" type="button">이미 체험했나요? 내 결과 다시 보기</button></p>
  `);
  const phone = $('#phone', el);
  if (S.session?.phoneMasked) phone.placeholder = S.session.phoneMasked;
  phone.addEventListener('input', () => {
    const d = phone.value.replace(/\D/g, '').slice(0, 11);
    phone.value = d.length < 4 ? d : d.length < 8 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
    phone.classList.remove('invalid');
    $('#phoneHint').textContent = '';
  });
  $('#toLookup', el).onclick = () => { track('lookup_open'); go('lookup'); };
  $('#phoneForm', el).onsubmit = async (e) => {
    e.preventDefault();
    const d = phone.value.replace(/\D/g, '');
    if (!/^0\d{9,10}$/.test(d)) {
      phone.classList.add('invalid');
      $('#phoneHint').textContent = '휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)';
      return phone.focus();
    }
    if (!$('#cPrivacy').checked) return toast('개인정보 수집 및 이용에 동의해 주세요.');
    const btn = $('#startBtn');
    btn.disabled = true;
    try {
      if (!S.session || S.session.story) await api('/api/session', { method: 'POST', body: { entry: S.booth ? 'booth' : 'qr' } });
      await api('/api/session/phone', { method: 'POST', body: { phone: d, consentPrivacy: true } });
      go('genre');
    } catch (err) {
      btn.disabled = false;
      if (['BAD_PHONE', 'NOT_ALLOWED', 'FLOW_LIMIT'].includes(err.code)) { phone.classList.add('invalid'); $('#phoneHint').textContent = err.message; }
      else handleError(err);
    }
  };
};

// Shown when a number is not on the pre-registered list or has used all its experiences.
VIEWS.limit = () => {
  const l = S.limit || { code: 'FLOW_LIMIT', message: '체험 횟수를 모두 사용했어요.' };
  const el = render(`
    <p class="scene">${l.code === 'NOT_ALLOWED' ? '사전 등록' : '체험 완료'}</p>
    <h2 class="h2">${l.code === 'NOT_ALLOWED' ? '등록된 번호가 <em>아니에요</em>' : '오늘의 촬영은 <em>여기까지</em>'}</h2>
    <div class="notice"><span class="ico">✦</span><span>${esc(l.message)}</span></div>
    <button class="btn btn-primary btn-block" id="toLookup">내 결과 다시 보기</button>
    <p style="text-align:center;margin-top:10px"><button class="linkish" id="toStart">${l.code === 'NOT_ALLOWED' ? '다른 번호로 시작하기' : '처음 화면으로'}</button></p>`);
  $('#toLookup', el).onclick = () => go('lookup');
  $('#toStart', el).onclick = async () => {
    try { await api('/api/session', { method: 'POST', body: { entry: S.booth ? 'booth' : 'qr' } }); } catch {}
    go('landing');
  };
};

VIEWS.lookup = () => {
  const el = render(`
    <p class="eyebrow">내 광고</p>
    <h2 class="h2">내 결과 다시 보기</h2>
    <p class="lead">체험할 때 입력한 휴대폰 번호와 이름으로 키비주얼과 광고 영상을 다시 찾아드려요.</p>
    <form class="panel" id="lookupForm" novalidate>
      <label class="field"><span>휴대폰 번호</span><input class="input" id="lPhone" type="tel" inputmode="numeric" placeholder="010-0000-0000" maxlength="13"></label>
      <label class="field"><span>이름</span><input class="input" id="lName" type="text" maxlength="12" placeholder="체험할 때 입력한 이름"></label>
      <button class="btn btn-primary btn-block" type="submit">결과 찾기</button>
    </form>
    <div class="result-list" id="lookupList"></div>
  `);
  $('#lookupForm', el).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { results } = await api('/api/lookup', { method: 'POST', body: { phone: $('#lPhone').value, director: $('#lName').value } });
      $('#lookupList').innerHTML = results.map((r) => `
        <a class="result-item" href="${esc(r.url)}">
          <img src="${esc(r.poster)}" alt="">
          <div><b>${esc(r.title)}</b><span class="small">${esc(r.genre)}, ${new Date(r.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
          <span class="small mono">${r.videoStatus === 'done' ? '▶ 영상' : r.videoStatus === 'idle' ? '키비주얼' : '생성 중'}</span>
        </a>`).join('');
    } catch (err) { toast(err.message); }
  };
};

VIEWS.genre = () => {
  let selected = S.session.genre;
  const el = render(`
    <p class="scene">${sceneLabel('genre')}</p>
    <h2 class="h2">어떤 <em>무드</em>의 광고를<br>만들어 볼까요?</h2>
    <p class="lead">고른 무드가 키비주얼의 색감과 광고 영상의 카메라 워크를 결정해요.</p>
    <div class="genre-grid">
      ${S.content.genres.map((g) => `
        <button class="genre" type="button" data-genre="${g.id}" aria-pressed="${g.id === selected}" style="--c1:${g.palette[0]};--c2:${g.palette[1]}">
          <span class="art" style="background-image:url('/genres/${esc(g.id)}.svg')"></span>
          <span class="tick">✓</span>
          <span class="name">${esc(g.ko)}</span><span class="sub">${esc(g.en)}</span><span class="desc">${esc(g.desc)}</span>
        </button>`).join('')}
    </div>
    <div class="cta-bar"><button class="btn btn-primary btn-block" id="genreNext" ${selected ? '' : 'disabled'}>키워드 뽑으러 가기 ${ic('arrow')}</button></div>
  `);
  $$('.genre', el).forEach((b) => (b.onclick = () => {
    selected = b.dataset.genre;
    $$('.genre', el).forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#genreNext').disabled = false;
    navigator.vibrate?.(8);
  }));
  $('#genreNext', el).onclick = async () => {
    $('#genreNext').disabled = true;
    try { await api('/api/session/genre', { method: 'POST', body: { genre: selected } }); go('cast'); }
    catch (e) { $('#genreNext').disabled = false; handleError(e); }
  };
};

VIEWS.cast = () => {
  const cats = S.content.categories;
  if (S.session.keywords && !Object.keys(S.cast).length) for (const c of cats) S.cast[c.id] = S.session.keywords[c.id]?.idx;
  S.director ||= S.session.director || '';
  const genre = S.content.genres.find((g) => g.id === S.session.genre);
  const el = render(`
    <div class="cast-head"><p class="scene">${sceneLabel('cast')}</p><span class="tag">${esc(genre?.ko || '')}</span></div>
    <h2 class="h2">랜덤 키워드로 <em>광고 컨셉</em>을<br>뽑아보세요</h2>
    <p class="lead">버튼 하나로 키워드 6개를 뽑고, 마음에 들지 않는 카드만 <b style="color:var(--accent)">↻</b> 다시 뽑아보세요.</p>
    <button class="btn draw-all" id="drawAll" type="button">⤨ 키워드 6개 한 번에 뽑기</button>
    <div class="cast-grid">
      ${cats.map((c) => `
        <div class="kcard" data-cat="${c.id}">
          <div class="k-top"><span class="k-cat">${esc(c.ko)}<small>${esc(c.en)}</small></span>
            <button class="k-re" type="button" data-reroll="${c.id}" aria-label="${esc(c.ko)} 다시 뽑기">↻</button></div>
          <div class="k-val placeholder">어떤 카드가 나올까요?</div>
        </div>`).join('')}
    </div>
    <label class="field">
      <span>내 이름 (광고에 ‘기획 ○○○’으로 들어가요)</span>
      <input class="input" id="director" type="text" maxlength="12" placeholder="예) 홍길동" autocomplete="nickname" value="${esc(S.director)}">
    </label>
    <div class="cta-bar"><button class="btn btn-primary btn-block" id="castNext" disabled>Seed로 광고 카피 쓰기 ${ic('arrow')}</button></div>
  `);

  const card = (id) => $(`.kcard[data-cat="${id}"]`, el);
  const paint = (id) => {
    const cat = cats.find((c) => c.id === id);
    const v = $('.k-val', card(id));
    const i = S.cast[id];
    if (i == null || !cat.keywords[i]) return;
    v.textContent = cat.keywords[i];
    v.classList.remove('placeholder');
    card(id).classList.add('filled');
  };
  const ready = () => { $('#castNext').disabled = !(cats.every((c) => S.cast[c.id] != null) && $('#director').value.trim()); };

  const roll = async (id, delay = 0) => {
    const cat = cats.find((c) => c.id === id);
    const k = card(id);
    const v = $('.k-val', k);
    await sleep(delay);
    k.classList.add('rolling');
    v.classList.remove('placeholder');
    const until = Date.now() + 520;
    while (Date.now() < until) { v.textContent = cat.keywords[Math.floor(Math.random() * cat.keywords.length)]; await sleep(70); }
    let next;
    do { next = Math.floor(Math.random() * cat.keywords.length); } while (cat.keywords.length > 1 && next === S.cast[id]);
    S.cast[id] = next;
    k.classList.remove('rolling');
    k.classList.remove('landed'); void k.offsetWidth; k.classList.add('landed');
    paint(id);
    ready();
  };

  cats.forEach((c) => paint(c.id));
  ready();
  $$('[data-reroll]', el).forEach((b) => (b.onclick = () => { navigator.vibrate?.(6); roll(b.dataset.reroll); track('keyword_reroll', { cat: b.dataset.reroll }); }));
  $('#drawAll', el).onclick = async () => {
    navigator.vibrate?.(12);
    track('keywords_drawn');
    await Promise.all(cats.map((c, i) => roll(c.id, i * 110)));
    if (!$('#director').value.trim()) $('#director').focus({ preventScroll: true });
  };
  $('#director', el).oninput = (e) => { S.director = e.target.value; ready(); };
  $('#castNext', el).onclick = () => {
    // Coming back here and moving on without changing anything keeps the existing copy.
    if (S.session.story && S.storyKey === storyKey($('#director').value.trim())) return go('story');
    makeStory();
  };
};

// Seconds to count down from while Seed writes the copy: last real duration here, else a typical 12s.
function storyEta() {
  let v = 0;
  try { v = Number(localStorage.getItem('scm_story_sec')); } catch {}
  return v >= 3 && v <= 40 ? v : 12;
}
const storyKey = (director) => JSON.stringify([S.session?.genre, S.cast, director]);

async function makeStory() {
  const director = $('#director')?.value.trim() || S.director || S.session.director;
  render(`
    <div class="loading-stage" style="aspect-ratio:auto;min-height:60vh;width:100%">
      <div>
        <div class="countdown" id="scd" style="--p:0%"><b id="scdNum">${storyEta()}</b></div>
        <div class="loading-msg" id="smsg">Seed가 <b>${esc(director)}</b> 님의<br>광고 카피를 쓰는 중…</div>
        <div class="loading-sub">무드 + 키워드 6개 → 카피와 프롬프트</div>
      </div>
      <div class="belt"><i></i></div>
    </div>`, { restart: false });
  // Count down from how long copy-writing took last time on this device (the server gives no progress).
  const t0 = Date.now(), est = storyEta();
  let ticking = true;
  (async function tick() {
    while (ticking) {
      const cd = $('#scd');
      if (!cd) return;
      const sec = (Date.now() - t0) / 1000, left = Math.ceil(est - sec);
      cd.style.setProperty('--p', `${Math.min(97, (sec / est) * 100)}%`);
      cd.classList.toggle('over', left <= 0);
      $('#scdNum').textContent = left > 0 ? left : '…';
      if (left <= 0 && !cd.dataset.over) { cd.dataset.over = 1; $('#smsg').textContent = '거의 다 됐어요! 마지막 문장을 다듬는 중…'; }
      await sleep(250);
    }
  })();
  try {
    await api('/api/story', { method: 'POST', body: { keywords: S.cast, director } });
    ticking = false;
    const took = (Date.now() - t0) / 1000;
    if (took > 2) try { localStorage.setItem('scm_story_sec', String(Math.round(took))); } catch {}
    S.storyKey = storyKey(director);
    go('story');
  } catch (e) {
    ticking = false;
    if (e.code === 'NO_DIRECTOR' || e.code === 'BANNED') { toast(e.message); return go('cast'); }
    handleError(e, 'cast');
  }
}

VIEWS.story = () => {
  const s = S.session;
  const st = s.story;
  const tags = Object.values(s.keywords || {}).map((k) => `<span class="tag">${esc(k.ko)}</span>`).join('');
  const hasKV = s.poster.status === 'done' && S.kvSeed === s.seed; // a key visual already exists for this copy
  const el = render(`
    <p class="scene">${sceneLabel('story')}</p>
    <div class="seed-chip">광고 ID ${pad(s.seed)}</div>
    <h2 class="story-title">${esc(st.title)}</h2>
    <p class="story-tagline">“${esc(st.tagline)}”</p>
    <div class="story-meta"><span class="tag" style="color:var(--accent);border-color:rgba(212,255,58,.4)">${esc(st.genre.ko)}</span><span class="tag">기획 ${esc(s.director)}</span><span class="tag">${won(offer(s.seed).price)} (-${offer(s.seed).off}%)</span></div>
    <p class="story-body">${esc(st.logline)}</p>
    <details class="prompt-box"><summary>상세페이지 카피 읽기</summary><div class="p-body"><p class="story-body" style="margin:0">${esc(st.synopsis)}</p></div></details>
    <details class="prompt-box" id="promptBox"><summary>자동 생성된 키비주얼 제작 프롬프트</summary>
      <div class="p-body"><pre>${esc(s.posterPrompt)}</pre>
        <div class="p-meta"><span>SEEDREAM 9:16${st.source === 'seed-llm' ? ', Seed 작성' : ''}</span><button class="copy-btn" data-copy>복사</button></div>
      </div>
    </details>
    <div class="story-meta" style="margin-top:14px">${tags}</div>
    <div class="cta-bar">
      <div class="notice"><span class="ico">✦</span><span>${esc(S.content.copy.posterNotice)}</span></div>
      <button class="btn btn-primary btn-block" id="makePoster">${hasKV ? `만든 키비주얼 보기 ${ic('arrow')}` : `키비주얼 만들기 ${ic('sparkle')}`}</button>
      <p style="text-align:center;margin:8px 0 0"><button class="linkish" id="rewrite">같은 키워드로 다시 쓰기</button></p>
    </div>
  `);
  $('#promptBox', el).addEventListener('toggle', (e) => e.target.open && track('prompt_opened'));
  $('[data-copy]', el).onclick = async () => { await copyText(s.posterPrompt); toast('프롬프트를 복사했어요'); track('prompt_copied'); };
  $('#rewrite', el).onclick = () => { S.director = s.director; makeStory(); };
  $('#makePoster', el).onclick = async () => {
    if (hasKV) return go('poster');
    $('#makePoster').disabled = true;
    try { await api('/api/poster', { method: 'POST' }); go('poster'); }
    catch (e) { $('#makePoster').disabled = false; handleError(e); }
  };
};

const POSTER_MSGS = [
  'Seedream이 조명을 세팅하는 중…', '상품을 포디움에 올리는 중…', '모델이 포즈를 잡는 중…',
  '카메라 앵글을 잡는 중…', '리터칭으로 광을 내는 중…', '베스트 컷을 고르는 중…',
];

VIEWS.poster = () => {
  const s = S.session;
  const p = s.poster;
  if (p.status === 'done') return renderPosterDone();
  if (p.status === 'failed') {
    const el = render(`
      <p class="scene">${sceneLabel('poster')}</p>
      <h2 class="h2">키비주얼 촬영이 <em>중단</em>됐어요</h2>
      <div class="error-box"><b>생성 실패</b>${esc(p.error || '잠시 후 다시 시도해 주세요.')}</div>
      <button class="btn btn-primary btn-block" id="retry">다시 시도하기</button>
      <p style="text-align:center;margin-top:10px"><button class="linkish" id="back">키워드 다시 뽑기</button></p>`);
    $('#retry', el).onclick = async () => { try { await api('/api/poster', { method: 'POST' }); go('poster'); } catch (e) { handleError(e); } };
    $('#back', el).onclick = () => go('cast');
    return;
  }
  const el = render(`
    <p class="scene">${sceneLabel('poster')}</p>
    <div class="notice"><span class="ico">✦</span><span>${esc(S.content.copy.posterNotice)}</span></div>
    <div class="poster-wrap"><div class="loading-stage">
      <div>
        <div class="countdown" id="cd" style="--p:0%"><b id="cdNum">${s.poster.etaSec || 60}</b></div>
        <div class="loading-msg" id="lmsg">${POSTER_MSGS[0]}</div>
        <div class="loading-sub" id="lsub">“${esc(s.story.title)}” 9:16 키비주얼</div>
      </div>
      <div class="belt"><i></i></div>
    </div></div>
  `);
  const myPoll = S.pollId;
  const t0 = s.poster.requestedAt || Date.now();
  let msgI = 0, lastMsg = Date.now();
  (async function loop() {
    while (myPoll === S.pollId) {
      const el2 = $('#cd');
      if (!el2) return;
      const sec = (Date.now() - t0) / 1000;
      const est = S.session.poster.etaSec || 60;
      const left = Math.ceil(est - sec);
      el2.style.setProperty('--p', `${Math.min(97, (sec / est) * 100)}%`);
      el2.classList.toggle('over', left <= 0);
      $('#cdNum').textContent = left > 0 ? left : '…';
      if (left <= 0 && !el2.dataset.over) { el2.dataset.over = 1; $('#lmsg').textContent = '거의 다 됐어요! 마지막 컷을 다듬는 중…'; lastMsg = Infinity; }
      if (Date.now() - lastMsg > 3200) { msgI = (msgI + 1) % POSTER_MSGS.length; $('#lmsg').textContent = POSTER_MSGS[msgI]; lastMsg = Date.now(); }
      const q = S.session.poster.queuePos;
      if (q > 1) $('#lsub').textContent = `앞에 ${q - 1}명 대기 중, 곧 시작해요`;
      await sleep(1000);
    }
  })();
  (async function poll() {
    while (myPoll === S.pollId) {
      await sleep(2000);
      if (myPoll !== S.pollId) return;
      try { await api('/api/session'); } catch { continue; }
      if (!['queued', 'running'].includes(S.session.poster.status)) { navigator.vibrate?.([20, 40, 20]); return go('poster', { push: false }); }
    }
  })();
};

async function getComposedPoster(info, rawUrl, finalUrl) {
  if (S.posterFor === rawUrl && S.posterData) return S.posterData;
  S.posterData = await composePoster(rawUrl, info).catch(() => null);
  S.posterFor = rawUrl;
  return S.posterData || finalUrl || rawUrl;
}

const infoFromSession = (s) => ({ title: s.story.title, tagline: s.story.tagline, director: s.director, seed: s.seed, genre: s.story.genre, keywords: s.keywords });

async function renderPosterDone() {
  S.kvSeed = S.session.seed;
  const s = S.session;
  const el = render(`
    <p class="scene">${sceneLabel('poster')}</p>
    <h2 class="h2">이 광고의 첫 번째 고객은 <em>당신</em>입니다.</h2>
    <div class="poster-wrap">
      <div class="poster-stage" id="stage"><div class="boot"><div class="spinner"></div></div></div>
      <div class="poster-caption"><span>기획 ${esc(s.director)}</span><span>${esc(s.story.genre.ko)} 9:16</span></div>
    </div>
    <div class="btn-row"><button class="btn" id="save">${ic('download')}키비주얼 저장</button><button class="btn" id="share">${ic('share')}공유하기</button></div>
    ${screenCard(s.screen, { poster: true })}
    <div class="cta-bar">
      <button class="btn btn-primary btn-block" id="toTrailer">${s.video.status === 'done' ? '완성된 광고 영상 보기' : '이 광고가 움직인다면?'} ${ic('arrow')}</button>
      ${s.poster.remaining > 0 ? `<p style="text-align:center;margin:8px 0 0"><button class="linkish" id="regen">키비주얼 다시 만들기 (${s.poster.remaining}회 남음)</button></p>` : ''}
    </div>
  `);
  const src = await getComposedPoster(infoFromSession(s), s.poster.url, s.poster.finalUrl);
  if (S.view !== 'poster') return;
  $('#stage', el).innerHTML = `<img class="reveal" src="${esc(src)}" alt="${esc(s.story.title)} 광고 키비주얼">`;
  // Uploading the finished key visual also puts it on the booth key-visual screen (server side).
  if (src.startsWith('data:') && !s.poster.finalUrl) {
    api('/api/poster/final', { method: 'POST', body: { dataUrl: src }, retries: 3 })
      .then(() => S.view === 'poster' && refreshScreenCard(el, S.session.screen)).catch(() => {});
  }
  const fname = `seedance-commerce-${pad(s.seed)}.jpg`;
  $('#save', el).onclick = () => { download(src.startsWith('data:') ? src : `${src}?dl=1`, fname); track('poster_saved'); toast('키비주얼을 저장했어요'); };
  $('#share', el).onclick = () => { shareFile(src, fname, `${s.story.title} — ${s.director} 기획`, absUrl(s.resultUrl)); track('poster_shared'); };
  $('#toTrailer', el).onclick = () => go(s.video.status === 'done' ? 'done' : 'trailer');
  $('#regen', el)?.addEventListener('click', async () => {
    try { await api('/api/poster', { method: 'POST' }); S.posterData = null; go('poster', { slate: true }); } catch (e) { handleError(e); }
  });
}

VIEWS.trailer = () => {
  const s = S.session;
  const failed = s.video.status === 'failed';
  const noMore = s.video.remaining <= 0; // per-session or per-phone daily limit used up
  const el = render(`
    <div class="trailer-head">
      <img src="${esc(S.posterData || s.poster.finalUrl || s.poster.url)}" alt="">
      <div><p class="scene" style="margin:0">${sceneLabel('trailer')}</p><p class="big-q">이 광고가<br><em style="color:var(--accent);font-style:normal">움직인다면?</em></p></div>
    </div>
    ${failed ? `<div class="error-box"><b>광고 영상 생성 실패</b>${esc(s.video.error || '')}</div>` : ''}
    <p class="story-body">${esc(s.story.videoKo)}</p>
    <p class="small" style="margin:-10px 0 18px">${esc(S.content.copy.videoNotice)}</p>
    <details class="prompt-box"><summary>자동 생성된 광고 영상 제작 프롬프트</summary>
      <div class="p-body"><pre>${esc(s.videoPrompt)}</pre><div class="p-meta"><span>SEEDANCE 이미지→영상</span><button class="copy-btn" data-copy>복사</button></div></div>
    </details>
    <div class="cta-bar">
      ${noMore ? `<div class="notice"><span class="ico">✦</span><span>${s.video.dailyLeft <= 0
        ? `광고 영상은 번호당 하루 ${s.video.dailyMax}편까지 만들 수 있어요. 오늘은 모두 만들었어요! 만든 광고는 ‘내 결과 다시 보기’에서 볼 수 있어요.`
        : '이 키비주얼로 만들 수 있는 광고 영상을 모두 만들었어요. 처음부터 다시 만들어 새 광고에 도전해 보세요.'}</span></div>` : ''}
      <button class="btn btn-primary btn-block" id="makeVideo"${noMore ? ' disabled' : ''}>${failed ? '다시 시도하기' : '영상 생성하기'} ${ic('play')}</button>
    </div>
  `);
  $('[data-copy]', el).onclick = async () => { await copyText(s.videoPrompt); toast('프롬프트를 복사했어요'); track('prompt_copied', { kind: 'video' }); };
  $('#makeVideo', el).onclick = async () => {
    $('#makeVideo').disabled = true;
    try { await api('/api/video', { method: 'POST' }); go('waiting'); }
    catch (e) { $('#makeVideo').disabled = false; handleError(e); }
  };
};

// ───────────── big screens: key visuals and ad videos go up automatically ─────────────
const SCREEN_ROWS = {
  poster: { tag: '키비주얼', name: '부스 키비주얼 스크린' },
  trailer: { tag: '광고 영상', name: '부스 광고 영상 스크린' },
};
const screenState = (st) => (st === 'live' ? '<span class="sc-state live">송출 중</span>'
  : st ? '<span class="sc-state">운영진 확인 중</span>'
    : '<span class="sc-state">곧 자동으로 걸려요</span>');
function screenCard(state = {}, { poster = false, trailer = false } = {}) {
  const rows = Object.entries({ poster, trailer }).filter(([, on]) => on).map(([kind]) => {
    const r = SCREEN_ROWS[kind];
    return `<div class="sc-row"><div><small>${r.tag}</small><b>${r.name}</b></div><span data-sc="${kind}">${screenState(state?.[kind])}</span></div>`;
  }).join('');
  return `<div class="screen-card">
    <div class="sc-head"><span class="sc-ico">${ic('screen')}</span><div><b>부스 대형 스크린에 자동 송출</b>
      <span>완성된 키비주얼과 광고 영상은 기획자 이름, 상품명과 함께 부스 스크린에 자동으로 걸려요.</span></div></div>
    <div class="sc-rows">${rows}</div></div>`;
}
function refreshScreenCard(el, state = {}) {
  $$('[data-sc]', el).forEach((n) => { n.innerHTML = screenState(state?.[n.dataset.sc]); });
}

function kakaoCard(enabled, title, sub, saveSub = '광고 영상이 완성되면 같은 링크에서 바로 볼 수 있어요') {
  return enabled
    ? `<div class="kakao-card"><span class="k-ico">TALK</span><div><b>${title}</b><span>${sub}</span></div></div>`
    : `<div class="kakao-save">
        <div class="ks-head"><span class="k-ico">TALK</span><div><b>내 광고 링크를 카카오톡에 저장하세요</b><span>${saveSub}</span></div></div>
        <button class="btn btn-block btn-kakao" data-ksave>${ic('share')}카카오톡 ‘나와의 채팅’에 저장</button>
        <p class="ks-tip">공유 목록에서 <b>카카오톡</b> → <b>나와의 채팅</b>을 선택하세요</p>
      </div>`;
}

// Visitor saves their own result link to KakaoTalk (no AlimTalk needed).
// Kakao JS SDK when a key is configured, otherwise the phone's share sheet, otherwise copy.
function bindKakaoSave(el, info) {
  $$('[data-ksave]', el).forEach((b) => (b.onclick = () => saveToKakao(info())));
}
async function saveToKakao(info) {
  track('kakao_share', { via: S.boot.kakao.jsKey ? 'sdk' : navigator.share ? 'sheet' : 'copy' });
  if (S.boot.kakao.jsKey) return kakaoShare(info);
  if (navigator.share) {
    try { await navigator.share({ title: info.title, text: `🛍️ ${info.title} — ${info.director} 기획\n내 광고 다시 보기: ${info.link}` }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  await copyText(info.link);
  toast('링크를 복사했어요. 카카오톡 ‘나와의 채팅’에 붙여넣어 두세요');
}
const sessionShareInfo = (s) => ({
  title: s.story?.title || '나의 광고', director: s.director || '나', tagline: s.story?.tagline || '',
  image: absUrl(s.poster.finalUrl || s.poster.url), link: absUrl(s.resultUrl),
});

const RENDER_MSGS = ['키비주얼 속 상품에 숨을 불어넣는 중', '카메라 레일을 까는 중', '첫 프레임과 마지막 프레임을 잇는 중', '빛과 반사의 움직임을 계산하는 중', '광고 컷을 다듬는 중'];

// Live progress for a trailer being made (waiting view and the shared result page).
// Seedance gives no progress, so: linear to 90% at the learned estimate, then creeping towards 99%,
// with a blinking status, rotating messages and the remaining time, so it never looks frozen.
const progressMarkup = (msg = RENDER_MSGS[0]) => `<div class="wait-overlay">
    <span class="status-dot" id="wStatus">RENDERING</span>
    <div class="bar"><i id="wBar"></i></div>
    <div class="wait-row"><span id="wMsg">${msg}</span><span id="wTime"></span></div>
  </div>`;
function trailerProgress(el, get, alive) {
  let i = 0;
  (async function loop() {
    while (alive() && $('#wBar', el)) {
      const st = get();
      const sec = Math.max(0, (Date.now() - (st.requestedAt || Date.now())) / 1000);
      const eta = st.etaSec || 90;
      const pct = sec < eta ? (sec / eta) * 90 : 99 - 9 * Math.exp(-(sec - eta) / (eta * 0.5));
      $('#wBar', el).style.width = `${pct}%`;
      $('#wTime', el).textContent = sec < eta ? `약 ${fmtDur(eta - sec)} 남음` : '거의 다 됐어요';
      $('#wStatus', el).textContent = st.queuePos > 1 ? `앞에 ${st.queuePos - 1}명 대기 중` : 'RENDERING';
      if (Math.floor(sec) % 6 === 0) $('#wMsg', el).textContent = RENDER_MSGS[i++ % RENDER_MSGS.length];
      await sleep(1000);
    }
  })();
}

VIEWS.waiting = () => {
  const s = S.session;
  const poster = S.posterData || s.poster.finalUrl || s.poster.url;
  const link = absUrl(s.resultUrl);
  const el = render(`
    <p class="scene">${sceneLabel('waiting')}</p>
    <h2 class="h2">광고 영상 <em>편집 중</em></h2>
    <div class="poster-wrap"><div class="poster-stage wait-card">
      <img class="kenburns" src="${esc(poster)}" alt="">
      ${progressMarkup()}
    </div></div>
    ${kakaoCard(S.boot.kakao.enabled, `완성되면 ${esc(s.phoneMasked)} 번호로 카카오톡을 보내드려요`, `약 ${fmtDur(s.video.etaSec)} 걸려요. 자리를 떠나도 괜찮아요. 부스를 둘러보고 오세요!`, `약 ${fmtDur(s.video.etaSec)} 걸려요. 자리를 떠나도 괜찮아요. 완성되면 같은 링크에서 바로 볼 수 있어요`)}
    <div class="btn-row"><button class="btn" id="copyLink">결과 링크 복사</button><button class="btn" id="again">${S.booth ? '다음 참가자' : '하나 더 만들기'}</button></div>
    <p class="small" style="text-align:center;margin-top:14px">이 화면을 켜 두면 완성되는 즉시 재생돼요.</p>
  `);
  $('#copyLink', el).onclick = async () => { await copyText(link); toast('결과 링크를 복사했어요'); };
  bindKakaoSave(el, () => sessionShareInfo(S.session));
  $('#again', el).onclick = () => (S.booth ? restart() : confirmRestart());
  const myPoll = S.pollId;
  const eta0 = s.video.etaSec || 90;
  trailerProgress(el, () => ({ requestedAt: S.session.video.requestedAt, etaSec: S.session.video.etaSec || eta0, queuePos: S.session.video.queuePos }), () => myPoll === S.pollId);
  (async function poll() {
    while (myPoll === S.pollId) {
      await sleep(5000);
      if (myPoll !== S.pollId) return;
      try { await api('/api/session'); } catch { continue; }
      const st = S.session.video.status;
      if (st === 'done') { navigator.vibrate?.([30, 60, 30]); toast('광고 영상이 완성됐어요! 📺'); return go('done', { push: false }); }
      if (st === 'failed' || st === 'idle') return go('trailer', { push: false });
    }
  })();
};

VIEWS.done = () => renderResult({
  title: S.session.story.title,
  tagline: S.session.story.tagline,
  info: infoFromSession(S.session),
  posterRaw: S.session.poster.url,
  posterFinal: S.session.poster.finalUrl,
  videoUrl: S.session.video.url,
  resultUrl: S.session.resultUrl,
  kakaoStatus: S.session.kakaoStatus,
  screen: S.session.screen,
  own: true,
});

async function renderResult(r) {
  const link = absUrl(r.resultUrl);
  const k = S.boot.kakao;
  const sent = ['sent', 'mock_sent'].includes(r.kakaoStatus);
  const el = render(`
    <p class="scene">${r.own ? sceneLabel('done') : '지금 송출 중'}</p>
    <h2 class="story-title" style="font-size:clamp(34px,10vw,52px)">${esc(r.title)}</h2>
    <p class="story-tagline">“${esc(r.tagline)}”</p>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-tab="video">${ic('play')}광고 영상</button>
      <button role="tab" aria-selected="false" data-tab="poster">키비주얼</button>
      <button role="tab" aria-selected="false" data-tab="ticket">${ic('tag')}상품 카드</button>
    </div>
    <div class="poster-wrap"><div class="video-stage" id="vstage">
      ${r.videoUrl
        ? `<video src="${esc(r.videoUrl)}" playsinline autoplay muted loop controls preload="auto" poster="${esc(r.posterFinal || r.posterRaw)}"></video>`
        : `<img class="kenburns" src="${esc(r.posterFinal || r.posterRaw)}" alt=""><span class="play-badge">DEMO PREVIEW</span>`}
    </div>
    <div class="poster-caption"><span>광고 ID ${pad(r.info.seed)}</span><span>기획 ${esc(r.info.director)}</span></div></div>
    <div class="actions" id="actions"></div>
    ${screenCard(r.screen, { poster: true, trailer: !!r.videoUrl })}
    ${r.own ? (k.enabled
      ? `<div class="kakao-card${sent ? '' : ' off'}"><span class="k-ico">TALK</span><div><b>${sent ? '카카오톡으로 결과 링크를 보냈어요' : '카카오톡 발송 대기 중'}</b><span>${S.boot.mode === 'mock' || k.provider === 'mock' ? '데모 모드: 실제 발송 대신 운영자 화면에 기록돼요' : `${esc(S.session.phoneMasked)} 번호로 보냈어요. 링크는 일정 기간 후 만료돼요`}</span></div></div>`
      : kakaoCard(false, '', '', '언제든 다시 보고, 키비주얼과 영상을 저장할 수 있어요')) : ''}
    <div class="end-card">
      <div class="big">${r.own ? '이 광고의 첫 번째 고객은 당신입니다.' : '나도 나만의 광고를 만들어 볼까요?'}</div>
      <p class="small">${r.own ? '키비주얼과 광고 영상을 간직하고, 다음 캠페인을 상상해 보세요.' : 'Seedance Seoul Commerce Lab 부스에서 직접 체험해 보세요.'}</p>
      <button class="btn btn-ghost btn-block" id="again" style="margin-top:12px">${r.own ? (S.booth ? '다음 참가자 시작하기' : '처음부터 다시 체험하기') : '나도 만들어보기'}</button>
    </div>
  `);
  const posterSrc = await getComposedPoster(r.info, r.posterRaw, r.posterFinal);
  const fileBase = `seedance-commerce-${pad(r.info.seed)}`;
  const actions = $('#actions', el);
  const tabBtns = $$('[data-tab]', el);
  const showTab = (tab) => {
    tabBtns.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    const stage = $('#vstage', el);
    if (tab === 'ticket') {
      stage.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
      actions.innerHTML = `<div class="btn-row"><button class="btn" data-a="tsave">${ic('download')}상품 카드 저장</button><button class="btn" data-a="tshare">${ic('share')}상품 카드 공유</button></div><p class="small" style="text-align:center;margin:0">AI가 만든 가상의 상품이에요. 가격과 할인율도 재미로 붙인 숫자예요.</p>`;
      getTicket(r.info, posterSrc).then((t) => { if (stage.isConnected && $('[data-tab="ticket"]', el).getAttribute('aria-selected') === 'true') stage.innerHTML = `<img class="reveal ticket-img" src="${t}" alt="상품 카드">`; });
    } else if (tab === 'poster') {
      stage.innerHTML = `<img class="reveal" src="${esc(posterSrc)}" alt="광고 키비주얼">`;
      actions.innerHTML = `<div class="btn-row"><button class="btn" data-a="psave">${ic('download')}키비주얼 저장</button><button class="btn" data-a="pshare">${ic('share')}키비주얼 공유</button></div>`;
    } else {
      stage.innerHTML = r.videoUrl
        ? `<video src="${esc(r.videoUrl)}" playsinline autoplay muted loop controls preload="auto" poster="${esc(posterSrc)}"></video>`
        : `<img class="kenburns" src="${esc(posterSrc)}" alt=""><span class="play-badge">DEMO PREVIEW</span>`;
      actions.innerHTML = `
        ${r.videoUrl ? `<div class="btn-row"><button class="btn" data-a="vsave">${ic('download')}영상 저장</button><button class="btn" data-a="vshare">${ic('share')}영상 공유</button></div>` : ''}
        <button class="btn btn-block" data-a="summary">결과 요약 복사</button>`;
    }
  };
  bindKakaoSave(el, () => ({ title: r.title, director: r.info.director, tagline: r.tagline, image: absUrl(r.posterFinal || r.posterRaw), link }));
  showTab('video');
  tabBtns.forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  const summary = () => `🛍️ ${r.title}\n“${r.tagline}”\n기획 ${r.info.director}, ${won(offer(r.info.seed).price)} (-${offer(r.info.seed).off}%)\n\n${Object.values(r.info.keywords || {}).map((x) => `#${x.ko.replace(/[\s&+]/g, '')}`).join(' ')}\n\n내 광고 보러가기 → ${link}\nSeedance Commerce Lab`;
  actions.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'psave') { download(posterSrc.startsWith('data:') ? posterSrc : `${posterSrc}?dl=1`, `${fileBase}.jpg`); track('poster_saved'); }
    if (a === 'pshare') { shareFile(posterSrc, `${fileBase}.jpg`, r.title, link); track('poster_shared'); }
    if (a === 'vsave') { download(`${r.videoUrl}?dl=1`, `${fileBase}.mp4`); track('video_downloaded'); toast('영상을 저장하고 있어요'); }
    if (a === 'vshare') { shareFile(r.videoUrl, `${fileBase}.mp4`, r.title, link); track('video_shared'); }
    if (a === 'summary') { await copyText(summary()); toast('결과 요약을 복사했어요. 카톡에 붙여넣어 보세요!'); track('summary_copied'); }
    if (a === 'tsave') { download(await getTicket(r.info, posterSrc), `${fileBase}-ticket.jpg`); track('ticket_saved'); toast('상품 카드를 저장했어요'); }
    if (a === 'tshare') { shareFile(await getTicket(r.info, posterSrc), `${fileBase}-ticket.jpg`, r.title, link); track('ticket_shared'); }
  };
  $('#again', el).onclick = () => (!r.own ? (location.href = '/') : S.booth ? restart() : confirmRestart());
}

// newNumber: forget the phone too (another person on this phone, or a typo) -> back to the ticket page.
async function restart({ newNumber = false } = {}) {
  track('restart', newNumber ? { newNumber: true } : undefined);
  S.cast = {};
  S.posterData = null;
  S.posterFor = null;
  S.kvSeed = null;
  S.storyKey = null;
  if (!S.booth) S.director = '';
  try {
    await api('/api/session', { method: 'POST', body: { keepPhone: !S.booth && !newNumber, entry: S.booth ? 'booth' : 'qr' } });
    S.director = S.booth || newNumber ? '' : S.session.director || '';
    go(S.session.hasPhone ? 'genre' : 'landing', { slate: S.session.hasPhone });
  } catch (e) { handleError(e); }
}

// Public result page: /r/:token  (KakaoTalk link / re-visit)
let resultWatch = 0; // invalidates the result page's progress/poll loops
async function showResultPage(tok) {
  resultWatch++;
  $('#stepCount').textContent = '';
  let data;
  try { data = await api(`/api/result/${encodeURIComponent(tok)}`); }
  catch (e) {
    render(`<p class="scene">404</p><h2 class="h2">${esc(e.message)}</h2><p class="lead">내 결과 다시 보기에서 휴대폰 번호와 이름으로 찾아볼 수 있어요.</p><a class="btn btn-primary btn-block" href="/">체험 페이지로 가기</a>`);
    return;
  }
  track('result_viewed', { own: data.own });
  const r = data.result;
  const info = { title: r.title, tagline: r.tagline, director: r.director, seed: r.seed, genre: r.genre, keywords: r.keywords };
  if (r.videoStatus !== 'done') {
    const making = ['queued', 'submitting', 'running'].includes(r.videoStatus);
    const el = render(`
      <p class="scene">곧 송출</p>
      <h2 class="story-title" style="font-size:clamp(34px,10vw,52px)">${esc(r.title)}</h2>
      <p class="story-tagline">“${esc(r.tagline)}”</p>
      <div class="poster-wrap"><div class="poster-stage${making ? ' wait-card' : ''}" id="stage"><div class="boot"><div class="spinner"></div></div>${making ? progressMarkup('광고 영상 편집 중…') : ''}</div>
      <div class="poster-caption"><span>광고 ID ${pad(r.seed)}</span><span>기획 ${esc(r.director)}</span></div></div>
      ${making
        ? `<div class="notice"><span class="ico">⏱</span><span>광고 영상을 만들고 있어요. 이 페이지를 열어 두면 완성되는 즉시 재생돼요.</span></div>`
        : r.videoStatus === 'failed' ? `<div class="error-box"><b>광고 영상 생성 실패</b>${esc(r.videoError || '')}</div>` : ''}
      <div class="btn-row"><button class="btn" id="psave">${ic('download')}키비주얼 저장</button><button class="btn" id="pshare">${ic('share')}공유하기</button></div>
      <p style="text-align:center;margin-top:18px"><a class="linkish" href="/">나도 만들어보기</a></p>`);
    const src = await getComposedPoster(info, r.posterUrl, r.posterFinalUrl);
    $('#stage .boot', el)?.remove();
    $('#stage', el).insertAdjacentHTML('afterbegin', `<img class="${making ? 'kenburns' : 'reveal'}" src="${esc(src)}" alt="">`);
    $('#psave', el).onclick = () => download(src.startsWith('data:') ? src : `${src}?dl=1`, `seedance-commerce-${pad(r.seed)}.jpg`);
    $('#pshare', el).onclick = () => shareFile(src, `seedance-commerce-${pad(r.seed)}.jpg`, r.title, location.href);
    if (making) {
      // Keep the page as it is and only refresh the numbers; switch to the ad video when it is ready.
      let st = { requestedAt: r.videoRequestedAt, etaSec: r.etaSec, queuePos: r.videoQueuePos };
      const watch = ++resultWatch;
      trailerProgress(el, () => st, () => watch === resultWatch);
      (async function poll() {
        while (watch === resultWatch) {
          await sleep(6000);
          let d;
          try { d = await api(`/api/result/${encodeURIComponent(tok)}`); } catch { continue; }
          const x = d.result;
          if (!['queued', 'submitting', 'running'].includes(x.videoStatus)) {
            if (x.videoStatus === 'done') { navigator.vibrate?.([30, 60, 30]); toast('광고 영상이 완성됐어요! 📺'); }
            return showResultPage(tok);
          }
          st = { requestedAt: x.videoRequestedAt, etaSec: x.etaSec, queuePos: x.videoQueuePos };
        }
      })();
    }
    return;
  }
  renderResult({ title: r.title, tagline: r.tagline, info, posterRaw: r.posterUrl, posterFinal: r.posterFinalUrl, videoUrl: r.videoUrl, resultUrl: location.pathname, own: false, token: tok, screen: r.screen });
}

// ───────────────────────── key-visual compositing ─────────────────────────
function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

// Wait for the faces the canvas needs. Korean web fonts arrive in many small slices, so we ask
// for the exact characters about to be drawn; otherwise some glyphs fall back to another face.
const CANVAS_LABELS = '기획신상출시캠페인특가지금구매하기컨셉키비주얼영상광고ID원가격할인무드장바구니담기품SponsoredbyBytePlusSEOUL0123456789%,:→-—';
async function fontsReady(text = '') {
  if (!document.fonts?.load) return;
  const sample = `${CANVAS_LABELS}${text}가A`;
  const faces = ['80px "Black Han Sans"', '40px "Bebas Neue"', '500 30px "Pretendard Variable"', '700 30px "Pretendard Variable"', '900 30px "Pretendard Variable"',
    '500 30px "Noto Sans KR"', '700 30px "Noto Sans KR"'];
  await Promise.race([Promise.all(faces.map((f) => document.fonts.load(f, sample))), sleep(3000)]).catch(() => {});
}

function spaced(ctx, text, x, y, font, spacing, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  if ('letterSpacing' in ctx) { ctx.letterSpacing = `${spacing}px`; ctx.fillText(text, x + spacing / 2, y); ctx.letterSpacing = '0px'; }
  else ctx.fillText(text, x, y);
}

function wrapLines(ctx, text, maxW, sep = ' ') {
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

async function composePoster(src, info) {
  await fontsReady(`${info.title || ''}${info.tagline || ''}${info.director || ''}${info.genre?.ko || ''}${S.content?.event?.sponsor || ''}`);
  const img = await loadImg(src);
  // Laid out on a 1125x2000 grid, drawn at 1080x1920: 9:16 like the booth screens and the trailer.
  const W = 1125, H = 2000, OUT_W = 1080;
  const c = document.createElement('canvas');
  c.width = OUT_W; c.height = Math.round((OUT_W * H) / W);
  const x = c.getContext('2d');
  x.scale(OUT_W / W, OUT_W / W);
  const r = Math.max(W / img.naturalWidth, H / img.naturalHeight);
  const iw = img.naturalWidth * r, ih = img.naturalHeight * r;
  x.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);

  let g = x.createLinearGradient(0, 0, 0, H * 0.24);
  g.addColorStop(0, 'rgba(0,0,0,.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H * 0.24);
  g = x.createLinearGradient(0, H * 0.42, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.4, 'rgba(0,0,0,.72)'); g.addColorStop(1, 'rgba(0,0,0,.96)');
  x.fillStyle = g; x.fillRect(0, H * 0.42, W, H * 0.58);

  const accent = '#d4ff3a', ink = '#0b0d02';
  const o = offer(info.seed);
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  // Top of the key visual: only 기획 (the visitor's name). The other credits live in the footer lines.
  const name = String(info.director || '나');
  const credits = [{ label: '기획', value: name }];
  const LAB = '500 25px "Pretendard Variable", "Noto Sans KR", sans-serif', VAL = '700 27px "Pretendard Variable", "Noto Sans KR", sans-serif';
  // The 기획 line is the visitor's own name, so it is set clearly larger than the other credits.
  const LAB0 = '500 40px "Pretendard Variable", "Noto Sans KR", sans-serif', VAL0 = '900 70px "Pretendard Variable", "Noto Sans KR", sans-serif';
  x.textAlign = 'left';
  x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 12;
  let cy0 = 0;
  credits.forEach((cr, i) => {
    const y = i ? 128 + i * 42 : 106;
    cy0 = y;
    const lab = `${cr.label}: `;
    const fl = i ? LAB : LAB0;
    let fv = i ? VAL : VAL0;
    x.font = fl; const lw = x.measureText(lab).width;
    x.font = fv; let vw = x.measureText(cr.value).width;
    if (!i && lw + vw > W * 0.8) { fv = '900 50px "Pretendard Variable", "Noto Sans KR", sans-serif'; x.font = fv; vw = x.measureText(cr.value).width; } // very long names
    const x0 = (W - lw - vw) / 2;
    x.font = fl; x.fillStyle = 'rgba(255,255,255,.66)'; x.fillText(lab, x0, y);
    x.font = fv; x.fillStyle = i ? '#fff' : accent; x.fillText(cr.value, x0 + lw, y);
  });
  x.shadowBlur = 0;
  x.textAlign = 'center';
  spaced(x, `${info.genre?.ko || '광고'} 캠페인 신상 출시`, W / 2, cy0 + 60, '700 27px "Pretendard Variable", "Noto Sans KR", sans-serif', 5, accent);

  // Discount sticker
  x.save();
  x.translate(W - 158, 470);
  x.rotate(-0.16);
  x.beginPath(); x.arc(0, 0, 108, 0, Math.PI * 2);
  x.fillStyle = accent; x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 30; x.fill();
  x.shadowBlur = 0;
  spaced(x, '특가', 0, -36, '700 32px "Pretendard Variable", "Noto Sans KR", sans-serif', 8, ink);
  let ss = 94;
  const setS = () => (x.font = `${ss}px "Bebas Neue", sans-serif`);
  setS();
  while (x.measureText(`-${o.off}%`).width > 170 && ss > 48) { ss -= 4; setS(); }
  x.fillStyle = ink;
  x.fillText(`-${o.off}%`, 0, 52 - (94 - ss) * 0.3);
  x.restore();

  // Product name (auto-fit, up to 2 lines)
  const title = info.title;
  let size = 164;
  const setT = () => (x.font = `${size}px "Black Han Sans", "Pretendard Variable", "Noto Sans KR", sans-serif`);
  setT();
  while (x.measureText(title).width > W * 0.86 && size > 92) { size -= 4; setT(); }
  let tLines = [title];
  if (x.measureText(title).width > W * 0.86) tLines = wrapLines(x, title, W * 0.86).slice(0, 2);
  const titleBottom = H - 478;
  x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 30;
  x.fillStyle = '#fff';
  tLines.forEach((l, i) => x.fillText(l, W / 2, titleBottom - (tLines.length - 1 - i) * size * 1.02));
  x.shadowBlur = 0;

  // Headline copy above the product name
  x.font = '500 38px "Pretendard Variable", "Noto Sans KR", sans-serif';
  const tag = wrapLines(x, info.tagline || '', W * 0.8).slice(0, 2);
  const tagBottom = titleBottom - tLines.length * size * 1.02 - 26;
  x.fillStyle = 'rgba(255,255,255,.92)';
  tag.forEach((l, i) => x.fillText(l, W / 2, tagBottom - (tag.length - 1 - i) * 52));

  // Price row: 35%  19,900원  31,000원(struck)
  const fBig = '88px "Bebas Neue", "Pretendard Variable", "Noto Sans KR", sans-serif', fWas = '42px "Bebas Neue", "Pretendard Variable", "Noto Sans KR", sans-serif';
  const parts = [[`${o.off}%`, fBig, accent], [won(o.price), fBig, '#fff'], [won(o.was), fWas, 'rgba(255,255,255,.5)']];
  const widths = parts.map(([t, f]) => { x.font = f; return x.measureText(t).width; });
  const gap = 26;
  let px = (W - widths.reduce((a, b) => a + b, 0) - gap * 2) / 2;
  const py = H - 364;
  x.textAlign = 'left';
  parts.forEach(([t, f, col], i) => {
    x.font = f; x.fillStyle = col;
    x.fillText(t, px, py);
    if (i === 2) x.fillRect(px - 4, py - 16, widths[i] + 8, 3);
    px += widths[i] + gap;
  });
  x.textAlign = 'center';

  // CTA button
  const cw = 460, chh = 86, cy = H - 328;
  rrect(x, (W - cw) / 2, cy, cw, chh, chh / 2);
  x.fillStyle = accent; x.fill();
  x.font = '700 36px "Pretendard Variable", "Noto Sans KR", sans-serif'; x.fillStyle = ink;
  x.textBaseline = 'middle';
  x.fillText('지금 구매하기  →', W / 2, cy + chh / 2 + 2);
  x.textBaseline = 'alphabetic';

  // Who made what (no keyword lines on the key visual)
  x.globalAlpha = 0.62;
  spaced(x, '컨셉 Seed       키비주얼 Seedream       영상 Seedance', W / 2, H - 168, '500 25px "Pretendard Variable", "Noto Sans KR", sans-serif', 2, '#fff');
  x.globalAlpha = 1;

  // Footer: ad ID, sponsor, event
  x.fillStyle = 'rgba(255,255,255,.25)';
  x.fillRect(80, H - 112, W - 160, 1);
  x.textAlign = 'left';
  spaced(x, `광고 ID ${pad(info.seed)}`, 80, H - 58, '700 26px "Pretendard Variable", "Noto Sans KR", sans-serif', 2, accent);
  x.textAlign = 'right';
  spaced(x, 'SEOUL 2026', W - 82, H - 58, '30px "Bebas Neue", sans-serif', 4, 'rgba(255,255,255,.75)');
  x.textAlign = 'center';
  x.font = '600 30px "Pretendard Variable", "Noto Sans KR", sans-serif'; x.fillStyle = '#fff';
  x.fillText(S.content?.event?.sponsor || 'Sponsored by BytePlus', W / 2, H - 58);

  return c.toDataURL('image/jpeg', 0.9);
}

// ───────────────────────── product card ─────────────────────────
const ticketCache = new Map();
function getTicket(info, posterSrc) {
  const key = `${info.seed}|${info.title}`;
  if (!ticketCache.has(key)) ticketCache.set(key, composeTicket(posterSrc, info).catch((e) => { ticketCache.delete(key); throw e; }));
  return ticketCache.get(key);
}

function rrect(x, X, Y, w, h, r) {
  x.beginPath();
  if (x.roundRect) x.roundRect(X, Y, w, h, r); else x.rect(X, Y, w, h);
}

async function composeTicket(posterSrc, info) {
  await fontsReady(`${info.title || ''}${info.tagline || ''}${info.director || ''}${info.genre?.ko || ''}`);
  const img = await loadImg(posterSrc);
  const W = 900, H = 1500, M = 40;
  const accent = '#d4ff3a', bg = '#0a0a0b';
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);

  // ticket body
  const tx = M, ty = M, tw = W - M * 2, th = H - M * 2;
  rrect(x, tx, ty, tw, th, 36);
  const bodyG = x.createLinearGradient(0, ty, 0, ty + th);
  bodyG.addColorStop(0, '#1b1c14'); bodyG.addColorStop(1, '#141416');
  x.fillStyle = bodyG; x.fill();
  x.lineWidth = 2; x.strokeStyle = 'rgba(212,255,58,.35)'; x.stroke();

  // key-visual window
  const px = tx + 28, py = ty + 28, pw = tw - 56, ph = 580;
  x.save();
  rrect(x, px, py, pw, ph, 24); x.clip();
  const sc = pw / img.naturalWidth;
  x.drawImage(img, px, py - img.naturalHeight * sc * 0.1, pw, img.naturalHeight * sc); // show the product area: below the credits block, above the copy
  const fade = x.createLinearGradient(0, py + ph * 0.55, 0, py + ph);
  fade.addColorStop(0, 'rgba(20,20,22,0)'); fade.addColorStop(1, 'rgba(20,20,22,.95)');
  x.fillStyle = fade; x.fillRect(px, py, pw, ph);
  x.restore();

  // 신상품 badge
  x.font = '700 26px "Pretendard Variable", "Noto Sans KR", sans-serif';
  const bw = x.measureText('신상품').width + 3 * 4 + 40;
  rrect(x, px + 22, py + 22, bw, 46, 10); x.fillStyle = accent; x.fill();
  x.textAlign = 'left'; x.textBaseline = 'middle';
  spaced(x, '신상품', px + 40, py + 46, '700 26px "Pretendard Variable", "Noto Sans KR", sans-serif', 4, '#0b0d02');
  x.textBaseline = 'alphabetic';

  // product name + who planned it
  let size = 96;
  const setT = () => (x.font = `${size}px "Black Han Sans", "Pretendard Variable", "Noto Sans KR", sans-serif`);
  setT();
  while (x.measureText(info.title).width > pw && size > 52) { size -= 4; setT(); }
  x.fillStyle = '#fff';
  x.fillText(info.title, px, py + ph + 40 + size * 0.85);
  const yDir = py + ph + 40 + size * 0.85 + 62;
  spaced(x, `기획 ${String(info.director || '나')}`, px, yDir, '700 34px "Pretendard Variable", "Noto Sans KR", sans-serif', 3, accent);

  // info grid
  x.font = '500 30px "Pretendard Variable", "Noto Sans KR", sans-serif';
  x.fillStyle = 'rgba(255,255,255,.82)';
  let copy = info.tagline || '';
  while (copy.length > 4 && x.measureText(copy).width > pw) copy = `${copy.slice(0, -2).trimEnd()}…`;
  x.fillText(copy, px, yDir + 58);
  const o = offer(info.seed);
  const cells = [
    ['가격', won(o.price)],
    ['할인', `-${o.off}%`],
    ['무드', info.genre?.ko || '광고'],
    ['광고 ID', pad(info.seed)],
  ];
  const gy = yDir + 110, cw = pw / cells.length;
  x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(px, gy, pw, 2);
  cells.forEach(([k, v], i) => {
    const cx = px + cw * i;
    if (i) { x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(cx, gy + 18, 2, 88); }
    spaced(x, k, cx + (i ? 18 : 0), gy + 44, '500 18px "Pretendard Variable", "Noto Sans KR", sans-serif', 2, 'rgba(255,255,255,.5)');
    x.font = '44px "Bebas Neue", "Pretendard Variable", "Noto Sans KR", sans-serif';
    let vs = 44;
    while (x.measureText(v).width > cw - 24 && vs > 26) { vs -= 2; x.font = `${vs}px "Bebas Neue", "Pretendard Variable", "Noto Sans KR", sans-serif`; }
    x.fillStyle = '#fff';
    x.fillText(v, cx + (i ? 18 : 0), gy + 96);
  });

  // perforation with side notches
  const yP = ty + th - 240;
  x.setLineDash([14, 12]); x.lineWidth = 3; x.strokeStyle = 'rgba(255,255,255,.22)';
  x.beginPath(); x.moveTo(tx + 44, yP); x.lineTo(tx + tw - 44, yP); x.stroke(); x.setLineDash([]);
  for (const nx of [tx, tx + tw]) {
    x.beginPath(); x.arc(nx, yP, 30, 0, Math.PI * 2); x.fillStyle = bg; x.fill();
    x.beginPath(); x.arc(nx, yP, 30, nx === tx ? -Math.PI / 2 : Math.PI / 2, nx === tx ? Math.PI / 2 : Math.PI * 1.5);
    x.strokeStyle = 'rgba(212,255,58,.35)'; x.lineWidth = 2; x.stroke();
  }

  // stub: seeded barcode + text
  let rs = info.seed >>> 0 || 7;
  const rnd = () => ((rs = (rs * 1103515245 + 12345) >>> 0) / 4294967296);
  let bx = px;
  const by = yP + 52, bh = 120;
  x.fillStyle = '#ecece6';
  while (bx < px + 330) { const w = 2 + Math.floor(rnd() * 5); if (rnd() > 0.35) x.fillRect(bx, by, w, bh); bx += w + 2 + Math.floor(rnd() * 4); }
  x.textAlign = 'right';
  spaced(x, '장바구니 담기', px + pw, by + 36, '700 38px "Pretendard Variable", "Noto Sans KR", sans-serif', 4, accent);
  spaced(x, 'SEEDANCE COMMERCE LAB', px + pw, by + 80, '500 19px "Pretendard Variable", "Noto Sans KR", sans-serif', 3, 'rgba(255,255,255,.75)');
  spaced(x, `SEOUL 2026   광고 ID ${pad(info.seed)}`, px + pw, by + 112, '500 19px "Pretendard Variable", "Noto Sans KR", sans-serif', 3, 'rgba(255,255,255,.5)');
  x.textAlign = 'left';

  return c.toDataURL('image/jpeg', 0.92);
}

// ───────────────────────── save / share ─────────────────────────
// 95 → "1분 35초", 40 → "40초" (rounded to 5s so it doesn't flicker)
function fmtDur(sec) {
  const t = Math.max(5, Math.ceil((sec || 0) / 5) * 5);
  const m = Math.floor(t / 60), s = t % 60;
  return m ? `${m}분${s ? ` ${s}초` : ''}` : `${s}초`;
}

function absUrl(p) { return p ? new URL(p, S.boot?.publicBaseUrl || location.origin).href : location.href; }

function download(href, filename) {
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

async function shareFile(src, filename, title, link) {
  try {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], filename, { type: blob.type || (filename.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg') });
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title, text: `${title}\n${link}` }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  if (navigator.share) {
    try { await navigator.share({ title, text: title, url: link }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  await copyText(link);
  toast('공유 링크를 복사했어요');
}

let kakaoLoading;
async function kakaoShare({ title, director, tagline, image, link }) {
  const key = S.boot.kakao.jsKey;
  try {
    kakaoLoading ||= new Promise((res, rej) => {
      const sc = Object.assign(document.createElement('script'), { src: 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js', crossOrigin: 'anonymous', onload: res, onerror: rej });
      document.head.append(sc);
    });
    await kakaoLoading;
    if (!window.Kakao.isInitialized()) window.Kakao.init(key);
    window.Kakao.Share.sendDefault({
      objectType: 'feed',
      content: { title: `${title} — ${director} 기획`, description: tagline, imageUrl: image, link: { mobileWebUrl: link, webUrl: link } },
      buttons: [{ title: '광고 보러가기', link: { mobileWebUrl: link, webUrl: link } }],
    });
  } catch {
    await copyText(link);
    toast('카카오톡을 열 수 없어 링크를 복사했어요');
  }
}

// Booth tablet: return to the start screen after inactivity on the final screens.
if (S.booth) {
  let idle;
  const reset = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { if (['done', 'waiting'].includes(S.view)) restart(); }, 120000);
  };
  ['pointerdown', 'keydown', 'scroll'].forEach((ev) => addEventListener(ev, reset, { passive: true }));
  reset();
}

// ───────────────────────── boot ─────────────────────────
(async function boot() {
  try {
    S.boot = await api('/api/bootstrap');
  } catch (e) {
    render(`<h2 class="h2">연결할 수 없어요</h2><p class="lead">${esc(e.message)}</p><button class="btn btn-primary btn-block" onclick="location.reload()">다시 시도</button>`);
    return;
  }
  S.content = S.boot.content;
  $('#modeBadge').hidden = S.boot.mode !== 'mock';
  const m = location.pathname.match(/^\/r\/([\w-]+)/);
  if (m) return showResultPage(m[1]);
  if (!S.session) {
    try { await api('/api/session', { method: 'POST', body: { entry: S.booth ? 'booth' : 'qr' } }); } catch (e) { return handleError(e); }
  }
  history.replaceState({ view: null }, '', '/' );
  resume({ push: false, slate: false });
  history.replaceState({ view: S.view }, '', '/');
})();
