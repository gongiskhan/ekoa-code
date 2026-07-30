/**
 * Convergence-audit citation gate: every repo path cited in docs/CONVERGENCE_AUDIT.md must exist,
 * so the audit cannot silently rot as the tree moves. Backticked `api/...`-style tokens resolve
 * against this repo; `garrison:...` tokens resolve against the sibling checkout ~/dev/garrison and
 * are skipped (with a visible count) when that checkout is not present on the machine running CI.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';

const repoRoot = resolve(__dirname, '..', '..', '..');
const auditPath = join(repoRoot, 'docs', 'CONVERGENCE_AUDIT.md');
const garrisonRoot = join(homedir(), 'dev', 'garrison');

const EKOA_PATH = /^(api|web|shared|docs|scripts|clients|drills|tests)\/[\w()./@-]+$/;
const GARRISON_PREFIX = 'garrison:';

function citedTokens(): string[] {
  const text = readFileSync(auditPath, 'utf8');
  const tokens = [...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
  // strip :line[-range] suffixes and trailing slashes before existence checks
  return tokens.map((t) => t.replace(/:\d+[\d,:-]*$/, '').replace(/\/+$/, ''));
}

describe('convergence audit citations (docs/CONVERGENCE_AUDIT.md)', () => {
  const tokens = citedTokens();
  const ekoaPaths = [...new Set(tokens.filter((t) => EKOA_PATH.test(t)))];
  const garrisonPaths = [
    ...new Set(
      tokens.filter((t) => t.startsWith(GARRISON_PREFIX)).map((t) => t.slice(GARRISON_PREFIX.length).replace(/\/+$/, '')),
    ),
  ];

  it('extracts a sane citation set (regex not silently broken)', () => {
    expect(ekoaPaths.length).toBeGreaterThan(25);
    expect(garrisonPaths.length).toBeGreaterThan(10);
  });

  it('every cited ekoa-code path exists', () => {
    const missing = ekoaPaths.filter((p) => !existsSync(join(repoRoot, p)));
    expect(missing, `stale audit citations: ${missing.join(', ')}`).toEqual([]);
  });

  it('every cited garrison path exists (skipped without the sibling checkout)', () => {
    if (!existsSync(garrisonRoot)) {
      console.warn(`[audit-gate] ~/dev/garrison absent — skipping ${garrisonPaths.length} garrison citations`);
      return;
    }
    const missing = garrisonPaths.filter((p) => !existsSync(join(garrisonRoot, p)));
    expect(missing, `stale garrison citations: ${missing.join(', ')}`).toEqual([]);
  });
});
