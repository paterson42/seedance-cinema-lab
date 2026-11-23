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

// ───────── Casting ─────────
// Left to themselves, the LLM and the image model cast the same person every time: late twenties,
// messy dark hair, tired gentle eyes, an even "average" face. So each visitor's lead gets a look
// drawn from these lists (by seed): gender, age, face, a distinguishing detail, hair, build.
// What the role already fixes is respected (a grandmother stays one, a retiree is not 22), and a
// cat, robot or alien gets no human casting at all.
const CAST = {
  face: ['a round, full-cheeked face', 'a long, narrow face', 'a square face with a strong jaw', 'a heart-shaped face with a pointed chin',
    'an angular face with high cheekbones', 'a soft oval face with a wide forehead', 'a broad face with a short chin', 'a lean face with hollow cheeks'],
  eyes: ['monolid eyes', 'heavy-lidded, hooded eyes', 'large, wide-set eyes', 'narrow eyes that crinkle at the corners',
    'deep-set eyes under thick straight brows', 'downturned eyes under thin arched brows', 'upturned eyes under sparse brows', 'small, close-set eyes'],
  nose: ['a broad, flat nose', 'a long, straight nose', 'a small button nose', 'a prominent high-bridged nose', 'a slightly crooked nose', 'a short upturned nose'],
  mouth: ['a wide mouth', 'thin lips', 'full lips', 'a small mouth with a slight overbite', 'a crooked half-smile', 'a mouth that turns down at the corners'],
  mark: ['a mole under one eye', 'a mole beside the mouth', 'freckles across the nose and cheeks', 'a small scar through one eyebrow', 'dimples',
    'faint acne scars on the cheeks', 'round wire-rimmed glasses', 'thick black-framed glasses', 'ears that stick out a little', 'a birthmark on the neck',
    'a slightly chipped front tooth', 'a faint scar on the chin'],
  markOlder: ['deep laugh lines', 'age spots on the temples', 'a deeply creased forehead', 'crow\'s feet and heavy eye bags', 'half-moon reading glasses'],
  skin: ['fair skin', 'light olive skin', 'warm tan skin', 'tanned skin'],
  build: ['slight and narrow-shouldered', 'stocky and broad-shouldered', 'tall and lanky', 'short and sturdy', 'heavyset', 'wiry and lean', 'small-framed', 'big-framed and soft around the middle'],
  hairWoman: ['a blunt chin-length bob', 'long straight hair in a low ponytail', 'a short pixie cut', 'shoulder-length wavy hair', 'tightly permed short curls',
    'a high bun with loose strands', 'long hair in a single braid', 'a shaggy layered cut with a fringe', 'a neat low bun', 'a cropped boyish cut'],
  hairMan: ['a close buzz cut', 'a neat side-parted short cut', 'a bowl cut with a heavy fringe', 'shoulder-length hair tied back', 'tightly curled permed hair',
    'slicked-back hair', 'short hair with a receding hairline', 'a shaved head', 'a grown-out undercut', 'thick wavy hair past the ears'],
  beard: ['clean-shaven', 'clean-shaven', 'light stubble', 'a thin moustache', 'a short trimmed beard'],
  beardYoung: ['clean-shaven', 'clean-shaven', 'clean-shaven', 'light stubble'],
  dye: ['bleached blond', 'ash brown', 'faded copper'],
};
// The stories are set in Seoul and the LLM used to write "Korean" by itself; once it is handed a
// casting it stops doing so and the cast drifts, so the casting says it. Empty = leave it open.
const CAST_ORIGIN = 'Korean';
const NOT_HUMAN = /\b(cat|dog|robot|alien|android|ghost|dragon|monster|puppet)\b/i;
const IS_WOMAN = /\b(grandmother|mother|woman|girl|queen|actress|aunt|sister|daughter|witch|she|her)\b/i;
const IS_MAN = /\b(grandfather|father|man|boy|king|uncle|brother|son|he|his)\b/i;
const AGE_GIVEN = /\b\d{1,3}(st|nd|rd|th)?\b|\b(child|kid|teen|baby|grandmother|grandfather|elderly)\b/i;
const AGES = [ // first match wins
  [/\b(trainee|rookie|apprentice|student|intern|newcomer)\b/i, 19, 29],
  [/\b(retire\w*|last remaining)\b/i, 58, 78],
  [/\b(former|owner|keeper|veteran|master)\b/i, 38, 70],
  [/./, 21, 72],
];
const CAST_NOTE = 'Cast like a distinctive character actor, not a model or an idol: an ordinary, memorable, slightly asymmetric face, not a generically handsome or pretty one.';

/** The lead's look for this visitor, or null when the role is not a person. */
export function casting(role, seed) {
  if (!role || NOT_HUMAN.test(role)) return null;
  const r = rng(Math.imul((seed ^ 0x51ed270b) >>> 0, 2246822519) >>> 0); // mixed: nearby seeds cast differently
  r(); r();
  const woman = IS_WOMAN.test(role) ? true : IS_MAN.test(role) ? false : r() < 0.5;
  const [, lo, hi] = AGES.find(([re]) => re.test(role));
  const age = lo + Math.floor(r() * (hi - lo + 1));
  const person = `${CAST_ORIGIN ? `${CAST_ORIGIN} ` : ''}${woman ? 'woman' : 'man'}`;
  const who = AGE_GIVEN.test(role) ? `a ${person}` : `a ${age}-year-old ${person}`;
  const old = AGE_GIVEN.test(role) ? /100|grand|elderly/i.test(role) : age >= 55;
  const young = !old && age < 35;
  let hair = pick(r, woman ? CAST.hairWoman : CAST.hairMan);
  const colour = old ? pick(r, ['grey', 'white', 'salt-and-pepper'])
    : age >= 45 ? pick(r, ['black, greying at the temples', 'black', 'dark brown'])
      : young && r() < 0.2 ? pick(r, CAST.dye) : pick(r, ['black', 'black', 'dark brown']);
  if (!/shaved head/.test(hair)) hair = `${hair}, ${colour}`;
  const mark = pick(r, old ? [...CAST.markOlder, ...CAST.mark] : CAST.mark);
  const parts = [
    `${pick(r, CAST.face)}, ${pick(r, CAST.eyes)}, ${pick(r, CAST.nose)} and ${pick(r, CAST.mouth)}`,
    mark,
    pick(r, CAST.skin),
    `hair: ${hair}`,
    woman ? null : pick(r, young ? CAST.beardYoung : CAST.beard),
    `build: ${pick(r, CAST.build)}`,
  ].filter(Boolean);
  return `${who} with ${parts.join('; ')}`;
}
const castingText = (cast) => (cast ? `Casting: the main character is ${cast}. ${CAST_NOTE}` : '');

// Appended to every poster / trailer prompt (Seed-written or template) so results read as a
// still and footage from a real live-action film, not a glossy AI render.
const POSTER_REALISM = 'Photographed as a still from a real live-action feature film: shot on 35mm film with a cinema camera and real lenses, natural skin texture with pores and fine lines, real fabric and material texture, practical motivated lighting, gentle film grain and halation, natural color, believable human proportions and restrained, natural expressions. Not CGI, not a 3D render, not an illustration; no airbrushed or plastic-looking skin, no over-sharpened HDR look.';
// Several large faces in one image tend to come out identical and break the trailer, so every poster
// has exactly one large, clear face; everyone else is kept small, turned away or out of focus.
const POSTER_ONE_FACE = 'Casting and framing: exactly one main character, and only that person\'s face is shown large and in sharp focus. Anyone else stays small in the background, seen from behind, in silhouette, partly out of frame or softly out of focus; never a second large, clearly visible face, no rows or crowds of faces, no mirrors, reflections or pictures repeating a face. Every person looks clearly different; no identical or twin-looking faces.';
const VIDEO_ONE_FACE = 'Keep exactly the people that are in the poster: do not add new faces, and do not turn a background figure into a second close-up face; any close-up is of the main character.';
const VIDEO_REALISM = 'Live-action film footage: real camera movement with natural motion blur, realistic physics and weight, natural human motion and micro-expressions, faces and hands stay consistent with the poster without morphing, 24fps film look with gentle grain.';
const SECS = () => config.ark.videoDuration;

function posterPrompt({ genre, kw, cast }) {
  return [
    `Photographic one-sheet for a live-action ${genre.en.toLowerCase()} film, tall vertical 9:16 full-bleed composition (portrait phone/kiosk screen), subject centred with headroom.`,
    `Main character: ${kw.who.en}, who ${kw.what.en} ${kw.how.en}, ${kw.why.en}.`,
    castingText(cast),
    `Setting: ${kw.where.en}, ${kw.when.en}.`,
    `Style: ${genre.style}.`,
    'A single strong moment that tells the story, real location with depth, theatrical one-sheet composition.',
    POSTER_ONE_FACE,
    POSTER_REALISM,
    'Keep the lower third darker and uncluttered for title placement. No text, no letters, no words, no logos, no watermark.',
  ].filter(Boolean).join(' ');
}

// Two-beat camera plan for the trailer, picked per visitor (by seed) from the genre's library.
// Moves are typed (push, pull, orbit, crane, truck, pan, tilt, track, ...): the opening move is
// never a push-in (the model's own default) and the closing move is a different type, so each
// trailer gets two clearly different camera moves. Plain strings in content.json still work.
const asMove = (x) => (typeof x === 'string' ? { type: x.includes('push') || x.includes('dolly-in') ? 'push' : 'other', text: x } : x);
function cameraPlan(genre, seed) {
  const moves = (genre.camera || []).map(asMove).filter((x) => x?.text);
  if (!moves.length) return null;
  const r = rng(Math.imul((seed ^ 0x9e3779b9) >>> 0, 2654435761) >>> 0); // mix: nearby seeds pick different moves
  r(); r();
  const pick = (list) => list[Math.floor(r() * list.length)];
  const openers = moves.filter((x) => x.type !== 'push');
  const open = pick(openers.length ? openers : moves);
  const closers = moves.filter((x) => x !== open && x.type !== open.type);
  const close = closers.length ? pick(closers) : null;
  return { open: open.text, close: close?.text || null };
}
const cameraText = (genre, plan) => (plan
  ? `Camera plan for this ${SECS()}-second ${genre.en.toLowerCase()} trailer shot: open with ${plan.open}${plan.close ? `, then move into ${plan.close}` : ''}, ending on a striking final frame. Make both camera moves clearly visible, with real direction and speed; do not replace them with a plain slow zoom or push-in.`
  : '');

function videoPrompt({ genre, kw, plan }) {
  return [
    `The movie poster comes alive as a ${SECS()}-second teaser trailer shot.`,
    `${kw.who.en} ${kw.what.en} ${kw.how.en}, ${kw.where.en}, ${kw.when.en}.`,
    cameraText(genre, plan),
    `Action and atmosphere: ${genre.motion}.`,
    'Keep the same characters, wardrobe, palette and composition as the poster.',
    VIDEO_ONE_FACE,
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
"poster_prompt" (English image prompt for a tall vertical 9:16 full-bleed movie poster (portrait kiosk screen), subject centred with headroom. Write it like a cinematographer's shot description of a still from a real live-action film: the actors (age, look, wardrobe, a natural believable expression; when a casting is given for the main character, use that gender, age, face, hair and build as given and do not swap in other ones; choose wardrobe that fits this one character and place, and do not fall back on stock choices such as a twenty-something with messy dark hair, tired gentle eyes and a cream knit sweater), the real location and time of day, the lighting setup and light sources, lens and framing, color grade. Prefer grounded, real-world details over spectacle. Exactly ONE character's face may be large and clearly visible; if the story has other people (a partner, a rival, a robot), show them small in the background, from behind, in silhouette or out of focus, never as a second large face, and never as a crowd of faces or a face repeated in a mirror or reflection. Do NOT use words like masterpiece, ultra-detailed, 8K, hyper-realistic, digital art, CGI, perfect skin, flawless, epic. MUST end with: "Keep the lower third darker for title placement. No text, no letters, no logos."),
"video_prompt" (English prompt, 2-3 sentences, describing how this exact poster image comes alive as a ${config.ark.videoDuration}-second live-action trailer shot. Use exactly the two camera moves of the given camera plan, in that order, describing each with its direction and speed (do not fall back to a slow push-in or dolly-in unless the plan names one), and describe what the actors physically do during each beat, plus small details like breath, wind or light changes. Keep motion believable and grounded. No on-screen text).
Content must be family-friendly.`;

export async function buildStory({ genreId, keywordIdx, director, seed }) {
  const sel = resolveSelection(genreId, keywordIdx);
  if (sel.error) return sel;
  const { genre, kw } = sel;
  const base = templateStory({ genre, kw, director, seed });
  let story = { ...base, source: 'template' };
  const cast = casting(kw.who.en, seed);
  let pPrompt = posterPrompt({ genre, kw, cast });
  const plan = cameraPlan(genre, seed);
  let vPrompt = videoPrompt({ genre, kw, plan });

  if (!config.mock && config.ark.llmEnabled) {
    try {
      const user = `Genre: ${genre.ko} (${genre.en}). Visual style hint: ${genre.style}.
Keywords — 누가: ${kw.who.ko} / 언제: ${kw.when.ko} / 어디서: ${kw.where.ko} / 무엇을: ${kw.what.ko} / 어떻게: ${kw.how.ko} / 왜: ${kw.why.ko}.
Director: ${director}. Random seed: ${seed}.${cast ? `
Casting for the main character: ${cast}.` : ''}${plan ? `
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
        pPrompt = [out.poster_prompt.trim(), castingText(cast), `Style: ${genre.style}.`, POSTER_ONE_FACE, POSTER_REALISM].filter(Boolean).join(' ');
        vPrompt = [out.video_prompt.trim(), cameraText(genre, plan), `Action and atmosphere: ${genre.motion}.`, VIDEO_ONE_FACE, VIDEO_REALISM].filter(Boolean).join(' ');
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
