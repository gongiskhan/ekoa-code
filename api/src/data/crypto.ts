/**
 * The single crypto module (ch04 §4.7, ch09 invariant 6, FIXED-8). AES-256-GCM, one
 * implementation, mandatory key (no default constant anywhere — grep-gated). Ciphertext
 * wire format is carried byte-compatible so migrated rows decrypt without re-encryption:
 *   base64(iv).base64(authTag).base64(ciphertext)
 * Key resolution is isolated behind one function so KMS envelope encryption (P-14, deferred)
 * can be added without touching call sites.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { loadConfig } from '../config.js';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/** The 32-byte key, derived deterministically from the mandatory ENCRYPTION_KEY (P-14 seam).
 *  An optional `scope` binds the key to a partition (e.g. an orgId) so ciphertext encrypted for
 *  one scope cannot be decrypted under another - defense in depth for org-scoped secret material
 *  like the anonymisation deny-list (ch17 §17.4 b). Unscoped callers keep the original key. */
function key(scope?: string): Buffer {
  const raw = loadConfig().encryptionKey;
  // Derive a fixed 32-byte key from the configured secret (accepts any-length secret).
  const h = createHash('sha256').update(raw, 'utf8');
  if (scope !== undefined) h.update('\x00').update(scope, 'utf8');
  return h.digest();
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGO, key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

/** Scope-bound encrypt/decrypt (ch17 §17.4 b): the ciphertext is bound to `scope` (an orgId), so
 *  it is undecryptable under any other scope - GCM auth fails with the wrong key. Same wire
 *  format as encrypt/decrypt. */
export function encryptForScope(plaintext: string, scope: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(scope), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptForScope(ciphertext: string, scope: string): string {
  const parts = ciphertext.split('.');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGO, key(scope), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
