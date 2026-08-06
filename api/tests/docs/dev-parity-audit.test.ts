import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE PARITY AUDIT ITSELF.
 *
 * On 2026-08-06 this script reported "ledger current" while four days of upstream work sat on the
 * operator's other machine, committed and never pushed. It was not wrong about `origin/main`; it
 * was wrong about what the question meant. GitHub is not the source of truth for ekoa-dev, so an
 * audit that only reads GitHub answers confidently and uselessly.
 *
 * The check that catches that is now itself checked. What is proved here:
 *
 *  A. It still does its original job: new commits on origin/main are reported and it exits non-zero.
 *  B. It sees a PEER checkout — commits that exist on another machine and nowhere else — and says
 *     so explicitly, rather than passing.
 *  C. Dispositioned peer work goes GREEN. Without a per-peer baseline the same unpushed commits
 *     would be re-reported forever, and an audit that is permanently red is one nobody reads.
 *  D. An unreachable peer WARNS and does not fail — a closed laptop is not a parity finding — but
 *     it also never silently counts as "audited".
 *
 * Everything runs against throwaway git repos in a temp dir. Nothing touches ../ekoa-dev.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/dev-parity-audit.mjs');

let root: string;
let originDir: string;
let devDir: string;
let peerDir: string;
let baseSha: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function commit(cwd: string, file: string, message: string): string {
  writeFileSync(join(cwd, file), `${message}\n`);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** Run the audit against a ledger we author, and capture what the operator would see. */
function runAudit(ledgerBody: string): { code: number; out: string } {
  const ledgerDir = join(root, 'repo', 'docs');
  mkdirSync(ledgerDir, { recursive: true });
  writeFileSync(join(ledgerDir, 'dev-parity.md'), ledgerBody);
  // spawnSync, not execFileSync: the audit writes its findings to STDERR and its verdict to
  // STDOUT, so capturing only stdout would miss every warning — including the "unreachable peer"
  // one. `out` is both streams, which is what the operator actually reads.
  //
  // Fetching is NOT skipped: peers are only reachable through a fetch, so `--no-fetch` would make
  // every peer look unreachable and prove nothing. Every remote here is a local path.
  const res = spawnSync('node', [join(root, 'repo', 'scripts', 'dev-parity-audit.mjs')], {
    encoding: 'utf8',
    // EKOA_DEV_PEERS is cleared so a peer configured in the operator's shell cannot leak in and
    // make these outcomes depend on which machine the suite runs on. An empty value falls back to
    // the ledger marker, which each case authors for itself.
    env: { ...process.env, EKOA_DEV_DIR: devDir, EKOA_DEV_PEERS: '' },
    cwd: join(root, 'repo'),
  });
  return { code: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

/**
 * The script resolves its ledger relative to ITSELF, so the temp ledger is reached by pointing a
 * copy of the script at a temp repo root. Simpler: copy the script into the temp repo's scripts/.
 */
function installScript(): void {
  const dir = join(root, 'repo', 'scripts');
  mkdirSync(dir, { recursive: true });
  execFileSync('cp', [SCRIPT, join(dir, 'dev-parity-audit.mjs')]);
}

const ledger = (opts: { recorded: string; peers?: string; peerBaseline?: string }): string =>
  [
    '# ledger',
    opts.peers ? `<!-- parity-peers: ${opts.peers} -->` : '',
    `Last audited upstream commit: \`${opts.recorded}\``,
    opts.peerBaseline ? `Last audited peer commit (\`madrid\`): \`${opts.peerBaseline}\`` : '',
  ].join('\n\n');

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'parity-audit-'));
  originDir = join(root, 'origin');
  devDir = join(root, 'dev');
  peerDir = join(root, 'peer');

  // A bare-ish "GitHub" with one commit, cloned into the local sibling and into a peer machine.
  mkdirSync(originDir, { recursive: true });
  git(originDir, 'init', '-q', '-b', 'main');
  git(originDir, 'config', 'user.email', 't@t');
  git(originDir, 'config', 'user.name', 't');
  baseSha = commit(originDir, 'a.txt', 'base commit');

  for (const [dir] of [[devDir], [peerDir]]) {
    execFileSync('git', ['clone', '-q', originDir, dir]);
    git(dir, 'config', 'user.email', 't@t');
    git(dir, 'config', 'user.name', 't');
  }
  installScript();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('parity audit — the original job', () => {
  it('goes GREEN when the ledger matches origin/main', () => {
    const res = runAudit(ledger({ recorded: baseSha }));
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/ledger current/);
  });

  it('reports a NEW upstream commit as a row scaffold and exits non-zero', () => {
    const newSha = commit(originDir, 'b.txt', 'feat: something upstream');
    git(devDir, 'fetch', 'origin');
    const res = runAudit(ledger({ recorded: baseSha }));
    expect(res.code).toBe(1);
    expect(res.out).toContain('feat: something upstream');
    expect(res.out).toContain(newSha.slice(0, 7));
    expect(res.out).toContain('OPEN -');
    // Re-baselining the ledger closes it.
    expect(runAudit(ledger({ recorded: newSha })).code).toBe(0);
  });

  it('refuses to audit against a baseline upstream no longer has (history rewritten)', () => {
    const res = runAudit(ledger({ recorded: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }));
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/not an ancestor|FAIL/);
  });
});

describe('parity audit — the blind spot it was built to close', () => {
  it('SEES a commit that exists only on a peer machine, and names it unpushed', () => {
    const head = git(originDir, 'rev-parse', 'HEAD');
    const peerSha = commit(peerDir, 'c.txt', 'feat: work that never got pushed');

    const res = runAudit(ledger({ recorded: head, peers: `madrid=${peerDir}` }));

    expect(res.code).toBe(1);
    expect(res.out).toContain('feat: work that never got pushed');
    expect(res.out).toContain(peerSha.slice(0, 7));
    // The wording is the point: silence here is what went wrong the first time.
    expect(res.out).toMatch(/UNPUSHED/);
  });

  it('goes GREEN once that peer work is dispositioned — but still says it is unpushed', () => {
    const head = git(originDir, 'rev-parse', 'HEAD');
    const peerHead = git(peerDir, 'rev-parse', 'HEAD');

    const res = runAudit(ledger({ recorded: head, peers: `madrid=${peerDir}`, peerBaseline: peerHead }));

    expect(res.code).toBe(0);
    expect(res.out).toMatch(/all dispositioned/);
    expect(res.out).toMatch(/Still unpushed upstream/);
  });

  it('reports the NEXT peer commit after the baseline, not the ones already handled', () => {
    const head = git(originDir, 'rev-parse', 'HEAD');
    const dispositioned = git(peerDir, 'rev-parse', 'HEAD');
    const fresh = commit(peerDir, 'd.txt', 'feat: newer peer work');

    const res = runAudit(ledger({ recorded: head, peers: `madrid=${peerDir}`, peerBaseline: dispositioned }));

    expect(res.code).toBe(1);
    expect(res.out).toContain('feat: newer peer work');
    expect(res.out).toContain(fresh.slice(0, 7));
    // The already-dispositioned one is NOT re-reported.
    expect(res.out).not.toContain('feat: work that never got pushed');
  });

  it('an UNREACHABLE peer warns loudly and is never counted as audited', () => {
    const head = git(originDir, 'rev-parse', 'HEAD');
    const res = runAudit(ledger({ recorded: head, peers: 'madrid=/nonexistent/path/to/nowhere' }));
    expect(res.out).toMatch(/unreachable/);
    expect(res.out).toMatch(/were NOT audited/);
  });

  it('ignores a malformed peer entry rather than treating it as a URL', () => {
    const head = git(originDir, 'rev-parse', 'HEAD');
    const res = runAudit(ledger({ recorded: head, peers: 'not-a-pair' }));
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/ledger current/);
  });
});
