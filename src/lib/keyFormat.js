/**
 * What an API key may look like, and how to clean up what a human pasted.
 * Pure + dependency-free on purpose: shared by the server routes and the admin/profile
 * forms, so "is this a key?" can never mean two different things in two places.
 */

/** Our own masked display form (`abc…wxyz`) — never a real credential. */
export function looksLikeMaskedKey(value) {
  return typeof value === 'string' && (value.includes('…') || value.includes('•'));
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
    .replace(/[\s"'`]+/g, '')
    .replace(/,+$/, '');
  if (!value) return { value: '', error: '' };
  if (looksLikeMaskedKey(value)) {
    return { value, error: 'Bu to’liq kalit emas — maskalangan ko’rinish. Konsoldan to’liq kalitni nusxalang. / This is the masked form; paste the full key.' };
  }
  const bad = [...new Set([...value].filter((c) => !KEY_CHARSET.test(c)))];
  if (bad.length) {
    return { value, error: `Kalitda noto’g’ri belgilar: ${bad.join(' ')} — faqat harf, raqam va - _ . ~ + / = bo’lishi mumkin.` };
  }
  if (value.length < min) return { value, error: `Kalit juda qisqa (${value.length}) — kamida ${min} belgi kerak.` };
  return { value, error: '' };
}
