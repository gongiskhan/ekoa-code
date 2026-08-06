#!/usr/bin/env node
/**
 * ekoa-dev parity audit (operator-run; NOT a CI gate - CI has no sibling checkout).
 *
 * Reads the recorded "Last audited upstream commit" SHA from docs/dev-parity.md,
 * fetches ../ekoa-dev (skip with --no-fetch), and lists every commit on origin/main
 * newer than the recorded SHA as a markdown row scaffold to disposition in the ledger.
 * Exits 1 while undispositioned commits exist, 0 when the ledger is current.
 *
 * The sibling repo is a READ-ONLY reference (docs/governance.md): this script runs
 * only `git fetch` / read commands against it, never a checkout or merge.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(repoRoot, 'docs', 'dev-parity.md');
const devDir = resolve(process.env.EKOA_DEV_DIR ?? join(repoRoot, '..', 'ekoa-dev'));
const noFetch = process.argv.includes('--no-fetch');

function git(args, opts = {}) {
  const out = execFileSync('git', ['-C', devDir, ...args], { encoding: 'utf8', ...opts });
  return typeof out === 'string' ? out.trim() : '';
}

function fail(msg) {
  console.error(`parity:audit FAIL - ${msg}`);
  process.exit(1);
}

if (!existsSync(devDir)) fail(`ekoa-dev checkout not found at ${devDir} (set EKOA_DEV_DIR)`);
if (!existsSync(ledgerPath)) fail(`ledger not found at ${ledgerPath}`);

const ledger = readFileSync(ledgerPath, 'utf8');
const m = ledger.match(/Last audited upstream commit: `([0-9a-f]{7,40})`/);
if (!m) fail('docs/dev-parity.md has no "Last audited upstream commit: `<sha>`" line');
const recorded = m[1];

if (!noFetch) {
  try {
    git(['fetch', 'origin'], { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    fail('git fetch failed (offline? use --no-fetch to audit against the last-fetched state)');
  }
}

let upstreamHead;
try {
  upstreamHead = git(['rev-parse', 'origin/main'], { stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  fail(`${devDir} has no origin/main to audit against (wrong remote, or a differently-named default branch)`);
}

// A recorded SHA that is no longer an ancestor means upstream rewrote history - the
// ledger's baseline is gone and the range below would be wrong.
try {
  git(['merge-base', '--is-ancestor', recorded, 'origin/main']);
} catch {
  fail(`recorded SHA ${recorded} is not an ancestor of origin/main (${upstreamHead.slice(0, 8)}) - upstream history rewritten? Re-baseline the ledger by hand.`);
}

// Advisory drift checks on the local checkout (never fatal - the audit reads origin/main).
try {
  const localHead = git(['rev-parse', 'main']);
  if (localHead !== upstreamHead) {
    const ahead = git(['rev-list', '--count', `origin/main..main`]);
    const behind = git(['rev-list', '--count', `main..origin/main`]);
    console.error(`note: local ekoa-dev main is ahead ${ahead} / behind ${behind} of origin/main (local-only commits are invisible to prod).`);
  }
} catch {
  /* detached HEAD or no local main - irrelevant to the audit */
}

const log = git(['log', '--reverse', '--date=short', '--format=%h%x09%ad%x09%s', `${recorded}..origin/main`]);
if (!log) {
  console.log(`parity:audit OK - ledger current at ${recorded.slice(0, 8)} (origin/main ${upstreamHead.slice(0, 8)})`);
  process.exit(0);
}

const rows = log.split('\n').map((line) => {
  const [sha, date, ...subject] = line.split('\t');
  return `| \`${sha}\` | ${date} | ${subject.join('\t').replace(/\|/g, '\\|')} | OPEN - |`;
});

console.error(`parity:audit - ${rows.length} upstream commit(s) past the recorded SHA need a disposition in docs/dev-parity.md:\n`);
console.error('| upstream | date | subject | disposition |');
console.error('|---|---|---|---|');
for (const row of rows) console.error(row);
console.error(`\nDisposition each row (PORTED / NOT-NEEDED / OPEN), append to the ledger, and update the`);
console.error(`"Last audited upstream commit" line to \`${upstreamHead}\`.`);
console.error(`Process: .claude/skills/ekoa-dev-parity/SKILL.md`);
process.exit(1);
