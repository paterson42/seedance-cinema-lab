// Builds the ad campaign (product name, headline, concept, product-page copy) and the model prompts.
// Uses the Seed LLM when available; always falls back to deterministic templates.
import { config } from './config.js';
import { getContent } from './content.js';
import { chatJSON } from './providers/ark.js';

const hasBatchim = (word) => {
  const ch = String(word).trim().slice(-1);
  const code = ch.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return /[013678lmn]$/i.test(ch); // digits/latin rough rule
  return code % 28 !== 0;
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

// Price tag for the ad. The list price comes from the product's "price" in content.json (a
// believable shelf price for that kind of product); the seed only picks the discount.
// Products without a price fall back to the old seed-only number.
export function offerFor(seed, listPrice) {
  const s = Number(seed) || 1;
  const off = [15, 20, 25, 30, 35, 40, 50][s % 7];
  const was = Number(listPrice);
  if (!(was >= 100)) {
    const price = (9 + (s % 90)) * 1000 + 900;
    return { off, price, was: Math.round(price / (1 - off / 100) / 1000) * 1000 };
  }
  const p = was * (1 - off / 100);
  // Shop-style endings: 27,900원 for five digits and up, 1,290원 below that.
  const price = p >= 10000 ? Math.max(1000, Math.round(p / 1000) * 1000 - 100) : Math.max(90, Math.round(p / 100) * 100 - 10);
  return { off, price, was };
}

export function resolveSelection(genreId, keywordIdx) {
  const c = getContent();
  const genre = c.genres.find((g) => g.id === genreId);
  if (!genre) return { error: '광고 무드를 다시 선택해 주세요.' };
  const kw = {};
  for (const cat of c.categories) {
    const i = Number(keywordIdx?.[cat.id]);
    const k = cat.keywords[i];
    if (!Number.isInteger(i) || !k) return { error: '키워드 카드를 모두 뽑아 주세요.' };
    kw[cat.id] = { idx: i, ...k };
  }
  return { genre, kw };
}

const obj = (w) => `${w}${hasBatchim(w) ? '을' : '를'}`;
const subj = (w) => `${w}${hasBatchim(w) ? '이' : '가'}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Story fields keep their original names so the rest of the flow is unchanged:
//   title = product name, tagline = headline copy, logline = campaign concept,
//   synopsis = product-page copy, director = the visitor's own name (credited as the ad's creator).
function templateStory({ genre, kw, director, seed }) {
  const r = rng(seed);
  const title = pick(r, genre.titles).replace('{n}', kw.what.n);
  const tagline = pick(r, genre.taglines);
  const logline = `${tag('when', kw.when.ko)}, ${tag('where', kw.where.ko)} ${tag('who', kw.who.ko)}에게 ${tag('what', obj(kw.what.ko))} ${tag('how', kw.how.ko)} 선보인다. 구매 포인트는 단 하나 — ${tag('why', kw.why.ko)}.`;
  const synopsis = `${director} 님이 기획한 신상 〈${title}〉. ${logline} ${genre.tail}`;
  return { title, tagline, logline, synopsis, director };
}

// Appended to every key-visual / ad-video prompt (Seed-written or template) so results read as a
// real commercial shoot, not a glossy AI render.
const POSTER_REALISM = 'Photographed like a real commercial advertising shoot: professional camera and real lenses, true-to-life product materials and surface texture, natural skin texture on any person, practical motivated lighting, natural color, believable proportions and restrained, natural expressions. Not CGI, not a 3D render, not an illustration.';
const VIDEO_REALISM = 'Live-action commercial footage: real camera movement with natural motion blur, realistic physics and weight, the product, faces and hands stay consistent with the key visual without morphing.';
const VIDEO_GUARD = 'Keep the same product, palette and composition as the key visual. No on-screen text, captions, subtitles, titles, logos or watermarks in any language.';
const SECS = () => config.ark.videoDuration;

// ───────────── keyword marks ─────────────
// Every generated text carries inline tags around the words that reflect one of the six picked
// keywords: <who>…</who> <when> <where> <what> <how> <why>. The tagged text is what the visitor
// sees (the app highlights each span in that keyword's colour); the tags are stripped before a
// prompt goes to Seedream / Seedance.
const SLOTS = ['who', 'when', 'where', 'what', 'how', 'why'];
const TAG = /<(\/?)(who|when|where|what|how|why)>/g;
export const stripMarks = (t) => String(t || '').replace(TAG, '');
const tag = (slot, text) => `<${slot}>${text}</${slot}>`;
const marked = (t) => new Set([...String(t || '').matchAll(/<(who|when|where|what|how|why)>\s*\S/g)].map((m) => m[1]));

// Keeps only well-formed, non-nested spans so the page can never show a stray tag.
export function tidyMarks(text) {
  const src = String(text || '');
  let out = '';
  let last = 0;
  let open = null; // { slot, at } where "at" is the position of its opening tag in out
  const dropOpen = () => { out = out.slice(0, open.at) + out.slice(open.at + open.slot.length + 2); open = null; };
  for (const m of src.matchAll(TAG)) {
    out += src.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[1] !== '/') {
      if (open) dropOpen(); // a tag opened inside another: the outer one was never closed properly
      open = { slot: m[2], at: out.length };
      out += `<${m[2]}>`;
    } else if (open && open.slot === m[2]) {
      // a span that runs on for a whole paragraph is a tagging mistake, not a keyword
      if (out.length - open.at > 220) dropOpen(); else { out += `</${m[2]}>`; open = null; }
    }
  }
  out += src.slice(last);
  if (open) dropOpen();
  return out.replace(/<(who|when|where|what|how|why)>\s*<\/\1>/g, '');
}

// Sentences that put a missing keyword back into a prompt, so all six are always there.
export const POSTER_FIX = {
  what: (kw) => `Hero product: ${tag('what', kw.what.en)}, sharply detailed and clearly the focus of the frame.`,
  who: (kw) => `${tag('who', cap(kw.who.en))} is clearly visible in the foreground beside the product and instantly recognisable as exactly that kind of person from wardrobe, props and action.`,
  where: (kw) => `Location: ${tag('where', kw.where.en)}, recognisable in the frame.`,
  when: (kw) => `Time: ${tag('when', kw.when.en)}, shown through light, weather and details.`,
  how: (kw) => `Creative concept: ${tag('how', kw.how.en)}.`,
  why: (kw) => `One visual cue in the scene suggests ${tag('why', kw.why.en)}.`,
};
const VIDEO_FIX = {
  what: (kw) => `${tag('what', cap(kw.what.en))} stays the hero of the shot.`,
  who: (kw) => `${tag('who', cap(kw.who.en))} stays in frame and reacts to the product.`,
  where: (kw) => `The scene stays ${tag('where', kw.where.en)}.`,
  when: (kw) => `It is ${tag('when', kw.when.en)}.`,
  how: (kw) => `The action plays out ${tag('how', kw.how.en)}.`,
  why: (kw) => `A closing beat hints at ${tag('why', kw.why.en)}.`,
};
const KO_FIX = {
  who: (kw) => `${tag('who', kw.who.ko)}에게 꼭 맞는 선택입니다.`,
  when: (kw) => `${tag('when', kw.when.ko)}에 만나 보세요.`,
  where: (kw) => `${tag('where', kw.where.ko)} 만나 보세요.`,
  what: (kw) => `${tag('what', kw.what.ko)}, 지금 만나 보세요.`,
  how: (kw) => `${tag('how', kw.how.ko)} 담아냈습니다.`,
  why: (kw) => `${tag('why', kw.why.ko)}.`,
};
export function withAll(text, kw, fixes, before = '') {
  const t = tidyMarks(text).trim();
  const have = marked(t);
  const add = SLOTS.filter((sl) => !have.has(sl)).map((sl) => fixes[sl](kw));
  if (!add.length) return t;
  // Missing keywords go in before the fixed closing instruction when there is one.
  const cut = before ? t.indexOf(before) : -1;
  return cut > 0 ? `${t.slice(0, cut).trim()} ${add.join(' ')} ${t.slice(cut)}` : `${t} ${add.join(' ')}`;
}

function posterPrompt({ genre, kw }) {
  return [
    'Commercial advertising key visual for an e-commerce campaign, tall vertical 9:16 full-bleed composition (portrait phone/kiosk screen), product centred with headroom.',
    `Hero product: ${tag('what', kw.what.en)}, sharply detailed and clearly the focus of the frame, with clean unbranded packaging.`,
    `${tag('who', cap(kw.who.en))} is clearly visible in the foreground beside the product, instantly recognisable as exactly that kind of person from wardrobe, props and action.`,
    `Setting: ${tag('where', kw.where.en)}, ${tag('when', kw.when.en)}.`,
    `Creative concept: ${tag('how', kw.how.en)}. One visual cue in the scene suggests ${tag('why', kw.why.en)}.`,
    `Style: ${genre.style}.`,
    'Premium product photography, desirable and tactile, strong focal point, rich depth, art-directed lighting.',
    POSTER_REALISM,
    'Keep the top edge and the lower third darker and uncluttered for headline and call-to-action placement. No text, no letters, no words, no logos, no brand names, no price tags, no watermark.',
  ].join(' ');
}

function videoPrompt({ genre, kw }) {
  return [
    `The ad key visual comes alive as a ${SECS()}-second vertical short-form commercial shot.`,
    `${tag('what', cap(kw.what.en))} stays the hero of the shot, ${tag('how', kw.how.en)}, with ${tag('who', kw.who.en)} reacting to it, ${tag('where', kw.where.en)}, ${tag('when', kw.when.en)}.`,
    `A closing beat hints at ${tag('why', kw.why.en)}.`,
    `Camera and motion: ${genre.motion}.`,
    VIDEO_REALISM,
    VIDEO_GUARD,
  ].join(' ');
}

function videoPromptKo({ genre, kw }) {
  return `키비주얼 속 ${tag('what', subj(kw.what.ko))} 움직이기 시작합니다. ${tag('where', kw.where.ko)} ${tag('who', obj(kw.who.ko))} 주인공으로, ${tag('how', kw.how.ko)} — ${genre.ko} 무드의 카메라 워크로 ${SECS()}초 숏폼 광고를 만듭니다.`;
}

const LLM_SYSTEM = () => `You are a sharp, playful Korean advertising copywriter working at an AI e-commerce ad booth.
The visitor picked SIX keywords for one fictional product launch: who (target customer), when, where, what (the product), how (creative treatment), why (the reason to buy).
All six are the visitor's own choices and every one of them must be clearly and specifically reflected in EVERY text you write. Never drop one, never water one down into something vaguer (a "developer working late" must stay recognisably a developer working late, not "a tired person" or a "tech" look), and never let the ad mood replace a keyword: the mood only sets styling such as lighting, palette and camera.

KEYWORD TAGS (required): wherever a text reflects a keyword, wrap exactly those words in that keyword's tag: <who>…</who>, <when>…</when>, <where>…</where>, <what>…</what>, <how>…</how>, <why>…</why>. Each of "logline", "synopsis", "poster_prompt" and "video_prompt" must contain all six tags at least once. Tag only the words that carry the keyword, do not nest tags, and use no other markup.

Return ONLY a JSON object with keys:
"title" (Korean product name, 2-10 characters, catchy and brandable, no quotes, no tags, must not be a real existing brand or product name),
"tagline" (Korean ad headline, one sentence, max 30 characters, no tags),
"logline" (Korean, 1-2 sentences describing the campaign concept; use each of the six Korean keywords word for word, tagged),
"synopsis" (Korean product-page copy, 3-4 sentences, persuasive but with no medical, health or guaranteed-result claims; names the target customer explicitly and reflects all six keywords, tagged),
"poster_prompt" (English image prompt for a tall vertical 9:16 full-bleed advertising key visual (portrait kiosk screen), product centred with headroom. Write it like a commercial photographer's shot description of a real advertising shoot. It must show: the <what> product as the clear hero with clean unbranded packaging; the <who> person clearly visible in the foreground or midground next to or using the product, never a blurred background figure, and identifiable as exactly that kind of person through age, wardrobe, props and action; the real <where> location recognisable in frame; the <when> moment through light, weather and details; the <how> treatment as the central visual idea; and one concrete visual cue for <why> (never as written text). Also give the lighting setup, lens and framing, and color grading. MUST end with: "Keep the top edge and the lower third darker for headline and call-to-action placement. No text, no letters, no logos, no brand names, no price tags."),
"video_prompt" (English prompt, 2-4 sentences, describing how this exact key visual comes alive as a ${config.ark.videoDuration}-second vertical short-form commercial shot: one clear camera move, what the <what> product and the <who> person physically do, the <how> treatment in motion, the <where> and <when> staying visible, and a closing beat that hints at <why>, plus small natural details like light changes, steam or droplets. Keep motion believable and grounded. No on-screen text).
KOREAN WORDING: write the way Korean shoppers and Korean shopping apps actually talk. Use the everyday Korean name for things, not a literal transliteration of the English: 후드집업 or 후드티 (not 후디), 러닝화 (not 러닝 스니커즈), 향수 (not 퍼퓸), 돗자리 (not 피크닉 매트), 접사 (not 매크로 샷), 원테이크 (not 롱숏). When you repeat a picked keyword, keep its Korean wording exactly as given. No translated-sounding sentences.
Content must be family-friendly. Never mention real brands, celebrities or trademarks.`;

export async function buildStory({ genreId, keywordIdx, director, seed }) {
  const sel = resolveSelection(genreId, keywordIdx);
  if (sel.error) return sel;
  const { genre, kw } = sel;
  const base = templateStory({ genre, kw, director, seed });
  let story = { ...base, source: 'template' };
  let pPrompt = posterPrompt({ genre, kw });
  let vPrompt = videoPrompt({ genre, kw });

  if (!config.mock && config.ark.llmEnabled) {
    try {
      const line = (slot, label) => `<${slot}> ${label}: ${kw[slot].ko} (${kw[slot].en})`;
      const user = `Ad mood (styling only): ${genre.ko} (${genre.en}). Visual style hint: ${genre.style}.
The six keywords, each with its meaning in English:
${line('who', 'target customer')}
${line('when', 'moment')}
${line('where', 'place')}
${line('what', 'product')}
${line('how', 'creative treatment')}
${line('why', 'reason to buy')}
Random seed: ${seed}.`;
      const out = await chatJSON(LLM_SYSTEM(), user);
      const ok = (s, max) => typeof s === 'string' && s.trim() && stripMarks(s).length <= max;
      if (ok(out.title, 24) && ok(out.tagline, 80) && ok(out.logline, 300) && ok(out.poster_prompt, 2400) && ok(out.video_prompt, 1500)) {
        // The concept line must carry all six keywords; if the model skipped one, the template line (which always has them) is used.
        const logline = tidyMarks(out.logline.trim());
        story = {
          title: stripMarks(out.title).trim().replace(/^["'《<]+|["'》>]+$/g, ''),
          tagline: stripMarks(out.tagline).trim(),
          logline: marked(logline).size === SLOTS.length ? logline : base.logline,
          synopsis: ok(out.synopsis, 900) ? withAll(out.synopsis, kw, KO_FIX) : base.synopsis,
          director,
          source: 'seed-llm',
        };
        pPrompt = `${withAll(out.poster_prompt, kw, POSTER_FIX, 'Keep the top edge')} Style: ${genre.style}. ${POSTER_REALISM}`;
        // The model-written prompt often omits the no-caption guard; without it Seedance can burn captions into the video.
        vPrompt = `${withAll(out.video_prompt, kw, VIDEO_FIX)} Camera and motion: ${genre.motion}. ${VIDEO_REALISM} ${VIDEO_GUARD}`;
      }
    } catch (e) {
      console.warn('[seed-llm] fallback to template:', e.message);
    }
  }

  return {
    // story.* and story.prompts keep the keyword tags for display; the prompts sent to the models are plain.
    story: {
      ...story, genre: { id: genre.id, ko: genre.ko, en: genre.en }, videoKo: videoPromptKo({ genre, kw }), offer: offerFor(seed, kw.what?.price),
      prompts: { poster: pPrompt, video: vPrompt },
    },
    keywords: Object.fromEntries(Object.entries(kw).map(([k, v]) => [k, { idx: v.idx, ko: v.ko }])),
    posterPrompt: stripMarks(pPrompt),
    videoPrompt: stripMarks(vPrompt),
  };
}
