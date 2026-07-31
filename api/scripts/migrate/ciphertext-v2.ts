/**
 * scripts/migrate/ciphertext-v2.ts — K-4: rewrite v1 ciphertext to the v2 envelope.
 *
 * v1 rows keep decrypting, which is why K-1 could be adopted with no flag day — but a v1 row is
 * encrypted under the FLAT global key and is not tenant-bound, so it decrypts under any tenant.
 * That is the weakness v2 removes, and it is only actually removed once no v1 row remains. Until
 * this has RUN against a database, K-1's tenant binding is a property of new writes only.
 *
 * Idempotent and resumable: a row already at v2 is skipped, so a partial run can simply be re-run.
 * A single undecryptable row is COUNTED, never fatal — one bad row must not abort the migration of
 * every other.
 *
 * SCAN AND MIGRATE ARE SEPARATE, and that split is the point of the 2026-07-29 revision. The
 * original `noV1CiphertextRemains()` called the migration to answer its question, so the "check"
 * that `gate:crypto-version` runs after the cutover window WROTE to the database. Safe only by
 * accident (the migration is idempotent), and wrong in shape: a gate that mutates cannot be run
 * against production to ask a question, which is exactly what a gate is for.
 */
import { integrationConfigs } from '../../src/data/stores.js';
// The UNSCOPED handle, exported by cofre/store.ts under a deliberately ugly name for exactly this
// caller. A migration rewrites every tenant's rows, so it cannot go through the owner-scoped
// repository that every product read must use — and naming it this way keeps that exception
// greppable instead of letting a second unscoped path look ordinary.
import { __cofreItemsStoreForMigration } from '../../src/cofre/store.js';
import { ciphertextVersion, envelopeEncrypt, envelopeDecrypt } from '../../src/data/crypto.js';

export interface MigrationReport {
  scanned: number;
  migrated: number;
  alreadyV2: number;
  failed: number;
}

export interface ScanReport {
  scanned: number;
  v1: number;
  v2: number;
  /** Rows whose field is absent/empty or whose org is missing — not migratable, not counted as v1. */
  skipped: number;
}

/** The collections carrying encrypted values, and the field on each. */
interface Target {
  name: string;
  store: { find: (q: Record<string, unknown>) => Promise<unknown[]>; update: (id: string, fn: (cur: never) => never) => Promise<unknown> };
  field: string;
}

function targets(): Target[] {
  return [
    { name: 'integrationConfigs', store: integrationConfigs as never, field: 'credentialsCiphertext' },
    { name: 'cofreItems', store: __cofreItemsStoreForMigration as never, field: 'valueCiphertext' },
  ];
}

/** A row is migratable when it has a non-empty ciphertext string AND an org to bind it to. */
function usable(row: Record<string, unknown>, field: string): { ct: string; orgId: string } | null {
  const ct = row[field];
  const orgId = row.orgId;
  if (typeof ct !== 'string' || !ct || typeof orgId !== 'string' || !orgId) return null;
  return { ct, orgId };
}

/**
 * READ-ONLY census of ciphertext versions. Writes nothing — this is what a gate may run against a
 * live database.
 */
export async function scanCiphertextVersions(): Promise<Record<string, ScanReport>> {
  const out: Record<string, ScanReport> = {};
  for (const t of targets()) {
    const report: ScanReport = { scanned: 0, v1: 0, v2: 0, skipped: 0 };
    const rows = (await t.store.find({})) as Array<Record<string, unknown>>;
    for (const row of rows) {
      const u = usable(row, t.field);
      if (!u) {
        report.skipped++;
        continue;
      }
      report.scanned++;
      if (ciphertextVersion(u.ct) === 'v2') report.v2++;
      else report.v1++;
    }
    out[t.name] = report;
  }
  return out;
}

/** Rewrite one collection's ciphertext field. Failures are counted, never fatal. */
async function migrateCollection(t: Target): Promise<MigrationReport> {
  const report: MigrationReport = { scanned: 0, migrated: 0, alreadyV2: 0, failed: 0 };
  const rows = (await t.store.find({})) as Array<Record<string, unknown>>;
  for (const row of rows) {
    const u = usable(row, t.field);
    if (!u) continue;
    report.scanned++;
    if (ciphertextVersion(u.ct) === 'v2') {
      report.alreadyV2++;
      continue;
    }
    try {
      const plaintext = await envelopeDecrypt(u.ct, u.orgId); // v1 path
      const next = await envelopeEncrypt(plaintext, u.orgId);
      await t.store.update(String(row._id), ((cur: Record<string, unknown>) => ({ ...cur, [t.field]: next })) as never);
      report.migrated++;
    } catch {
      report.failed++;
    }
  }
  return report;
}

/** MUTATING. Rewrites every v1 row to v2. Idempotent; re-run a partial run. */
export async function migrateCiphertextToV2(): Promise<Record<string, MigrationReport>> {
  const out: Record<string, MigrationReport> = {};
  for (const t of targets()) out[t.name] = await migrateCollection(t);
  return out;
}

/**
 * True when no v1 ciphertext remains — the assertion `gate:crypto-version` makes after the cutover
 * window. READ-ONLY: it scans, it does not migrate.
 */
export async function noV1CiphertextRemains(): Promise<boolean> {
  const scan = await scanCiphertextVersions();
  return Object.values(scan).every((r) => r.v1 === 0);
}
