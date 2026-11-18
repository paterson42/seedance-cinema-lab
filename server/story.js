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

// Appended to every poster / trailer prompt (Seed-written or template) so results read as a
// still and footage from a real live-action film, not a glossy AI render.
const POSTER_REALISM = 'Photographed as a still from a real live-action feature film: shot on 35mm film with a cinema camera and real lenses, natural skin texture with pores and fine lines, real fabric and material texture, practical motivated lighting, gentle film grain and halation, natural color, believable human proportions and restrained, natural expressions. Not CGI, not a 3D render, not an illustration; no airbrushed or plastic-looking skin, no over-sharpened HDR look.';
const VIDEO_REALISM = 'Live-action film footage: real camera movement with natural motion blur, realistic physics and weight, natural human motion and micro-expressions, faces and hands stay consistent with the poster without morphing, 24fps film look with gentle grain.';
const SECS = () => config.ark.videoDuration;

function posterPrompt({ genre, kw }) {
  return [
    `Photographic one-sheet for a live-action ${genre.en.toLowerCase()} film, tall vertical 9:16 full-bleed composition (portrait phone/kiosk screen), subject centred with headroom.`,
    `Main character: ${kw.who.en}, who ${kw.what.en} ${kw.how.en}, ${kw.why.en}.`,
    `Setting: ${kw.where.en}, ${kw.when.en}.`,
    `Style: ${genre.style}.`,
    'A single strong moment that tells the story, real location with depth, theatrical one-sheet composition.',
    POSTER_REALISM,
    'Keep the lower third darker and uncluttered for title placement. No text, no letters, no words, no logos, no watermark.',
  ].join(' ');
}

// Two-beat camera plan for the trailer, picked per visitor (by seed) from the genre's signature moves.
function cameraPlan(genre, seed) {
  const moves = genre.camera?.length ? genre.camera : [];
  if (!moves.length) return null;
  const r = rng(Math.imul((seed ^ 0x9e3779b9) >>> 0, 2654435761) >>> 0); // mix: nearby seeds pick different moves
  r(); r();
  const a = Math.floor(r() * moves.length);
  let b = Math.floor(r() * moves.length);
  if (moves.length > 1 && b === a) b = (a + 1) % moves.length;
  return { open: moves[a], close: moves.length > 1 ? moves[b] : null };
}
const cameraText = (genre, plan) => (plan
  ? `Camera plan for this ${SECS()}-second ${genre.en.toLowerCase()} trailer shot: open with ${plan.open}${plan.close ? `, then move into ${plan.close}` : ''}, ending on a striking final frame. Dynamic, deliberate trailer-style camera work with smooth, motivated movement.`
  : '');

function videoPrompt({ genre, kw, plan }) {
  return [
    `The movie poster comes alive as a ${SECS()}-second teaser trailer shot.`,
    `${kw.who.en} ${kw.what.en} ${kw.how.en}, ${kw.where.en}, ${kw.when.en}.`,
    cameraText(genre, plan),
    `Action and atmosphere: ${genre.motion}.`,
    'Keep the same characters, wardrobe, palette and composition as the poster.',
    VIDEO_REALISM,
    'No text or titles on screen.',
  ].join(' ');
}

function videoPromptKo({ genre, kw }) {
  return `포스터 속 ${kw.who.ko}${hasBatchim(kw.who.ko) ? '이' : '가'} 움직이기 시작합니다. ${kw.where.ko} ${kw.how.ko} — ${genre.ko} 특유의 카메라 워크로 ${SECS()}초 티저 장면을 만듭니다.`;
}

const LLM_SYSTEM = () => `You are a playful Korean film marketer writing for an AI movie poster booth.
Return ONLY a JSON object with keys:
"title" (Korean movie title, 2-10 characters, catchy, no quotes),
"tagline" (Korean, one sentence, max 30 characters),
"logline" (Korean, 1-2 sentences, must naturally include all six keywords),
"synopsis" (Korean, 3-4 sentences),
"poster_prompt" (English image prompt for a tall vertical 9:16 full-bleed movie poster (portrait kiosk screen), subject centred with headroom. Write it like a cinematographer's shot description of a still from a real live-action film: the actors (age, look, wardrobe, a natural believable expression), the real location and time of day, the lighting setup and light sources, lens and framing, color grade. Prefer grounded, real-world details over spectacle. Do NOT use words like masterpiece, ultra-detailed, 8K, hyper-realistic, digital art, CGI, perfect skin, flawless, epic. MUST end with: "Keep the lower third darker for title placement. No text, no letters, no logos."),
"video_prompt" (English prompt, 2-3 sentences, describing how this exact poster image comes alive as a ${config.ark.videoDuration}-second live-action trailer shot. Build it around the given camera plan (opening move, then closing move) and describe what the actors physically do during each beat, plus small details like breath, wind or light changes. Keep motion believable and grounded. No on-screen text).
Content must be family-friendly.`;

export async function buildStory({ genreId, keywordIdx, director, seed }) {
  const sel = resolveSelection(genreId, keywordIdx);
  if (sel.error) return sel;
  const { genre, kw } = sel;
  const base = templateStory({ genre, kw, director, seed });
  let story = { ...base, source: 'template' };
  let pPrompt = posterPrompt({ genre, kw });
  const plan = cameraPlan(genre, seed);
  let vPrompt = videoPrompt({ genre, kw, plan });

  if (!config.mock && config.ark.llmEnabled) {
    try {
      const user = `Genre: ${genre.ko} (${genre.en}). Visual style hint: ${genre.style}.
Keywords — 누가: ${kw.who.ko} / 언제: ${kw.when.ko} / 어디서: ${kw.where.ko} / 무엇을: ${kw.what.ko} / 어떻게: ${kw.how.ko} / 왜: ${kw.why.ko}.
Director: ${director}. Random seed: ${seed}.${plan ? `
Camera plan for the trailer: open with ${plan.open}${plan.close ? `, then ${plan.close}` : ''}.` : ''}`;
      const out = await chatJSON(LLM_SYSTEM(), user);
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
        pPrompt = `${out.poster_prompt.trim()} Style: ${genre.style}. ${POSTER_REALISM}`;
        vPrompt = [out.video_prompt.trim(), cameraText(genre, plan), `Action and atmosphere: ${genre.motion}.`, VIDEO_REALISM].filter(Boolean).join(' ');
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
