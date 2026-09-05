/**
 * Admin: provider API keys.
 *
 *   GET  /api/admin/providers          → masked view of every provider
 *   PUT  /api/admin/providers          → { providerId, apiKey?, enabled?, baseUrl?, visionModel?, textModel?, imageModel?, setAsDefault? }
 *   DELETE /api/admin/providers        → { providerId } wipe a key
 *
 * Keys are AES-256-GCM encrypted at rest and never returned in full.
 */
import { readStore, withStore, pushEvent } from '@/lib/store';
import { encryptSecret, maskKey, fingerprint } from '@/lib/crypto';
import { handler, json, readJson, badRequest } from '@/lib/http';
import { looksLikeMaskedKey, normalizeApiKey } from '@/lib/crypto';
import { capabilityReport } from '@/lib/ai';

export const dynamic = 'force-dynamic';

export const GET = handler(
  async (_req, _ctx, user) => {
    const s = readStore();
    return json({
      ok: true,
      defaultProvider: s.settings.defaultProvider,
      allowSelfServeKeys: s.settings.allowSelfServeKeys !== false,
      maxVariations: s.settings.maxVariations,
      refinePrompt: s.settings.refinePrompt !== false,
      providers: Object.entries(s.settings.providers).map(([id, p]) => ({
        id,
        label: p.label,
        enabled: p.enabled !== false,
        baseUrl: p.baseUrl,
        visionModel: p.visionModel,
        textModel: p.textModel,
        imageModel: p.imageModel,
        hasKey: Boolean(p.apiKeyEnc),
        masked: p.masked || (p.apiKeyEnc ? '••••' : ''),
        fingerprint: p.apiKeyEnc ? p.fingerprint || '' : '',
        updatedAt: p.updatedAt || null,
        updatedBy: p.updatedBy || null,
      })),
      capabilities: capabilityReport(s, user),
    });
  },
  { admin: true }
);

function cleanUrl(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) throw badRequest('Base URL http(s):// bilan boshlanishi kerak.');
  return s.replace(/\/+$/, '');
}

function cleanModel(v, fallback) {
  const s = String(v || '').trim();
  if (!s) return fallback;
  if (!/^[\w.\-:/]{2,80}$/.test(s)) throw badRequest(`Model nomi noto’g’ri: ${s.slice(0, 40)}`);
  return s;
}

export const PUT = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 256 * 1024);
  const id = String(body.providerId || '').trim();
  const s0 = readStore();
  if (!s0.settings.providers[id]) throw badRequest(`Provider mavjud emas: ${id}`);

  const now = new Date().toISOString();
  await withStore((s) => {
    const p = s.settings.providers[id];
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
      if (looksLikeMaskedKey(body.apiKey)) {
        throw badRequest('Maskalangan qiymat yuborildi — to’liq kalitni konsoldan nusxalang.');
      }
      const { value: key, error } = normalizeApiKey(body.apiKey);
      if (error) throw badRequest(error);
      if (!key) throw badRequest('API kaliti bo’sh.');
      p.apiKeyEnc = encryptSecret(s.secret, key);
      p.fingerprint = fingerprint(key);
      p.masked = maskKey(key);
      p.updatedAt = now;
      p.updatedBy = user.displayName;
    } else if (body.clearKey) {
      p.apiKeyEnc = '';
      p.fingerprint = '';
      p.masked = '';
      p.updatedAt = now;
      p.updatedBy = user.displayName;
    }
    if (typeof body.enabled === 'boolean') p.enabled = body.enabled;
    if (body.baseUrl !== undefined) p.baseUrl = cleanUrl(body.baseUrl) || p.baseUrl;
    for (const field of ['visionModel', 'textModel', 'imageModel']) {
      if (body[field] !== undefined) p[field] = cleanModel(body[field], p[field]);
    }
    if (body.setAsDefault || body.defaultProvider) s.settings.defaultProvider = id;
    pushEvent(s, { kind: 'provider.updated', actor: user.displayName, providerId: id, hasKey: Boolean(p.apiKeyEnc) });
  });

  if (body.test === true) {
    // best-effort connectivity probe after saving
    try {
      const { testConnection } = await import('@/lib/ai');
      const fresh = readStore().settings.providers[id];
      const { decryptSecret } = await import('@/lib/crypto');
      const test = await testConnection({
        id,
        apiKey: decryptSecret(readStore().secret, fresh.apiKeyEnc),
        baseUrl: fresh.baseUrl,
        models: { visionModel: fresh.visionModel, textModel: fresh.textModel, imageModel: fresh.imageModel },
      });
      return json({ ok: true, providers: null, test });
    } catch (err) {
      return json({ ok: true, test: { ok: false, error: String(err?.message || err) } });
    }
  }
  return json({ ok: true });
}, { admin: true });

export const DELETE = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 64 * 1024).catch(() => ({}));
  const id = String(body.providerId || '').trim();
  await withStore((s) => {
    if (s.settings.providers[id]) {
      s.settings.providers[id].apiKeyEnc = '';
      s.settings.providers[id].fingerprint = '';
      s.settings.providers[id].masked = '';
      s.settings.providers[id].updatedAt = new Date().toISOString();
      s.settings.providers[id].updatedBy = user.displayName;
    }
    pushEvent(s, { kind: 'provider.key-cleared', actor: user.displayName, providerId: id });
  });
  return json({ ok: true });
}, { admin: true });
