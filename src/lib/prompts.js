/**
 * Prompt engineering for the two AI steps:
 *   1) ANALYSE  — read a reference cover/post, extract its design DNA, and figure
 *      out what info we still need from the user (notably: is a company name
 *      written in the design, and if so what is it).
 *   2) GENERATE — write a brief that reproduces the *style* of the reference but
 *      with the user's own content, format and insight.
 */

export const ANALYSIS_SCHEMA = {
  kind: 'one of: poster | social-post | reel-cover | story | banner | carousel-slide | logo | menu | flyer | photo | ui | other',
  isDesign: 'boolean — false if the image is a random photo/meme with no layout',
  summary: '1 sentence, what the reference actually is',
  detectedText: [{ text: 'string', role: 'brand-name | headline | subhead | cta | caption | decorative | noise', confidence: '0..1' }],
  companyName: 'string or null — the brand/company name printed in the design (wordmark, logo text, handle, footer). null when nothing brand-like is written',
  hasCompanyMark: 'boolean — a logo/wordmark is visible',
  handles: 'array of strings — @handles, phone numbers or urls printed in the design',
  palette: [{ hex: '#rrggbb', role: 'bg | primary | accent | text | glow', coverage: '0..1' }],
  background: { type: 'flat | gradient | mesh | photo | texture | glass | dark-glow', description: 'string' },
  typography: {
    headlineStyle: 'e.g. heavy geometric sans, all caps, tight tracking',
    pairing: 'e.g. display + neutral grotesque',
    casing: 'upper | title | lower',
    hierarchy: 'string — how many type levels and how they differ',
  },
  layout: {
    archetype: 'centered-stacked | split-left-type | split-left-image | editorial-grid | hero-photo-type-overlay | asymmetric-blocks | big-number | frame-border',
    alignment: 'left | center | right',
    safeZones: ['where a headline can sit on calm negative space'],
    focalPoint: 'top-left | top-center | top-right | center | bottom-left | bottom-center | bottom-right',
    density: 'low | medium | high',
  },
  decoration: 'array of strings, each one of: glow | grain | 3d-shapes | thin-outlines | glass-cards | sticker-type | mockup-frame | none',
  mood: ['3-5 adjectives'],
  styleTags: ['6-10 short tags a designer would use'],
  aspectRatio: '1:1 | 4:5 | 9:16 | 16:9 | 3:2 | 2:3 | 21:9',
  colorStory: '1 sentence on how the colours are used (contrast, temperature, where the accent sits)',
  whatMakesItWork: ['exactly 3 concrete reasons this design reads premium'],
  doNotCopy: ['elements we must NOT reuse — real logos, stock faces, watermarks, legible brand names'],
  questionsToAsk: [{ field: 'companyName | topic | tagline | tone | audience | offer', question: 'short question in the user language', why: 'why it matters' }],
  textRisk: ['warnings, e.g. "headline too small to read at feed size"'],
};

const SCHEMA_DOC = JSON.stringify(ANALYSIS_SCHEMA, null, 1);

export const ANALYSIS_PROMPT = `You are a senior art director + brand strategist.
A user uploaded a REFERENCE DESIGN (an Instagram cover, reel cover, poster, banner…) they
want to reuse as a style donor. Study it and return ONLY minified JSON — no markdown fences —
with exactly these keys and types (strings may be null / arrays may be empty):

${SCHEMA_DOC}

Hard rules:
- READ EVERY PIECE OF TEXT in the image and put it in detectedText, in reading order.
- companyName: only if a real company/brand/person name is printed or logoed in the design.
  Prefer a wordmark/logo text over a headline. If ambiguous or absent → null. Never invent.
- questionsToAsk: ask ONLY about what the image does not tell us (max 3, in this priority:
  companyName (only when null), topic, then one of tone/audience/offer). Write each question
  in the same language as the design text; default to Uzbek if the design has no readable text.
  Question text must be short and answerable in a few words.
- whatMakesItWork must be concrete and craft-level (spacing, contrast, type scale, restraint),
  never generic praise.
- Palette: 4-6 swatches, real hex values sampled from the image, coverage summing to ~1.`;

/** Extra signals measured client-side in a canvas, so analysis has grounding even w/o vision API. */
export function signalsDigest(signals = {}) {
  if (!signals || typeof signals !== 'object') return '';
  const bits = [];
  if (signals.palette?.length)
    bits.push(`measured palette: ${signals.palette.map((p) => `${p.hex} (${Math.round(p.share * 100)}%)`).join(', ')}`);
  if (signals.width && signals.height) bits.push(`measured pixels: ${signals.width}x${signals.height} (${signals.ratioLabel || ''})`);
  if (signals.luminance != null) bits.push(`brightness ${Math.round(signals.luminance * 100)}/100, contrast ${Math.round((signals.contrast || 0) * 100)}/100`);
  if (signals.saturation != null) bits.push(`saturation ${Math.round(signals.saturation * 100)}/100`);
  if (signals.edgeDensity != null) bits.push(`detail/edge density ${Math.round(signals.edgeDensity * 100)}/100`);
  if (signals.regions) {
    const hot = Object.entries(signals.regions).sort((a, b) => b[1].energy - a[1].energy)[0];
    if (hot) bits.push(`busiest region: ${hot[0]} (energy ${Math.round(hot[1].energy * 100)}%), calmest: ${signals.calmRegion || '?'}`);
  }
  if (signals.typeGuess) bits.push(`heuristic type guess: ${signals.typeGuess}`);
  return bits.length ? `\n\nInstrument measurements from the file itself (trust these for colour/brightness, they are exact):\n- ${bits.join('\n- ')}` : '';
}

export function buildAnalysisPrompt(signals) {
  return ANALYSIS_PROMPT + signalsDigest(signals);
}

/* ------------------------------------------------------------- generation */

const FORMAT = {
  'post-1x1': { label: 'Instagram / Facebook post', gemini: '1:1', openai: '1024x1024', css: '1 / 1' },
  'post-4x5': { label: 'Instagram portrait (4:5)', gemini: '4:5', openai: '1024x1536', css: '4 / 5' },
  'reel-9x16': { label: 'Reel / Story cover', gemini: '9:16', openai: '1024x1536', css: '9 / 16' },
  'wide-16x9': { label: 'YouTube / LinkedIn banner', gemini: '16:9', openai: '1536x1024', css: '16 / 9' },
  'wide-21x9': { label: 'Ultrawide web hero', gemini: '21:9', openai: '1536x1024', css: '21 / 9' },
  'poster-2x3': { label: 'Poster / Flyer', gemini: '2:3', openai: '1024x1536', css: '2 / 3' },
  'square-story': { label: 'Square story card', gemini: '1:1', openai: '1024x1024', css: '1 / 1' },
};

export function formatSpec(id) {
  return FORMAT[id] || FORMAT['post-1x1'];
}
export const FORMATS = Object.entries(FORMAT).map(([id, v]) => ({ id, label: v.label, css: v.css, gemini: v.gemini }));

function textBlock(label, value) {
  const v = String(value ?? '').trim();
  return v ? `${label}: ${v}\n` : '';
}

/**
 * The one big brief we hand to the image model. Reference image is attached
 * alongside, so the wording leans on "this design" for style.
 */
export function buildGenerationPrompt({ analysis = {}, brief = {}, variation = 0 } = {}) {
  const fmt = formatSpec(brief.format || analysis.aspectRatio);
  const a = analysis || {};
  const palette = (a.palette || []).slice(0, 6).map((p) => `${p.hex}${p.role ? ` (${p.role})` : ''}`).join(', ');
  const styleTags = (a.styleTags || []).slice(0, 8).join(', ');
  const mood = (a.mood || []).slice(0, 5).join(', ');
  const why = (a.whatMakesItWork || []).slice(0, 3).map((s, i) => `${i + 1}. ${s}`).join('\n');
  const deco = (a.decoration || []).slice(0, 6).join(', ');
  const doNot = (a.doNotCopy || []).slice(0, 6).join('; ');

  const texts = [
    brief.companyName && `Brand / company name — render EXACTLY as written, spelled like this: "${brief.companyName}"`,
    brief.headline && `Headline — render EXACTLY: "${brief.headline}"`,
    brief.subhead && `Sub-headline — render EXACTLY: "${brief.subhead}"`,
    brief.tagline && `Tagline — render EXACTLY: "${brief.tagline}"`,
    brief.cta && `Button / CTA — render EXACTLY: "${brief.cta}"`,
    brief.footer && `Footer line (date / place / price / handle) — render EXACTLY: "${brief.footer}"`,
  ]
    .filter(Boolean)
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');

  const tone = [brief.tone, brief.audience && `for ${brief.audience}`, brief.offering && `promoting: ${brief.offering}`]
    .filter(Boolean)
    .join(' · ');

  const insight = String(brief.insight || '').trim();
  const dir = String(brief.direction || '').trim();

  const variations = [
    'Stay closest to the reference: same layout archetype, same type scale, same palette weight.',
    'Premium twist: keep the mood, push contrast + whitespace, simplify to 3 visual layers.',
    'Bold edition: larger headline, stronger accent colour, more kinetic decoration — same brand feel.',
    'Editorial edition: grid-driven, smaller type, more negative space, refined and calm.',
  ];

  return [
    'TASK — Re-design a new piece of key art in the visual style of the attached reference design.',
    '',
    'HOW TO USE THE REFERENCE: copy its *design language* — colour relationships, typography feel,',
    'layout rhythm, spacing, effects, mood. Do NOT copy its words, logo, people or artwork.',
    '',
    `FORMAT: ${fmt.label}, ${brief.aspect || fmt.gemini} aspect ratio, safe for ${brief.platform || 'a social feed'} — keep all text inside the middle 88% so nothing is cropped.`,
    brief.count > 1 ? `VARIATION ${variation + 1} of ${brief.count}. ${variations[variation % variations.length]}` : '',
    '',
    'STYLE DNA EXTRACTED FROM THE REFERENCE',
    a.summary ? `- What the reference is: ${a.summary}` : '',
    styleTags ? `- Style: ${styleTags}` : '',
    mood ? `- Mood: ${mood}` : '',
    palette ? `- Palette (use these hex values): ${palette}` : '',
    a.background?.description ? `- Background: ${a.background.type || ''} — ${a.background.description}` : '',
    a.typography?.headlineStyle ? `- Typography: ${a.typography.headlineStyle}${a.typography.pairing ? `; pairing: ${a.typography.pairing}` : ''}` : '',
    a.layout?.archetype ? `- Layout: ${a.layout.archetype}, ${a.layout.alignment || ''} alignment, ${a.layout.density || ''} density, focal point ${a.layout.focalPoint || ''}` : '',
    deco ? `- Decorations: ${deco}` : '',
    a.colorStory ? `- Colour story: ${a.colorStory}` : '',
    why ? `- Why the reference works (reproduce these qualities):\n${why}` : '',
    '',
    'NEW CONTENT — these strings are the ONLY text allowed in the image. Spell them exactly,',
    'on separate lines, with clear hierarchy and enough size to read on a phone.',
    texts ||
      `(no wording supplied — write ONE punchy 3-6 word headline from the topic below and nothing else: "${
        String(brief.topic || brief.insight || '').slice(0, 180) || 'a bold brand statement'
      }")`,
    brief.topic ? `TOPIC THE PIECE MUST COMMUNICATE: "${String(brief.topic).slice(0, 300)}" — the headline, imagery and accent placement must all serve this.` : '',
    '',
    textBlock('BRIEF', tone),
    insight ? `INSIGHT FROM THE CREATOR (this is the meaning of the piece — make the composition serve it):\n${insight}` : '',
    dir ? `EXTRA ART-DIRECTION FROM THE AI PLANNER:\n${dir}` : '',
    '',
    'QUALITY BAR: magazine-grade art direction, pixel-crisp vector-clean type, perfect kerning,',
    'consistent light, no stock-photo look, print-quality detail. Flat or subtle gradient only if the reference uses it.',
    '',
    `NEVER: ${doNot || 'no logos or names that are not in the content list above'}, no lorem-ipsum, no gibberish or extra words, no watermark, no frame, no mockup, no photo of a screen.`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Short text-model pass that turns the user's insight into sharp art direction. */
export function buildDirectorPrompt({ analysis = {}, brief = {} }) {
  const a = analysis || {};
  return `You are an art director. In AT MOST 130 words, write the creative direction for a new ${brief.formatLabel || 'social cover'} that borrows the style of a reference design and communicates the creator's insight.

REFERENCE DNA: style=${(a.styleTags || []).join('/') || 'n/a'}; mood=${(a.mood || []).join('/') || 'n/a'}; palette=${(a.palette || []).map((p) => p.hex).join(' ')}; layout=${a.layout?.archetype || 'n/a'}; type=${a.typography?.headlineStyle || 'n/a'}
CREATOR: company="${brief.companyName || 'unknown'}"; topic="${brief.topic || ''}"; tone="${brief.tone || ''}"; audience="${brief.audience || ''}"
CREATOR'S INSIGHT (the raw material, do not ignore any part of it): """${String(brief.insight || '').slice(0, 1200)}"""

Return plain prose (no markdown, no preamble) covering: 1) the central idea & the single message,
2) the visual concept (what the eye sees first, layout move, colour usage, type attitude),
3) one hook line suggestion for the headline IF the creator left the headline empty,
4) one concrete detail that makes it feel premium, 5) what to avoid. Do not invent a company name.`;
}

export function extractJson(text) {
  if (!text) return null;
  const cleaned = String(text)
    .replace(/^\uFEFF/, '')
    .replace(/```json/gi, '```')
    .trim();
  const candidates = [];
  const fence = /```([\s\S]*?)```/.exec(cleaned);
  if (fence) candidates.push(fence[1]);
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(cleaned.slice(first, last + 1));
  candidates.push(cleaned);
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c.trim());
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      /* keep trying */
    }
  }
  return null;
}

/** Merge AI analysis with client-side measurements (AI wins on semantics, canvas wins on colour). */
export function mergeAnalysis(ai = {}, signals = {}) {
  const out = { ...ai };
  out.sources = [ai && Object.keys(ai).length ? 'ai-vision' : null, signals ? 'canvas-measure' : null].filter(Boolean);
  if (!out.palette?.length && signals.palette?.length) {
    out.palette = signals.palette.slice(0, 6).map((p, i) => ({ hex: p.hex, role: ['bg', 'primary', 'accent', 'text', 'glow'][i], coverage: p.share }));
  }
  out.measured = {
    width: signals.width,
    height: signals.height,
    ratioLabel: signals.ratioLabel,
    luminance: signals.luminance,
    contrast: signals.contrast,
    saturation: signals.saturation,
    edgeDensity: signals.edgeDensity,
    calmRegion: signals.calmRegion,
    dark: (signals.luminance ?? 1) < 0.42,
    typeGuess: signals.typeGuess,
  };
  if (!out.aspectRatio && signals.ratioLabel) out.aspectRatio = signals.ratioLabel;
  if (!out.questionsToAsk?.length) {
    out.questionsToAsk = [{ field: 'topic', question: 'Reel yoki post uchun mavzu nima?', why: 'Kontent matnini yozish uchun' }];
    if (!out.companyName)
      out.questionsToAsk.unshift({ field: 'companyName', question: 'Kompaniya / brend nomi nimani kiritaylik?', why: 'Dizaynda o’qilmadi — yangi ishda logotip yozuvi kerak' });
  }
  out.companyName = out.companyName || null;
  return out;
}

/** Turn the "does the design name a company?" answer into UI copy. */
export function companyHint(analysis = {}) {
  if (analysis.companyName)
    return { found: true, value: analysis.companyName, text: `Dizayndan brend topildi: ${analysis.companyName}` };
  if (analysis.detectedText?.length)
    return {
      found: false,
      value: '',
      text: `Dizaynda yozuv bor (${analysis.detectedText.slice(0, 3).map((t) => t.text).join(' / ')}), ammo kompaniya nomi aniq emas.`,
    };
  return { found: false, value: '', text: 'Dizaynda kompaniya nomi topilmadi — o’zingiz kiriting.' };
}
