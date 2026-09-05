/**
 * Where a Gemini key is actually sent, in order.
 *
 * Two families exist and the key alone decides which one answers:
 *  · Google AI Studio / Generative Language API — `generativelanguage.googleapis.com/v1beta`,
 *    key in the `x-goog-api-key` header (standard `AIza…` and new `AQ.…` auth keys).
 *  · Vertex AI in express mode — `aiplatform.googleapis.com/v1/publishers/google/models/{model}`,
 *    documented with the key as a `?key=` query parameter, no project or location needed.
 * A `400 API key not valid` from one family does not mean the key is bad — it can mean the key
 * belongs to the other. So `auto` tries the configured family first and falls through once, and the
 * caller reports which one answered. Pure and dependency-free: the server lane and the browser lane
 * both use it, so a tab request cannot quietly differ from a server one.
 */

export const VERTEX_EXPRESS_BASE = 'https://aiplatform.googleapis.com/v1';

const norm = (baseUrl) => String(baseUrl || '').replace(/\/+$/, '');

function isVertexBase(baseUrl) {
  return /aiplatform\.googleapis\.com/i.test(String(baseUrl || ''));
}

/**
 * Where the express-style path lives for a given base URL.
 *
 * Google's own host is hard-coded (that is the documented endpoint), but everything else keeps the
 * admin's origin and swaps the version prefix — a gateway proxying both families must not be skipped
 * in favour of the public host, or the fallback would leave the configured network entirely.
 */
export function expressBase(baseUrl) {
  const raw = norm(baseUrl);
  if (!raw) return VERTEX_EXPRESS_BASE;
  if (isVertexBase(raw)) return raw.replace(/\/publishers.*$/, '');
  let u;
  try {
    u = new URL(raw);
  } catch {
    return VERTEX_EXPRESS_BASE;
  }
  if (/^generativelanguage\.googleapis\.com$/i.test(u.hostname)) return VERTEX_EXPRESS_BASE;
  return `${u.origin}${u.pathname.replace(/\/v1beta\/?$/, '/v1').replace(/\/+$/, '') || '/v1'}`;
}

/** `{model}` shaped URLs for one target, both lanes passing the same pieces */
export function geminiTargets({ baseUrl, model, key, wire = 'auto' }) {
  const modelId = String(model || '');
  const google = {
    kind: 'generativelanguage',
    label: 'Google AI Studio API',
    url: `${norm(baseUrl)}/models/${modelId}:generateContent`,
    headers: (apiKey) => ({ 'content-type': 'application/json', 'x-goog-api-key': String(apiKey || '') }),
  };
  const express = {
    kind: 'vertex-express',
    label: 'Vertex express',
    url: `${expressBase(baseUrl)}/publishers/google/models/${modelId}:generateContent`,
    // documented form is ?key=; the header is also sent because a proxy may strip the query
    headers: (apiKey) => ({ 'content-type': 'application/json', 'x-goog-api-key': String(apiKey || '') }),
    queryKey: true,
  };
  const pinned = String(wire || 'auto').toLowerCase();
  if (pinned === 'google' || pinned === 'aistudio') return [google];
  if (pinned === 'vertex' || pinned === 'express') return [express];
  // the base URL is the admin's intent: honour it first, then try the other family
  return isVertexBase(baseUrl) ? [express, google] : [google, express];
}

/**
 * Only these fall through to the next family. A timeout, a safety block, a bad model output or a
 * 429 is the provider talking — retrying against another endpoint just doubles the wait and hides it.
 */
export function isKeyRejection(err) {
  const text = `${err?.message || ''} ${err?.detail || ''}`;
  if (/safety|blocked|finishReason|quota|429|rate/i.test(text)) return false;
  return /API key not valid|Please pass a valid API key|ACCESS_TOKEN_TYPE_UNSUPPORTED|PERMISSION_DENIED|permission and quota|invalid_api_key|unrestricted|api key not restricted/i.test(text) || err?.status === 401 || err?.status === 403;
}

/** where a ?key= query belongs, without ever putting the key in a URL we log */
export function withQueryKey(url, key) {
  if (!key) return url;
  return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
}

/** the pieces every caller needs to describe a failure honestly */
export function describeTargets(targets) {
  return targets.map((t) => `${t.label} (${tryHost(t.url)})`).join(' → ');
}

function tryHost(url) {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return String(url || '?');
  }
}
