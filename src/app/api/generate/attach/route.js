/**
 * POST /api/generate/attach — store pixels a client fetched from the image model.
 *
 * The counterpart of /api/generate/prompts: the browser did the model call, this route decides
 * whether those bytes may land in the user's history. Same ownership, mime and size rules as the
 * server lane, and the same item shape, so nothing downstream can tell the two apart.
 */
import { readStore, withStore, uid, saveFile, upsertDesign, pushEvent } from '@/lib/store';
import { formatSpec } from '@/lib/prompts';
import { safeImagePayload } from '@/lib/generateCore';
import { handler, json, readJson, badRequest, sanitizeText } from '@/lib/http';

export const dynamic = 'force-dynamic';

const extFor = (mime) => (mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png');

export const POST = handler(async (req, _ctx, user) => {
  const t0 = Date.now();
  const body = await readJson(req, 12 * 1024 * 1024);
  const designId = String(body.designId || '').trim();
  if (!designId) throw badRequest('designId kerak.');
  const store0 = readStore();
  const design = store0.designs[designId];
  if (!design || design.userId !== user.id) throw badRequest('Design topilmadi.', 404);

  const rawItems = Array.isArray(body.items) ? body.items.slice(0, 4) : [];
  if (!rawItems.length) throw badRequest('Saqlanadigan rasm yo‘q.');

  const format = typeof body.format === 'string' && body.format.length < 24 ? body.format : design.brief?.format || 'post-1x1';
  const label = formatSpec(format).label;
  const provider = sanitizeText(body.provider || 'gemini', 20) || 'gemini';
  const model = sanitizeText(body.model || '', 80);

  const items = [];
  for (const r of rawItems) {
    const { mime, base64, bytes } = safeImagePayload(r);
    const itemId = uid('it_');
    const rel = `out/${designId}/${itemId}.${extFor(mime)}`;
    await saveFile(rel, Buffer.from(base64, 'base64'), mime);
    const variation = Number(r.variation);
    items.push({
      id: itemId,
      file: rel,
      url: `/api/file/${rel}`,
      // 'ai' + a real provider/model: the studio attributes every tile, and a browser-run image
      // was produced by the model just the same as a server-run one
      mode: 'ai',
      provider,
      model,
      prompt: sanitizeText(r.prompt, 4000),
      variation: Number.isFinite(variation) ? variation : items.length,
      bytes,
      mime,
      via: 'browser',
      createdAt: new Date().toISOString(),
      label: `${label} · v${(Number.isFinite(variation) ? variation : items.length) + 1}`,
    });
  }

  await withStore(async (s) => {
    const d = s.designs[designId];
    if (!d) return;
    await upsertDesign(s, {
      ...d,
      status: 'done',
      items: [...items, ...(d.items || [])].slice(0, 24),
      runs: [...(d.runs || []), { at: new Date().toISOString(), mode: 'image-model', count: items.length, ms: Date.now() - t0, provider, via: 'browser', errors: [] }].slice(-12),
    });
    const u = s.users[user.id];
    if (u) {
      u.stats = { ...(u.stats || { designs: 0, generations: 0, favorites: 0 }), generations: (u.stats?.generations || 0) + items.length };
    }
    pushEvent(s, { kind: 'design.generated', userId: user.id, actor: user.displayName, designId, mode: 'image-model', count: items.length, via: 'browser' });
  });

  return json({ ok: true, designId, items, item: items[0], ms: Date.now() - t0 });
});
