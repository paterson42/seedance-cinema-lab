// Builds the movie (title, tagline, logline, synopsis) and the model prompts.
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
const topic = (w) => `${w}${hasBatchim(w) ? '은' : '는'}`;

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
  if (!genre) return { error: '장르를 다시 선택해 주세요.' };
  const kw = {};
  for (const cat of c.categories) {
    const i = Number(keywordIdx?.[cat.id]);
    const k = cat.keywords[i];
    if (!Number.isInteger(i) || !k) return { error: '키워드 카드를 모두 뽑아 주세요.' };
    kw[cat.id] = { idx: i, ...k };
  }
  return { genre, kw };
}

function templateStory({ genre, kw, director, seed }) {
  const r = rng(seed);
  const title = pick(r, genre.titles).replace('{n}', kw.what.n);
  const tagline = pick(r, genre.taglines);
  const logline = `${kw.when.ko}, ${kw.where.ko}. ${topic(kw.who.ko)} ${kw.why.ko} ${kw.how.ko} ${kw.what.ko}.`;
  const synopsis = `${logline} 그러나 목표에 다가갈수록, 지키고 싶던 것과 되찾고 싶던 것이 서로 다른 편에 놓여 있음을 깨닫는다. ${genre.tail}`;
  return { title, tagline, logline, synopsis, director };
}

function posterPrompt({ genre, kw }) {
  return [
    `Cinematic ${genre.en.toLowerCase()} movie poster key art, vertical 2:3 composition.`,
    `Main character: ${kw.who.en}, who ${kw.what.en} ${kw.how.en}, ${kw.why.en}.`,
    `Setting: ${kw.where.en}, ${kw.when.en}.`,
    `Style: ${genre.style}.`,
    'Iconic single-image storytelling, striking silhouette, rich depth, theatrical one-sheet lighting, 35mm film grain, masterpiece quality.',
    'Keep the lower third darker and uncluttered for title placement. No text, no letters, no words, no logos, no watermark.',
  ].join(' ');
}

function videoPrompt({ genre, kw }) {
  return [
    'The movie poster comes alive as an 8-second cinematic teaser trailer shot.',
    `${kw.who.en} ${kw.what.en} ${kw.how.en}, ${kw.where.en}, ${kw.when.en}.`,
    `Camera and motion: ${genre.motion}.`,
    'Keep the same character, wardrobe, palette and composition as the poster. Smooth, coherent, film-like motion with atmospheric depth. No text or titles on screen.',
  ].join(' ');
}

function videoPromptKo({ genre, kw }) {
  return `포스터 속 ${kw.who.ko}${hasBatchim(kw.who.ko) ? '이' : '가'} 움직이기 시작합니다. ${kw.where.ko} ${kw.how.ko} — ${genre.ko} 특유의 카메라 워크로 8초 내외의 티저 장면을 만듭니다.`;
}

const LLM_SYSTEM = `You are a playful Korean film marketer writing for an AI movie poster booth.
Return ONLY a JSON object with keys:
"title" (Korean movie title, 2-10 characters, catchy, no quotes),
"tagline" (Korean, one sentence, max 30 characters),
"logline" (Korean, 1-2 sentences, must naturally include all six keywords),
"synopsis" (Korean, 3-4 sentences),
"poster_prompt" (English image prompt for a vertical 2:3 movie poster. Describe subject, setting, lighting, color grading, composition. MUST end with: "Keep the lower third darker for title placement. No text, no letters, no logos."),
"video_prompt" (English prompt, 1-3 sentences, describing how this exact poster image comes alive as an 8-second trailer shot: camera movement, subject motion, atmosphere. No on-screen text).
Content must be family-friendly.`;

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
      const user = `Genre: ${genre.ko} (${genre.en}). Visual style hint: ${genre.style}.
Keywords — 누가: ${kw.who.ko} / 언제: ${kw.when.ko} / 어디서: ${kw.where.ko} / 무엇을: ${kw.what.ko} / 어떻게: ${kw.how.ko} / 왜: ${kw.why.ko}.
Director: ${director}. Random seed: ${seed}.`;
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
        vPrompt = out.video_prompt.trim();
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
