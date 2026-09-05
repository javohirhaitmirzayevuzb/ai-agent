import { logout } from '@/lib/session';
import { handler, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const POST = handler(
  async () => {
    await logout();
    return json({ ok: true });
  },
  { auth: false }
);
