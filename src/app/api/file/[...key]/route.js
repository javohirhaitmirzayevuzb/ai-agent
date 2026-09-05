/**
 * GET /api/file/<rel…> — serves reference uploads and generated art.
 * Every path embeds a design id (refs/<designId>/…, out/<designId>/…), and the
 * owning user (or an admin) must match, so nothing leaks between accounts.
 */
import { readFile } from '@/lib/store';
import { readStore } from '@/lib/store';
import { handler } from '@/lib/http';
import { badRequest } from '@/lib/http';

export const dynamic = 'force-dynamic';

function designIdFrom(parts) {
  // refs/<id>/ref.png | out/<id>/<item>.png
  if (parts[0] === 'refs' || parts[0] === 'out') return parts[1] || '';
  return '';
}

export const GET = handler(async (req, ctx, user) => {
  const { key } = await ctx.params;
  const parts = (Array.isArray(key) ? key : [key]).map((p) => decodeURIComponent(String(p)));
  const rel = parts.join('/');
  const id = designIdFrom(parts);
  if (!id) throw badRequest('Not-to’g’ri yo’l.', 404);
  const design = readStore().designs?.[id];
  if (!design) throw badRequest('Design topilmadi.', 404);
  if (design.userId !== user.id && user.role !== 'admin') throw badRequest('Ruxsat yo’q.', 403);

  const { buf, mime } = await readFile(rel);
  return new Response(buf, {
    headers: {
      'content-type': mime,
      'content-length': String(buf.length),
      'cache-control': 'private, max-age=31536000, immutable',
      etag: `"${buf.length.toString(36)}-${buf.subarray(0, 64).length.toString(36)}"`,
    },
  });
});
