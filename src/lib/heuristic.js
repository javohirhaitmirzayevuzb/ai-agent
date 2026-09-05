/**
 * Heuristic design analysis — the measurements a browser canvas can make from the
 * file itself (palette, luminance, contrast, edge/detail energy per region).
 *
 * Two jobs:
 *  1. ground the vision model with exact numbers it cannot eyeball, and
 *  2. keep the studio fully usable when no vision key is configured yet, so the
 *     user still gets a real, defensible read of their reference before answering
 *     the brief.
 */

const RATIOS = [
  { id: 'reel-9x16', test: (r) => r < 0.62, label: '9:16', kind: 'reel-cover' },
  { id: 'post-4x5', test: (r) => r >= 0.62 && r < 0.86, label: '4:5', kind: 'social-post' },
  { id: 'post-1x1', test: (r) => r >= 0.86 && r < 1.2, label: '1:1', kind: 'social-post' },
  { id: 'wide-16x9', test: (r) => r >= 1.2 && r < 1.95, label: '16:9', kind: 'banner' },
  { id: 'wide-21x9', test: (r) => r >= 1.95, label: '21:9', kind: 'banner' },
];

function kindFor(ratio) {
  return RATIOS.find((r) => r.test(ratio)) || RATIOS[2];
}

/**
 * @param {object} signals {width,height,palette:[{hex,share,luminance,saturation}],
 *   luminance,contrast,saturation,edgeDensity,regions:{'tl':{energy,light}},
 *   calmRegion, hotRegion, typeGuess}
 */
export function heuristicAnalysis(signals = {}) {
  const pal = Array.isArray(signals.palette) ? signals.palette : [];
  const ratio = signals.ratio || (signals.width && signals.height ? signals.width / signals.height : 1);
  const match = kindFor(ratio);
  const dark = (signals.luminance ?? 0.5) < 0.42;
  const loud = (signals.saturation ?? 0.3) > 0.42;
  const busy = (signals.edgeDensity ?? 0.3) > 0.42;
  const calm = signals.calmRegion || 'center';
  const hot = signals.hotRegion || 'center';

  const roles = ['bg', 'primary', 'accent', 'glow', 'text'];
  const palette = pal.slice(0, 6).map((p, i) => ({
    hex: p.hex,
    role: roles[i % roles.length],
    coverage: Number(p.share ?? 1 / Math.max(1, pal.length)).toFixed(3) * 1,
  }));

  const archetypes = [
    { id: 'centered-stacked', when: (s) => s.contrast > 0.28 && s.edgeDensity < 0.36 },
    { id: 'hero-photo-type-overlay', when: (s) => s.edgeDensity >= 0.36 && s.regionsTopHeavy },
    { id: 'split-left-type', when: (s) => s.regionsLeftHeavy },
    { id: 'editorial-grid', when: (s) => s.edgeDensity >= 0.3 && !s.regionsLeftHeavy },
    { id: 'asymmetric-blocks', when: () => true },
  ];
  const feats = {
    ...signals,
    regionsTopHeavy: (signals.regions?.tl?.energy || 0) + (signals.regions?.tc?.energy || 0) + (signals.regions?.tr?.energy || 0) >
      (signals.regions?.bl?.energy || 0) + (signals.regions?.bc?.energy || 0) + (signals.regions?.br?.energy || 0),
    regionsLeftHeavy: (signals.regions?.tl?.energy || 0) + (signals.regions?.ml?.energy || 0) + (signals.regions?.bl?.energy || 0) >
      (signals.regions?.tr?.energy || 0) + (signals.regions?.mr?.energy || 0) + (signals.regions?.br?.energy || 0) * 1.15,
  };
  const archetype = archetypes.find((a) => a.when(feats))?.id || 'centered-stacked';

  const mood = [dark ? 'premium' : 'airy', loud ? 'energetic' : 'restrained', busy ? 'rich' : 'minimal', match.kind === 'reel-cover' ? 'motion-ready' : 'feed-ready']
    .filter(Boolean)
    .slice(0, 4);

  const styleTags = [
    dark ? 'dark-mode' : 'light-mode',
    loud ? 'saturated palette' : 'muted palette',
    busy ? 'high-detail artwork' : 'flat graphic shapes',
    feats.regionsTopHeavy ? 'top-weighted composition' : 'bottom-weighted composition',
    (signals.contrast || 0) > 0.34 ? 'strong figure/ground contrast' : 'soft contrast',
    match.kind.replace('-', ' '),
  ];

  return {
    kind: match.kind,
    isDesign: true,
    engine: 'heuristic',
    summary: `${dark ? 'Tungi' : 'Yorug’'} ${loud ? 'to’ying’ rangli' : 'sokin rangli'}, ${(signals.edgeDensity || 0) > 0.4 ? 'detalga boy' : 'sof grafik'} ${match.label} dizayn (${pal.length}-rangli palitra, kontrast ${Math.round((signals.contrast || 0) * 100)}/100).`,
    detectedText: [],
    companyName: null,
    hasCompanyMark: false,
    handles: [],
    palette,
    background: {
      type: (signals.contrast || 0) > 0.3 ? 'gradient' : 'flat',
      description: `Eng katta maydon ${palette[0]?.hex || '#111'} (${Math.round((palette[0]?.share || 0.5) * 100)}% qoplama) — ${dark ? 'chuqur fon ustida yorug’ matn' : 'yorug’ fonda qorong’i matn'}.`,
    },
    typography: {
      headlineStyle: busy ? 'zich, kichikro’k sarlavha, grafik elementlar bilan raqobatlashadi' : 'yirik display sarlavha, keng satr oralig’i',
      pairing: 'display + neutral sans',
      casing: dark && loud ? 'upper' : 'title',
      hierarchy: `${busy ? '3-4' : '2-3'} bosqichli tipografik iyerarxiya`,
    },
    layout: {
      archetype,
      alignment: feats.regionsLeftHeavy ? 'left' : calm.includes('c') ? 'center' : 'left',
      safeZones: [`${calm} — eng bo’sh hudud, sarlavha shu yerga qo’ysiz`],
      focalPoint: hot,
      density: busy ? 'high' : feats.edgeDensity > 0.2 ? 'medium' : 'low',
    },
    decoration: dark ? ['glow', 'grain'] : ['thin-outlines'],
    mood,
    styleTags,
    aspectRatio: match.label,
    formatSuggestion: match.id,
    colorStory: `${palette.length} rang: asos ${palette[0]?.hex}, aksent ${palette[1]?.hex || palette[palette.length - 1]?.hex}.`,
    whatMakesItWork: [
      `Ranglar bo’linishi (${pal.map((p) => Math.round((p.share || 0) * 100) + '%').join(' / ') || 'yagona dom'}) — bir dominant, bir aksent, qolg’anida nefes`,
      `Kontrast ${Math.round((signals.contrast || 0) * 100)}/100: matn fon ustida o’qiladi, ammo ko’z charchamaydi`,
      `Vizual og’irlik ${hot} tomonda, ${calm} tomon bo’sh — sarlavha uchun tayyor maydon`,
    ],
    doNotCopy: ['dizayndagi haqiqiy logotip va odam yuzlari', 'fayldagi watermark', 'to’liq nusxa olinggan rasm'],
    questionsToAsk: [
      { field: 'companyName', question: 'Kompaniya yoki brend nomi nimani kiritaylik?', why: 'Analizda matn o’qilmadi — yangi dizaynga nom kerak' },
      { field: 'topic', question: 'Reel/post mavzusi nima?', why: 'Sarlavha va vizual g’oyani shu belgilaydi' },
      { field: 'insight', question: 'Bu post nima his qildirsin yoki nimaga undasin?', why: 'Sizning fikringiz dizayn ruhini aniq belgilaydi' },
    ],
    textRisk: ['Matn aniqligi uchun AI vizual kalitini ulang — hozircha faqat rang/o’lchov tahlili'],
    measured: {
      width: signals.width,
      height: signals.height,
      ratioLabel: match.label,
      luminance: signals.luminance,
      contrast: signals.contrast,
      saturation: signals.saturation,
      edgeDensity: signals.edgeDensity,
      calmRegion: calm,
      hotRegion: hot,
      regions: signals.regions || null,
      dark,
      typeGuess: signals.typeGuess,
    },
    sources: ['canvas-measure'],
  };
}

/** Which step of the flow is available with the current configuration. */
export function flowReadiness({ analyse, image }) {
  return {
    analysisMode: analyse ? 'ai-vision' : 'heuristic',
    renderMode: image ? 'image-model' : 'local-svg',
    note: !analyse && !image ? 'Hech qanday AI kaliti yo’q — lokal rejimda ishlaydi (rang/tahlil canvas’dan, rasm SVG kompozitsiyadan).' : '',
  };
}
