import { readStore } from '@/lib/store';
import { handler, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handler(
  async (req) => {
    const s = readStore();
    const url = new URL(req.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 60));
    return json({ ok: true, events: (s.events || []).slice(0, limit) });
  },
  { admin: true }
);
