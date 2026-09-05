/**
 * At-rest encryption for AI provider keys (AES-256-GCM, key derived from the
 * local store secret) + safe masking for anything we echo back to a browser.
 */
import crypto from 'node:crypto';

const ENC_PREFIX = 'v1.';

function deriveKey(secret) {
  return crypto.scryptSync(String(secret || 'dev-secret'), 'ai-agent.provider-keys', 32);
}

export function encryptSecret(secret, plain) {
  if (!plain) return '';
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ENC_PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString('base64url')).join('.');
}

export function decryptSecret(secret, enc) {
  if (!enc) return '';
  if (!enc.startsWith(ENC_PREFIX)) return enc; // tolerate a raw key pasted in
  try {
    const [iv, tag, ct] = enc.slice(ENC_PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

/** "sk-…9f2c" — never leak a full key to the client. */
export function maskKey(plain) {
  const s = String(plain || '');
  if (!s) return '';
  if (s.length <= 8) return `••••${s.slice(-2)}`;
  return `${s.slice(0, 3)}…${s.slice(-4)}`;
}

export function looksLikeAKey(value) {
  return typeof value === 'string' && value.includes('…');
}

export function fingerprint(plain) {
  return crypto.createHash('sha256').update(String(plain || '')).digest('hex').slice(0, 10);
}
