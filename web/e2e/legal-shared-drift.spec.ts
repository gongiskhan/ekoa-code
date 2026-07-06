import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * S1-foundation - the canonical legal-shared layer must stay byte-identical
 * across the six featured scaffolds. `scripts/sync-legal-shared.mjs --check`
 * compares every synced file (styles.css / shared.js / Layout / Icons / ui)
 * against `ekoa-data/legal-shared/` and exits non-zero on any drift. This spec
 * is the gate: it fails if someone edits a scaffold copy instead of the
 * canonical source (or forgets to re-run the sync).
 */
test('legal-shared: the six scaffolds are in sync with the canonical layer', () => {
  const repoRoot = resolve(__dirname, '..', '..');
  let output = '';
  let exitOk = true;
  try {
    output = execFileSync('node', ['scripts/sync-legal-shared.mjs', '--check'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
  } catch (err: unknown) {
    exitOk = false;
    const e = err as { stdout?: string; stderr?: string };
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  expect(exitOk, `sync-legal-shared --check reported drift:\n${output}`).toBe(true);
});
