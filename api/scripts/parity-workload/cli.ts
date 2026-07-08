/**
 * Parity-workload CLI (ch10 §10.4 Part B), STRUCTURAL mode - no live model calls.
 *
 *   node --loader ts-node/esm api/scripts/parity-workload/cli.ts --workload <workload.json> [--json]
 *
 * Drives the committed workload through the real tracker against an ephemeral memory-mongo
 * (or MONGODB_URI when set) and asserts the structural invariants. Exits 0 when every invariant
 * holds, 1 otherwise. Requires ENCRYPTION_KEY + JWT_SECRET for the billing config.
 */
import '../tool-env.js';
import { readFileSync } from 'node:fs';
import { runWorkload, checkComposition, type Workload, type StructuralReport } from './workload.js';

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printHuman(report: StructuralReport, composition: { ok: boolean; detail: string }): void {
  process.stdout.write('\nparity workload - Part B (structural-assertion mode)\n');
  process.stdout.write(`composition: ${composition.ok ? 'OK' : 'MISMATCH'} (${composition.detail})\n`);
  process.stdout.write(`ledger census: ${report.totalEvents} events for ${report.totalCalls} model calls\n`);
  process.stdout.write(`attribution: user_work=${report.attributionCensus.user_work} classifier=${report.attributionCensus.classifier} platform=${report.attributionCensus.platform}\n\n`);
  for (const inv of report.invariants) {
    process.stdout.write(`  [${inv.ok ? 'PASS' : 'FAIL'}] ${inv.name} - ${inv.detail}\n`);
  }
  process.stdout.write('\nper-class user_work tokens (for the documented +/-25% live band):\n');
  for (const pc of report.perClass) process.stdout.write(`  ${pc.class.padEnd(20)} ${String(pc.userWorkTokens).padStart(10)} tokens / ${pc.events} events\n`);
  process.stdout.write(`\nresult: ${report.ok && composition.ok ? 'STRUCTURALLY EXACT' : 'INVARIANT VIOLATION'}\n`);
}

async function main(): Promise<void> {
  const workloadPath = arg('--workload');
  if (!workloadPath) {
    process.stderr.write('usage: cli.ts --workload <workload.json> [--json]\n');
    process.exit(2);
  }
  const workload = JSON.parse(readFileSync(workloadPath, 'utf8')) as Workload;

  const { connectMongo, closeMongo } = await import('../../src/data/mongo.js');
  let memStop: (() => Promise<void>) | undefined;
  if (process.env.MONGODB_URI) {
    await connectMongo();
  } else {
    const { createMem } = await import('../../tests/helpers/mongo-mem.js');
    const mem = await createMem();
    memStop = async () => {
      await mem.stop();
    };
    await connectMongo(mem.getUri(), 'ekoa_parity_workload');
  }

  try {
    const composition = checkComposition(workload);
    const report = await runWorkload(workload);
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ composition, report }, null, 2) + '\n');
    else printHuman(report, composition);
    process.exitCode = report.ok && composition.ok ? 0 : 1;
  } finally {
    await closeMongo();
    if (memStop) await memStop();
  }
}

void main();
