/**
 * Name + surname login and signed-session cookies.
 *
 * There is no password by design: identity in this app is "Javohir Ali".
 * We normalise the pair into a slug, and mint an HMAC-signed cookie that
 * carries the user id + an expiry. Tampering invalidates the session.
 */
import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { readStore, withStore, slugName } from './store.js';

export const COOKIE = 'studio_session';
/** embedded contexts that still allow third-party cookies */
export const COOKIE_TLS = 'studio_session_tls';
/** embedded contexts with third-party cookies blocked (CHIPS partition jar) */
export const COOKIE_CHIP = 'studio_session_chip';
/** read priority: the most-restrictive-first, all carry the same token */
export const COOKIE_NAMES = [COOKIE_CHIP, COOKIE_TLS, COOKIE];
/** header the client also sends, so a hostile cookie policy is never a lockout */
export const SESSION_HEADER = 'x-studio-session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** The admin identity — name "javohir" + surname "ali" unlocks /admin. */
export const ADMIN_FIRST = 'javohir';
export const ADMIN_LAST = 'ali';

export function isAdminName(firstName, lastName) {
  // exact match after trim + casefold + accent strip: "Javohir"/"Ali" yes, "Ali2" no
  const norm = (v) =>
    String(v || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  return norm(firstName) === ADMIN_FIRST && norm(lastName) === ADMIN_LAST;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(secret, payloadB64) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function mintToken(secret, payload) {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = sign(secret, body);
  const a = Buffer.from(sig || '', 'utf8');
  const b = Buffer.from(expect, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.uid || !payload?.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Create/refresh the user row for a name + surname pair. Returns the public user. */
export async function login({ firstName, lastName }) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (first.length < 2 || last.length < 2) {
    throw badRequest('Ikkala maydonni ham to’ldiring (name + surname).');
  }
  const NAME_RE = /^[\p{L}\p{M}0-9'’\-. ]{2,40}$/u;
  if (!NAME_RE.test(first) || !NAME_RE.test(last)) {
    throw badRequest('Faqsat harf, raqam, tire va apostrof ishlatishing (2-40).');
  }

  const slug = slugName(first, last);
  let created = false;
  const store = readStore();
  if (!store.users[slug]) created = true;

  await withStore((s) => {
    const now = new Date().toISOString();
    const prev = s.users[slug] || null;
    // the name is what they typed just now, so it normally wins — but a hurried
    // lowercase re-login must not downgrade a name the user capitalised before
    const nicer = (prevVal, nextVal) => {
      if (!prevVal) return nextVal;
      const hadCaps = /[\p{Lu}]/u.test(prevVal);
      const hasCaps = /[\p{Lu}]/u.test(nextVal);
      return hasCaps || !hadCaps ? nextVal : prevVal;
    };
    const firstName = nicer(prev?.firstName, first);
    const lastName = nicer(prev?.lastName, last);
    s.users[slug] = {
      id: slug,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      role: isAdminName(first, last) ? 'admin' : 'user',
      createdAt: prev?.createdAt || now,
      lastLoginAt: now,
      logins: (prev?.logins || 0) + 1,
      // rotated on logout so a token the client mirrored somewhere dies with the session
      sessionNonce: prev?.sessionNonce || crypto.randomUUID(),
      // never overwrite profile/keys on re-login
      profile: prev?.profile || defaultProfile(),
      keys: prev?.keys || {},
      stats: prev?.stats || { designs: 0, generations: 0, favorites: 0 },
    };
    if (!prev) {
      s.users[slug].firstLogin = true;
    }
  });

  const token = mintToken(readStore().secret, {
    uid: slug,
    exp: Date.now() + SESSION_TTL_MS,
    nonce: readStore().users[slug].sessionNonce,
  });
  const jar = await cookies();
  for (const f of sessionCookieFlavours()) {
    const { name, ...attrs } = f;
    jar.set(name, token, attrs);
  }

  // the token is also returned so the client can replay it in a header when its
  // cookie jar is unavailable (sandboxed iframe, aggressive tracker blocking)
  return { created, user: publicUser(readStore().users[slug]), token };
}

export function defaultProfile() {
  return {
    company: '',
    tagline: '',
    niche: '',
    audience: '',
    tone: '',
    brandColors: [],
    avatarHue: 210,
  };
}

/**
 * Every cookie flavour the session could legally live in, written in one response.
 *
 * This app gets embedded (preview iframe, dashboard) and also opened directly, and
 * each context accepts a different cookie:
 *   · top-level / plain http dev      → SameSite=Lax works, SameSite=None needs Secure
 *   · cross-site iframe               → Lax is dropped, None+Secure is required
 *   · cross-site iframe, 3PC blocked  → only Partitioned (CHIPS) survives
 *   · Partitioned outside an embed    → REJECTED outright (this is what bit us first)
 * Rather than sniff headers and guess the context (a proxy hides it, and a wrong guess
 * means "login works but every API call is 401"), we set all three under three names and
 * the browser keeps whichever its context allows. A flavour it cannot use is silently
 * ignored, so this is safe in every case. `currentUser()` accepts any of them.
 *
 * Overrides for self-hosters: COOKIE_SAMESITE=none|lax|strict pins one flavour,
 * INSECURE_COOKIE=1 sends only the lax one (plain http, no Secure).
 */
export function sessionCookieFlavours() {
  const base = { httpOnly: true, path: '/' };
  const forced = String(process.env.COOKIE_SAMESITE || '').toLowerCase();
  if (forced === 'lax' || forced === 'strict' || forced === 'none') {
    const secure = forced === 'none';
    return [{ name: COOKIE, ...base, sameSite: forced, secure, maxAge: SESSION_TTL_MS / 1000 }];
  }
  if (process.env.INSECURE_COOKIE === '1') {
    return [{ name: COOKIE, ...base, sameSite: 'lax', secure: false, maxAge: SESSION_TTL_MS / 1000 }];
  }
  return [
    { name: COOKIE, ...base, sameSite: 'lax', secure: false, maxAge: SESSION_TTL_MS / 1000 },
    { name: COOKIE_TLS, ...base, sameSite: 'none', secure: true, maxAge: SESSION_TTL_MS / 1000 },
    { name: COOKIE_CHIP, ...base, sameSite: 'none', secure: true, partitioned: true, maxAge: SESSION_TTL_MS / 1000 },
  ];
}

/** Same flavours, emptied — must match attribute-wise or the live cookie survives. */
export function sessionCookieClears() {
  return sessionCookieFlavours().map((f) => ({ ...f, maxAge: 0, expires: new Date(0) }));
}

export async function logout(req) {
  const s = await readSession(req);
  if (s) await withStore((st) => { if (st.users[s.uid]) st.users[s.uid].sessionNonce = crypto.randomUUID(); });
  const jar = await cookies();
  for (const f of sessionCookieClears()) {
    const { name, ...attrs } = f;
    jar.set(name, '', attrs);
  }
}

/** Resolve the caller from the cookie jar or the bearer header. Returns { uid, user }. */
export async function readSession(req) {
  let token = '';
  let via = '';
  try {
    const jar = await cookies();
    for (const name of COOKIE_NAMES) {
      const v = jar.get(name)?.value;
      if (v) {
        token = v;
        via = 'cookie';
        break;
      }
    }
  } catch {
    /* no cookie store (static render) */
  }
  if (!token) {
    // Header auth is CSRF-immune by construction (a foreign page cannot read ours), and
    // this app has no password — the signed token is the whole credential either way.
    token = String(req?.headers?.get?.(SESSION_HEADER) || '');
    via = 'header';
  }
  if (!token && String(req?.method || 'GET').toUpperCase() === 'GET') {
    // <img>/<a> cannot add headers, so GET-only media routes may carry it in the query.
    // Never accepted for writes, which keeps CSRF out of the picture.
    try {
      token = new URL(req.url, 'http://x').searchParams.get('sid') || '';
      via = 'query';
    } catch {
      /* not a fetch Request */
    }
  }
  if (!token) return null;
  const store = readStore();
  const payload = verifyToken(store.secret, token);
  if (!payload) return null;
  const u = store.users[payload.uid];
  if (!u) return null;
  // signed but signed out: the mirrored token must not outlive the session
  if (payload.nonce && u.sessionNonce && payload.nonce !== u.sessionNonce) return null;
  return { uid: payload.uid, token, user: u, via };
}

/** Which credential the caller ended up using — surfaced as `x-studio-auth`. */
export const AUTH_HEADER = 'x-studio-auth';

/** Current session user (public shape) or null. */
export async function currentUser(req) {
  const s = await readSession(req);
  if (s) req && (req.__studioAuth = s.via);
  return s ? publicUser(s.user) : null;
}

export function publicUser(u) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    displayName: u.displayName,
    role: u.role,
    isAdmin: u.role === 'admin',
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    logins: u.logins || 0,
    profile: u.profile || defaultProfile(),
    stats: u.stats || { designs: 0, generations: 0, favorites: 0 },
    // self-serve keys are returned masked
    keys: Object.fromEntries(
      Object.entries(u.keys || {}).map(([k, v]) => [
        k,
        { hasKey: Boolean(v?.apiKeyEnc), fingerprint: v?.fingerprint || '', providerId: k },
      ])
    ),
  };
}

export function badRequest(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}
