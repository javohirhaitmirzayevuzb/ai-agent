/**
 * What an API key may look like, and how to clean up what a human pasted.
 * Pure + dependency-free on purpose: shared by the server routes and the admin/profile
 * forms, so "is this a key?" can never mean two different things in two places.
 */

/** Our own masked display form (`abc…wxyz`) — never a real credential. */
export function looksLikeMaskedKey(value) {
  return typeof value === 'string' && (value.includes('…') || value.includes('•') || value.includes('...'));
}

/** Legacy `AIza…`, new `AQ.…`, `sk-…`: word chars plus - _ . ~ + / = and nothing else. */
export const KEY_CHARSET = /^[A-Za-z0-9_\-.~+/=]+$/;

/**
 * Strip clipboard noise (quotes, spaces, newlines, a trailing comma from a JSON snippet)
 * and name out loud whatever is still impossible. Silent rejection is what made the
 * "save" button look broken; every problem here comes back as a readable message.
 */
export function normalizeApiKey(raw, { min = 12 } = {}) {
  const value = String(raw || '')
    .replace(/\s+/g, '') // newlines/spaces from a JSON snippet or a wrapped textarea
    .replace(/^["'`]+|["'`,;]+$/g, '') // surrounding quotes, a trailing comma from the copy
    .replace(/^(api[-_ ]?key|key|token)[:=]/i, ''); // pasted together with its label
  // deliberately NO other stripping: deleting a character the user pasted can turn a real
  // key into a wrong one, which is far worse than refusing it outright
  if (!value) return { value: '', error: '', warning: '' };
  if (looksLikeMaskedKey(value)) {
    return {
      value,
      error: 'Bu to’liq kalit emas — maskalangan ko’rinish. AI Studio’dan to’liq kalitni nusxalang. / This is the masked form; paste the full key.',
      warning: '',
    };
  }
  if (value.length < min) return { value, error: `Kalit juda qisqa (${value.length}) — kamida ${min} belgi kerak.`, warning: '' };
  const odd = [...new Set([...value].filter((c) => !KEY_CHARSET.test(c)))];
  // deliberately a warning, not a refusal: a provider key format we have not seen is
  // not proof of a mistake, and blocking here once made "save" look completely dead
  const warning = odd.length ? `E’tibor: kalitda g‘alati belgilar bor (${odd.join(' ')}) — konsoladagi to’liq qiymat bilan bir xilmi?` : '';
  return { value, error: '', warning };
}

/**
 * Same value as fingerprint() in src/lib/crypto.js (sha256, first 10 hex chars), computed with
 * SubtleCrypto so a form can say "this is / is not the key the server already has". The two must
 * agree, and the suite checks exactly that — a compare that silently used a different hash would
 * be worse than no compare at all.
 */
export async function fingerprintHex(value) {
  const subtle = globalThis.crypto?.subtle; // browser: https/localhost only; node: 20+ webcrypto
  if (!subtle) return '';
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10);
}
