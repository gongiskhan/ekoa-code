/**
 * Ledger-replay CLI (ch10 §10.4 Part A). Pure computation - no model calls, no DB.
 *
 *   node --loader ts-node/esm api/scripts/billing-replay/cli.ts \
 *        --ledger <ledger.json> --expected <expected.json> [--json]
 *
 * Exits 0 when the recomputed per-user totals equal the stored aggregates EXACTLY (tolerance
 * zero), 1 otherwise. Requires ENCRYPTION_KEY + JWT_SECRET so the billing config (tier weights
 * + cache-read factor) loads through config.ts.
 */
import '../tool-env.js';
import { readFileSync } from 'node:fs';
import { replay, type ReplayLedger, type ExpectedAggregates, type ReplayResult } from './replay.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printHuman(result: ReplayResult): void {
  process.stdout.write('\nledger replay - billing parity Part A (tolerance zero)\n');
  process.stdout.write(`${'user'.padEnd(16)} ${'recomputed'.padStart(12)} ${'expected'.padStart(12)} ${'diff'.padStart(8)}\n`);
  for (const p of result.perUser) {
    process.stdout.write(`${p.userId.padEnd(16)} ${String(p.recomputed).padStart(12)} ${String(p.expected).padStart(12)} ${String(p.diff).padStart(8)}\n`);
  }
  if (result.perEventMismatches.length) {
    process.stdout.write(`\nper-event mismatches: ${result.perEventMismatches.length}\n`);
    for (const m of result.perEventMismatches) {
      process.stdout.write(`  event ${m.index} (${m.billeeUserId}): stored ${m.stored} != recomputed ${m.recomputed}\n`);
    }
  }
  process.stdout.write(`\nresult: ${result.match ? 'EXACT MATCH' : 'MISMATCH (parity broken)'}\n`);
}

function main(): void {
  const ledgerPath = arg('--ledger');
  const expectedPath = arg('--expected');
  if (!ledgerPath || !expectedPath) {
    process.stderr.write('usage: cli.ts --ledger <ledger.json> --expected <expected.json> [--json]\n');
    process.exit(2);
  }
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as ReplayLedger;
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as ExpectedAggregates;
  const result = replay(ledger, expected);
  if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  process.exitCode = result.match ? 0 : 1;
}

main();
