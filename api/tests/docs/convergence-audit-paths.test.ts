/**
 * Citation gate for the run's two agent-facing docs: every repo path cited in
 * docs/CONVERGENCE_AUDIT.md and docs/CAPABILITY_CONTRACT.md must exist, so neither can rot as
 * the tree moves. Backticked `api/...`-style tokens resolve against this repo; `garrison:...`
 * tokens resolve against the sibling checkout ~/dev/garrison and are skipped (with a visible
 * count) when that checkout is not present on the machine running CI.
 *
 * CAPABILITY_CONTRACT.md earns this gate by its own thesis: a rule either names a gate that
 * exists, or admits it has none. A citation that stops existing must fail the build.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const repoRoot = resolve(__dirname, '..', '..', '..');
const garrisonRoot = join(homedir(), 'dev', 'garrison');

/** doc -> minimum citation count, so a broken extractor (or a gutted doc) fails loudly. */
const DOCS: Array<{ file: string; minEkoa: number }> = [
  { file: 'CONVERGENCE_AUDIT.md', minEkoa: 25 },
  { file: 'CAPABILITY_CONTRACT.md', minEkoa: 10 },
];

const EKOA_PATH = /^(api|web|shared|docs|scripts|clients|drills|tests|\.github)\/[\w()./@-]+$/;
const GARRISON_PREFIX = 'garrison:';

function citedTokens(docFile: string): string[] {
  const text = readFileSync(join(repoRoot, 'docs', docFile), 'utf8');
  const tokens = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
  // strip :line[-range] suffixes and trailing slashes before existence checks
  return tokens.map((t) => t.replace(/:\d+[\d,:-]*$/, '').replace(/\/+$/, ''));
}

describe.each(DOCS)('citation gate: docs/$file', ({ file, minEkoa }) => {
  const tokens = citedTokens(file);
  const ekoaPaths = [...new Set(tokens.filter((t) => EKOA_PATH.test(t)))];
  const garrisonPaths = [
    ...new Set(
      tokens.filter((t) => t.startsWith(GARRISON_PREFIX)).map((t) => t.slice(GARRISON_PREFIX.length).replace(/\/+$/, '')),
    ),
  ];

  it('extracts a sane citation set (regex not silently broken)', () => {
    expect(ekoaPaths.length).toBeGreaterThanOrEqual(minEkoa);
  });

  it('every cited ekoa-code path exists', () => {
    const missing = ekoaPaths.filter((p) => !existsSync(join(repoRoot, p)));
    expect(missing, `stale citations in ${file}: ${missing.join(', ')}`).toEqual([]);
  });

  it('every cited garrison path exists (skipped without the sibling checkout)', () => {
    if (!existsSync(garrisonRoot)) {
      console.warn(`[audit-gate] ~/dev/garrison absent - skipping ${garrisonPaths.length} garrison citations`);
      return;
    }
    const missing = garrisonPaths.filter((p) => !existsSync(join(garrisonRoot, p)));
    expect(missing, `stale garrison citations in ${file}: ${missing.join(', ')}`).toEqual([]);
  });
});
