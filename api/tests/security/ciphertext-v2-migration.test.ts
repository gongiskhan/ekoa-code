import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { integrationConfigs } from '../../src/data/stores.js';
import { __cofreItemsStoreForMigration } from '../../src/cofre/store.js';
import { encrypt, envelopeDecrypt, ciphertextVersion } from '../../src/data/crypto.js';
import {
  migrateCiphertextToV2,
  scanCiphertextVersions,
  noV1CiphertextRemains,
} from '../../scripts/migrate/ciphertext-v2.js';

/**
 * SECURITY SUITE — the v1 -> v2 ciphertext migration (Cofre WS-K / K-4).
 *
 * WHAT THIS ACTUALLY PROTECTS. K-1 made ciphertext versioned and tenant-bound, and could be adopted
 * with no flag day precisely because v1 rows keep decrypting. The cost of that grace is that a v1
 * row stays encrypted under the FLAT GLOBAL key and is NOT tenant-bound — it decrypts under any
 * tenant argument. So K-1's tenant binding is a property of NEW WRITES until this migration has
 * actually run over the old ones. The decisive case below is therefore not "the row changed shape"
 * but "the row can no longer be decrypted under the wrong tenant".
 *
 * The migration was journaled as landed on 2026-07-28 while having no entry point, no gate and no
 * test — it had never compiled, let alone run (`k4-migration-dead-on-arrival`). These cases are the
 * evidence that was missing.
 */
let mem: MongoMemoryServer;
const ORG_A = 'orgA';
const ORG_B = 'orgB';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_k4');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await integrationConfigs.deleteMany({});
  await __cofreItemsStoreForMigration.deleteMany({});
});

/** A pre-K-1 row: `encrypt()` is the FLAT global-key path that produced v1 ciphertext. */
async function seedV1Integration(id: string, orgId: string, secret: string) {
  await integrationConfigs.insert({ _id: id, orgId, credentialsCiphertext: encrypt(secret) } as never);
}
async function seedV1CofreItem(id: string, orgId: string, secret: string) {
  await __cofreItemsStoreForMigration.insert({ _id: id, orgId, valueCiphertext: encrypt(secret) } as never);
}

const ctOf = async (store: typeof integrationConfigs, id: string, field: string) =>
  ((await store.get(id)) as unknown as Record<string, string>)[field] as string;

describe('the weakness the migration exists to remove', () => {
  it('a v1 row decrypts under the WRONG tenant — this is the defect', async () => {
    await seedV1Integration('i1', ORG_A, 'orgA-secret-value');
    const ct = await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext');
    expect(ciphertextVersion(ct)).not.toBe('v2');
    // Stated as a test rather than a comment: the flat global key is not tenant-bound.
    await expect(envelopeDecrypt(ct, ORG_B)).resolves.toBe('orgA-secret-value');
  });

  it('AFTER migrating, the same row refuses the wrong tenant and still serves the right one', async () => {
    await seedV1Integration('i1', ORG_A, 'orgA-secret-value');
    await migrateCiphertextToV2();

    const ct = await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext');
    expect(ciphertextVersion(ct)).toBe('v2');
    // The property the whole workstream is for.
    await expect(envelopeDecrypt(ct, ORG_B)).rejects.toThrow();
    await expect(envelopeDecrypt(ct, ORG_A)).resolves.toBe('orgA-secret-value');
  });

  it('migrates Cofre item values too, not just integration configs', async () => {
    await seedV1CofreItem('c1', ORG_A, 'cofre-secret-value');
    await migrateCiphertextToV2();
    const ct = await ctOf(__cofreItemsStoreForMigration as never, 'c1', 'valueCiphertext');
    expect(ciphertextVersion(ct)).toBe('v2');
    await expect(envelopeDecrypt(ct, ORG_B)).rejects.toThrow();
    await expect(envelopeDecrypt(ct, ORG_A)).resolves.toBe('cofre-secret-value');
  });
});

describe('idempotent and resumable', () => {
  it('a second run migrates nothing and breaks nothing', async () => {
    await seedV1Integration('i1', ORG_A, 'v');
    const first = await migrateCiphertextToV2();
    expect(first.integrationConfigs!.migrated).toBe(1);

    const second = await migrateCiphertextToV2();
    expect(second.integrationConfigs!.migrated).toBe(0);
    expect(second.integrationConfigs!.alreadyV2).toBe(1);
    await expect(envelopeDecrypt(await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext'), ORG_A)).resolves.toBe('v');
  });

  it('ONE undecryptable row is counted, never fatal — the rest still migrate', async () => {
    // A partial run that aborted on the first bad row would leave every later row on the flat key,
    // which is the opposite of what this migration is for.
    await seedV1Integration('good-1', ORG_A, 'a');
    await integrationConfigs.insert({ _id: 'corrupt', orgId: ORG_A, credentialsCiphertext: 'not-decryptable' } as never);
    await seedV1Integration('good-2', ORG_A, 'b');

    const report = (await migrateCiphertextToV2()).integrationConfigs!;
    expect(report.migrated).toBe(2);
    expect(report.failed).toBe(1);
    await expect(envelopeDecrypt(await ctOf(integrationConfigs, 'good-2', 'credentialsCiphertext'), ORG_A)).resolves.toBe('b');
  });

  it('a row with no org is skipped, not mangled — there is no tenant to bind it to', async () => {
    await integrationConfigs.insert({ _id: 'orphan', credentialsCiphertext: encrypt('x') } as never);
    const before = await ctOf(integrationConfigs, 'orphan', 'credentialsCiphertext');

    const scan = await scanCiphertextVersions();
    expect(scan.integrationConfigs!.skipped).toBe(1);
    expect(scan.integrationConfigs!.scanned).toBe(0); // not counted as migratable either

    await migrateCiphertextToV2();
    // Byte-identical afterwards — captured BEFORE the migration, not re-read twice.
    expect(await ctOf(integrationConfigs, 'orphan', 'credentialsCiphertext')).toBe(before);
    expect(ciphertextVersion(before)).not.toBe('v2');
  });
});

describe('the gate is READ-ONLY — a check that writes cannot be run to ask a question', () => {
  it('scanCiphertextVersions reports without migrating', async () => {
    await seedV1Integration('i1', ORG_A, 'v');
    const before = await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext');

    const scan = await scanCiphertextVersions();
    expect(scan.integrationConfigs!.v1).toBe(1);
    expect(scan.integrationConfigs!.v2).toBe(0);

    // The row is byte-identical afterwards. The original noV1CiphertextRemains() called the
    // MIGRATION to answer this, so the post-cutover gate wrote to production to read it.
    expect(await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext')).toBe(before);
  });

  it('noV1CiphertextRemains is false with a v1 row and true after migrating, without mutating on the false path', async () => {
    await seedV1Integration('i1', ORG_A, 'v');
    const before = await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext');
    expect(await noV1CiphertextRemains()).toBe(false);
    expect(await ctOf(integrationConfigs, 'i1', 'credentialsCiphertext')).toBe(before);

    await migrateCiphertextToV2();
    expect(await noV1CiphertextRemains()).toBe(true);
  });

  it('an empty database is trivially clean', async () => {
    expect(await noV1CiphertextRemains()).toBe(true);
  });
});
