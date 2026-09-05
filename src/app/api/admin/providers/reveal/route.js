/**
 * POST /api/admin/providers/reveal — hand one key back to the admin who owns it.
 *
 * This is the one deliberate exception to "keys are never returned in full". It exists because the
 * browser lane needs a key in the tab, and asking a human to retype 53 characters is how wrong keys
 * get pasted and "the API is broken" gets concluded. So the admin can copy it across in one click.
 * The guardrails that make that acceptable: admin-only, POST with an explicit confirm flag (never a
 * GET a prefetch could trigger), no-store on the way out, the reveal itself is logged, and nothing
 * about the key value is written to the activity log.
 */
import { readStore, withStore, pushEvent } from '@/lib/store';
import { decryptSecret, maskKey, fingerprint } from '@/lib/crypto';
import { handler, json, readJson, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handler(
  async (req, _ctx, user) => {
    const body = await readJson(req, 4096);
    const id = String(body.providerId || '').trim();
    if (body.confirm !== true) throw badRequest('Aniq tasdiq kerak: { confirm: true }.');
    const s = readStore();
    const p = s.settings.providers[id];
    if (!p) throw badRequest('Provider mavjud emas.');
    if (!p.apiKeyEnc) return noStore(json({ ok: true, apiKey: '', masked: '', note: 'Bu provider uchun saqlangan kalit yo‘q.' }));
    const apiKey = decryptSecret(s.secret, p.apiKeyEnc);
    if (!apiKey) throw badRequest('Kalitni ochib bo‘lmadi — store kaliti o‘zgargan bo‘lishi mumkin. Qayta saqlang.');
    await withStore((st) => {
      pushEvent(st, { kind: 'provider.key-revealed', providerId: id, actor: user?.displayName || 'admin' });
    });
    return noStore(json({ ok: true, apiKey, masked: maskKey(apiKey), fingerprint: fingerprint(apiKey) }));
  },
  { admin: true }
);

/** a response that must not be cached by a proxy, a browser, or anything in between */
function noStore(res) {
  res.headers.set('cache-control', 'no-store, no-transform, max-age=0');
  res.headers.set('pragma', 'no-cache');
  return res;
}
