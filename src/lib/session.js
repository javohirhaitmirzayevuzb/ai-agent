/**
 * Name + surname login and signed-session cookies.
 *
 * There is no password by design: identity in this app is "Javohir Ali".
 * We normalise the pair into a slug, and mint an HMAC-signed cookie that
 * carries the user id + an expiry. Tampering invalidates the session.
 */
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
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
    s.users[slug] = {
      id: slug,
      firstName: prev?.firstName || first,
      lastName: prev?.lastName || last,
      displayName: `${prev?.firstName || first} ${prev?.lastName || last}`,
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
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIE !== '1',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });

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

export async function logout() {
  const jar = await cookies();
  jar.delete(COOKIE);
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
