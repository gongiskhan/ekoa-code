#!/usr/bin/env node
/**
 * CLIENT DRIFT GATE.
 *
 * Regenerates the typed client from `docs/openapi/cortex.v1.json` into a scratch directory and
 * diffs it against the committed `src/generated/*`. Any difference fails, naming the fix.
 *
 * This is the second half of the chain the Capability Contract asks for. The first half
 * (`api/tests/contract/openapi-drift.test.ts`) proves the SPEC still equals the `shared/`
 * descriptors; this proves the CLIENT still equals the spec. Together: descriptors -> spec ->
 * client, with no link that can move quietly.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate-client.mjs';

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const committedDir = join(pkgRoot, 'src', 'generated');
const scratch = mkdtempSync(join(tmpdir(), 'cortex-client-drift-'));

try {
  const fresh = await generate(scratch);
  const files = [
    ['cortex-v1.d.ts', fresh.types],
    ['operations.ts', fresh.operations],
  ];
  const drifted = [];
  for (const [name, regenerated] of files) {
    let committed;
    try {
      committed = readFileSync(join(committedDir, name), 'utf8');
    } catch {
      drifted.push(`${name} (missing)`);
      continue;
    }
    if (committed !== regenerated) drifted.push(name);
  }

  if (drifted.length > 0) {
    console.error(
      [
        'CLIENT DRIFT: the committed generated client no longer matches docs/openapi/cortex.v1.json.',
        `  drifted: ${drifted.join(', ')}`,
        '  fix: npm run generate --workspace @ekoa/cortex-cli && review the diff before committing.',
        '  (If the SPEC is what changed, regenerate it first: npm run openapi:generate.)',
      ].join('\n'),
    );
    process.exit(1);
  }
  console.log(`cortex-cli client drift: clean (${files.map(([n]) => n).join(', ')} match the spec)`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
