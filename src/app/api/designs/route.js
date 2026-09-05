/**
 * /api/designs — the user's studio history ("my profile" gallery).
 *   GET    ?limit=24          → my designs, newest first
 *   PATCH  {id, title?, favoriteItemId?, profileRef?}
 *   DELETE {id}               → remove design + its files
 */
import fs from 'node:fs';
import path from 'node:path';
import { readStore, withStore, deleteFile, upsertDesign, pushEvent, FILES_DIR } from '@/lib/store';
import { handler, json, readJson, badRequest, sanitizeText } from '@/lib/http';
import { formatSpec } from '@/lib/prompts';

export const dynamic = 'force-dynamic';

function shape(d, { full = false } = {}) {
  const items = (d.items || []).map((i) => ({
    id: i.id,
    url: i.url || (i.file ? `/api/file/${i.file}` : ''),
    mode: i.mode,
    provider: i.provider,
    model: i.model,
    label: i.label,
    variation: i.variation,
    mime: i.mime,
    createdAt: i.createdAt,
    favorite: Boolean(d.favoriteItemId === i.id),
    prompt: full ? i.prompt : undefined,
  }));
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    format: d.brief?.format || 'post-1x1',
    formatLabel: formatSpec(d.brief?.format).label,
    refUrl: d.reference?.file ? `/api/file/${d.reference.file}` : '',
    palette: (d.analysis?.palette || []).slice(0, 6).map((p) => p.hex),
    archetype: d.analysis?.layout?.archetype || '',
    styleTags: (d.analysis?.styleTags || []).slice(0, 6),
    companyName: d.analysis?.companyName || d.brief?.companyName || '',
    brief: full ? d.brief : undefined,
    analysis: full ? d.analysis : undefined,
    direction: full ? d.direction : undefined,
    runs: d.runs || [],
    favoriteItemId: d.favoriteItemId || '',
    items,
    counts: { ai: items.filter((i) => i.mode === 'ai').length, local: items.filter((i) => i.mode === 'local').length },
  };
}

export const GET = handler(async (req, _ctx, user) => {
  const url = new URL(req.url);
  const limit = Math.min(60, Math.max(1, Number(url.searchParams.get('limit')) || 24));
  const q = (url.searchParams.get('q') || '').toLowerCase();
  const s = readStore();
  let list = Object.values(s.designs || {}).filter((d) => d.userId === user.id || user.role === 'admin');
  if (q)
    list = list.filter((d) =>
      [d.title, d.brief?.companyName, d.analysis?.companyName, ...(d.analysis?.styleTags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  list.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
  const id = url.searchParams.get('id');
  if (id) {
    const one = list.find((d) => d.id === id);
    if (!one) throw badRequest('Topilmadi.', 404);
    return json({ ok: true, design: shape(one, { full: true }) });
  }
  return json({ ok: true, designs: list.slice(0, limit).map((d) => shape(d)) });
});

export const PATCH = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 128 * 1024);
  const id = String(body.id || '').trim();
  let out = null;
  await withStore(async (s) => {
    const d = s.designs[id];
    if (!d) throw badRequest('Design topilmadi.', 404);
    if (d.userId !== user.id && user.role !== 'admin') throw badRequest('Ruxsat yo’q.', 403);
    const patch = { id, userId: d.userId };
    if (body.title !== undefined) patch.title = sanitizeText(body.title, 60);
    if (body.favoriteItemId !== undefined) patch.favoriteItemId = d.favoriteItemId === body.favoriteItemId ? '' : String(body.favoriteItemId).slice(0, 40);
    if (body.status) patch.status = sanitizeText(body.status, 16);
    if (body.analysis) patch.analysis = { ...(d.analysis || {}), ...body.analysis };
    if (body.brief) patch.brief = { ...(d.brief || {}), ...body.brief };
    await upsertDesign(s, patch);
    if (body.saveToProfile && body.favoriteItemId) {
      const item = (d.items || []).find((i) => i.id === body.favoriteItemId);
      const u = s.users[user.id];
      if (u && item?.file) {
        u.profile = u.profile || {};
        u.profile.references = [
          { id: `ref_${Date.now().toString(36)}`, label: d.title || 'Saqlangan', file: item.file, note: `design:${d.id}` },
          ...(u.profile.references || []).filter((r) => r.file !== item.file),
        ].slice(0, 12);
      }
    }
    out = shape(s.designs[id]);
  });
  return json({ ok: true, design: out });
});

export const DELETE = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 64 * 1024);
  const id = String(body.id || '').trim();
  await withStore(async (s) => {
    const d = s.designs[id];
    if (!d) throw badRequest('Design topilmadi.', 404);
    if (d.userId !== user.id && user.role !== 'admin') throw badRequest('Ruxsat yo’q.', 403);
    const files = [d.reference?.file, ...(d.items || []).map((i) => i.file)].filter(Boolean);
    for (const f of files) await deleteFile(f).catch(() => {});
    try {
      await fs.promises.rm(path.join(FILES_DIR, 'refs', id), { recursive: true, force: true });
      await fs.promises.rm(path.join(FILES_DIR, 'out', id), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete s.designs[id];
    if (d.userId === user.id) {
      const u = s.users[user.id];
      if (u) u.stats = { ...(u.stats || {}), designs: Math.max(0, (u.stats?.designs || 1) - 1) };
    }
    pushEvent(s, { kind: 'design.deleted', actor: user.displayName, designId: id });
  });
  return json({ ok: true });
});
