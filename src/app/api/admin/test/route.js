/**
 * POST /api/admin/test — "does this key actually work?"
 * Body: { providerId } (test the saved key) or { providerId, apiKey, baseUrl, models } (dry-run a key before saving).
 */
import { readStore } from '@/lib/store';
import { decryptSecret } from '@/lib/crypto';
import { testConnection, AiError } from '@/lib/ai';
import { handler, json, readJson, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handler(async (req) => {
  const body = await readJson(req, 64 * 1024);
  const id = String(body.providerId || '').trim();
  const s = readStore();
  const saved = s.settings.providers[id];
  if (!saved) throw badRequest('Provider mavjud emas.');

  const apiKey = (typeof body.apiKey === 'string' && body.apiKey.trim().length > 11 ? body.apiKey.trim() : null) || decryptSecret(s.secret, saved.apiKeyEnc);
  if (!apiKey) return json({ ok: false, error: 'Kalit bo’sh — avval saqlang.' });

  const models = {
    visionModel: body.visionModel || saved.visionModel,
    textModel: body.textModel || saved.textModel,
    imageModel: body.imageModel || saved.imageModel,
  };
  const baseUrl = body.baseUrl || saved.baseUrl;
  try {
    const test = await testConnection({ id, apiKey, baseUrl, models });
    return json({ ok: true, test });
  } catch (err) {
    return json({ ok: false, error: String(err?.message || err), detail: err instanceof AiError ? err.detail : undefined });
  }
}, { admin: true });
