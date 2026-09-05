/**
 * Where the mirrored session token lives, and how URLs get it.
 *
 * A cookie is the normal carrier, but some contexts give us none (sandboxed iframe,
 * strict tracker blocking). There we mirror the signed token in sessionStorage and send
 * it as `x-studio-session`; media elements cannot send headers, so `authedSrc()` adds it
 * to /api/ URLs — but only while cookies are actually failing, so tokens never end up in
 * a URL when a cookie would have done the job.
 */
export const BEARER_HEADER = 'x-studio-session';
const BEARER_KEY = 'studio.sessionToken';

export function readBearer() {
  try {
    return window.sessionStorage.getItem(BEARER_KEY) || '';
  } catch {
    return '';
  }
}

export function writeBearer(token) {
  try {
    if (token) window.sessionStorage.setItem(BEARER_KEY, token);
    else window.sessionStorage.removeItem(BEARER_KEY);
  } catch {
    /* storage unavailable — the cookie has to carry it */
  }
}

export function clearBearer() {
  writeBearer('');
}

/** Set once a request has authenticated from a real cookie. */
export function markCookieAuth(on = true) {
  globalThis.__studioCookieAuth = Boolean(on);
}

export function cookieAuthWorks() {
  return globalThis.__studioCookieAuth === true;
}

/** /api/ URL that also works when the browser will not hold a cookie for us. */
export function authedSrc(src) {
  if (!src || !src.startsWith('/api/') || cookieAuthWorks() || src.includes('sid=')) return src;
  const bearer = readBearer();
  if (!bearer) return src;
  return `${src}${src.includes('?') ? '&' : '?'}sid=${encodeURIComponent(bearer)}`;
}
