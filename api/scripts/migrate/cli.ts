/**
 * Import-tool CLI (ch10 §10.3). Dry-run by default; `--execute` required to write (§10.3 rule 3).
 *
 *   node --loader ts-node/esm api/scripts/migrate/cli.ts --source <dir> [--journal <file>]
 *   node --loader ts-node/esm api/scripts/migrate/cli.ts --source <dir> --execute \
 *        --content-data-dir <dir>          # execute needs MONGODB_URI + a data dir for blobs/prose
 *   ... --json                             # machine-readable summary on stdout
 *
 * Read-only on the source (§10.3 rule 1): a dry-run touches no database and needs no MONGODB_URI.
 * `--execute` connects to the target via MONGODB_URI (fail-fast). Every run appends a block to
 * the journal (§10.3 rule 5). Requires ENCRYPTION_KEY (the carried key) for the decrypt-samples.
 */
import { join } from 'node:path';
import { runImport, type RunResult } from './import-tool.js';

interface Args {
  source: string;
  execute: boolean;
  journal: string;
  contentDataDir?: string;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const source = get('--source');
  if (!source) {
    process.stderr.write('usage: cli.ts --source <dir> [--execute] [--content-data-dir <dir>] [--journal <file>] [--json]\n');
    process.exit(2);
  }
  return {
    source,
    execute: argv.includes('--execute'),
    journal: get('--journal') ?? join(source, 'RUN_LOG.migration.txt'),
    contentDataDir: get('--content-data-dir'),
    json: argv.includes('--json'),
  };
}

function printHuman(result: RunResult): void {
  process.stdout.write(`\nekoa migration - ${result.mode}\n`);
  process.stdout.write(`${'family'.padEnd(34)} ${'source'.padStart(7)} ${'imported'.padStart(9)}  checksum\n`);
  for (const f of result.families) {
    const cs = result.mode === 'execute' ? (f.checksumMatch ? 'MATCH' : 'MISMATCH') : f.checksumSource.slice(0, 16);
    process.stdout.write(`${f.family.padEnd(34)} ${String(f.sourceCount).padStart(7)} ${String(f.importedCount).padStart(9)}  ${cs}${f.sampled ? ' (1%)' : ''}\n`);
  }
  process.stdout.write(`\nnon-imports: ${result.nonImports.map((n) => n.file).join(', ')}\n`);
  process.stdout.write(`result: ${result.ok ? 'OK' : 'ANOMALIES PRESENT'}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.execute) {
    // Connect the target lazily so a dry-run needs no MONGODB_URI.
    const { connectMongo, closeMongo } = await import('../../src/data/mongo.js');
    await connectMongo();
    try {
      const result = await runImport({
        sourceDir: args.source,
        execute: true,
        journalPath: args.journal,
        contentDataDir: args.contentDataDir,
      });
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else printHuman(result);
      process.exitCode = result.ok ? 0 : 1;
    } finally {
      await closeMongo();
    }
    return;
  }

  const result = await runImport({ sourceDir: args.source, execute: false, journalPath: args.journal });
  if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else printHuman(result);
  process.exitCode = result.ok ? 0 : 1;
}

void main();
