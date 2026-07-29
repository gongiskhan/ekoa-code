/**
 * CLI for the K-4 ciphertext migration.
 *
 * WHY THIS FILE EXISTS. `ciphertext-v2.ts` was journaled as landed on 2026-07-28 but had no entry
 * point, no gate and no test — it had never compiled, let alone run (findings:
 * `k4-migration-dead-on-arrival`). A migration nobody can invoke does not remove the weakness it
 * was written for: until it has RUN, every pre-K-1 row is still encrypted under the flat global key
 * and still decrypts under ANY tenant.
 *
 *   # read-only census (safe against production; this is what gate:crypto-version runs)
 *   MONGODB_URI=... npm run gate:crypto-version --workspace api
 *
 *   # rewrite v1 -> v2. --execute is REQUIRED to write (ch10 §10.3 rule 3: dry-run by default)
 *   MONGODB_URI=... npm run migrate:ciphertext-v2 --workspace api -- --execute
 *
 * Exit codes: 0 = no v1 rows remain (or a migration completed with no failures); 1 = v1 rows remain
 * or a row failed. Non-zero is what lets the gate be wired into CI after the cutover window.
 */
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { migrateCiphertextToV2, scanCiphertextVersions, type ScanReport } from './ciphertext-v2.js';

function requireUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    process.stderr.write('[ciphertext-v2] MONGODB_URI is required (this reads the live database).\n');
    process.exit(2);
  }
  return uri;
}

function printScan(scan: Record<string, ScanReport>): number {
  let v1Total = 0;
  process.stdout.write(`\n${'collection'.padEnd(22)} ${'rows'.padStart(7)} ${'v1'.padStart(7)} ${'v2'.padStart(7)} ${'skipped'.padStart(8)}\n`);
  for (const [name, r] of Object.entries(scan)) {
    v1Total += r.v1;
    process.stdout.write(`${name.padEnd(22)} ${String(r.scanned).padStart(7)} ${String(r.v1).padStart(7)} ${String(r.v2).padStart(7)} ${String(r.skipped).padStart(8)}\n`);
  }
  return v1Total;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const uri = requireUri();
  await connectMongo(uri, process.env.MONGODB_DB ?? 'ekoa');
  try {
    if (execute) {
      const reports = await migrateCiphertextToV2();
      let failed = 0;
      process.stdout.write(`\n${'collection'.padEnd(22)} ${'scanned'.padStart(8)} ${'migrated'.padStart(9)} ${'already'.padStart(8)} ${'failed'.padStart(7)}\n`);
      for (const [name, r] of Object.entries(reports)) {
        failed += r.failed;
        process.stdout.write(`${name.padEnd(22)} ${String(r.scanned).padStart(8)} ${String(r.migrated).padStart(9)} ${String(r.alreadyV2).padStart(8)} ${String(r.failed).padStart(7)}\n`);
      }
      // A failed row is reported, never fatal mid-run (one bad row must not abort the rest) — but
      // the RUN exits non-zero so an operator cannot mistake a partial migration for a complete one.
      const remaining = printScan(await scanCiphertextVersions());
      process.stdout.write(`\nresult: ${failed === 0 && remaining === 0 ? 'COMPLETE' : 'INCOMPLETE — re-run after investigating'}\n`);
      process.exit(failed === 0 && remaining === 0 ? 0 : 1);
    }

    const remaining = printScan(await scanCiphertextVersions());
    if (remaining > 0) {
      process.stdout.write(
        `\n[ciphertext-v2] ${remaining} v1 row(s) remain. Until they are migrated they are encrypted\n` +
          'under the FLAT global key and decrypt under ANY tenant (K-1/K-4).\n' +
          'Run with --execute to migrate.\n',
      );
      process.exit(1);
    }
    process.stdout.write('\n[ciphertext-v2] OK — no v1 ciphertext remains.\n');
  } finally {
    await closeMongo();
  }
}

main().catch((err) => {
  process.stderr.write(`[ciphertext-v2] ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
