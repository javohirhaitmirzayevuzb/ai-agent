import { readStore, withStore, pushEvent } from '@/lib/store';
import { publicUser } from '@/lib/session';
import { handler, json, readJson, badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handler(
  async (req) => {
    const s = readStore();
    const q = (req.nextUrl?.searchParams || new URL(req.url).searchParams).get('q') || '';
    const designsBy = {};
    for (const d of Object.values(s.designs || {})) {
      designsBy[d.userId] = (designsBy[d.userId] || 0) + 1;
    }
    const users = Object.values(s.users || {})
      .map((u) => ({
        ...publicUser(u),
        designs: designsBy[u.id] || 0,
        ownKeyProviders: Object.keys(u.keys || {}),
      }))
      .filter((u) => !q || u.displayName.toLowerCase().includes(String(q).toLowerCase()))
      .sort((a, b) => String(b.lastLoginAt || '').localeCompare(String(a.lastLoginAt || '')));
    return json({
      ok: true,
      users,
      totals: {
        users: users.length,
        admins: users.filter((u) => u.isAdmin).length,
        designs: Object.keys(s.designs || {}).length,
        generations: users.reduce((n, u) => n + (u.stats?.generations || 0), 0),
      },
    });
  },
  { admin: true }
);

/** PATCH — role/profile notes for a user (e.g. grant admin, reset stats). */
export const PATCH = handler(async (req, _ctx, admin) => {
  const body = await readJson(req, 64 * 1024);
  const id = String(body.userId || '').trim();
  if (!id) throw badRequest('userId kerak.');
  let found = null;
  await withStore((s) => {
    const u = s.users[id];
    if (!u) throw badRequest('Foydalanuvchi topilmadi.', 404);
    if (typeof body.role === 'string') u.role = body.role === 'admin' ? 'admin' : 'user';
    if (body.profile && typeof body.profile === 'object') u.profile = { ...u.profile, ...body.profile };
    found = publicUser(u);
    pushEvent(s, { kind: 'user.updated', actor: admin.displayName, target: id, fields: Object.keys(body) });
  });
  return json({ ok: true, user: found });
}, { admin: true });
