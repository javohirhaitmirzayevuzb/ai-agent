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
      // never overwrite profile/keys on re-login
      profile: prev?.profile || defaultProfile(),
      keys: prev?.keys || {},
      stats: prev?.stats || { designs: 0, generations: 0, favorites: 0 },
    };
    if (!prev) {
      s.users[slug].firstLogin = true;
    }
  });

  const token = mintToken(store.secret, { uid: slug, exp: Date.now() + SESSION_TTL_MS });
  const jar = await cookies();
  jar.set(COOKIE, token, { ...(await sessionCookieAttrs()), maxAge: SESSION_TTL_MS / 1000 });

  return { created, user: publicUser(readStore().users[slug]) };
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
 * Cookie attributes for the session.
 *
 * This app gets embedded (preview iframe, dashboard) where the document origin
 * differs from ours. Browsers silently refuse to *store* a cookie that is not
 * `SameSite=None; Secure` in that context — the classic symptom being "login
 * returned 200 but every API call says session not found". So: any TLS-ish
 * context → None + Secure + Partitioned (CHIPS); plain http on localhost → Lax.
 * `INSECURE_COOKIE=1` forces the lax form for plain-http self-hosting.
 */
export async function sessionCookieAttrs() {
  const req = { proto: '', host: '', referer: '', origin: '' };
  try {
    const h = await headers();
    req.proto = String(h.get('x-forwarded-proto') || h.get('forwarded') || '').toLowerCase();
    req.host = String(h.get('host') || '').toLowerCase();
    req.referer = String(h.get('referer') || '').toLowerCase();
    req.origin = String(h.get('origin') || '').toLowerCase();
  } catch {
    /* called outside a request (tests) */
  }

  // explicit escape hatches win, so a surprising proxy is never a lockout
  const forced = String(process.env.COOKIE_SAMESITE || '').toLowerCase();
  if (forced === 'lax' || forced === 'strict' || forced === 'none') {
    const secure = forced === 'none';
    return { httpOnly: true, path: '/', sameSite: forced, secure, ...(secure ? { partitioned: true } : {}) };
  }
  if (process.env.INSECURE_COOKIE === '1') {
    return { httpOnly: true, path: '/', sameSite: 'lax', secure: false };
  }

  const localhost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.host);
  const fromHttp = /^http:\/\/(localhost|127\.0\.0\.1)/.test(req.referer) || /^http:\/\/(localhost|127\.0\.0\.1)/.test(req.origin);
  const fromHttpsPage = req.referer.startsWith('https://') || req.origin.startsWith('https://');
  // the preview proxy forwards our real host + https page context; a plain local dev
  // server (http://localhost:3000) must stay lax or the browser drops the cookie instead
  const secure = req.proto.includes('https') || fromHttpsPage || (!localhost && !fromHttp) || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    path: '/',
    sameSite: secure ? 'none' : 'lax',
    secure,
    ...(secure ? { partitioned: true } : {}),
  };
}

export async function logout() {
  const jar = await cookies();
  // must carry the same attributes, or the browser keeps the live cookie
  jar.set(COOKIE, '', { ...(await sessionCookieAttrs()), maxAge: 0, expires: new Date(0) });
}

/** Current session user (public shape) or null. */
export async function currentUser() {
  let token = '';
  try {
    const jar = await cookies();
    token = jar.get(COOKIE)?.value || '';
  } catch {
    return null;
  }
  if (!token) return null;
  const store = readStore();
  const payload = verifyToken(store.secret, token);
  if (!payload) return null;
  const u = store.users[payload.uid];
  return u ? publicUser(u) : null;
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
