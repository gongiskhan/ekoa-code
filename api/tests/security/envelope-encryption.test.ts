import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  encrypt,
  decrypt,
  envelopeEncrypt,
  envelopeDecrypt,
  ciphertextVersion,
} from '../../src/data/crypto.js';
import { setKeyWrapper, __resetKeyWrapperForTests, type KeyWrapper } from '../../src/data/kms.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * SECURITY SUITE — versioned envelope encryption (Cofre WS-K / K-1; invariant I4).
 *
 * The target is a per-tenant DEK wrapped by ONE Cloud KMS key per environment. Provisioning that
 * key is an infrastructure step, so the WRAPPING is a seam with a local implementation today and a
 * Cloud KMS one that plugs in with no call-site change — turning real KMS on becomes configuration,
 * not a refactor.
 *
 * The property these cases exist to protect: v1 rows keep decrypting, so this was adopted WITHOUT a
 * migration flag day, and a tenant's ciphertext cannot be decrypted under another tenant.
 */
beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  __resetConfigForTests();
  loadConfig();
});

afterEach(() => __resetKeyWrapperForTests());

describe('v2 envelope', () => {
  it('round-trips', async () => {
    const ct = await envelopeEncrypt('hello secret', 'orgA');
    expect(await envelopeDecrypt(ct, 'orgA')).toBe('hello secret');
  });

  it('is labelled v2 and carries no plaintext', async () => {
    const ct = await envelopeEncrypt('SUPERSECRET', 'orgA');
    expect(ciphertextVersion(ct)).toBe('v2');
    expect(ct.startsWith('v2.')).toBe(true);
    expect(ct).not.toContain('SUPERSECRET');
  });

  it('REFUSES to decrypt under a different tenant', async () => {
    const ct = await envelopeEncrypt('orgA-only', 'orgA');
    await expect(envelopeDecrypt(ct, 'orgB')).rejects.toThrow();
  });

  it('uses a FRESH data key per record — two encryptions of the same value differ', async () => {
    const a = await envelopeEncrypt('same', 'orgA');
    const b = await envelopeEncrypt('same', 'orgA');
    expect(a).not.toBe(b);
    expect(await envelopeDecrypt(a, 'orgA')).toBe('same');
    expect(await envelopeDecrypt(b, 'orgA')).toBe('same');
  });

  it('rejects a tampered payload (GCM auth)', async () => {
    const ct = await envelopeEncrypt('x', 'orgA');
    const parts = ct.split('.');
    parts[4] = Buffer.from('tampered').toString('base64');
    await expect(envelopeDecrypt(parts.join('.'), 'orgA')).rejects.toThrow();
  });

  it('rejects a malformed v2 string rather than guessing', async () => {
    await expect(envelopeDecrypt('v2.only.three.parts', 'orgA')).rejects.toThrow(/Malformed/);
  });
});

describe('v1 compatibility — no migration flag day', () => {
  it('envelopeDecrypt reads a legacy v1 row unchanged', async () => {
    const legacy = encrypt('written before K-1');
    expect(ciphertextVersion(legacy)).toBe('v1');
    expect(await envelopeDecrypt(legacy, 'orgA')).toBe('written before K-1');
  });

  it('a v1 row decrypts regardless of the tenant argument (it was never tenant-bound)', async () => {
    // Stated as a TEST rather than a comment: this is exactly the weakness v2 removes, and the
    // K-4 migration exists because of it.
    const legacy = encrypt('flat-key row');
    expect(await envelopeDecrypt(legacy, 'orgA')).toBe('flat-key row');
    expect(await envelopeDecrypt(legacy, 'orgB')).toBe('flat-key row');
  });

  it('the v1 functions still round-trip on their own', () => {
    expect(decrypt(encrypt('v1'))).toBe('v1');
  });
});

describe('the wrapper is a seam — a Cloud KMS impl plugs in with no call-site change', () => {
  it('routes wrap/unwrap through the installed wrapper', async () => {
    const calls: string[] = [];
    const fake: KeyWrapper = {
      keyId: 'fake-kms',
      async wrap(dek, tenantId) {
        calls.push(`wrap:${tenantId}`);
        return `fake:${dek.toString('base64')}`;
      },
      async unwrap(wrapped, tenantId) {
        calls.push(`unwrap:${tenantId}`);
        return Buffer.from(wrapped.slice('fake:'.length), 'base64');
      },
    };
    setKeyWrapper(fake);
    const ct = await envelopeEncrypt('through the seam', 'orgZ');
    expect(await envelopeDecrypt(ct, 'orgZ')).toBe('through the seam');
    expect(calls).toEqual(['wrap:orgZ', 'unwrap:orgZ']);
  });

  it('a wrapper failure surfaces rather than falling back to a weaker key', async () => {
    setKeyWrapper({
      keyId: 'broken',
      async wrap() {
        throw new Error('KMS unavailable');
      },
      async unwrap() {
        throw new Error('KMS unavailable');
      },
    });
    // Fail closed: an unavailable KMS must never degrade to encrypting under something else.
    await expect(envelopeEncrypt('x', 'orgA')).rejects.toThrow(/KMS unavailable/);
  });

  it('the local wrapper binds a wrapped DEK to its tenant', async () => {
    const { LocalKeyWrapper } = await import('../../src/data/kms.js');
    const w = new LocalKeyWrapper();
    const dek = randomBytes(32);
    const wrapped = await w.wrap(dek, 'orgA');
    expect((await w.unwrap(wrapped, 'orgA')).equals(dek)).toBe(true);
    await expect(w.unwrap(wrapped, 'orgB')).rejects.toThrow();
  });
});
