/**
 * /api/profile — the creator's own profile / brand kit: company, tagline, niche,
 * audience, tone, brand colours. Everything the generator prefills from.
 */
import { readStore, withStore, uid, pushEvent } from '@/lib/store';
import { publicUser, defaultProfile, badRequest } from '@/lib/session';
import { handler, json, readJson } from '@/lib/http';
import { formatSpec } from '@/lib/prompts';

export const dynamic = 'force-dynamic';

const FIELDS = ['company', 'tagline', 'niche', 'audience', 'tone', 'handles', 'website', 'defaultFormat', 'defaultVariations'];

function cleanHex(v) {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

export const PUT = handler(async (req, _ctx, user) => {
  const body = await readJson(req, 128 * 1024);
  await withStore((s) => {
    const u = s.users[user.id];
    if (!u) throw badRequest('Profil topilmadi.', 404);
    const profile = { ...(u.profile || defaultProfile()) };
    for (const f of FIELDS) {
      if (body[f] !== undefined) profile[f] = String(body[f] ?? '').slice(0, 240).trim();
    }
    if (Array.isArray(body.brandColors)) profile.brandColors = body.brandColors.map(cleanHex).filter(Boolean).slice(0, 8);
    if (body.brandColors === undefined && Array.isArray(body.palette)) profile.brandColors = body.palette.map(cleanHex).filter(Boolean).slice(0, 8);
    if (body.avatarHue !== undefined) profile.avatarHue = Math.abs(Number(body.avatarHue) || 0) % 360;
    if (Array.isArray(body.references)) {
      profile.references = body.references
        .slice(0, 12)
        .map((r) => ({ id: r.id || uid('ref_'), label: String(r.label || '').slice(0, 80), file: String(r.file || '').slice(0, 160), note: String(r.note || '').slice(0, 200) }))
        .filter((r) => r.file);
    }
    u.profile = profile;
    pushEvent(s, { kind: 'profile.updated', actor: user.displayName, fields: Object.keys(body) });
  });
  return json({ ok: true, profile: readStore().users[user.id].profile, user: publicUser(readStore().users[user.id]) });
});

export const GET = handler(async (_req, _ctx, user) => {
  const u = readStore().users[user.id];
  return json({ ok: true, profile: u?.profile || defaultProfile() });
});
