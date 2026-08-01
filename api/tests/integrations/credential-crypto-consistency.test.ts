import { describe, it, expect, beforeAll } from 'vitest';
import { encrypt, decrypt, envelopeEncrypt, envelopeDecrypt, ciphertextVersion } from '../../src/data/crypto.js';

/**
 * REGRESSION SUITE — the integration-credential crypto split (B1, run 20260801-171149).
 *
 * WHAT BROKE. `integration_configs.credentialsCiphertext` was written in TWO schemes on one field:
 * `service.ts` (the POST /integrations/configs path) wrote v2 org-bound envelopes, while
 * `platform-oauth.ts`, `pipedream.ts`, `action-executor.ts`'s rotation writer and the zoho backend
 * seam wrote+read FLAT v1 via `encrypt`/`decrypt`. `envelopeDecrypt` reads v1 transparently, but
 * flat `decrypt` THROWS on a v2 string (5 dotted segments vs the 3 it expects). Two live faults:
 *   (a) a zoho config created through the normal save path (v2) was unreadable by the zoho backend,
 *       whose flat `decrypt` threw — a latent unreadable-config bug; and
 *   (b) every rotation writer re-encrypted with flat `encrypt`, silently DOWNGRADING a v2 row to v1
 *       and dropping its org binding.
 *
 * B1 moved every writer/reader on this field onto the org-bound envelope. These cases pin the
 * invariant that made the split possible to introduce and would catch its reintroduction: the
 * normal save shape is readable, rotation stays v2, legacy v1 still reads, and org binding holds.
 * Pure crypto — no Mongo, no network; ENCRYPTION_KEY is the only dependency.
 */

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';
const BUNDLE = JSON.stringify({ client_id: 'cid-1', client_secret: 'shhh', refresh_token: 'rt-1', dc: 'com' });

// The B1 zoho-backend decrypt seam, verbatim: (ciphertext, orgId) => envelopeDecrypt(...).
const zohoDecryptSeam = (ciphertext: string, orgId: string) => envelopeDecrypt(ciphertext, orgId);

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
});

describe('integration credential crypto — one scheme (B1)', () => {
  it('the normal save path writes v2, and the restored read seam reads it back', async () => {
    // What POST /integrations/configs (service.createConfig) produces:
    const stored = await envelopeEncrypt(BUNDLE, ORG_A);
    expect(ciphertextVersion(stored)).toBe('v2');
    // The B1 zoho seam reads it; the parsed bundle is intact.
    const roundTripped = await zohoDecryptSeam(stored, ORG_A);
    expect(JSON.parse(roundTripped)).toMatchObject({ refresh_token: 'rt-1' });
  });

  it('DOCUMENTS the pre-B1 bug: flat decrypt throws on the v2 row the save path writes', async () => {
    const stored = await envelopeEncrypt(BUNDLE, ORG_A);
    // This is exactly what the old zoho/platform/pipedream readers did — and why a v2 config was
    // unreadable to them. The envelope reader (B1) does not throw (asserted above).
    expect(() => decrypt(stored)).toThrow();
  });

  it('rotation re-encrypts as v2 — never downgrades to flat v1', async () => {
    // The rotation writers (action-executor.persistProviderCredentialUpdates, the zoho backend's
    // persistOwnerCredentialUpdates, platform-oauth refresh) now compute envelopeEncrypt(merged, org).
    const current = JSON.parse(await envelopeDecrypt(await envelopeEncrypt(BUNDLE, ORG_A), ORG_A)) as Record<string, unknown>;
    const rotated = await envelopeEncrypt(JSON.stringify({ ...current, refresh_token: 'rt-2' }), ORG_A);
    expect(ciphertextVersion(rotated)).toBe('v2'); // pre-B1 this was v1 (the downgrade)
    expect(JSON.parse(await zohoDecryptSeam(rotated, ORG_A))).toMatchObject({ refresh_token: 'rt-2' });
  });

  it('legacy v1 rows still read through the envelope seam (no flag day)', async () => {
    const legacy = encrypt(BUNDLE); // a row written before K-1/B1
    expect(ciphertextVersion(legacy)).toBe('v1');
    expect(JSON.parse(await envelopeDecrypt(legacy, ORG_A))).toMatchObject({ client_id: 'cid-1' });
  });

  it('a v2 row is org-bound — it does not decrypt under another org', async () => {
    const stored = await envelopeEncrypt(BUNDLE, ORG_A);
    await expect(zohoDecryptSeam(stored, ORG_B)).rejects.toThrow();
  });
});
