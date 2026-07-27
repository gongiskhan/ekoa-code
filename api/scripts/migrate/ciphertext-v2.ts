/**
 * scripts/migrate/ciphertext-v2.ts — K-4: rewrite v1 ciphertext to the v2 envelope.
 *
 * v1 rows keep decrypting, which is why K-1 could be adopted with no flag day — but a v1 row is
 * encrypted under the FLAT global key and is not tenant-bound, so it decrypts under any tenant.
 * That is the weakness v2 removes, and it is only actually removed once no v1 row remains.
 *
 * Idempotent and resumable: a row already at v2 is skipped, so a partial run can simply be re-run.
 * Reports counts so `gate:crypto-version` has something to assert after the cutover window.
 */
import { integrationConfigs, cofreItems } from '../../src/data/stores.js';
import { ciphertextVersion, envelopeEncrypt, envelopeDecrypt } from '../../src/data/crypto.js';

export interface MigrationReport {
  scanned: number;
  migrated: number;
  alreadyV2: number;
  failed: number;
}

/** Rewrite one collection's ciphertext field. Failures are counted, never fatal: one undecryptable
 *  row must not abort the migration of every other. */
async function migrateCollection(
  store: { find: (q: Record<string, unknown>) => Promise<unknown[]>; update: (id: string, fn: (cur: never) => never) => Promise<unknown> },
  field: string,
): Promise<MigrationReport> {
  const report: MigrationReport = { scanned: 0, migrated: 0, alreadyV2: 0, failed: 0 };
  const rows = (await store.find({})) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const ct = row[field];
    const orgId = row.orgId;
    if (typeof ct !== 'string' || !ct || typeof orgId !== 'string') continue;
    report.scanned++;
    if (ciphertextVersion(ct) === 'v2') {
      report.alreadyV2++;
      continue;
    }
    try {
      const plaintext = await envelopeDecrypt(ct, orgId); // v1 path
      const next = await envelopeEncrypt(plaintext, orgId);
      await store.update(String(row._id), ((cur: Record<string, unknown>) => ({ ...cur, [field]: next })) as never);
      report.migrated++;
    } catch {
      report.failed++;
    }
  }
  return report;
}

export async function migrateCiphertextToV2(): Promise<Record<string, MigrationReport>> {
  return {
    integrationConfigs: await migrateCollection(integrationConfigs as never, 'credentialsCiphertext'),
    cofreItems: await migrateCollection(cofreItems.raw as never, 'valueCiphertext'),
  };
}

/** True when no v1 ciphertext remains — the assertion `gate:crypto-version` makes after cutover. */
export async function noV1CiphertextRemains(): Promise<boolean> {
  const reports = await migrateCiphertextToV2();
  return Object.values(reports).every((r) => r.migrated === 0 && r.failed === 0);
}
