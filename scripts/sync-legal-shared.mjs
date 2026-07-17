#!/usr/bin/env node
/**
 * sync-legal-shared - keep the legal apps' shared layer byte-identical.
 *
 * The 29 legal featured-artifact scaffolds share a common layer (styles.css,
 * shared.js, demo-spine.js, demo.js, components/{Layout,ui,Icons}.jsx). The
 * canonical source is COMMITTED at `api/assets/legal-shared/`; a runtime
 * mirror is kept at `ekoa-data/legal-shared/` (local working dir, gitignored)
 * so tooling that reads the documented mirror location keeps working.
 *
 *   --check  compare every scaffold copy against the canonical layer;
 *            print a drift report and exit 1 on any difference.
 *   --write  propagate the canonical layer to every scaffold (and refresh
 *            the ekoa-data mirror), then exit 0.
 *
 * The ported e2e gate `web/e2e/legal-shared-drift.spec.ts` runs `--check`:
 * edit the canonical source, run `--write`, never edit a scaffold copy.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = join(ROOT, 'api', 'assets', 'legal-shared');
const MIRROR = join(ROOT, 'ekoa-data', 'legal-shared');
const SCAFFOLD_ROOT = join(ROOT, 'api', 'assets', 'featured-artifacts');

const SHARED_FILES = [
  'shared.js',
  'styles.css',
  'demo-spine.js',
  'demo.js',
  'components/Layout.jsx',
  'components/ui.jsx',
  'components/Icons.jsx',
];

function legalScaffolds() {
  return readdirSync(SCAFFOLD_ROOT)
    .filter((d) => d.startsWith('legal-'))
    .map((d) => ({ app: d, src: join(SCAFFOLD_ROOT, d, 'scaffold', 'frontend', 'src') }))
    .filter(({ src }) => existsSync(src));
}

function refreshMirror() {
  for (const rel of SHARED_FILES) {
    const dst = join(MIRROR, rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(join(CANONICAL, rel), dst);
  }
}

function main() {
  const mode = process.argv[2];
  if (mode !== '--check' && mode !== '--write') {
    console.error('usage: node scripts/sync-legal-shared.mjs --check | --write');
    process.exit(2);
  }

  for (const rel of SHARED_FILES) {
    if (!existsSync(join(CANONICAL, rel))) {
      console.error(`[FAIL] canonical file missing: api/assets/legal-shared/${rel}`);
      process.exit(1);
    }
  }

  const scaffolds = legalScaffolds();
  if (scaffolds.length === 0) {
    console.error('[FAIL] no legal-* scaffolds found under api/assets/featured-artifacts/');
    process.exit(1);
  }

  refreshMirror();

  if (mode === '--write') {
    let copied = 0;
    for (const { src } of scaffolds) {
      for (const rel of SHARED_FILES) {
        const dst = join(src, rel);
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(join(CANONICAL, rel), dst);
        copied += 1;
      }
    }
    console.log(`[sync-legal-shared] wrote ${SHARED_FILES.length} files to ${scaffolds.length} scaffolds (${copied} copies); mirror refreshed`);
    return;
  }

  const drift = [];
  for (const { app, src } of scaffolds) {
    for (const rel of SHARED_FILES) {
      const copy = join(src, rel);
      if (!existsSync(copy)) {
        drift.push(`${app}: MISSING ${rel}`);
        continue;
      }
      const a = readFileSync(join(CANONICAL, rel));
      const b = readFileSync(copy);
      if (!a.equals(b)) drift.push(`${app}: DIFFERS ${rel}`);
    }
  }

  if (drift.length > 0) {
    console.error(`[FAIL] legal-shared drift in ${drift.length} file(s):`);
    for (const line of drift) console.error(`  - ${line}`);
    console.error('Fix: edit api/assets/legal-shared/ then run: node scripts/sync-legal-shared.mjs --write');
    process.exit(1);
  }
  console.log(`[sync-legal-shared] OK - ${scaffolds.length} scaffolds x ${SHARED_FILES.length} files in sync with the canonical layer`);
}

main();
