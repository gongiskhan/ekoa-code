/**
 * Shared-corpus import CLI (ch04 §4.4.1 + ch10 §10.3 discipline). Dry-run by default; `--execute`
 * required to write. The importer is the ONLY sanctioned writer of the reserved `_shared` vault
 * partition (the online service refuses a shared-org actor).
 *
 *   node --loader ts-node/esm api/scripts/migrate/knowledge/cli.ts --source <dir>            # dry-run
 *   node --loader ts-node/esm api/scripts/migrate/knowledge/cli.ts --source <dir> --execute  # write
 *   ... --collection jurisprudencia --collection legislacao   # restrict (repeatable)
 *   ... --limit 500 --batch 1000 --force --prune --json --journal ./RUN_LOG.knowledge-import.txt
 *
 * The target vault/index live under EKOA_DATA_DIR (or ~/.ekoa/data). The tool REFUSES (exit 2) if
 * --source resolves inside that data dir — the live corpus must never be its own import source.
 */
import { join } from 'node:path';
import { runKnowledgeImport, assertSourceOutsideDataDir, SourceUnderDataDirError, type ImportResult } from './importer.js';
import { closeIndex } from '../../../src/knowledge/index-store.js';

interface Args {
  source: string;
  collections: string[];
  limit?: number;
  batch: number;
  execute: boolean;
  force: boolean;
  prune: boolean;
  json: boolean;
  journal: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const getAll = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === flag && argv[i + 1] !== undefined) out.push(argv[i + 1] as string);
    return out;
  };
  const source = get('--source');
  if (!source) {
    process.stderr.write(
      'usage: cli.ts --source <dir> [--collection <name> ...] [--limit N] [--batch N] [--execute] [--force] [--prune] [--json] [--journal <file>]\n',
    );
    process.exit(2);
  }
  const limitRaw = get('--limit');
  const batchRaw = get('--batch');
  return {
    source,
    collections: getAll('--collection'),
    limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    batch: batchRaw !== undefined ? Number(batchRaw) : 1000,
    execute: argv.includes('--execute'),
    force: argv.includes('--force'),
    prune: argv.includes('--prune'),
    json: argv.includes('--json'),
    // Default to the CWD (the run repo), NEVER inside the source. --journal overrides.
    journal: get('--journal') ?? join(process.cwd(), 'RUN_LOG.knowledge-import.txt'),
  };
}

function printHuman(result: ImportResult): void {
  process.stdout.write(`\nekoa knowledge import - ${result.mode}\n`);
  process.stdout.write(`${'collection'.padEnd(28)} ${'parsed'.padStart(7)} ${'import'.padStart(7)} ${'skip'.padStart(6)} ${'malf'.padStart(5)} ${'anom'.padStart(5)} ${'prune'.padStart(6)}\n`);
  for (const c of result.collections) {
    process.stdout.write(
      `${c.collection.padEnd(28)} ${String(c.parsed).padStart(7)} ${String(c.imported).padStart(7)} ${String(c.skipped).padStart(6)} ${String(c.malformed).padStart(5)} ${String(c.anomalies).padStart(5)} ${String(c.pruned).padStart(6)}\n`,
    );
  }
  process.stdout.write(
    `\ntotal: ${result.total} considered | parsed ${result.parsed} | imported ${result.imported} | skipped ${result.skipped} | malformed ${result.malformed} | anomalies ${result.anomalies} | pruned ${result.pruned}\n`,
  );
  process.stdout.write(`result: ${result.ok ? 'OK' : 'ANOMALIES PRESENT'}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Guard before any work so the refusal is a clean exit 2 (the importer re-checks defensively).
  try {
    assertSourceOutsideDataDir(args.source);
  } catch (e) {
    if (e instanceof SourceUnderDataDirError) {
      process.stderr.write(`${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }

  try {
    const result = await runKnowledgeImport({
      sourceDir: args.source,
      collections: args.collections,
      limit: args.limit,
      batch: args.batch,
      execute: args.execute,
      force: args.force,
      prune: args.prune,
      journalPath: args.journal,
      onProgress: (line) => process.stderr.write(`${line}\n`),
    });
    if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    else printHuman(result);
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    closeIndex();
  }
}

void main();
