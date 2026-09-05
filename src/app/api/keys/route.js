/**
 * /api/keys — self-serve keys.
 * A user may bring their own provider key (stored per profile, encrypted, and
 * preferred over the workspace key). The admin can disable this entirely.
 */
import { readStore, withStore, pushEvent } from '@/lib/store';
import { encryptSecret, maskKey, fingerprint, looksLikeAKey, normalizeApiKey } from '@/lib/crypto';
import { publicUser } from '@/lib/session';
import { capabilityReport } from '@/lib/ai';
import { handler, json, readJson, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req, _ctx, user) => {
  const s0 = readStore();
  if (s0.settings.allowSelfServeKeys === false) throw badRequest('Admin shaxsiy kalitlarni o’chirgan.', 403);
  const body = await readJson(req, 64 * 1024);
  const id = String(body.providerId || '').trim();
  if (!s0.settings.providers[id]) throw badRequest('Provider mavjud emas.');
  const { value: key, error } = normalizeApiKey(body.apiKey);
  if (!key) throw badRequest('To’liq kalit kiriting.');
  if (error) throw badRequest(error);
  await withStore((s) => {
    const u = s.users[user.id];
    u.keys = u.keys || {};
    u.keys[id] = {
      apiKeyEnc: encryptSecret(s.secret, key),
      masked: maskKey(key),
      fingerprint: fingerprint(key),
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim().replace(/\/+$/, '') : '',
      visionModel: typeof body.visionModel === 'string' ? body.visionModel.trim() : '',
      textModel: typeof body.textModel === 'string' ? body.textModel.trim() : '',
      imageModel: typeof body.imageModel === 'string' ? body.imageModel.trim() : '',
      updatedAt: new Date().toISOString(),
    };
    pushEvent(s, { kind: 'user.key-set', actor: user.displayName, providerId: id, scope: 'own' });
  });
  const store = readStore();
  return json({ ok: true, user: publicUser(store.users[user.id]), capabilities: capabilityReport(store, user) });
});

export const DELETE = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 64 * 1024).catch(() => ({}));
  const id = String(body.providerId || '').trim();
  await withStore((s) => {
    const u = s.users[user.id];
    if (u?.keys && id) {
      delete u.keys[id];
      pushEvent(s, { kind: 'user.key-removed', actor: user.displayName, providerId: id });
    }
  });
  const store = readStore();
  return json({ ok: true, user: publicUser(store.users[user.id]), capabilities: capabilityReport(store, user) });
});
