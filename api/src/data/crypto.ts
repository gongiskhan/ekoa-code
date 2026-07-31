/**
 * The single crypto module (ch04 §4.7, ch09 invariant 6, FIXED-8). AES-256-GCM, one
 * implementation, mandatory key (no default constant anywhere — grep-gated). Ciphertext
 * wire format is carried byte-compatible so migrated rows decrypt without re-encryption:
 *   base64(iv).base64(authTag).base64(ciphertext)
 * Key resolution is isolated behind one function so KMS envelope encryption can be added without
 * touching call sites — and as of 2026-07-27 it HAS been (Cofre K-1): `envelopeEncrypt` /
 * `envelopeDecrypt` below implement a versioned per-tenant-DEK envelope over the `data/kms.ts`
 * wrapper seam. The v1 functions stay for byte-compatibility with every already-stored row.
 *
 * WIRE FORMATS, both decryptable by `envelopeDecrypt`:
 *   v1 (legacy, still written by `encrypt`):  base64(iv).base64(tag).base64(ct)
 *   v2 (envelope):                            v2.<wrappedDek>.base64(iv).base64(tag).base64(ct)
 * The `v2.` prefix is unambiguous because v1's first segment is always base64 of a 12-byte IV.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { loadConfig } from '../config.js';
import { currentKeyWrapper } from './kms.js';

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

// ---------------------------------------------------------------------------
// v2 — envelope encryption (Cofre K-1)
// ---------------------------------------------------------------------------

/**
 * Encrypt under a fresh per-record DEK, wrapped for `tenantId` by the installed KeyWrapper.
 *
 * A NEW DEK per record rather than per tenant: it costs one extra wrap per write, it removes any
 * need for DEK caching or rotation bookkeeping, and it means a single leaked DEK exposes exactly
 * one record. "Per-tenant DEK" in the brief is about the TRUST boundary — which the wrapping key
 * enforces — not about reusing one data key across a tenant's whole vault.
 */
export async function envelopeEncrypt(plaintext: string, tenantId: string): Promise<string> {
  const dek = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, dek, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const wrapped = await currentKeyWrapper().wrap(dek, tenantId);
  dek.fill(0); // the DEK's use window ends here (I4)
  return `v2.${Buffer.from(wrapped, 'utf8').toString('base64url')}.${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/**
 * Decrypt either wire version. v1 rows keep working untouched, so this can be adopted per-module
 * without a migration flag day; `chore(data): migrate existing ciphertext to v2` (K-4) rewrites
 * them at leisure and a gate can then assert no v1 row remains.
 */
export async function envelopeDecrypt(ciphertext: string, tenantId: string): Promise<string> {
  if (!ciphertext.startsWith('v2.')) return decrypt(ciphertext); // v1, byte-compatible
  const parts = ciphertext.split('.');
  if (parts.length !== 5) throw new Error('Malformed v2 ciphertext');
  const [, wrappedB64u, ivB64, tagB64, dataB64] = parts as [string, string, string, string, string];
  const wrapped = Buffer.from(wrappedB64u, 'base64url').toString('utf8');
  const dek = await currentKeyWrapper().unwrap(wrapped, tenantId);
  try {
    const decipher = createDecipheriv(ALGO, dek, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } finally {
    dek.fill(0); // zeroize after the use window, always — including on a failed decrypt
  }
}

/** Which wire version a stored value uses. For the K-4 migration and its "no v1 remains" gate. */
export function ciphertextVersion(ciphertext: string): 'v1' | 'v2' {
  return ciphertext.startsWith('v2.') ? 'v2' : 'v1';
}
