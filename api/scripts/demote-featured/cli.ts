/**
 * CLI for WS10 Stage B (featured-artifact demotion). Mechanism only - this does not know
 * or care WHICH artifacts should be demoted; that disposition ledger is WS10 Stage A's
 * output. Point this at whatever ids the ledger names.
 *
 *   # plan (default): no writes, no fs mutation - reports what a real run would do,
 *   # or the exact reason it would refuse, per id.
 *   MONGODB_URI=... npm run tool:demote-featured --workspace api -- --id legal-nucleo
 *
 *   # execute: --execute is REQUIRED to write (ch10 §10.3 rule 3 convention, carried
 *   # here even though this isn't a ch10 migration - a script that touches the live
 *   # artifacts collection and deletes an on-disk asset dir gets the same guard rail).
 *   MONGODB_URI=... npm run tool:demote-featured --workspace api -- --id legal-nucleo --execute
 *
 *   # multiple ids in one run, comma-separated or repeated --id flags; --json for a
 *   # machine-readable summary.
 *   ... -- --ids legal-nucleo,cobrancas --execute --json
 *
 * One id's failure never aborts the batch (a bad manifest, a missing scaffold, a since-
 * deactivated admin) - every id gets its own attempt and its own line in the report; the
 * process exit code is non-zero iff at least one id failed.
 */
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { appRegistry } from '../../src/apps/app-registry.js';
import {
  planDemotion,
  demoteFeaturedArtifact,
  type DemotionPlan,
  type DemotionResult,
} from '../../src/apps/featured-demote.js';

interface Args {
  ids: string[];
  execute: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const ids = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--id' && argv[i + 1]) {
      ids.add(argv[i + 1] as string);
      i++;
    } else if (argv[i] === '--ids' && argv[i + 1]) {
      for (const id of (argv[i + 1] as string).split(',').map((s) => s.trim()).filter(Boolean)) ids.add(id);
      i++;
    }
  }
  if (ids.size === 0) {
    process.stderr.write(
      'usage: cli.ts --id <artifactId> [--id <artifactId> ...] | --ids <id1,id2,...> [--execute] [--json]\n',
    );
    process.exit(2);
  }
  return { ids: [...ids], execute: argv.includes('--execute'), json: argv.includes('--json') };
}

function requireUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    process.stderr.write('[demote-featured] MONGODB_URI is required (this reads/writes the live database).\n');
    process.exit(2);
  }
  return uri;
}

interface Outcome {
  id: string;
  ok: boolean;
  error?: string;
  plan?: DemotionPlan;
  result?: DemotionResult;
}

function printHuman(outcomes: Outcome[], execute: boolean): void {
  process.stdout.write(`\nekoa featured-artifact demotion - ${execute ? 'EXECUTE' : 'PLAN (dry run)'}\n`);
  for (const o of outcomes) {
    if (!o.ok) {
      process.stdout.write(`  ${o.id.padEnd(28)} REFUSED - ${o.error}\n`);
      continue;
    }
    if (execute && o.result) {
      const buildNote = o.result.built ? 'built OK' : `BUILD FAILED (${o.result.buildErrors.join('; ') || 'unknown'})`;
      process.stdout.write(
        `  ${o.id.padEnd(28)} demoted -> owner=${o.result.newOwner.userId} dir=${o.result.targetDir} ${buildNote} assetDirRemoved=${o.result.assetDirRemoved}\n`,
      );
    } else if (o.plan) {
      process.stdout.write(
        `  ${o.id.padEnd(28)} would demote -> owner ${o.plan.currentOwner.userId} -> ${o.plan.newOwner.userId}, copy ${o.plan.scaffoldDir} -> ${o.plan.targetDir}${o.plan.targetDirAlreadyExists ? ' [target dir already exists - will be overwritten]' : ''}, then remove ${o.plan.assetDir}\n`,
      );
    }
  }
  const failed = outcomes.filter((o) => !o.ok).length;
  process.stdout.write(`\nresult: ${failed === 0 ? 'OK' : `${failed}/${outcomes.length} REFUSED/FAILED`}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const uri = requireUri();
  await connectMongo(uri, process.env.MONGODB_DB ?? 'ekoa');
  const outcomes: Outcome[] = [];
  try {
    for (const id of args.ids) {
      try {
        if (args.execute) {
          const result = await demoteFeaturedArtifact(id);
          outcomes.push({ id, ok: true, result });
        } else {
          const plan = await planDemotion(id);
          outcomes.push({ id, ok: true, plan });
        }
      } catch (err) {
        outcomes.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    // demoteFeaturedArtifact registers apps (chokidar watchers); stop them so the
    // process can exit instead of hanging on open handles.
    await appRegistry.stop();
    await closeMongo();
  }

  if (args.json) {
    process.stdout.write(JSON.stringify({ mode: args.execute ? 'execute' : 'plan', outcomes }, null, 2) + '\n');
  } else {
    printHuman(outcomes, args.execute);
  }
  process.exit(outcomes.every((o) => o.ok) ? 0 : 1);
}

main().catch((err) => {
  process.stderr.write(`[demote-featured] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
