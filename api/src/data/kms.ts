/**
 * data/kms.ts — the key-wrapping seam (Cofre WS-K / K-1).
 *
 * WHY THIS EXISTS AS AN INTERFACE. The Cofre target is envelope encryption: a per-tenant DEK
 * wrapped by ONE Cloud KMS key per environment. Provisioning that KMS key is an infrastructure
 * step, and making the code wait for it would have meant either shipping nothing or shipping a
 * design that has to be retrofitted later. Instead the WRAPPING is an interface with two
 * implementations: a local one derived from the existing `ENCRYPTION_KEY` (dev, test, and any
 * deployment before the key is provisioned) and a Cloud KMS one that plugs in with no call-site
 * change. Turning on real KMS becomes configuration, not a refactor.
 *
 * The honest consequence, stated plainly: under `LocalKeyWrapper` the per-tenant DEKs are wrapped
 * by a key derived from an environment variable, so a database breach plus that variable yields
 * plaintext. That is exactly the property the KMS wrapper removes, and it is why the wrapper is a
 * seam rather than a permanent choice. `docs/security.md`'s threat model must not claim the KMS
 * property while `LocalKeyWrapper` is the one in use.
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { loadConfig } from '../config.js';

/** Wraps and unwraps a per-tenant data-encryption key. The DEK itself never leaves this boundary
 *  in plaintext except to the caller that is about to use it. */
export interface KeyWrapper {
  /** Stable id recorded in the ciphertext so a rotation can be detected, never the key material. */
  readonly keyId: string;
  wrap(dek: Buffer, tenantId: string): Promise<string>;
  unwrap(wrapped: string, tenantId: string): Promise<Buffer>;
}

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * The pre-KMS wrapper: AES-GCM under a key derived from `ENCRYPTION_KEY` and the TENANT id, so a
 * wrapped DEK is at least bound to its tenant (a row moved between tenants fails to unwrap). This
 * is strictly better than the flat single-key model it replaces, and strictly weaker than KMS.
 */
export class LocalKeyWrapper implements KeyWrapper {
  readonly keyId = 'local-v1';

  private kek(tenantId: string): Buffer {
    return createHash('sha256')
      .update(loadConfig().encryptionKey, 'utf8')
      .update('\x00kek\x00', 'utf8')
      .update(tenantId, 'utf8')
      .digest();
  }

  async wrap(dek: Buffer, tenantId: string): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const c = createCipheriv(ALGO, this.kek(tenantId), iv);
    const enc = Buffer.concat([c.update(dek), c.final()]);
    return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
  }

  async unwrap(wrapped: string, tenantId: string): Promise<Buffer> {
    const [ivB64, tagB64, dataB64] = wrapped.split('.') as [string, string, string];
    const d = createDecipheriv(ALGO, this.kek(tenantId), Buffer.from(ivB64, 'base64'));
    d.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]);
  }
}

let wrapper: KeyWrapper = new LocalKeyWrapper();

/**
 * Install the production wrapper at the composition root. A Cloud KMS implementation supplies
 * `wrap`/`unwrap` backed by a Cloud KMS crypto-key resource and needs no other
 * change anywhere — `envelopeEncrypt`/`envelopeDecrypt` and every call site stay as they are.
 */
export function setKeyWrapper(next: KeyWrapper): void {
  wrapper = next;
}

export function currentKeyWrapper(): KeyWrapper {
  return wrapper;
}

/** Test helper: restore the local wrapper. */
export function __resetKeyWrapperForTests(): void {
  wrapper = new LocalKeyWrapper();
}
