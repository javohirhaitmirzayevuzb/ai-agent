import { login } from '@/lib/session';
import { readStore, withStore, pushEvent } from '@/lib/store';
import { capabilityReport } from '@/lib/ai';
import { handler, json, readJson } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login — name + surname only, no password. */
export const POST = handler(
  async (req) => {
    const body = await readJson(req, 64 * 1024);
    const { created, user } = await login({ firstName: body.firstName ?? body.name, lastName: body.lastName ?? body.surname });
    await withStore((s) => {
      pushEvent(s, { kind: created ? 'user.created' : 'user.login', userId: user.id, actor: user.displayName, role: user.role });
      if (s.users[user.id]) delete s.users[user.id].firstLogin;
    });
    return json({ ok: true, user, capabilities: capabilityReport(readStore(), user) });
  },
  { auth: false }
);
