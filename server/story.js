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
//   synopsis = product-page copy, director = the visitor's brand name.
function templateStory({ genre, kw, director, seed }) {
  const r = rng(seed);
  const title = pick(r, genre.titles).replace('{n}', kw.what.n);
  const tagline = pick(r, genre.taglines);
  const logline = `${kw.when.ko}, ${kw.where.ko} ${kw.who.ko}에게 ${obj(kw.what.ko)} ${kw.how.ko} 선보인다. 구매 포인트는 단 하나 — ${kw.why.ko}.`;
  const synopsis = `${director}의 신상 〈${title}〉. ${logline} ${genre.tail}`;
  return { title, tagline, logline, synopsis, director };
}

function posterPrompt({ genre, kw }) {
  return [
    'Commercial advertising key visual for an e-commerce campaign, vertical 2:3 composition.',
    `Hero product: ${kw.what.en}, sharply detailed and clearly the focus of the frame, with clean unbranded packaging.`,
    `Featuring ${kw.who.en}.`,
    `Setting: ${kw.where.en}, ${kw.when.en}.`,
    `Creative concept: ${kw.how.en}. The image should convey ${kw.why.en}.`,
    `Style: ${genre.style}.`,
    'Premium product photography, desirable and tactile, strong focal point, rich depth, art-directed lighting, masterpiece quality.',
    'Keep the top edge and the lower third darker and uncluttered for headline and call-to-action placement. No text, no letters, no words, no logos, no brand names, no price tags, no watermark.',
  ].join(' ');
}

function videoPrompt({ genre, kw }) {
  return [
    'The ad key visual comes alive as an 8-second vertical short-form commercial shot.',
    `${cap(kw.what.en)} stays the hero of the shot, ${kw.how.en}, with ${kw.who.en}, ${kw.where.en}, ${kw.when.en}.`,
    `Camera and motion: ${genre.motion}.`,
    `Smooth, coherent, polished commercial motion. ${VIDEO_GUARD}`,
  ].join(' ');
}

function videoPromptKo({ genre, kw }) {
  return `키비주얼 속 ${subj(kw.what.ko)} 움직이기 시작합니다. ${kw.where.ko} ${kw.how.ko} — ${genre.ko} 무드의 카메라 워크로 8초 내외의 숏폼 광고를 만듭니다.`;
}

const VIDEO_GUARD = 'Keep the same product, palette and composition as the key visual. No on-screen text, captions, subtitles, titles, logos or watermarks in any language.';

const LLM_SYSTEM = `You are a sharp, playful Korean advertising copywriter working at an AI e-commerce ad booth.
The visitor's brand is launching one fictional product. Return ONLY a JSON object with keys:
"title" (Korean product name, 2-12 characters, catchy and brandable, no quotes, must not be a real existing brand or product name),
"tagline" (Korean ad headline, one sentence, max 30 characters),
"logline" (Korean, 1-2 sentences describing the campaign concept, must naturally include all six keywords),
"synopsis" (Korean product-page copy, 3-4 sentences, persuasive but with no medical, health or guaranteed-result claims),
"poster_prompt" (English image prompt for a vertical 2:3 advertising key visual. The product is the clear hero with clean unbranded packaging. Describe product, model, setting, lighting, color grading, composition. MUST end with: "Keep the top edge and the lower third darker for headline and call-to-action placement. No text, no letters, no logos, no brand names, no price tags."),
"video_prompt" (English prompt, 1-3 sentences, describing how this exact key visual comes alive as an 8-second vertical short-form commercial: camera movement, product and model motion, atmosphere. No on-screen text).
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
      const user = `Ad mood: ${genre.ko} (${genre.en}). Visual style hint: ${genre.style}.
Keywords — 타깃 고객: ${kw.who.ko} / 시점: ${kw.when.ko} / 장소: ${kw.where.ko} / 상품: ${kw.what.ko} / 연출: ${kw.how.ko} / 구매 포인트: ${kw.why.ko}.
Brand name: ${director}. Random seed: ${seed}.`;
      const out = await chatJSON(LLM_SYSTEM, user);
      const ok = (s, max) => typeof s === 'string' && s.trim() && s.length <= max;
      if (ok(out.title, 24) && ok(out.tagline, 80) && ok(out.logline, 300) && ok(out.poster_prompt, 2000) && ok(out.video_prompt, 1200)) {
        story = {
          title: out.title.trim().replace(/^["'《<]+|["'》>]+$/g, ''),
          tagline: out.tagline.trim(),
          logline: out.logline.trim(),
          synopsis: ok(out.synopsis, 900) ? out.synopsis.trim() : base.synopsis,
          director,
          source: 'seed-llm',
        };
        pPrompt = `${out.poster_prompt.trim()} Style: ${genre.style}.`;
        // The model-written prompt often omits these guards; without them Seedance can burn captions into the video.
        vPrompt = `${out.video_prompt.trim()} ${VIDEO_GUARD}`;
      }
    } catch (e) {
      console.warn('[seed-llm] fallback to template:', e.message);
    }
  }

  return {
    story: { ...story, genre: { id: genre.id, ko: genre.ko, en: genre.en }, videoKo: videoPromptKo({ genre, kw }) },
    keywords: Object.fromEntries(Object.entries(kw).map(([k, v]) => [k, { idx: v.idx, ko: v.ko }])),
    posterPrompt: pPrompt,
    videoPrompt: vPrompt,
  };
}
