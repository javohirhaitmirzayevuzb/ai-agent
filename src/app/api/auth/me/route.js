import { currentUser, defaultProfile } from '@/lib/session';
import { readStore } from '@/lib/store';
import { capabilityReport } from '@/lib/ai';
import { handler, json } from '@/lib/http';

export const dynamic = 'force-dynamic';

export const GET = handler(
  async () => {
    const user = await currentUser();
    if (!user) return json({ ok: true, user: null });
    const store = readStore();
    return json({
      ok: true,
      user,
      capabilities: capabilityReport(store, user),
      profile: user.profile || defaultProfile(),
      app: { name: store.settings.appName, maxVariations: store.settings.maxVariations },
    });
  },
  { auth: false }
);
