import { logout } from '@/lib/session';
import { handler, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handler(
  async (req) => {
    await logout(req);
    return json({ ok: true });
  },
  { auth: false }
);
