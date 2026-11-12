// Seedance Seoul Cinema Lab — booth client (vanilla JS, mobile first)
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pad = (n, w = 6) => String(n ?? 0).padStart(w, '0');
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

// ───────────────────────── icons ─────────────────────────
const ICONS = {
  arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  share: '<path d="M8 10H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-2"/><path d="M12 14V3"/><path d="m8 7 4-4 4 4"/>',
  play: '<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none"/>',
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
  takes: {},        // clapperboard TAKE count per scene
  booth: false,
};

try {
  const q = new URLSearchParams(location.search);
  if (q.has('booth')) localStorage.setItem('scl_booth', q.get('booth') === '0' ? '0' : '1');
  S.booth = localStorage.getItem('scl_booth') === '1';
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

// Film-production names for each step (shown on the clapperboard and scene labels).
const SCENES = {
  genre: { n: 1, ko: '장르', en: 'GENRE' },
  cast: { n: 2, ko: '캐스팅', en: 'CASTING' },
  story: { n: 3, ko: '시나리오', en: 'SCRIPT' },
  poster: { n: 4, ko: '촬영', en: 'SHOOTING', action: true },
  trailer: { n: 5, ko: '편집', en: 'EDITING' },
  waiting: { n: 5, ko: '편집', en: 'EDITING', action: true },
  done: { n: 6, ko: '시사회', en: 'PREMIERE' },
};
const ORDER = ['landing', 'lookup', 'genre', 'cast', 'story', 'poster', 'trailer', 'waiting', 'done'];
const sceneLabel = (view) => { const sc = SCENES[view]; return `SCENE ${pad(sc.n, 2)} / ${sc.en} · ${sc.ko}`; };

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
  $('#slDir').textContent = (S.session?.director || S.director || 'YOU').toUpperCase();
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
  const title = esc(c.heroTitle).replace(/영화\./, '<em>영화.</em>');
  const el = render(`
    <p class="eyebrow">${esc(S.content.event.name)} · ${esc(S.content.event.city)} ${esc(S.content.event.year)}</p>
    <h1 class="h1">${title}</h1>
    <p class="lead">${esc(c.heroSub)}</p>
    <div class="hero-strip">
      <div><b>01 SEED</b><span>스토리</span></div>
      <div><b>02 SEEDREAM</b><span>포스터</span></div>
      <div><b>03 SEEDANCE</b><span>트레일러</span></div>
    </div>
    <form class="ticket" id="phoneForm" novalidate>
      <div class="ticket-head">
        <div class="ticket-top"><span>ADMIT ONE</span><span>№ ${pad(Math.floor(Math.random() * 9999), 4)}</span></div>
        <div class="ticket-name">SEEDANCE CINEMA LAB</div>
        <div class="ticket-meta">
          <div><small>SCREEN</small><b>01</b></div>
          <div><small>DATE</small><b>${today()}</b></div>
          <div><small>SEAT</small><b>YOU</b></div>
        </div>
      </div>
      <div class="ticket-perf"></div>
      <div class="ticket-body">
      <label class="field">
        <span>티켓 발급 · 결과를 받을 휴대폰 번호</span>
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
      <button class="btn btn-primary btn-block" id="startBtn" type="submit" style="margin-top:8px">티켓 받고 입장하기 ${ic('arrow')}</button>
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
    <p class="eyebrow">MY CINEMA</p>
    <h2 class="h2">내 결과 다시 보기</h2>
    <p class="lead">체험할 때 입력한 휴대폰 번호와 감독 이름으로 포스터와 트레일러를 다시 찾아드려요.</p>
    <form class="panel" id="lookupForm" novalidate>
      <label class="field"><span>휴대폰 번호</span><input class="input" id="lPhone" type="tel" inputmode="numeric" placeholder="010-0000-0000" maxlength="13"></label>
      <label class="field"><span>감독 이름</span><input class="input" id="lName" type="text" maxlength="12" placeholder="포스터에 넣은 이름"></label>
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
          <span class="small mono">${r.videoStatus === 'done' ? '▶ 영상' : r.videoStatus === 'idle' ? '포스터' : '생성 중'}</span>
        </a>`).join('');
    } catch (err) { toast(err.message); }
  };
};

VIEWS.genre = () => {
  let selected = S.session.genre;
  const el = render(`
    <p class="scene">${sceneLabel('genre')}</p>
    <h2 class="h2">어떤 <em>장르</em>의 영화를<br>만들어 볼까요?</h2>
    <p class="lead">고른 장르가 포스터의 색감과 트레일러의 카메라 워크를 결정해요.</p>
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
    <button class="back" data-back>← 장르 다시 고르기</button>
    <div class="cast-head"><p class="scene">${sceneLabel('cast')}</p><span class="tag">${esc(genre?.ko || '')}</span></div>
    <h2 class="h2">우연을 <em>캐스팅</em>하세요</h2>
    <p class="lead">버튼 하나로 키워드 6개를 뽑고, 마음에 들지 않는 카드만 <b style="color:var(--accent)">↻</b> 다시 뽑아보세요.</p>
    <button class="btn draw-all" id="drawAll" type="button">⤨ 키워드 6개 한 번에 뽑기</button>
    <div class="cast-grid">
      ${cats.map((c) => `
        <div class="kcard" data-cat="${c.id}">
          <div class="k-top"><span class="k-cat">${esc(c.ko)}<small>${esc(c.en)}</small></span>
            <button class="k-re" type="button" data-reroll="${c.id}" aria-label="${esc(c.ko)} 다시 뽑기">↻</button></div>
          <div class="k-val placeholder">어떤 이야기가 기다릴까요?</div>
        </div>`).join('')}
    </div>
    <label class="field">
      <span>감독 이름 · 포스터에 "A FILM BY ___" 로 들어가요</span>
      <input class="input" id="director" type="text" maxlength="12" placeholder="예) 홍길동" autocomplete="nickname" value="${esc(S.director)}">
    </label>
    <div class="cta-bar"><button class="btn btn-primary btn-block" id="castNext" disabled>Seed로 이야기 만들기 ${ic('arrow')}</button></div>
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
        <div class="loading-msg">Seed가 SEED NO.를 발급하고<br>당신의 이야기를 쓰는 중…</div>
        <div class="loading-sub">GENRE + 6 KEYWORDS → STORY & PROMPT</div>
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
    <div class="story-meta"><span class="tag" style="color:var(--accent);border-color:rgba(212,255,58,.4)">${esc(st.genre.ko)}</span><span class="tag">A FILM BY ${esc(s.director)}</span></div>
    <p class="story-body">${esc(st.logline)}</p>
    <details class="prompt-box"><summary>시놉시스 읽기</summary><div class="p-body"><p class="story-body" style="margin:0">${esc(st.synopsis)}</p></div></details>
    <details class="prompt-box" id="promptBox"><summary>자동으로 만들어지는 요청 보기</summary>
      <div class="p-body"><pre>${esc(s.posterPrompt)}</pre>
        <div class="p-meta"><span>SEEDREAM · 2:3 · SEED ${s.seed}${st.source === 'seed-llm' ? ' · WRITTEN BY SEED' : ''}</span><button class="copy-btn" data-copy>복사</button></div>
      </div>
    </details>
    <div class="story-meta" style="margin-top:14px">${tags}</div>
    <div class="cta-bar">
      <div class="notice"><span class="ico">✦</span><span>${esc(S.content.copy.posterNotice)}</span></div>
      <button class="btn btn-primary btn-block" id="makePoster">포스터 만들기 ${ic('sparkle')}</button>
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
  'Seedream이 조명을 세팅하는 중…', '주인공이 의상을 갈아입는 중…', '세트장에 안개를 깔고 있어요…',
  'SEED NO.로 장면을 고정하는 중…', '컬러 그레이딩을 입히는 중…', '마지막 컷을 고르는 중…',
];

VIEWS.poster = () => {
  const s = S.session;
  const p = s.poster;
  if (p.status === 'done') return renderPosterDone();
  if (p.status === 'failed') {
    const el = render(`
      <p class="scene">${sceneLabel('poster')}</p>
      <h2 class="h2">포스터 촬영이 <em>중단</em>됐어요</h2>
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
    <h2 class="h2">이 영화의 첫 관객은 <em>당신</em>입니다.</h2>
    <div class="poster-wrap">
      <div class="poster-stage" id="stage"><div class="boot"><div class="spinner"></div></div></div>
      <div class="poster-caption"><span>NO.${pad(s.seed)}</span><span>${esc(s.story.genre.en)} · 2:3</span></div>
    </div>
    <div class="btn-row"><button class="btn" id="save">${ic('download')}포스터 저장</button><button class="btn" id="share">${ic('share')}공유하기</button></div>
    ${screenCard(s.screen, { poster: true })}
    <div class="cta-bar">
      <button class="btn btn-primary btn-block" id="toTrailer">이 포스터가 움직인다면? ${ic('arrow')}</button>
      ${s.poster.remaining > 0 ? `<p style="text-align:center;margin:8px 0 0"><button class="linkish" id="regen">포스터 다시 만들기 (${s.poster.remaining}회 남음)</button></p>` : ''}
    </div>
  `);
  const src = await getComposedPoster(infoFromSession(s), s.poster.url, s.poster.finalUrl);
  if (S.view !== 'poster') return;
  $('#stage', el).innerHTML = `<img class="reveal" src="${esc(src)}" alt="${esc(s.story.title)} 포스터">`;
  if (src.startsWith('data:') && !s.poster.finalUrl) S.finalUpload = api('/api/poster/final', { method: 'POST', body: { dataUrl: src }, retries: 3 }).catch(() => {});
  bindScreenCard(el, {});
  const fname = `seedance-cinema-${pad(s.seed)}.jpg`;
  $('#save', el).onclick = () => { download(src.startsWith('data:') ? src : `${src}?dl=1`, fname); track('poster_saved'); toast('포스터를 저장했어요'); };
  $('#share', el).onclick = () => { shareFile(src, fname, `${s.story.title} — A FILM BY ${s.director}`, absUrl(s.resultUrl)); track('poster_shared'); };
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
    <button class="back" data-back>← 포스터로 돌아가기</button>
    <div class="trailer-head">
      <img src="${esc(S.posterData || s.poster.finalUrl || s.poster.url)}" alt="">
      <div><p class="scene" style="margin:0">${sceneLabel('trailer')}</p><p class="big-q">이 포스터가<br><em style="color:var(--accent);font-style:normal">움직인다면?</em></p></div>
    </div>
    ${failed ? `<div class="error-box"><b>트레일러 생성 실패</b>${esc(s.video.error || '')}</div>` : ''}
    <p class="story-body">${esc(s.story.videoKo)}</p>
    <p class="small" style="margin:-10px 0 18px">${esc(S.content.copy.videoNotice)}</p>
    <details class="prompt-box"><summary>Seedance 트레일러 프롬프트 보기</summary>
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

// ───────────── big screens: visitor submits poster / trailer ─────────────
const SCREEN_ROWS = {
  poster: { tag: 'LOBBY', name: '로비 포스터 월', cta: '포스터 걸기', ok: '로비 스크린에 포스터가 걸렸어요!' },
  trailer: { tag: 'SCREEN 01', name: '예고편 상영관', cta: '상영하기', ok: '예고편 상영관 대기열에 올렸어요!' },
};
const screenState = (st) => (st === 'live' ? '<span class="sc-state live"><i></i>상영 중</span>' : '<span class="sc-state">운영진 확인 중</span>');
function screenCard(state = {}, { poster = false, trailer = false } = {}) {
  const rows = Object.entries({ poster, trailer }).filter(([, on]) => on).map(([kind]) => {
    const st = state?.[kind];
    const r = SCREEN_ROWS[kind];
    const right = st ? screenState(st) : `<button class="btn sc-btn" data-screen="${kind}">${r.cta}</button>`;
    return `<div class="sc-row"><div><small>${r.tag}</small><b>${r.name}</b></div>${right}</div>`;
  }).join('');
  return `<div class="screen-card">
    <div class="sc-head"><span class="sc-ico">${ic('screen')}</span><div><b>현장 대형 스크린에 상영하기</b>
      <span>제출하면 감독 이름·영화 제목·${trailer ? '포스터·트레일러' : '포스터'}가 부스 대형 스크린에 공개돼요.</span></div></div>
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
      toast(st === 'live' ? `${SCREEN_ROWS[kind].ok} 🎬` : '운영진 확인 후 대형 스크린에 상영돼요');
    } catch (e) { b.disabled = false; handleError(e); }
  }));
}

function kakaoCard(enabled, title, sub) {
  return enabled
    ? `<div class="kakao-card"><span class="k-ico">TALK</span><div><b>${title}</b><span>${sub}</span></div></div>`
    : `<div class="kakao-card off"><span class="k-ico">LINK</span><div><b>결과 링크를 저장해 두세요</b><span>${sub}</span></div></div>`;
}

const RENDER_MSGS = ['포스터 속 인물에게 숨을 불어넣는 중', '카메라 레일을 까는 중', '첫 프레임과 마지막 프레임을 잇는 중', '빛과 그림자의 움직임을 계산하는 중', '8초짜리 명장면을 다듬는 중'];

VIEWS.waiting = () => {
  const s = S.session;
  const poster = S.posterData || s.poster.finalUrl || s.poster.url;
  const link = absUrl(s.resultUrl);
  const el = render(`
    <p class="scene">${sceneLabel('waiting')}</p>
    <h2 class="h2">트레일러 <em>편집 중</em></h2>
    <div class="poster-wrap"><div class="poster-stage wait-card">
      <img class="kenburns" src="${esc(poster)}" alt="">
      <div class="wait-overlay">
        <span class="status-dot" id="wStatus">RENDERING</span>
        <div class="bar"><i id="wBar"></i></div>
        <div class="wait-row"><span id="wMsg">${RENDER_MSGS[0]}</span><span id="wTime">0:00</span></div>
      </div>
    </div></div>
    ${kakaoCard(S.boot.kakao.enabled, `완성되면 ${esc(s.phoneMasked)} 번호로 카카오톡을 보내드려요`, '자리를 떠나도 괜찮아요. 부스를 둘러보고 오세요!')}
    <div class="btn-row"><button class="btn" id="copyLink">결과 링크 복사</button><button class="btn" id="again">${S.booth ? '다음 관람객' : '하나 더 만들기'}</button></div>
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
      if (st === 'done') { navigator.vibrate?.([30, 60, 30]); toast('트레일러가 완성됐어요! 🎬'); return go('done', { push: false }); }
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
    <p class="scene">${r.own ? sceneLabel('done') : 'NOW SHOWING'}</p>
    <h2 class="story-title" style="font-size:clamp(34px,10vw,52px)">${esc(r.title)}</h2>
    <p class="story-tagline">“${esc(r.tagline)}”</p>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected="true" data-tab="video">${ic('play')}트레일러</button>
      <button role="tab" aria-selected="false" data-tab="poster">포스터</button>
      <button role="tab" aria-selected="false" data-tab="ticket">${ic('ticket')}티켓</button>
    </div>
    <div class="poster-wrap"><div class="video-stage" id="vstage">
      ${r.videoUrl
        ? `<video src="${esc(r.videoUrl)}" playsinline autoplay muted loop controls preload="auto" poster="${esc(r.posterFinal || r.posterRaw)}"></video>`
        : `<img class="kenburns" src="${esc(r.posterFinal || r.posterRaw)}" alt=""><span class="play-badge">DEMO PREVIEW</span>`}
    </div>
    <div class="poster-caption"><span>NO.${pad(r.info.seed)}</span><span>A FILM BY ${esc(r.info.director)}</span></div></div>
    <div class="actions" id="actions"></div>
    ${screenCard(r.screen, { poster: true, trailer: !!r.videoUrl })}
    ${r.own ? (k.enabled
      ? `<div class="kakao-card${sent ? '' : ' off'}"><span class="k-ico">TALK</span><div><b>${sent ? '카카오톡으로 결과 링크를 보냈어요' : '카카오톡 발송 대기 중'}</b><span>${S.boot.mode === 'mock' || k.provider === 'mock' ? '데모 모드: 실제 발송 대신 운영자 화면에 기록돼요' : `${esc(S.session.phoneMasked)} · 링크는 일정 기간 후 만료돼요`}</span></div></div>`
      : '') : ''}
    <div class="end-card">
      <div class="big">${r.own ? '이 영화의 첫 관객은 당신입니다.' : '나도 나만의 영화를 만들어 볼까요?'}</div>
      <p class="small">${r.own ? '포스터와 트레일러를 간직하고, 다음 장면을 상상해 보세요.' : 'Seedance Seoul Cinema Lab 부스에서 직접 체험해 보세요.'}</p>
      <button class="btn btn-ghost btn-block" id="again" style="margin-top:12px">${r.own ? (S.booth ? '다음 관람객 시작하기' : '처음부터 다시 체험하기') : '나도 만들어보기'}</button>
    </div>
  `);
  const posterSrc = await getComposedPoster(r.info, r.posterRaw, r.posterFinal);
  const fileBase = `seedance-cinema-${pad(r.info.seed)}`;
  const actions = $('#actions', el);
  const tabBtns = $$('[data-tab]', el);
  const showTab = (tab) => {
    tabBtns.forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
    const stage = $('#vstage', el);
    if (tab === 'ticket') {
      stage.innerHTML = '<div class="boot"><div class="spinner"></div></div>';
      actions.innerHTML = `<div class="btn-row"><button class="btn" data-a="tsave">${ic('download')}티켓 저장</button><button class="btn" data-a="tshare">${ic('share')}티켓 공유</button></div>`;
      getTicket(r.info, posterSrc).then((t) => { if (stage.isConnected && $('[data-tab="ticket"]', el).getAttribute('aria-selected') === 'true') stage.innerHTML = `<img class="reveal ticket-img" src="${t}" alt="영화 티켓">`; });
    } else if (tab === 'poster') {
      stage.innerHTML = `<img class="reveal" src="${esc(posterSrc)}" alt="포스터">`;
      actions.innerHTML = `<div class="btn-row"><button class="btn" data-a="psave">${ic('download')}포스터 저장</button><button class="btn" data-a="pshare">${ic('share')}포스터 공유</button></div>`;
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
  const summary = () => `🎬 ${r.title}\n“${r.tagline}”\nA FILM BY ${r.info.director} · SEED NO.${pad(r.info.seed)}\n\n${Object.values(r.info.keywords || {}).map((x) => `#${x.ko.replace(/\s/g, '')}`).join(' ')}\n\n내 영화 보러가기 → ${link}\nSeedance Seoul Cinema Lab`;
  actions.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'psave') { download(posterSrc.startsWith('data:') ? posterSrc : `${posterSrc}?dl=1`, `${fileBase}.jpg`); track('poster_saved'); }
    if (a === 'pshare') { shareFile(posterSrc, `${fileBase}.jpg`, r.title, link); track('poster_shared'); }
    if (a === 'vsave') { download(`${r.videoUrl}?dl=1`, `${fileBase}.mp4`); track('video_downloaded'); toast('영상을 저장하고 있어요'); }
    if (a === 'vshare') { shareFile(r.videoUrl, `${fileBase}.mp4`, r.title, link); track('video_shared'); }
    if (a === 'summary') { await copyText(summary()); toast('결과 요약을 복사했어요. 카톡에 붙여넣어 보세요!'); track('summary_copied'); }
    if (a === 'kshare') { kakaoShare(r, posterSrc, link); track('kakao_share'); }
    if (a === 'tsave') { download(await getTicket(r.info, posterSrc), `${fileBase}-ticket.jpg`); track('ticket_saved'); toast('티켓을 저장했어요'); }
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
    render(`<p class="scene">404</p><h2 class="h2">${esc(e.message)}</h2><p class="lead">내 결과 다시 보기에서 휴대폰 번호와 감독 이름으로 찾아볼 수 있어요.</p><a class="btn btn-primary btn-block" href="/">체험 페이지로 가기</a>`);
    return;
  }
  track('result_viewed', { own: data.own });
  const r = data.result;
  const info = { title: r.title, tagline: r.tagline, director: r.director, seed: r.seed, genre: r.genre, keywords: r.keywords };
  if (r.videoStatus !== 'done') {
    const el = render(`
      <p class="scene">NOW SHOWING · SOON</p>
      <h2 class="story-title" style="font-size:clamp(34px,10vw,52px)">${esc(r.title)}</h2>
      <p class="story-tagline">“${esc(r.tagline)}”</p>
      <div class="poster-wrap"><div class="poster-stage" id="stage"><div class="boot"><div class="spinner"></div></div></div>
      <div class="poster-caption"><span>NO.${pad(r.seed)}</span><span>A FILM BY ${esc(r.director)}</span></div></div>
      ${['queued', 'submitting', 'running'].includes(r.videoStatus)
        ? `<div class="notice"><span class="ico">⏱</span><span>트레일러를 만들고 있어요. 이 페이지를 열어 두면 완성되는 즉시 재생돼요.</span></div>`
        : r.videoStatus === 'failed' ? `<div class="error-box"><b>트레일러 생성 실패</b>${esc(r.videoError || '')}</div>` : ''}
      <div class="btn-row"><button class="btn" id="psave">${ic('download')}포스터 저장</button><button class="btn" id="pshare">${ic('share')}공유하기</button></div>
      <p style="text-align:center;margin-top:18px"><a class="linkish" href="/">나도 만들어보기</a></p>`);
    const src = await getComposedPoster(info, r.posterUrl, r.posterFinalUrl);
    $('#stage', el).innerHTML = `<img class="reveal" src="${esc(src)}" alt="">`;
    $('#psave', el).onclick = () => download(src.startsWith('data:') ? src : `${src}?dl=1`, `seedance-cinema-${pad(r.seed)}.jpg`);
    $('#pshare', el).onclick = () => shareFile(src, `seedance-cinema-${pad(r.seed)}.jpg`, r.title, location.href);
    if (['queued', 'submitting', 'running'].includes(r.videoStatus)) setTimeout(() => showResultPage(tok), 8000);
    return;
  }
  renderResult({ title: r.title, tagline: r.tagline, info, posterRaw: r.posterUrl, posterFinal: r.posterFinalUrl, videoUrl: r.videoUrl, resultUrl: location.pathname, own: false, token: tok, screen: r.screen });
}

// ───────────────────────── poster compositing ─────────────────────────
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

  let g = x.createLinearGradient(0, 0, 0, H * 0.2);
  g.addColorStop(0, 'rgba(0,0,0,.72)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H * 0.2);
  g = x.createLinearGradient(0, H * 0.48, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.42, 'rgba(0,0,0,.7)'); g.addColorStop(1, 'rgba(0,0,0,.95)');
  x.fillStyle = g; x.fillRect(0, H * 0.48, W, H * 0.52);

  const accent = '#d4ff3a';
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  spaced(x, 'SEEDANCE CINEMA LAB PRESENTS', W / 2, 86, '34px "Bebas Neue", "Noto Sans KR", sans-serif', 8, 'rgba(255,255,255,.88)');
  spaced(x, `AN ORIGINAL ${info.genre.en} FILM`, W / 2, 128, '24px "Bebas Neue", "Noto Sans KR", sans-serif', 6, accent);

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
  spaced(x, `A FILM BY ${String(info.director || 'YOU').toUpperCase()}`, W / 2, H - 216, '50px "Bebas Neue", "Noto Sans KR", sans-serif', 10, '#fff');
  const kws = Object.values(info.keywords || {}).map((k) => k.ko);
  x.globalAlpha = 0.6;
  spaced(x, `STORY BY SEED   ·   KEY ART BY SEEDREAM   ·   MOTION BY SEEDANCE   ·   SEED ${info.seed}`, W / 2, H - 162, '24px "Bebas Neue", sans-serif', 3, '#fff');
  x.font = '400 21px "Noto Sans KR", sans-serif';
  const kwLines = wrapLines(x, kws.join('  ·  '), W * 0.86, '  ·  ').slice(0, 2);
  x.fillStyle = '#fff';
  kwLines.forEach((l, i) => x.fillText(l, W / 2, H - 126 + i * 30));
  x.globalAlpha = 1;

  x.fillStyle = 'rgba(255,255,255,.25)';
  x.fillRect(80, H - 72, W - 160, 1);
  x.textAlign = 'left';
  spaced(x, `NO.${pad(info.seed)}`, 80, H - 34, '30px "Bebas Neue", sans-serif', 4, accent);
  x.textAlign = 'right';
  spaced(x, 'SEOUL 2026', W - 84, H - 34, '30px "Bebas Neue", sans-serif', 4, '#fff');
  x.textAlign = 'center';
  spaced(x, 'COMING SOON', W / 2, H - 34, '30px "Bebas Neue", sans-serif', 6, 'rgba(255,255,255,.7)');

  return c.toDataURL('image/jpeg', 0.9);
}

// ───────────────────────── ticket stub ─────────────────────────
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

  // poster window (top part of the key art)
  const px = tx + 28, py = ty + 28, pw = tw - 56, ph = 700;
  x.save();
  rrect(x, px, py, pw, ph, 24); x.clip();
  const sc = pw / img.naturalWidth;
  x.drawImage(img, px, py - img.naturalHeight * sc * 0.1, pw, img.naturalHeight * sc); // skip the poster's top billing line
  const fade = x.createLinearGradient(0, py + ph * 0.55, 0, py + ph);
  fade.addColorStop(0, 'rgba(20,20,22,0)'); fade.addColorStop(1, 'rgba(20,20,22,.95)');
  x.fillStyle = fade; x.fillRect(px, py, pw, ph);
  x.restore();

  // ADMIT ONE badge
  x.font = '30px "Bebas Neue", sans-serif';
  const bw = x.measureText('ADMIT ONE').width + 9 * 3 + 40;
  rrect(x, px + 22, py + 22, bw, 46, 10); x.fillStyle = accent; x.fill();
  x.textAlign = 'left'; x.textBaseline = 'middle';
  spaced(x, 'ADMIT ONE', px + 40, py + 47, '30px "Bebas Neue", sans-serif', 3, '#0b0d02');
  x.textBaseline = 'alphabetic';

  // title + director
  let size = 96;
  const setT = () => (x.font = `${size}px "Black Han Sans", "Noto Sans KR", sans-serif`);
  setT();
  while (x.measureText(info.title).width > pw && size > 52) { size -= 4; setT(); }
  x.fillStyle = '#fff';
  x.fillText(info.title, px, py + ph + 40 + size * 0.85);
  const yDir = py + ph + 40 + size * 0.85 + 62;
  spaced(x, `A FILM BY ${String(info.director || 'YOU').toUpperCase()}`, px, yDir, '40px "Bebas Neue", "Noto Sans KR", sans-serif', 6, accent);

  // info grid
  const d = new Date();
  const cells = [
    ['DATE', today()],
    ['TIME', `${pad(d.getHours(), 2)}:${pad(d.getMinutes(), 2)}`],
    ['GENRE', info.genre?.en || 'FILM'],
    ['SEAT', pad(info.seed)],
  ];
  const gy = yDir + 50, cw = pw / cells.length;
  x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(px, gy, pw, 2);
  cells.forEach(([k, v], i) => {
    const cx = px + cw * i;
    if (i) { x.fillStyle = 'rgba(255,255,255,.12)'; x.fillRect(cx, gy + 18, 2, 88); }
    spaced(x, k, cx + (i ? 18 : 0), gy + 44, '500 17px "IBM Plex Mono", monospace', 3, 'rgba(255,255,255,.5)');
    x.font = '44px "Bebas Neue", sans-serif';
    let vs = 44;
    while (x.measureText(v).width > cw - 24 && vs > 26) { vs -= 2; x.font = `${vs}px "Bebas Neue", sans-serif`; }
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
  spaced(x, 'ADMIT ONE', px + pw, by + 40, '50px "Bebas Neue", sans-serif', 6, accent);
  spaced(x, 'SEEDANCE CINEMA LAB', px + pw, by + 80, '500 19px "IBM Plex Mono", monospace', 3, 'rgba(255,255,255,.75)');
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
      content: { title: `${r.title} — A FILM BY ${r.info.director}`, description: r.tagline, imageUrl: image, link: { mobileWebUrl: link, webUrl: link } },
      buttons: [{ title: '영화 보러가기', link: { mobileWebUrl: link, webUrl: link } }],
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
