import { readStore, withStore, pushEvent } from '@/lib/store';
import { handler, json, readJson, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const PUT = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 64 * 1024);
  await withStore((s) => {
    if (body.defaultProvider !== undefined) {
      if (!s.settings.providers[body.defaultProvider]) throw badRequest('Provider mavjud emas.');
      s.settings.defaultProvider = body.defaultProvider;
    }
    if (typeof body.allowSelfServeKeys === 'boolean') s.settings.allowSelfServeKeys = body.allowSelfServeKeys;
    if (typeof body.refinePrompt === 'boolean') s.settings.refinePrompt = body.refinePrompt;
    if (body.maxVariations !== undefined) s.settings.maxVariations = Math.min(4, Math.max(1, Number(body.maxVariations) || 2));
    if (typeof body.appName === 'string' && body.appName.trim()) s.settings.appName = body.appName.trim().slice(0, 40);
    pushEvent(s, { kind: 'settings.updated', actor: user.displayName, patch: Object.keys(body) });
  });
  const s = readStore();
  return json({
    ok: true,
    settings: {
      defaultProvider: s.settings.defaultProvider,
      allowSelfServeKeys: s.settings.allowSelfServeKeys !== false,
      refinePrompt: s.settings.refinePrompt !== false,
      maxVariations: s.settings.maxVariations,
      appName: s.settings.appName,
    },
  });
}, { admin: true });
