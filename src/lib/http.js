/**
 * Small HTTP helpers shared by every route handler: uniform JSON errors,
 * body size caps, data-URL parsing, and auth-wrapped handlers.
 */
import { currentUser, badRequest } from './session.js';

export { badRequest };

export const MAX_BODY_BYTES = 16 * 1024 * 1024; // 16MB — room for 4K reference designs
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function json(data, init = {}) {
  return Response.json(data, {
    ...init,
    headers: { 'cache-control': 'no-store', ...(init.headers || {}) },
  });
}

export function fail(err) {
  const status = err?.status || err?.statusCode || 500;
  if (status >= 500) console.error('[api]', err);
  return Response.json(
    { ok: false, error: err?.message || 'Nimadir xato ketdi', detail: status >= 500 ? String(err?.cause?.message || '') : undefined },
    { status, headers: { 'cache-control': 'no-store' } }
  );
}

/** Wraps an async handler with session auth (+ optional admin gate). */
export function handler(fn, { auth = true, admin = false } = {}) {
  return async (req, ctx) => {
    try {
      const user = await currentUser(req);
      if (auth && !user) throw badRequest('Sessiya topilmadi. Qaytadan kiring.', 401);
      if (admin && user?.role !== 'admin') throw badRequest('Faqat admin.', 403);
      const res = await fn(req, ctx ?? {}, user);
      if (req.__studioAuth && res?.headers) res.headers.set('x-studio-auth', req.__studioAuth);
      return res;
    } catch (err) {
      return fail(err);
    }
  };
}

export async function readJson(req, limit = MAX_BODY_BYTES) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > limit) throw badRequest(`Javob hajmi juda katta (max ${Math.round(limit / 1024 / 1024)}MB).`, 413);
  let body;
  try {
    body = await req.json();
  } catch {
    throw badRequest('JSON o’qib bo’lmadi.');
  }
  if (!body || typeof body !== 'object') throw badRequest('JSON kutilmoqda.');
  return body;
}

const DATA_URL_RE = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;

/** Accepts "data:image/png;base64,...", raw base64, or a http(s) URL. */
export function parseImage(value, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest('Rasm topilmadi.');
  const v = value.trim();
  if (v.startsWith('data:')) {
    const m = DATA_URL_RE.exec(v);
    if (!m) throw badRequest('Faqat PNG / JPG / WEBP / GIF qabul qilinadi.');
    const buf = Buffer.from(m[3].replace(/\s/g, ''), 'base64');
    if (buf.length > maxBytes) throw badRequest(`Rasm hajmi ${(buf.length / 1024 / 1024).toFixed(1)}MB — juda katta.`, 413);
    return { buf, mime: m[1], dataUrl: `data:${m[1]};base64,${buf.toString('base64')}`, bytes: buf.length };
  }
  throw badRequest('Rasm data-URL ko’rinishida bo’lishi kerak.');
}

export async function fetchBuffer(url, { maxBytes = MAX_IMAGE_BYTES, timeout = 25000 } = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
    headers: { 'user-agent': 'ai-agent-studio/1.0', accept: 'image/*' },
  });
  if (!res.ok) throw badRequest(`Rasmni yuklab bo’lmadi (HTTP ${res.status}).`, 400);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw badRequest('Rasm juda katta.', 413);
  const mime = (res.headers.get('content-type') || 'image/png').split(';')[0];
  return { buf, mime, dataUrl: `data:${mime};base64,${buf.toString('base64')}`, bytes: buf.length };
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n) || lo));
}

export function sanitizeText(v, max = 4000) {
  return String(v ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max);
}
