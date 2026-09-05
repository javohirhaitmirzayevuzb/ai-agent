/**
 * Local cover composer.
 *
 * The image models do the heavy lifting, but a design tool must never dead-end:
 * when no image key is configured (or the model refuses), we compose a real
 * vector cover from the *measured* DNA of the reference — its palette, brightness,
 * layout archetype and the user's text. It is also what the "Style sheet" preview
 * and the layout wireframe are built from, so it doubles as the explain layer.
 *
 * Output: SVG markup (browser-safe fonts only, so it rasterises cleanly to PNG).
 */
import { formatSpec } from './prompts.js';

const FONT_DISPLAY = "'Helvetica Neue', 'Arial Black', Arial, sans-serif";
const FONT_BODY = "'Helvetica Neue', Arial, sans-serif";
const FONT_SERIF = "Georgia, 'Times New Roman', serif";

const hex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback);
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));

/** luminance + mix helpers so we can derive readable type colours */
function rgb(h) {
  const v = h.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
function lum(h) {
  const [r, g, b] = rgb(h).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return '#' + A.map((c, i) => Math.round(c + (B[i] - c) * t).toString(16).padStart(2, '0')).join('');
}
const shade = (c, t) => mix(c, lum(c) > 0.5 ? '#000000' : '#ffffff', t);

function wrap(text, maxChars) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    if (!cur.length) cur = w;
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
    if (lines.length > 7) break;
  }
  if (cur && lines.length <= 7) lines.push(cur);
  return lines.slice(0, 8);
}

function esc(s) {
  return String(s ?? '')
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

function palette(analysis) {
  const list = (analysis?.palette || []).map((p) => ({ hex: hex(p.hex, null), role: p.role || 'primary', coverage: Number(p.coverage) || 0.15 }));
  const clean = list.filter((p) => p.hex);
  if (clean.length >= 2) return clean;
  const dark = analysis?.measured?.dark;
  return [
    { hex: dark ? '#0d1117' : '#f5f2ea', role: 'bg', coverage: 0.6 },
    { hex: '#ff5c39', role: 'accent', coverage: 0.2 },
    { hex: dark ? '#161d29' : '#e7e1d4', role: 'primary', coverage: 0.13 },
    { hex: '#ffffff', role: 'text', coverage: 0.07 },
  ];
}

/** Choose a background/ink/accent triple that keeps text readable. */
function themeOf(paletteList, measured = {}) {
  const bgEntry = paletteList.find((p) => p.role === 'bg') || paletteList[0];
  let bg = bgEntry.hex;
  if (measured.luminance != null) bg = mix(bg, measured.luminance > 0.55 ? '#ffffff' : '#000000', 0.15);
  const dark = lum(bg) < 0.42;
  const accents = paletteList.filter((p) => p.role !== 'bg' && p.role !== 'text');
  const ranked = [...accents].sort((a, b) => {
    const score = (p) => Math.abs(lum(p.hex) - lum(bg)) * 1.6 + (p.coverage || 0) + (p.role === 'accent' ? 0.5 : 0);
    return score(b) - score(a);
  });
  const accent = ranked[0]?.hex || (dark ? '#ffd166' : '#111111');
  const second = ranked[1]?.hex || mix(accent, dark ? '#ffffff' : '#000000', 0.4);
  const ink = dark ? '#f7f9fc' : '#0c0f16';
  const soft = dark ? 'rgba(255,255,255,.62)' : 'rgba(12,15,22,.62)';
  return { bg, ink, soft, accent, second, dark };
}

function defs(theme, variation, size) {
  const angle = [0, 26, -18, 45, 90][variation % 5];
  return `<defs>
  <linearGradient id="bg" gradientTransform="rotate(${angle} .5 .5)">
    <stop offset="0%" stop-color="${mix(theme.bg, theme.dark ? '#ffffff' : '#000000', 0.06)}"/>
    <stop offset="55%" stop-color="${theme.bg}"/>
    <stop offset="100%" stop-color="${mix(theme.bg, theme.accent, 0.22)}"/>
  </linearGradient>
  <radialGradient id="glow" cx="${[28, 74, 50, 18][variation % 4]}%" cy="${[22, 30, 68, 76][variation % 4]}%" r="62%">
    <stop offset="0%" stop-color="${theme.accent}" stop-opacity="${theme.dark ? 0.55 : 0.34}"/>
    <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="accentbar" x1="0" x2="1">
    <stop offset="0%" stop-color="${theme.accent}"/>
    <stop offset="100%" stop-color="${theme.second}"/>
  </linearGradient>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${7 + variation}"/>
    <feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.05"/></feComponentTransfer>
    <feComposite in2="SourceGraphic" operator="in"/></filter>
  <clipPath id="clip"><rect x="0" y="0" width="${size.w}" height="${size.h}" rx="${size.r || 0}"/></clipPath>
</defs>`;
}

function typeBlock({ lines, x, y, size, lead, fill, weight, family, caseFn = (s) => s, tracking = 0, anchor = 'start', opacity = 1 }) {
  return `<g font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${tracking}" opacity="${opacity}">
${lines.map((l, i) => `  <text x="${x}" y="${(y + i * size * lead).toFixed(1)}">${esc(caseFn(l))}</text>`).join('\n')}
</g>`;
}

function shapeField(theme, variation, size, mood, offset) {
  const w = size.w;
  const h = size.h;
  const ox = offset?.x || 0;
  const oy = offset?.y || 0;
  const wrap = (inner) => (ox || oy ? `<g transform="translate(${ox} ${oy})">${inner}</g>` : inner);
  const soft = theme.dark ? 0.9 : 0.75;
  const kinds = ['orbits', 'slabs', 'grid', 'arc'];
  const kind = kinds[(variation + (mood === 'tech' ? 0 : 1)) % kinds.length];
  const inner =
    kind === 'orbits'
      ? `<g fill="none" stroke="${theme.accent}">
  <circle cx="${w * 0.72}" cy="${h * 0.26}" r="${w * 0.19}" stroke-width="${(w * 0.006).toFixed(1)}"/>
  <circle cx="${w * 0.72}" cy="${h * 0.26}" r="${w * 0.29}" stroke-width="${(w * 0.003).toFixed(1)}" stroke-opacity=".55"/>
  <circle cx="${w * 0.72}" cy="${h * 0.26}" r="${w * 0.07}" fill="${theme.accent}" stroke="none" opacity=".9"/>
</g>`
      : kind === 'slabs'
        ? `<g>
  <rect x="${w * 0.58}" y="${h * 0.07}" width="${w * 0.36}" height="${h * 0.26}" fill="url(#accentbar)"/>
  <rect x="${w * 0.64}" y="${h * 0.37}" width="${w * 0.3}" height="${h * 0.045}" fill="${theme.ink}" opacity=".22"/>
  <rect x="${w * 0.58}" y="${h * 0.64}" width="${w * 0.36}" height="${h * 0.24}" fill="${theme.second}" opacity=".42"/>
</g>`
        : kind === 'grid'
          ? `<g>
  <g opacity="${theme.dark ? 0.16 : 0.16}" stroke="${theme.ink}" stroke-width="1">
  ${Array.from({ length: 9 }, (_, i) => `<line x1="${((w / 8) * i).toFixed(1)}" y1="${(h * 0.55).toFixed(1)}" x2="${((w / 8) * i).toFixed(1)}" y2="${h}"/>`).join('')}
  </g>
  <circle cx="${w * 0.74}" cy="${h * 0.2}" r="${w * 0.13}" fill="${theme.accent}" opacity=".92"/>
</g>`
          : `<g>
  <path d="M0 ${h * 0.92} Q ${w * 0.5} ${h * 0.58} ${w} ${h * 0.92}" fill="none" stroke="url(#accentbar)" stroke-width="${(w * 0.012).toFixed(1)}"/>
  <path d="M0 ${h * 1.0} Q ${w * 0.5} ${h * 0.7} ${w} ${h * 1.0}" fill="none" stroke="${theme.ink}" stroke-opacity=".22" stroke-width="${(w * 0.004).toFixed(1)}"/>
</g>`;
  return wrap(inner.replace('<g>', `<g opacity="${soft.toFixed(2)}">`));
}

function ctaPill(label, theme, size, { x, y, anchor = 'start' }) {
  const t = String(label || '').trim();
  if (!t) return '';
  const fs = clampNum(size.w * 0.017, 11, 21);
  const bw = t.length * fs * 0.68 + fs * 2.8;
  const bh = fs * 2.35;
  const bx = anchor === 'end' ? x - bw : anchor === 'middle' ? x - bw / 2 : x;
  return `<g>
  <rect x="${bx.toFixed(1)}" y="${(y - bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="${(bh / 2).toFixed(1)}" fill="${theme.accent}"/>
  <text x="${(bx + bw / 2).toFixed(1)}" y="${(y + fs * 0.36).toFixed(1)}" text-anchor="middle" font-family="${FONT_BODY}" font-size="${fs.toFixed(1)}" font-weight="800" letter-spacing="${(fs * 0.06).toFixed(1)}" fill="${lum(theme.accent) > 0.55 ? '#0b0d12' : '#fff'}">${esc(t.toUpperCase())}</text>
</g>`;
}

function wordmark(name, theme, size, { x, y, anchor = 'start' }) {
  const s = clampNum(size.w * 0.019, 12, 26);
  const label = String(name || '').toUpperCase();
  const w = label.length * s * 0.72 + s * 2.4;
  const bx = anchor === 'end' ? x - w : x;
  return `<g>
  <rect x="${bx.toFixed(1)}" y="${(y - s).toFixed(1)}" width="${w.toFixed(1)}" height="${(s * 1.75).toFixed(1)}" rx="${s}" fill="${theme.ink}" opacity=".08"/>
  <circle cx="${(bx + s * 0.85).toFixed(1)}" cy="${(y + s * 0.36).toFixed(1)}" r="${s * 0.34}" fill="${theme.accent}"/>
  <text x="${(bx + s * 1.7).toFixed(1)}" y="${(y + s * 0.72).toFixed(1)}" font-family="${FONT_BODY}" font-size="${s}" font-weight="700" letter-spacing="${s * 0.06}" fill="${theme.ink}">${esc(label)}</text>
</g>`;
}

/**
 * @param {object} p.analysis  merged analysis (palette, layout, typography…)
 * @param {object} p.brief     user answers: companyName, headline, tagline, cta, topic, insight
 * @param {number} p.variation 0..3 — nudges composition so variants differ
 * @param {string} p.variant   archetype override, e.g. 'hero-photo-type-overlay'
 */
export function renderCover({ analysis = {}, brief = {}, variation = 0, format, wireframe = false } = {}) {
  const spec = format ? formatSpec(format) : null;
  const ratioRaw = format || brief.format || 'post-1x1';
  const cssRatio = spec?.css || '1 / 1';
  const [rw, rh] = cssRatio.split('/').map((n) => Number(n.trim()) || 1);
  const long = 1200;
  let w = rw >= rh ? long : Math.round((long * rw) / rh);
  let h = rh > rw ? long : Math.round((long * rh) / rw);
  if (!isFinite(w) || !isFinite(h)) {
    w = h = long;
  }
  const size = { w, h };
  const pal = palette(analysis);
  const theme = themeOf(pal, analysis.measured || {});
  const archetype = analysis.layout?.archetype || 'centered-stacked';
  const serif = /serif|editorial|classic|luxury/.test(
    ((analysis.typography?.headlineStyle || '') + ' ' + (analysis.typography?.pairing || '')).toLowerCase()
  );
  const family = serif ? FONT_SERIF : FONT_DISPLAY;
  const upper = analysis.typography?.casing !== 'lower';
  const m = Math.round(w * 0.075);
  const texts = {
    company: String(brief.companyName || analysis.companyName || '').trim(),
    headline: String(brief.headline || brief.topic || 'Yangi mavzu').trim(),
    sub: String(brief.subhead || brief.tagline || '').trim(),
    cta: String(brief.cta || '').trim(),
    footer: String(brief.footer || brief.offer || '').trim(),
    kicker: String(brief.kicker || analysis.kind || 'reel cover').trim(),
  };
  const headSize = clampNum(w * (texts.headline.length > 44 ? 0.055 : texts.headline.length > 26 ? 0.072 : 0.095), 26, 116);
  const headLines = wrap(texts.headline, Math.max(10, Math.round((w - m * 2) / (headSize * 0.53))));
  const headFill = theme.ink;
  const accentBar = `<rect x="${m}" y="${Math.round(h * 0.16)}" width="${Math.round(w * 0.07)}" height="${Math.max(4, Math.round(w * 0.008))}" rx="3" fill="url(#accentbar)"/>`;
  const grain = `<rect width="${w}" height="${h}" filter="url(#grain)" opacity=".5"/>`;
  const scrim = theme.dark
    ? `<rect width="${w}" height="${h}" fill="#000" opacity=".0"/>\n`
    : '';

  let body = '';
  const left = m;
  const bottom = h - m;

  switch (archetype) {
    case 'split-left-type':
    case 'split-left-image': {
      const imgSide = archetype === 'split-left-image' ? 'left' : 'right';
      const colX = imgSide === 'left' ? 0 : w * 0.54;
      const tx = imgSide === 'left' ? w * 0.54 + m * 0.3 : m;
      const tw = w * 0.46 - m * 1.2;
      body = `<g>
  <rect x="${colX}" y="0" width="${w * 0.46}" height="${h}" fill="${mix(theme.bg, theme.accent, 0.16)}"/>
  ${shapeField(theme, variation, { w: w * 0.46, h }, analysis.mood?.[0], { x: colX })}
  ${typeBlock({ lines: wrap(texts.kicker, 26), x: tx, y: h * 0.34, size: clampNum(w * 0.017, 11, 20), lead: 1.3, fill: theme.accent, weight: 700, family: FONT_BODY, tracking: 2, caseFn: (s) => s.toUpperCase() })}
  ${typeBlock({ lines: headLines, x: tx, y: h * 0.46, size: headSize * 0.82, lead: 1.02, fill: headFill, weight: 800, family, caseFn: upper ? (s) => s.toUpperCase() : (s) => s })}
  ${texts.sub ? typeBlock({ lines: wrap(texts.sub, Math.max(12, Math.round(tw / (clampNum(w * 0.022, 14, 28) * 0.55)))), x: tx, y: h * 0.46 + Math.min(headLines.length, 3) * headSize * 0.92, size: clampNum(w * 0.022, 14, 28), lead: 1.4, fill: theme.soft, weight: 500, family: FONT_BODY }) : ''}
  ${texts.cta ? ctaPill(texts.cta, theme, { w, h }, { x: tx, y: h * 0.87 }) : ''}
</g>`;
      break;
    }
    case 'editorial-grid':
    case 'frame-border': {
      const frame = archetype === 'frame-border' ? `<rect x="${m * 0.55}" y="${m * 0.55}" width="${w - m * 1.1}" height="${h - m * 1.1}" fill="none" stroke="${theme.ink}" stroke-opacity=".35" stroke-width="1.5"/>` : '';
      body = `${frame}
  <g opacity=".28" stroke="${theme.ink}" stroke-width="1">
    ${Array.from({ length: 3 }, (_, i) => `<line x1="${m + ((w - 2 * m) / 3) * (i + 1)}" y1="${h * 0.58}" x2="${m + ((w - 2 * m) / 3) * (i + 1)}" y2="${h * 0.82}"/>`).join('')}
  </g>
  <line x1="${m}" y1="${h * 0.3}" x2="${w - m}" y2="${h * 0.3}" stroke="${theme.ink}" stroke-opacity=".22"/>
  ${typeBlock({ lines: wrap(texts.kicker, 30), x: m, y: h * 0.24, size: clampNum(w * 0.016, 10, 18), lead: 1.3, fill: theme.soft, weight: 600, family: FONT_BODY, tracking: 3, caseFn: (s) => s.toUpperCase() })}
  ${typeBlock({ lines: headLines.slice(0, 4), x: m, y: h * 0.45, size: headSize * 0.78, lead: 1.06, fill: headFill, weight: 700, family, caseFn: (s) => s })}
  ${texts.sub ? typeBlock({ lines: wrap(texts.sub, Math.round((w - 2 * m) / (headSize * 0.34))), x: m, y: h * 0.62, size: clampNum(w * 0.02, 13, 24), lead: 1.5, fill: theme.soft, weight: 400, family: FONT_BODY }) : ''}
  ${texts.footer ? typeBlock({ lines: [texts.footer], x: m, y: h * 0.86, size: clampNum(w * 0.016, 11, 19), lead: 1, fill: theme.accent, weight: 700, family: FONT_BODY, tracking: 1.5 }) : ''}
  ${texts.cta ? ctaPill(texts.cta, theme, { w, h }, { x: w - m, y: h * 0.5, anchor: 'end' }) : ''}`;
      break;
    }
    case 'big-number': {
      // only ever render a number the user actually gave us — otherwise fall back to a brand monogram
      const fromWhere = `${texts.headline} ${brief.offer || ''} ${texts.footer || ''} ${brief.topic || ''}`;
      const num = (fromWhere.match(/\d+\s?\d*[+%%]?/g) || []).sort((a, b) => b.length - a.length)[0]?.trim() || (texts.company || '★').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
      body = `${accentBar}
  <text x="${w * 0.5}" y="${h * 0.62}" text-anchor="middle" font-family="${family}" font-size="${(w * (num.length > 3 ? 0.4 : 0.52)).toFixed(0)}" font-weight="900" fill="${theme.ink}" opacity=".14">${esc(num)}</text>
  <text x="${w * 0.5}" y="${h * 0.62}" text-anchor="middle" font-family="${family}" font-size="${(w * (num.length > 3 ? 0.24 : 0.3)).toFixed(0)}" font-weight="900" fill="url(#accentbar)">${esc(num)}</text>
  ${typeBlock({ lines: wrap(texts.headline.replace(num, '').trim() || texts.kicker, 26), x: w * 0.5, y: h * 0.74, size: clampNum(w * 0.03, 16, 40), lead: 1.25, fill: headFill, weight: 700, family: FONT_BODY, anchor: 'middle', caseFn: upper ? (s) => s.toUpperCase() : (s) => s })}
  ${texts.sub ? typeBlock({ lines: wrap(texts.sub, 40), x: w * 0.5, y: h * 0.83, size: clampNum(w * 0.019, 12, 22), lead: 1.4, fill: theme.soft, weight: 400, family: FONT_BODY, anchor: 'middle' }) : ''}`;
      break;
    }
    case 'hero-photo-type-overlay': {
      const art = [0, 1, 2, 3].map((i) => {
        const c = [theme.accent, theme.second, mix(theme.bg, '#ffffff', 0.22), theme.accent][i];
        const cx = (w * (0.2 + 0.22 * ((i + variation) % 4))).toFixed(0);
        const cy = (h * (0.16 + 0.12 * i)).toFixed(0);
        const r = (w * (0.3 - i * 0.05)).toFixed(0);
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c}" opacity="${(0.32 - i * 0.06).toFixed(2)}"/>`;
      }).join('\n  ');
      body = `<g>
  <rect width="${w}" height="${h}" fill="${mix(theme.bg, theme.second, 0.35)}"/>
  ${art}
  <rect width="${w}" height="${h}" fill="url(#grain)" opacity=".35"/>
  <rect y="${h * 0.42}" width="${w}" height="${h * 0.58}" fill="${theme.dark ? '#05070c' : mix(theme.bg, '#000', 0.72)}" opacity=".62"/>
  ${typeBlock({ lines: wrap(texts.kicker, 28), x: m, y: h * 0.66, size: clampNum(w * 0.017, 11, 20), lead: 1.3, fill: theme.accent, weight: 700, family: FONT_BODY, tracking: 2.5, caseFn: (s) => s.toUpperCase() })}
  ${typeBlock({ lines: headLines.slice(0, 3), x: m, y: h * 0.75, size: headSize * 0.92, lead: 1.02, fill: '#fff', weight: 800, family, caseFn: upper ? (s) => s.toUpperCase() : (s) => s })}
  ${texts.cta ? `<g><rect x="${m}" y="${h * 0.885}" width="${texts.cta.length * w * 0.0135 + w * 0.05}" height="${w * 0.042}" rx="${w * 0.021}" fill="${theme.accent}"/>
  <text x="${m + (texts.cta.length * w * 0.0135 + w * 0.05) / 2}" y="${h * 0.885 + w * 0.028}" text-anchor="middle" font-family="${FONT_BODY}" font-size="${clampNum(w * 0.016, 11, 18)}" font-weight="800" fill="${lum(theme.accent) > 0.55 ? '#0b0d12' : '#fff'}">${esc(texts.cta.toUpperCase())}</text></g>` : ''}
</g>`;
      break;
    }
    case 'asymmetric-blocks': {
      body = `<g>
  <rect x="${w * 0.58}" y="${h * 0.06}" width="${w * 0.36}" height="${h * 0.38}" fill="${theme.accent}" opacity=".92"/>
  <rect x="${w * 0.68}" y="${h * 0.5}" width="${w * 0.26}" height="${h * 0.3}" fill="${theme.second}" opacity=".55"/>
  ${accentBar}
  ${typeBlock({ lines: headLines, x: m, y: h * 0.4, size: headSize * 0.9, lead: 1.03, fill: headFill, weight: 800, family, caseFn: upper ? (s) => s.toUpperCase() : (s) => s })}
  ${texts.sub ? typeBlock({ lines: wrap(texts.sub, 34), x: m, y: h * 0.4 + headLines.length * headSize * 0.94, size: clampNum(w * 0.021, 13, 26), lead: 1.45, fill: theme.soft, weight: 400, family: FONT_BODY }) : ''}
  ${texts.cta ? ctaPill(texts.cta, theme, { w, h }, { x: m, y: h * 0.78 }) : ''}
  ${texts.footer ? typeBlock({ lines: [texts.footer], x: m, y: h * 0.88, size: clampNum(w * 0.016, 11, 19), lead: 1, fill: theme.ink, weight: 700, family: FONT_BODY, tracking: 1.2 }) : ''}
</g>`;
      break;
    }
    default: {
      // centered-stacked — the most reusable social-cover shape
      body = `${accentBar}
  ${typeBlock({ lines: wrap(texts.kicker, 30), x: w * 0.5, y: h * 0.24, size: clampNum(w * 0.016, 10, 18), lead: 1.3, fill: theme.soft, weight: 700, family: FONT_BODY, anchor: 'middle', tracking: 3, caseFn: (s) => s.toUpperCase() })}
  ${typeBlock({ lines: headLines.slice(0, 4), x: w * 0.5, y: h * 0.44, size: headSize, lead: 1.02, fill: headFill, weight: 800, family, anchor: 'middle', caseFn: upper ? (s) => s.toUpperCase() : (s) => s })}
  ${texts.sub ? typeBlock({ lines: wrap(texts.sub, Math.round((w * 0.8) / (headSize * 0.42))), x: w * 0.5, y: h * 0.44 + Math.min(headLines.length, 4) * headSize * 1.06, size: clampNum(w * 0.022, 14, 26), lead: 1.45, fill: theme.soft, weight: 400, family: FONT_BODY, anchor: 'middle' }) : ''}
  ${texts.cta ? ctaPill(texts.cta, theme, { w, h }, { x: w * 0.5, y: h * 0.79, anchor: 'middle' }) : `<line x1="${(w * 0.44).toFixed(0)}" y1="${(h * 0.78).toFixed(0)}" x2="${(w * 0.56).toFixed(0)}" y2="${(h * 0.78).toFixed(0)}" stroke="${theme.accent}" stroke-width="3"/>`}
  ${texts.footer ? typeBlock({ lines: [texts.footer], x: w * 0.5, y: h * 0.88, size: clampNum(w * 0.015, 10, 18), lead: 1, fill: theme.soft, weight: 600, family: FONT_BODY, anchor: 'middle', tracking: 1.2 }) : ''}`;
    }
  }

  // the wordmark rides in the type column, never under an art block
  const markSide = archetype === 'split-left-type' ? { x: w * 0.54 + m * 0.3, y: h * 0.1, anchor: 'start' } : archetype === 'split-left-image' ? { x: m, y: h * 0.1, anchor: 'start' } : { x: m, y: h * 0.1, anchor: 'start' };
  const mark = texts.company ? wordmark(texts.company, theme, size, markSide) : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(texts.headline)}">
${defs(theme, variation, size)}
<g clip-path="url(#clip)">
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#glow)"/>
  ${scrim}
  ${body}
  ${wireframe ? '' : mark}
  ${wireframe ? '' : grain}
  ${wireframe ? `<g fill="none" stroke="${theme.accent}" stroke-width="2" stroke-dasharray="10 8" opacity=".95">
    <rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}"/>
    <rect x="${m}" y="${h * 0.2}" width="${w * 0.62}" height="${h * 0.56}"/>
    <text x="${m}" y="${h * 0.19}" font-family="${FONT_BODY}" font-size="18" fill="${theme.accent}" stroke="none">SAFE ZONE · type here</text>
  </g>` : ''}
  <text x="${m}" y="${h - Math.round(h * 0.035)}" font-family="${FONT_BODY}" font-size="${clampNum(w * 0.012, 9, 14)}" fill="${theme.soft}" opacity=".8">${esc(`local render · ${archetype} · ${ratioRaw}`)}</text>
</g>
</svg>`;

  return {
    svg,
    width: w,
    height: h,
    theme: { bg: theme.bg, ink: theme.ink, accent: theme.accent, second: theme.second, dark: theme.dark },
    palette: pal.map((p) => p.hex),
    archetype,
    headlineLines: headLines,
    format: ratioRaw,
  };
}
