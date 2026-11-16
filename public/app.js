// Seedance Seoul Commerce Lab — booth client (vanilla JS, mobile first)
// Internal names follow the original flow: genre = ad mood, director = brand name,
// poster = ad key visual, trailer/video = short-form ad, ticket = product card.
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n, w = 6) => String(n ?? 0).padStart(w, '0');
const won = (n) => `${Number(n).toLocaleString('ko-KR')}원`;
// Playful, fictional price tag derived from the SEED NO. (same on poster, card and big screens).
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
  screen: '<rect x="2.5" y="4" width="19" height="12.5" rx="1.5"/><path d="M8 20.5h8M12 16.5v4"/><path d="m10.2 8 4 2.2-4 2.2z" fill="currentColor" stroke="none"/>',
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
  takes: {},        // clapperboard TAKE count per step
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
    if (!res.ok) throw Object.assign(new Error(data.error || '문제가 생겼어요. 다시 시도해 주세요.'), { status: res.status, code: data.code });
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
  toast(e.message || '문제가 생겼어요.');
  if (fallbackView) go(fallbackView);
}

// ───────────────────────── routing ─────────────────────────
const STEP_OF = { landing: 1, lookup: 1, genre: 2, cast: 3, story: 4, poster: 5, trailer: 6, waiting: 6, done: 6 };

// Ad-production names for each step (shown on the clapperboard and step labels).
const SCENES = {
  genre: { n: 1, ko: '브리프', en: 'BRIEF' },
  cast: { n: 2, ko: '컨셉', en: 'CONCEPT' },
  story: { n: 3, ko: '카피', en: 'COPY' },
  poster: { n: 4, ko: '촬영', en: 'SHOOTING', action: true },
  trailer: { n: 5, ko: '편집', en: 'EDITING' },
  waiting: { n: 5, ko: '편집', en: 'EDITING', action: true },
  done: { n: 6, ko: '온에어', en: 'ON AIR' },
};
const ORDER = ['landing', 'lookup', 'genre', 'cast', 'story', 'poster', 'trailer', 'waiting', 'done'];
const sceneLabel = (view) => { const sc = SCENES[view]; return `STEP ${pad(sc.n, 2)} / ${sc.en} · ${sc.ko}`; };

const today = () => { const d = new Date(); return `${d.getFullYear()}.${pad(d.getMonth() + 1, 2)}.${pad(d.getDate(), 2)}`; };
let slateTimer = 0;
async function clapperboard(view) {
  const sc = SCENES[view];
  if (!sc || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  S.takes[view] = (S.takes[view] || 0) + 1;
  const el = $('#slate');
  $('#slScene').textContent = pad(sc.n, 2);
  $('#slTake').textContent = S.takes[view];
  $('#slTitle').textContent = `${sc.ko} · ${sc.en}`;
  $('#slDir').textContent = (S.session?.director || S.director || 'MY BRAND').toUpperCase();
  $('#slDate').textContent = today();
  const my = ++slateTimer;
  el.classList.remove('show', 'clap', 'action');
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('show');
  await sleep(420);
  if (my !== slateTimer) return;
  el.classList.add('clap');
  navigator.vibrate?.(15);
  if (sc.action) { await sleep(160); el.classList.add('action'); }
  await sleep(sc.action ? 720 : 480);
  if (my !== slateTimer) return;
  el.classList.remove('show');
  await sleep(260);
  if (my === slateTimer) { el.hidden = true; el.classList.remove('clap', 'action'); }
}

function go(view, { push = true, slate } = {}) {
  S.pollId++; // cancels any running poll loop
  const prev = S.view;
  // Clap on forward moves (and when explicitly asked), never on back/restore.
  const forward = prev && ORDER.indexOf(view) > ORDER.indexOf(prev);
  if (slate ?? forward) clapperboard(view);
  S.view = view;
  const step = STEP_OF[view];
  $('#stepCount').textContent = step ? `${pad(step, 2)} / 06` : '';
  $('#progressBar').style.width = step ? `${(step / 6) * 100}%` : '0';
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

const render = (html) => { app.innerHTML = `<section class="view">${html}</section>`; return app.firstElementChild; };

// ───────────────────────── views ─────────────────────────
const VIEWS = {};

VIEWS.landing = () => {
  const c = S.content.copy;
  const title = esc(c.heroTitle).replace(/광고\./, '<em>광고.</em>');
  const el = render(`
    <p class="eyebrow">${esc(S.content.event.name)} · ${esc(S.content.event.city)} ${esc(S.content.event.year)}</p>
    <h1 class="h1">${title}</h1>
    <p class="lead">${esc(c.heroSub)}</p>
    <div class="hero-strip">
      <div><b>01 SEED</b><span>광고 카피</span></div>
      <div><b>02 SEEDREAM</b><span>키비주얼</span></div>
      <div><b>03 SEEDANCE</b><span>광고 영상</span></div>
    </div>
    <form class="ticket" id="phoneForm" novalidate>
      <div class="ticket-head">
        <div class="ticket-top"><span>SELLER PASS</span><span>№ ${pad(Math.floor(Math.random() * 9999), 4)}</span></div>
        <div class="ticket-name">SEEDANCE COMMERCE LAB</div>
        <div class="ticket-meta">
          <div><small>BOOTH</small><b>01</b></div>
          <div><small>DATE</small><b>${today()}</b></div>
          <div><small>SELLER</small><b>YOU</b></div>
        </div>
      </div>
      <div class="ticket-perf"></div>
      <div class="ticket-body">
      <label class="field">
        <span>셀러 패스 발급 · 결과를 받을 휴대폰 번호</span>
        <input class="input" id="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="010-0000-0000" maxlength="13" required>
        <div class="input-hint" id="phoneHint"></div>
      </label>
      <div class="check">
        <input type="checkbox" id="cPrivacy">
        <label for="cPrivacy"><span class="req">[필수]</span>개인정보 수집·이용 동의
          <details><summary>자세히 보기</summary><pre>${esc(c.consentPrivacy)}</pre></details>
        </label>
      </div>
      <div class="check">
        <input type="checkbox" id="cMarketing">
        <label for="cMarketing">[선택] ${esc(c.consentMarketing)}</label>
      </div>
      <button class="btn btn-primary btn-block" id="startBtn" type="submit" style="margin-top:8px">셀러 패스 받고 입점하기 ${ic('arrow')}</button>
      </div>
      <div class="ticket-perf"></div>
      <div class="ticket-stub"><span class="barcode" aria-hidden="true"></span><span>NON-TRANSFERABLE<br>SEOUL 2026</span></div>
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
    if (!/^01[016789]\d{7,8}$/.test(d) || (d.startsWith('010') && d.length !== 11)) {
      phone.classList.add('invalid');
      $('#phoneHint').textContent = '휴대폰 번호 형식을 확인해 주세요. (예: 010-1234-5678)';
      return phone.focus();
    }
    if (!$('#cPrivacy').checked) return toast('개인정보 수집·이용에 동의해 주세요.');
    const btn = $('#startBtn');
    btn.disabled = true;
    try {
      if (!S.session || S.session.story) await api('/api/session', { method: 'POST', body: { entry: S.booth ? 'booth' : 'qr' } });
      await api('/api/session/phone', { method: 'POST', body: { phone: d, consentPrivacy: true, consentMarketing: $('#cMarketing').checked } });
      go('genre');
    } catch (err) {
      btn.disabled = false;
      if (err.code === 'BAD_PHONE') { phone.classList.add('invalid'); $('#phoneHint').textContent = err.message; }
      else handleError(err);
    }
  };
};

VIEWS.lookup = () => {
  const el = render(`
    <button class="back" data-back>← 돌아가기</button>
    <p class="eyebrow">MY CAMPAIGN</p>
    <h2 class="h2">내 결과 다시 보기</h2>
    <p class="lead">체험할 때 입력한 휴대폰 번호와 브랜드 이름으로 키비주얼과 광고 영상을 다시 찾아드려요.</p>
    <form class="panel" id="lookupForm" novalidate>
      <label class="field"><span>휴대폰 번호</span><input class="input" id="lPhone" type="tel" inputmode="numeric" placeholder="010-0000-0000" maxlength="13"></label>
      <label class="field"><span>브랜드 이름</span><input class="input" id="lName" type="text" maxlength="12" placeholder="광고에 넣은 브랜드 이름"></label>
      <button class="btn btn-primary btn-block" type="submit">결과 찾기</button>
    </form>
    <div class="result-list" id="lookupList"></div>
  `);
  $('[data-back]', el).onclick = () => history.back();
  $('#lookupForm', el).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { results } = await api('/api/lookup', { method: 'POST', body: { phone: $('#lPhone').value, director: $('#lName').value } });
      $('#lookupList').innerHTML = results.map((r) => `
        <a class="result-item" href="${esc(r.url)}">
          <img src="${esc(r.poster)}" alt="">
          <div><b>${esc(r.title)}</b><span class="small">${esc(r.genre)} · ${new Date(r.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div>
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
          <span class="en">${esc(g.en)}</span><span class="ko">${esc(g.ko)}</span><span class="desc">${esc(g.desc)}</span>
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
    <button class="back" data-back>← 광고 무드 다시 고르기</button>
    <div class="cast-head"><p class="scene">${sceneLabel('cast')}</p><span class="tag">${esc(genre?.ko || '')}</span></div>
    <h2 class="h2">우연으로 <em>광고 컨셉</em>을 뽑으세요</h2>
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
      <span>브랜드 이름 · 광고 상단에 브랜드 로고처럼 들어가요</span>
      <input class="input" id="director" type="text" maxlength="12" placeholder="예) 길동상회" autocomplete="off" value="${esc(S.director)}">
    </label>
    <div class="cta-bar"><button class="btn btn-primary btn-block" id="castNext" disabled>Seed로 광고 카피 쓰기 ${ic('arrow')}</button></div>
  `);
  $('[data-back]', el).onclick = () => go('genre');

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
  $('#castNext', el).onclick = () => makeStory();
};

async function makeStory() {
  const director = $('#director')?.value.trim() || S.director || S.session.director;
  render(`
    <div class="loading-stage" style="aspect-ratio:auto;min-height:60vh">
      <div>
        <div class="countdown" style="--p:0%"><b>S</b></div>
        <div class="loading-msg">Seed가 SEED NO.를 발급하고<br>당신의 광고 카피를 쓰는 중…</div>
        <div class="loading-sub">MOOD + 6 KEYWORDS → COPY & PROMPT</div>
      </div>
      <div class="film-strip"></div>
    </div>`);
  try {
    await api('/api/story', { method: 'POST', body: { keywords: S.cast, director } });
    go('story');
  } catch (e) {
    if (e.code === 'NO_DIRECTOR' || e.code === 'BANNED') { toast(e.message); return go('cast'); }
    handleError(e, 'cast');
  }
}

VIEWS.story = () => {
  const s = S.session;
  const st = s.story;
  const tags = Object.values(s.keywords || {}).map((k) => `<span class="tag">${esc(k.ko)}</span>`).join('');
  const el = render(`
    <button class="back" data-back>← 키워드 다시 뽑기</button>
    <p class="scene">${sceneLabel('story')}</p>
    <div class="seed-chip"><i></i>SEED NO.${pad(s.seed)}</div>
    <h2 class="story-title">${esc(st.title)}</h2>
    <p class="story-tagline">“${esc(st.tagline)}”</p>
    <div class="story-meta"><span class="tag" style="color:var(--accent);border-color:rgba(212,255,58,.4)">${esc(st.genre.ko)}</span><span class="tag">BRAND · ${esc(s.director)}</span><span class="tag">${won(offer(s.seed).price)} · -${offer(s.seed).off}%</span></div>
    <p class="story-body">${esc(st.logline)}</p>
    <details class="prompt-box"><summary>상세페이지 카피 읽기</summary><div class="p-body"><p class="story-body" style="margin:0">${esc(st.synopsis)}</p></div></details>
    <details class="prompt-box" id="promptBox"><summary>자동으로 만들어지는 요청 보기</summary>
      <div class="p-body"><pre>${esc(s.posterPrompt)}</pre>
        <div class="p-meta"><span>SEEDREAM · 2:3 · SEED ${s.seed}${st.source === 'seed-llm' ? ' · WRITTEN BY SEED' : ''}</span><button class="copy-btn" data-copy>복사</button></div>
      </div>
    </details>
    <div class="story-meta" style="margin-top:14px">${tags}</div>
    <div class="cta-bar">
      <div class="notice"><span class="ico">✦</span><span>${esc(S.content.copy.posterNotice)}</span></div>
      <button class="btn btn-primary btn-block" id="makePoster">키비주얼 만들기 ${ic('sparkle')}</button>
      <p style="text-align:center;margin:8px 0 0"><button class="linkish" id="rewrite">같은 키워드로 다시 쓰기</button></p>
    </div>
  `);
  $('[data-back]', el).onclick = () => go('cast');
  $('#promptBox', el).addEventListener('toggle', (e) => e.target.open && track('prompt_opened'));
  $('[data-copy]', el).onclick = async () => { await copyText(s.posterPrompt); toast('프롬프트를 복사했어요'); track('prompt_copied'); };
  $('#rewrite', el).onclick = () => { S.director = s.director; makeStory(); };
  $('#makePoster', el).onclick = async () => {
    $('#makePoster').disabled = true;
    try { await api('/api/poster', { method: 'POST' }); go('poster'); }
    catch (e) { $('#makePoster').disabled = false; handleError(e); }
  };
};

const POSTER_MSGS = [
  'Seedream이 조명을 세팅하는 중…', '상품을 포디움에 올리는 중…', '모델이 포즈를 잡는 중…',
  'SEED NO.로 장면을 고정하는 중…', '리터칭으로 광을 내는 중…', '베스트 컷을 고르는 중…',
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
    <div class="notice"><span class="ico">✦</span><span><b>SEED NO.${pad(s.seed)}</b> → Seedream. ${esc(S.content.copy.posterNotice)}</span></div>
    <div class="poster-wrap"><div class="loading-stage">
      <div>
        <div class="countdown" id="cd" style="--p:0%"><b id="cdNum">30</b></div>
        <div class="loading-msg" id="lmsg">${POSTER_MSGS[0]}</div>
        <div class="loading-sub" id="lsub">“${esc(s.story.title)}” · 2:3 KEY ART</div>
      </div>
      <div class="film-strip"></div>
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
      const est = 30;
      el2.style.setProperty('--p', `${Math.min(97, (sec / est) * 100)}%`);
      $('#cdNum').textContent = Math.max(1, Math.ceil(est - sec));
      if (Date.now() - lastMsg > 3200) { msgI = (msgI + 1) % POSTER_MSGS.length; $('#lmsg').textContent = POSTER_MSGS[msgI]; lastMsg = Date.now(); }
      const q = S.session.poster.queuePos;
      if (q > 1) $('#lsub').textContent = `앞에 ${q - 1}명 대기 중 · 곧 시작해요`;
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
  const s = S.session;
  const el = render(`
    <p class="scene">${sceneLabel('poster')}</p>
    <h2 class="h2">이 광고의 첫 번째 고객은 <em>당신</em>입니다.</h2>
    <div class="poster-wrap">
      <div class="poster-stage" id="stage"><div class="boot"><div class="spinner"></div></div></div>
      <div class="poster-caption"><span>NO.${pad(s.seed)}</span><span>${esc(s.story.genre.en)} · 2:3</span></div>
    </div>
    <div class="btn-row"><button class="btn" id="save">${ic('download')}키비주얼 저장</button><button class="btn" id="share">${ic('share')}공유하기</button></div>
    ${screenCard(s.screen, { poster: true })}
    <div class="cta-bar">
      <button class="btn btn-primary btn-block" id="toTrailer">이 광고가 움직인다면? ${ic('arrow')}</button>
      ${s.poster.remaining > 0 ? `<p style="text-align:center;margin:8px 0 0"><button class="linkish" id="regen">키비주얼 다시 만들기 (${s.poster.remaining}회 남음)</button></p>` : ''}
    </div>
  `);
  const src = await getComposedPoster(infoFromSession(s), s.poster.url, s.poster.finalUrl);
  if (S.view !== 'poster') return;
  $('#stage', el).innerHTML = `<img class="reveal" src="${esc(src)}" alt="${esc(s.story.title)} 광고 키비주얼">`;
  if (src.startsWith('data:') && !s.poster.finalUrl) S.finalUpload = api('/api/poster/final', { method: 'POST', body: { dataUrl: src }, retries: 3 }).catch(() => {});
  bindScreenCard(el, {});
  const fname = `seedance-commerce-${pad(s.seed)}.jpg`;
  $('#save', el).onclick = () => { download(src.startsWith('data:') ? src : `${src}?dl=1`, fname); track('poster_saved'); toast('키비주얼을 저장했어요'); };
  $('#share', el).onclick = () => { shareFile(src, fname, `${s.story.title} — ${s.director}`, absUrl(s.resultUrl)); track('poster_shared'); };
  $('#toTrailer', el).onclick = () => go('trailer');
  $('#regen', el)?.addEventListener('click', async () => {
    try { await api('/api/poster', { method: 'POST' }); S.posterData = null; go('poster', { slate: true }); } catch (e) { handleError(e); }
  });
}

VIEWS.trailer = () => {
  const s = S.session;
  const k = S.boot.kakao;
  const failed = s.video.status === 'failed';
  const el = render(`
    <button class="back" data-back>← 키비주얼로 돌아가기</button>
    <div class="trailer-head">
      <img src="${esc(S.posterData || s.poster.finalUrl || s.poster.url)}" alt="">
      <div><p class="scene" style="margin:0">${sceneLabel('trailer')}</p><p class="big-q">이 광고가<br><em style="color:var(--accent);font-style:normal">움직인다면?</em></p></div>
    </div>
    ${failed ? `<div class="error-box"><b>광고 영상 생성 실패</b>${esc(s.video.error || '')}</div>` : ''}
    <p class="story-body">${esc(s.story.videoKo)}</p>
    <p class="small" style="margin:-10px 0 18px">${esc(S.content.copy.videoNotice)}</p>
    <details class="prompt-box"><summary>Seedance 광고 영상 프롬프트 보기</summary>
      <div class="p-body"><pre>${esc(s.videoPrompt)}</pre><div class="p-meta"><span>SEEDANCE · IMAGE→VIDEO · SEED ${s.seed}</span><button class="copy-btn" data-copy>복사</button></div></div>
    </details>
    ${kakaoCard(k.enabled, `완성되면 ${esc(s.phoneMasked)} 번호로 알려드려요`, '평균 3~5분 · 자리를 떠나도 괜찮아요')}
    <div class="cta-bar">
      <button class="btn btn-primary btn-block" id="makeVideo">${failed ? '다시 시도하기' : '영상 생성하기'} ${ic('play')}</button>
    </div>
  `);
  $('[data-back]', el).onclick = () => go('poster');
  $('[data-copy]', el).onclick = async () => { await copyText(s.videoPrompt); toast('프롬프트를 복사했어요'); track('prompt_copied', { kind: 'video' }); };
  $('#makeVideo', el).onclick = async () => {
    $('#makeVideo').disabled = true;
    try { await api('/api/video', { method: 'POST' }); go('waiting'); }
    catch (e) { $('#makeVideo').disabled = false; handleError(e); }
  };
};

// ───────────── big screens: visitor submits key visual / ad video ─────────────
const SCREEN_ROWS = {
  poster: { tag: 'AD WALL', name: '신상 광고 월', cta: '광고 걸기', ok: '광고 월에 키비주얼이 걸렸어요!' },
  trailer: { tag: 'CH.01', name: '광고 쇼케이스', cta: '송출하기', ok: '광고 쇼케이스 대기열에 올렸어요!' },
};
const screenState = (st) => (st === 'live' ? '<span class="sc-state live"><i></i>송출 중</span>' : '<span class="sc-state">운영진 확인 중</span>');
function screenCard(state = {}, { poster = false, trailer = false } = {}) {
  const rows = Object.entries({ poster, trailer }).filter(([, on]) => on).map(([kind]) => {
    const st = state?.[kind];
    const r = SCREEN_ROWS[kind];
    const right = st ? screenState(st) : `<button class="btn sc-btn" data-screen="${kind}">${r.cta}</button>`;
    return `<div class="sc-row"><div><small>${r.tag}</small><b>${r.name}</b></div>${right}</div>`;
  }).join('');
  return `<div class="screen-card">
    <div class="sc-head"><span class="sc-ico">${ic('screen')}</span><div><b>현장 대형 스크린에 광고 내보내기</b>
      <span>제출하면 브랜드 이름·상품명·${trailer ? '키비주얼·광고 영상' : '키비주얼'}이 부스 대형 스크린에 공개돼요.</span></div></div>
    <div class="sc-rows">${rows}</div></div>`;
}
function bindScreenCard(el, { token }) {
  $$('[data-screen]', el).forEach((b) => (b.onclick = async () => {
    const kind = b.dataset.screen;
    b.disabled = true;
    try {
      if (kind === 'poster' && S.finalUpload) await S.finalUpload;
      const r = await api('/api/screen/submit', { method: 'POST', body: { kind, token } });
      const st = r.screen?.[kind];
      if (S.session && !token) S.session.screen = r.screen;
      b.outerHTML = screenState(st);
      navigator.vibrate?.(20);
      toast(st === 'live' ? `${SCREEN_ROWS[kind].ok} 📺` : '운영진 확인 후 대형 스크린에 송출돼요');
    } catch (e) { b.disabled = false; handleError(e); }
  }));
}

function kakaoCard(enabled, title, sub) {
  return enabled
    ? `<div class="kakao-card"><span class="k-ico">TALK</span><div><b>${title}</b><span>${sub}</span></div></div>`
    : `<div class="kakao-card off"><span class="k-ico">LINK</span><div><b>결과 링크를 저장해 두세요</b><span>${sub}</span></div></div>`;
}

const RENDER_MSGS = ['키비주얼 속 상품에 숨을 불어넣는 중', '카메라 레일을 까는 중', '첫 프레임과 마지막 프레임을 잇는 중', '빛과 반사의 움직임을 계산하는 중', '8초짜리 광고 컷을 다듬는 중'];

VIEWS.waiting = () => {
  const s = S.session;
  const poster = S.posterData || s.poster.finalUrl || s.poster.url;
  const link = absUrl(s.resultUrl);
  const el = render(`
    <p class="scene">${sceneLabel('waiting')}</p>
    <h2 class="h2">광고 영상 <em>편집 중</em></h2>
    <div class="poster-wrap"><div class="poster-stage wait-card">
      <img class="kenburns" src="${esc(poster)}" alt="">
      <div class="wait-overlay">
        <span class="status-dot" id="wStatus">RENDERING</span>
        <div class="bar"><i id="wBar"></i></div>
        <div class="wait-row"><span id="wMsg">${RENDER_MSGS[0]}</span><span id="wTime">0:00</span></div>
      </div>
    </div></div>
    ${kakaoCard(S.boot.kakao.enabled, `완성되면 ${esc(s.phoneMasked)} 번호로 카카오톡을 보내드려요`, '자리를 떠나도 괜찮아요. 부스를 둘러보고 오세요!')}
    <div class="btn-row"><button class="btn" id="copyLink">결과 링크 복사</button><button class="btn" id="again">${S.booth ? '다음 셀러' : '하나 더 만들기'}</button></div>
    <p class="small" style="text-align:center;margin-top:14px">이 화면을 켜 두면 완성되는 즉시 재생돼요.</p>
  `);
  $('#copyLink', el).onclick = async () => { await copyText(link); toast('결과 링크를 복사했어요'); };
  $('#again', el).onclick = restart;
  const myPoll = S.pollId;
  const eta = s.video.etaSec || 240;
  let i = 0;
  (async function loop() {
    while (myPoll === S.pollId && $('#wBar')) {
      const sec = (Date.now() - (S.session.video.requestedAt || Date.now())) / 1000;
      const pct = Math.min(96, 100 * (1 - Math.exp(-sec / (eta * 0.55))));
      $('#wBar').style.width = `${pct}%`;
      $('#wTime').textContent = `${mmss(sec)} / 약 ${Math.round(eta / 60)}분`;
      const q = S.session.video.queuePos;
      $('#wStatus').textContent = q > 1 ? `QUEUED · 앞에 ${q - 1}명 대기 중` : 'RENDERING';
      if (Math.floor(sec) % 6 === 0) $('#wMsg').textContent = RENDER_MSGS[i++ % RENDER_MSGS.length];
      await sleep(1000);
    }
  })();
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
    <p class="scene">${r.own ? sceneLabel('done') : 'NOW ON AIR'}</p>
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
    <div class="poster-caption"><span>NO.${pad(r.info.seed)}</span><span>BRAND · ${esc(r.info.director)}</span></div></div>
    <div class="actions" id="actions"></div>
    ${screenCard(r.screen, { poster: true, trailer: !!r.videoUrl })}
    ${r.own ? (k.enabled
      ? `<div class="kakao-card${sent ? '' : ' off'}"><span class="k-ico">TALK</span><div><b>${sent ? '카카오톡으로 결과 링크를 보냈어요' : '카카오톡 발송 대기 중'}</b><span>${S.boot.mode === 'mock' || k.provider === 'mock' ? '데모 모드: 실제 발송 대신 운영자 화면에 기록돼요' : `${esc(S.session.phoneMasked)} · 링크는 일정 기간 후 만료돼요`}</span></div></div>`
      : '') : ''}
    <div class="end-card">
      <div class="big">${r.own ? '이 광고의 첫 번째 고객은 당신입니다.' : '나도 나만의 광고를 만들어 볼까요?'}</div>
      <p class="small">${r.own ? '키비주얼과 광고 영상을 간직하고, 다음 캠페인을 상상해 보세요.' : 'Seedance Seoul Commerce Lab 부스에서 직접 체험해 보세요.'}</p>
      <button class="btn btn-ghost btn-block" id="again" style="margin-top:12px">${r.own ? (S.booth ? '다음 셀러 시작하기' : '처음부터 다시 체험하기') : '나도 만들어보기'}</button>
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
        ${k.jsKey ? `<button class="btn btn-block" data-a="kshare" style="background:#fee500;color:#191600;border:0">카카오톡으로 공유하기</button>` : ''}
        <button class="btn btn-block" data-a="summary">결과 요약 복사</button>`;
    }
  };
  bindScreenCard(el, { token: r.token });
  showTab('video');
  tabBtns.forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));
  const summary = () => `🛍️ ${r.title}\n“${r.tagline}”\n${r.info.director} · ${won(offer(r.info.seed).price)} (-${offer(r.info.seed).off}%) · SEED NO.${pad(r.info.seed)}\n\n${Object.values(r.info.keywords || {}).map((x) => `#${x.ko.replace(/[\s&+]/g, '')}`).join(' ')}\n\n내 광고 보러가기 → ${link}\nSeedance Seoul Commerce Lab`;
  actions.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'psave') { download(posterSrc.startsWith('data:') ? posterSrc : `${posterSrc}?dl=1`, `${fileBase}.jpg`); track('poster_saved'); }
    if (a === 'pshare') { shareFile(posterSrc, `${fileBase}.jpg`, r.title, link); track('poster_shared'); }
    if (a === 'vsave') { download(`${r.videoUrl}?dl=1`, `${fileBase}.mp4`); track('video_downloaded'); toast('영상을 저장하고 있어요'); }
    if (a === 'vshare') { shareFile(r.videoUrl, `${fileBase}.mp4`, r.title, link); track('video_shared'); }
    if (a === 'summary') { await copyText(summary()); toast('결과 요약을 복사했어요. 카톡에 붙여넣어 보세요!'); track('summary_copied'); }
    if (a === 'kshare') { kakaoShare(r, posterSrc, link); track('kakao_share'); }
    if (a === 'tsave') { download(await getTicket(r.info, posterSrc), `${fileBase}-ticket.jpg`); track('ticket_saved'); toast('상품 카드를 저장했어요'); }
    if (a === 'tshare') { shareFile(await getTicket(r.info, posterSrc), `${fileBase}-ticket.jpg`, r.title, link); track('ticket_shared'); }
  };
  $('#again', el).onclick = () => (r.own ? restart() : (location.href = '/'));
}

async function restart() {
  track('restart');
  S.cast = {};
  S.takes = {};
  S.posterData = null;
  S.posterFor = null;
  if (!S.booth) S.director = '';
  try {
    await api('/api/session', { method: 'POST', body: { keepPhone: !S.booth, entry: S.booth ? 'booth' : 'qr' } });
    S.director = S.booth ? '' : S.session.director || '';
    go(S.session.hasPhone ? 'genre' : 'landing', { slate: S.session.hasPhone });
  } catch (e) { handleError(e); }
}

// Public result page: /r/:token  (KakaoTalk link / re-visit)
async function showResultPage(tok) {
  $('#stepCount').textContent = '';
  let data;
  try { data = await api(`/api/result/${encodeURIComponent(tok)}`); }
  catch (e) {
    render(`<p class="scene">404</p><h2 class="h2">${esc(e.message)}</h2><p class="lead">내 결과 다시 보기에서 휴대폰 번호와 브랜드 이름으로 찾아볼 수 있어요.</p><a class="btn btn-primary btn-block" href="/">체험 페이지로 가기</a>`);
    return;
  }
  track('result_viewed', { own: data.own });
  const r = data.result;
  const info = { title: r.title, tagline: r.tagline, director: r.director, seed: r.seed, genre: r.genre, keywords: r.keywords };
  if (r.videoStatus !== 'done') {
    const el = render(`
      <p class="scene">ON AIR · SOON</p>
      <h2 class="story-title" style="font-size:clamp(34px,10vw,52px)">${esc(r.title)}</h2>
      <p class="story-tagline">“${esc(r.tagline)}”</p>
      <div class="poster-wrap"><div class="poster-stage" id="stage"><div class="boot"><div class="spinner"></div></div></div>
      <div class="poster-caption"><span>NO.${pad(r.seed)}</span><span>BRAND · ${esc(r.director)}</span></div></div>
      ${['queued', 'submitting', 'running'].includes(r.videoStatus)
        ? `<div class="notice"><span class="ico">⏱</span><span>광고 영상을 만들고 있어요. 이 페이지를 열어 두면 완성되는 즉시 재생돼요.</span></div>`
        : r.videoStatus === 'failed' ? `<div class="error-box"><b>광고 영상 생성 실패</b>${esc(r.videoError || '')}</div>` : ''}
      <div class="btn-row"><button class="btn" id="psave">${ic('download')}키비주얼 저장</button><button class="btn" id="pshare">${ic('share')}공유하기</button></div>
      <p style="text-align:center;margin-top:18px"><a class="linkish" href="/">나도 만들어보기</a></p>`);
    const src = await getComposedPoster(info, r.posterUrl, r.posterFinalUrl);
    $('#stage', el).innerHTML = `<img class="reveal" src="${esc(src)}" alt="">`;
    $('#psave', el).onclick = () => download(src.startsWith('data:') ? src : `${src}?dl=1`, `seedance-commerce-${pad(r.seed)}.jpg`);
    $('#pshare', el).onclick = () => shareFile(src, `seedance-commerce-${pad(r.seed)}.jpg`, r.title, location.href);
    if (['queued', 'submitting', 'running'].includes(r.videoStatus)) setTimeout(() => showResultPage(tok), 8000);
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

async function fontsReady() {
  if (!document.fonts?.load) return;
  await Promise.race([
    Promise.all(['80px "Black Han Sans"', '40px "Bebas Neue"', '500 30px "Noto Sans KR"', '700 30px "Noto Sans KR"', '500 20px "IBM Plex Mono"'].map((f) => document.fonts.load(f, '가A'))),
    sleep(2500),
  ]).catch(() => {});
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
  await fontsReady();
  const img = await loadImg(src);
  const W = 1200, H = 1800;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
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

  // Brand wordmark (the visitor's brand name) + campaign line
  const brand = String(info.director || 'MY BRAND').toUpperCase();
  let bs = 72;
  const setB = () => (x.font = `${bs}px "Black Han Sans", "Noto Sans KR", sans-serif`);
  setB();
  while (x.measureText(brand).width > W * 0.62 && bs > 40) { bs -= 4; setB(); }
  x.fillStyle = '#fff';
  x.fillText(brand, W / 2, 116);
  spaced(x, `NEW DROP  ·  ${info.genre.en} CAMPAIGN`, W / 2, 160, '26px "Bebas Neue", "Noto Sans KR", sans-serif', 6, accent);

  // Discount sticker
  x.save();
  x.translate(W - 150, 330);
  x.rotate(-0.16);
  x.beginPath(); x.arc(0, 0, 104, 0, Math.PI * 2);
  x.fillStyle = accent; x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 30; x.fill();
  x.shadowBlur = 0;
  spaced(x, 'SALE', 0, -34, '34px "Bebas Neue", sans-serif', 6, ink);
  let ss = 92;
  const setS = () => (x.font = `${ss}px "Bebas Neue", sans-serif`);
  setS();
  while (x.measureText(`-${o.off}%`).width > 164 && ss > 48) { ss -= 4; setS(); }
  x.fillStyle = ink;
  x.fillText(`-${o.off}%`, 0, 50 - (92 - ss) * 0.3);
  x.restore();

  // Product name (auto-fit, up to 2 lines)
  const title = info.title;
  let size = 168;
  const setT = () => (x.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`);
  setT();
  while (x.measureText(title).width > W * 0.86 && size > 92) { size -= 4; setT(); }
  let tLines = [title];
  if (x.measureText(title).width > W * 0.86) tLines = wrapLines(x, title, W * 0.86).slice(0, 2);
  const titleBottom = H - 440;
  x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 30;
  x.fillStyle = '#fff';
  tLines.forEach((l, i) => x.fillText(l, W / 2, titleBottom - (tLines.length - 1 - i) * size * 1.02));
  x.shadowBlur = 0;

  // Headline copy above the product name
  x.font = '500 38px "Noto Sans KR", sans-serif';
  const tag = wrapLines(x, info.tagline || '', W * 0.8).slice(0, 2);
  const tagBottom = titleBottom - tLines.length * size * 1.02 - 26;
  x.fillStyle = 'rgba(255,255,255,.92)';
  tag.forEach((l, i) => x.fillText(l, W / 2, tagBottom - (tag.length - 1 - i) * 52));

  // Price row: -35%  19,900원  31,000원(struck)
  const fBig = '88px "Bebas Neue", "Noto Sans KR", sans-serif', fWas = '42px "Bebas Neue", "Noto Sans KR", sans-serif';
  const parts = [[`${o.off}%`, fBig, accent], [won(o.price), fBig, '#fff'], [won(o.was), fWas, 'rgba(255,255,255,.5)']];
  const widths = parts.map(([t, f]) => { x.font = f; return x.measureText(t).width; });
  const gap = 26;
  let px = (W - widths.reduce((a, b) => a + b, 0) - gap * 2) / 2;
  const py = H - 326;
  x.textAlign = 'left';
  parts.forEach(([t, f, c], i) => {
    x.font = f; x.fillStyle = c;
    x.fillText(t, px, py);
    if (i === 2) x.fillRect(px - 4, py - 16, widths[i] + 8, 3);
    px += widths[i] + gap;
  });
  x.textAlign = 'center';

  // CTA button
  const cw = 460, chh = 86, cy = H - 290;
  rrect(x, (W - cw) / 2, cy, cw, chh, chh / 2);
  x.fillStyle = accent; x.fill();
  x.font = '700 36px "Noto Sans KR", sans-serif'; x.fillStyle = ink;
  x.textBaseline = 'middle';
  x.fillText('지금 구매하기  →', W / 2, cy + chh / 2 + 2);
  x.textBaseline = 'alphabetic';

  // Credits
  const kws = Object.values(info.keywords || {}).map((k) => k.ko);
  x.globalAlpha = 0.6;
  spaced(x, `COPY BY SEED   ·   KEY VISUAL BY SEEDREAM   ·   MOTION BY SEEDANCE   ·   SEED ${info.seed}`, W / 2, H - 158, '24px "Bebas Neue", sans-serif', 3, '#fff');
  x.font = '400 21px "Noto Sans KR", sans-serif';
  const kwLines = wrapLines(x, kws.join('  ·  '), W * 0.86, '  ·  ').slice(0, 2);
  x.fillStyle = '#fff';
  kwLines.forEach((l, i) => x.fillText(l, W / 2, H - 122 + i * 30));
  x.globalAlpha = 1;

  x.fillStyle = 'rgba(255,255,255,.25)';
  x.fillRect(80, H - 72, W - 160, 1);
  x.textAlign = 'left';
  spaced(x, `NO.${pad(info.seed)}`, 80, H - 34, '30px "Bebas Neue", sans-serif', 4, accent);
  x.textAlign = 'right';
  spaced(x, 'SEOUL 2026', W - 84, H - 34, '30px "Bebas Neue", sans-serif', 4, '#fff');
  x.textAlign = 'center';
  spaced(x, 'SHOP NOW', W / 2, H - 34, '30px "Bebas Neue", sans-serif', 6, 'rgba(255,255,255,.7)');

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
  await fontsReady();
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
  x.drawImage(img, px, py - img.naturalHeight * sc * 0.105, pw, img.naturalHeight * sc); // show the product area: below the brand line, above the copy
  const fade = x.createLinearGradient(0, py + ph * 0.55, 0, py + ph);
  fade.addColorStop(0, 'rgba(20,20,22,0)'); fade.addColorStop(1, 'rgba(20,20,22,.95)');
  x.fillStyle = fade; x.fillRect(px, py, pw, ph);
  x.restore();

  // NEW ARRIVAL badge
  x.font = '30px "Bebas Neue", sans-serif';
  const bw = x.measureText('NEW ARRIVAL').width + 11 * 3 + 40;
  rrect(x, px + 22, py + 22, bw, 46, 10); x.fillStyle = accent; x.fill();
  x.textAlign = 'left'; x.textBaseline = 'middle';
  spaced(x, 'NEW ARRIVAL', px + 40, py + 47, '30px "Bebas Neue", sans-serif', 3, '#0b0d02');
  x.textBaseline = 'alphabetic';

  // product name + brand
  let size = 96;
  const setT = () => (x.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`);
  setT();
  while (x.measureText(info.title).width > pw && size > 52) { size -= 4; setT(); }
  x.fillStyle = '#fff';
  x.fillText(info.title, px, py + ph + 40 + size * 0.85);
  const yDir = py + ph + 40 + size * 0.85 + 62;
  spaced(x, String(info.director || 'MY BRAND').toUpperCase(), px, yDir, '40px "Bebas Neue", "Noto Sans KR", sans-serif', 6, accent);

  // info grid
  x.font = '500 30px "Noto Sans KR", sans-serif';
  x.fillStyle = 'rgba(255,255,255,.82)';
  let copy = info.tagline || '';
  while (copy.length > 4 && x.measureText(copy).width > pw) copy = `${copy.slice(0, -2).trimEnd()}…`;
  x.fillText(copy, px, yDir + 58);
  const o = offer(info.seed);
  const cells = [
    ['PRICE', won(o.price)],
    ['SALE', `-${o.off}%`],
    ['MOOD', info.genre?.en || 'AD'],
    ['ITEM NO.', pad(info.seed)],
  ];
  const gy = yDir + 110, cw = pw / cells.length;
  x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(px, gy, pw, 2);
  cells.forEach(([k, v], i) => {
    const cx = px + cw * i;
    if (i) { x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(cx, gy + 18, 2, 88); }
    spaced(x, k, cx + (i ? 18 : 0), gy + 44, '500 17px "IBM Plex Mono", monospace', 3, 'rgba(255,255,255,.5)');
    x.font = '44px "Bebas Neue", "Noto Sans KR", sans-serif';
    let vs = 44;
    while (x.measureText(v).width > cw - 24 && vs > 26) { vs -= 2; x.font = `${vs}px "Bebas Neue", "Noto Sans KR", sans-serif`; }
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
  spaced(x, 'ADD TO CART', px + pw, by + 40, '50px "Bebas Neue", sans-serif', 6, accent);
  spaced(x, 'SEEDANCE COMMERCE LAB', px + pw, by + 80, '500 19px "IBM Plex Mono", monospace', 3, 'rgba(255,255,255,.75)');
  spaced(x, `SEOUL 2026 · NO.${pad(info.seed)}`, px + pw, by + 112, '500 19px "IBM Plex Mono", monospace', 3, 'rgba(255,255,255,.5)');
  x.textAlign = 'left';

  return c.toDataURL('image/jpeg', 0.92);
}

// ───────────────────────── save / share ─────────────────────────
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
async function kakaoShare(r, posterSrc, link) {
  const key = S.boot.kakao.jsKey;
  try {
    kakaoLoading ||= new Promise((res, rej) => {
      const sc = Object.assign(document.createElement('script'), { src: 'https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js', crossOrigin: 'anonymous', onload: res, onerror: rej });
      document.head.append(sc);
    });
    await kakaoLoading;
    if (!window.Kakao.isInitialized()) window.Kakao.init(key);
    const image = absUrl(r.posterFinal || r.posterRaw);
    window.Kakao.Share.sendDefault({
      objectType: 'feed',
      content: { title: `${r.title} — ${r.info.director}`, description: r.tagline, imageUrl: image, link: { mobileWebUrl: link, webUrl: link } },
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
