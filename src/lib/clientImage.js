/**
 * Browser-side image toolkit: resize, exact measurements (palette, brightness,
 * contrast, detail energy per region) and PNG export of the SVG composer output.
 * Everything here is real signal — it is what the vision model is grounded with
 * and what the local renderer is built from.
 */

import { authedSrc } from './bearer.js';

const MAX_EDGE = 1600; // reference designs rarely need more, and API payloads stay small
const JPEG_QUALITY = 0.92;

export function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Rasmni ochib bo’lmadi.'));
    img.src = src;
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Fayl o’qilmadi.'));
    fr.readAsDataURL(file);
  });
}

/** Flatten any image data URL (incl. SVG) to a PNG bitmap the model APIs accept. */
export async function rasterizeDataUrl(dataUrl, mime = 'image/png', maxEdge = MAX_EDGE) {
  const img = await loadImageEl(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1200, img.naturalHeight || 1200));
  const width = Math.round((img.naturalWidth || 1200) * scale);
  const height = Math.round((img.naturalHeight || 1200) * scale);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!/png$/.test(mime)) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const out = c.toDataURL('image/png');
  return { dataUrl: out, mime: 'image/png', width, height, bytes: Math.round((out.length * 3) / 4) };
}

/** Downscales + re-encodes to a data URL. SVG/GIF are flattened to PNG. */
export async function prepareImage(file) {
  const raw = await fileToDataUrl(file);
  const vectorish = /svg|gif/.test(file.type || '') || /^data:image\/svg/.test(raw);
  if (vectorish) {
    // AI endpoints want a bitmap: flatten SVG / first GIF frame through a canvas
    const img = await loadImageEl(raw);
    const width = img.naturalWidth || 1200;
    const height = img.naturalHeight || 1200;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = c.toDataURL('image/png');
    return { dataUrl, mime: 'image/png', width, height, bytes: Math.round((dataUrl.length * 3) / 4), sourceType: file.type, keptSvg: raw };
  }
  const img = await loadImageEl(raw);
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  let dataUrl = raw;
  let mime = file.type || 'image/png';
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  if (scale < 1) {
    width = Math.round(img.naturalWidth * scale);
    height = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, width, height);
    dataUrl = c.toDataURL('image/jpeg', JPEG_QUALITY);
    mime = 'image/jpeg';
  }
  return { dataUrl, mime, width, height, bytes: Math.round((dataUrl.length * 3) / 4) };
}

const ratioLabel = (r) => {
  const known = [
    ['9:16', 9 / 16],
    ['2:3', 2 / 3],
    ['4:5', 4 / 5],
    ['1:1', 1],
    ['3:2', 3 / 2],
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['21:9', 21 / 9],
  ];
  return known.sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
};

const srgbToLin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (r, g, b) => 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
const toHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};

/**
 * @returns {Promise<object>} signals — width/height/ratio, palette with shares,
 * luminance/contrast/saturation, per-region detail energy, calm + hot regions.
 */
export async function measureImage(dataUrl, { out = { width: 0, height: 0 } } = {}) {
  const img = await loadImageEl(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const scale = Math.min(1, 150 / Math.max(W, H));
  const w = Math.max(24, Math.round(W * scale));
  const h = Math.max(24, Math.round(H * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const buckets = new Map();
  const gray = new Float32Array(w * h);
  let sumL = 0;
  let sumS = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 24) continue;
    count++;
    const L = luminance(r, g, b);
    sumL += L;
    sumS += satOf(r, g, b);
    gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    // 3 bits per channel for clustering, then refine with exact averages
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    let cur = buckets.get(key);
    if (!cur) buckets.set(key, (cur = { n: 0, r: 0, g: 0, b: 0 }));
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
  }

  const ranked = [...buckets.values()]
    .map((b) => {
      const r = b.r / b.n;
      const g = b.g / b.n;
      const bl = b.b / b.n;
      return { hex: toHex(r, g, bl), n: b.n, share: b.n / Math.max(1, count), L: luminance(r, g, bl), S: satOf(r, g, bl) };
    })
    .sort((a, b) => b.n - a.n);

  // merge near-duplicates so the palette reads as design decisions, not noise
  const palette = [];
  for (const cand of ranked) {
    const clash = palette.find(
      (p) => Math.abs(p.L - cand.L) < 0.09 && Math.hypot(parseInt(cand.hex.slice(1, 3), 16) - parseInt(p.hex.slice(1, 3), 16), parseInt(cand.hex.slice(3, 5), 16) - parseInt(p.hex.slice(3, 5), 16), parseInt(cand.hex.slice(5, 7), 16) - parseInt(p.hex.slice(5, 7), 16)) < 34
    );
    if (clash) {
      const n = clash.n + cand.n;
      clash.share = n / Math.max(1, count);
      clash.n = n;
      continue;
    }
    if (palette.length < 7) palette.push({ ...cand });
    if (palette.length >= 7) break;
  }
  palette.sort((a, b) => b.share - a.share);

  // contrast: spread of luminance
  let varSum = 0;
  const meanL = sumL / Math.max(1, count);
  const step = 4;
  for (let i = 0; i < data.length; i += 4 * step) {
    if (data[i + 3] < 24) continue;
    const d = luminance(data[i], data[i + 1], data[i + 2]) - meanL;
    varSum += d * d;
  }
  const contrast = Math.min(1, Math.sqrt(varSum / Math.max(1, count / step)) * 2.6);

  // Sobel-ish detail energy, globally and per 3x3 region
  let totalGrad = 0;
  const regions = {};
  const keys = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  for (const k of keys) regions[k] = { energy: 0, light: 0, n: 0 };
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - 1] - gray[i + 1];
      const gy = gray[i - w] - gray[i + w];
      const mag = Math.min(255, Math.hypot(gx, gy));
      totalGrad += mag;
      const col = x < w / 3 ? 0 : x < (2 * w) / 3 ? 1 : 2;
      const row = y < h / 3 ? 0 : y < (2 * h) / 3 ? 1 : 2;
      const reg = regions[keys[row * 3 + col]];
      reg.energy += mag;
      reg.light += gray[i];
      reg.n++;
    }
  }
  const px = Math.max(1, (w - 2) * (h - 2));
  for (const k of keys) {
    const r = regions[k];
    r.energy = Number((r.energy / px / 255).toFixed(3));
    r.light = Number((r.light / Math.max(1, r.n) / 255).toFixed(3));
    delete r.n;
  }
  const edgeDensity = Number((totalGrad / px / 255).toFixed(3));
  const sorted = keys.slice().sort((a, b) => regions[a].energy - regions[b].energy);
  const ratio = W / H;

  return {
    width: W,
    height: H,
    ratio: Number(ratio.toFixed(3)),
    ratioLabel: ratioLabel(ratio),
    luminance: Number(meanL.toFixed(3)),
    contrast: Number(contrast.toFixed(3)),
    saturation: Number((sumS / Math.max(1, count)).toFixed(3)),
    edgeDensity,
    regions,
    calmRegion: sorted[0],
    hotRegion: sorted[sorted.length - 1],
    palette: palette.map((p) => ({ hex: p.hex, share: Number(p.share.toFixed(3)), luminance: Number(p.L.toFixed(3)), saturation: Number(p.S.toFixed(3)) })),
    coverage: Number((count / (w * h)).toFixed(3)),
    typeGuess: edgeDensity > 0.42 ? 'dense, detail-heavy artwork' : edgeDensity > 0.22 ? 'mixed type + image blocks' : 'large flat graphic areas, big type',
    measuredAt: new Date().toISOString(),
  };
}

/** Rasterise the local SVG composer (or any same-origin image) to PNG. */
export async function exportPng(src, filename = 'cover.png', maxEdge = 2400) {
  let img;
  try {
    img = await loadImageEl(src);
  } catch {
    return download(src, filename.replace(/\.png$/i, ''));
  }
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1200, img.naturalHeight || 1200), 3);
  const c = document.createElement('canvas');
  c.width = Math.round((img.naturalWidth || 1200) * scale);
  c.height = Math.round((img.naturalHeight || 1200) * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0e16';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  try {
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw new Error('rasterise failed');
    saveBlob(blob, filename);
    return { width: c.width, height: c.height };
  } catch {
    // tainted canvas or an SVG the browser will not rasterise — hand the file over instead
    return download(src, filename.replace(/\.png$/i, '.svg'));
  }
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function download(src, filename) {
  try {
    const res = await fetch(authedSrc(src), { credentials: 'include' });
    if (!res.ok) throw new Error(String(res.status));
    saveBlob(await res.blob(), filename);
  } catch {
    const a = document.createElement('a');
    a.href = src;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/** Paste-friendly: pull the first image item out of a paste event. */
export function imageFromPaste(e) {
  const items = e.clipboardData?.items;
  if (!items) return null;
  for (const it of items) {
    if (it.type?.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

/** Inline an SVG string as an <img> src (used by the live vector draft). */
export function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace(/\s{2,}/g, ' '))}`;
}
