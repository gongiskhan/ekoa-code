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
 *
 * ======================== WHY IT ALSO LOOKS AT PEER CHECKOUTS ===========================
 * The first version audited `origin/main` and nothing else, and on 2026-08-06 that quietly
 * reported "ledger current" while four days of work sat on the operator's other machine,
 * committed and never pushed. GitHub was not the source of truth for ekoa-dev; it was just
 * the copy that happened to be reachable.
 *
 * So peers are audited too. A peer is any other checkout of ekoa-dev - another machine over
 * SSH, another directory - configured in `EKOA_DEV_PEERS` as a comma-separated list of
 * `name=<git-url-or-path>` entries, or in the ledger's own `<!-- parity-peers: ... -->`
 * marker so the configuration travels with the repo rather than living in one shell profile.
 * Each is fetched into `refs/remotes/parity-peer-<name>/main` (a namespace of our own, so a
 * peer can never move the sibling's real refs) and reported separately: commits a peer has
 * that origin does not are UNPUSHED work, and the audit says so instead of staying silent.
 *
 * A peer that cannot be reached is a WARNING, never a failure: the audit's job is to report
 * what it can see and be honest about what it cannot, and a laptop being closed is not a
 * parity finding.
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

/* ------------------------------- peer checkouts -------------------------------- */

/**
 * Peers come from `EKOA_DEV_PEERS` or, failing that, the ledger's own marker:
 *     <!-- parity-peers: madrid=ssh://dev-madrid/home/ggomes/dev/ekoa-dev -->
 * The ledger is the better home: a peer nobody's shell exports is a peer nobody audits.
 */
function configuredPeers() {
  // An EMPTY env var falls through to the ledger rather than suppressing it: `EKOA_DEV_PEERS=`
  // in a shell profile or a CI env block would otherwise silently disable the whole peer check
  // while looking like it was merely "not set".
  const fromEnv = process.env.EKOA_DEV_PEERS?.trim();
  const raw = fromEnv || (ledger.match(/<!--\s*parity-peers:\s*([^>]*?)\s*-->/)?.[1] ?? '');
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf('=');
      if (at < 0) return null;
      const name = entry.slice(0, at).trim();
      const url = entry.slice(at + 1).trim();
      // The name becomes a ref path component, so keep it boring.
      return name && url && /^[a-z0-9][a-z0-9-]*$/i.test(name) ? { name, url } : null;
    })
    .filter(Boolean);
}

/** Fetch one peer's main into our own namespace. Returns its head, or null when unreachable. */
function fetchPeer(peer) {
  const ref = `refs/remotes/parity-peer-${peer.name}/main`;
  if (!noFetch) {
    try {
      git(['fetch', peer.url, `main:${ref}`], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 60_000 });
    } catch {
      return null; // unreachable machine, wrong path, no network - reported, never fatal
    }
  }
  try {
    return git(['rev-parse', ref], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

/**
 * A peer gets its OWN recorded baseline in the ledger:
 *     Last audited peer commit (`madrid`): `c4f7f2c6` ...
 * Without one, every already-dispositioned unpushed commit would be re-reported forever and the
 * audit could never go green - which would train the operator to ignore it, the one failure mode
 * worse than not having the check at all.
 */
function recordedPeerBaseline(name) {
  const re = new RegExp(`Last audited peer commit \\(\`${name}\`\\):\\s*\`([0-9a-f]{7,40})\``);
  return ledger.match(re)?.[1] ?? null;
}

const peers = configuredPeers();
/** Peer commits that origin/main does NOT have: work that exists but has never been pushed. */
const peerFindings = [];
/** Peers actually READ. A peer we could not reach must never be reported as audited - that is the
 *  exact false reassurance this whole mechanism exists to stop giving. */
const peersAudited = [];
const peersSkipped = [];
for (const peer of peers) {
  const head = fetchPeer(peer);
  if (!head) {
    console.error(`note: peer "${peer.name}" (${peer.url}) is unreachable - its commits, if any, were NOT audited.`);
    peersSkipped.push(peer.name);
    continue;
  }
  peersAudited.push(peer.name);
  const unpushedCount = git(['rev-list', '--count', `origin/main..${head}`]);

  // Anything the peer holds that origin lacks AND that is newer than this peer's own baseline.
  const baseline = recordedPeerBaseline(peer.name);
  let range = `origin/main..${head}`;
  if (baseline) {
    try {
      git(['merge-base', '--is-ancestor', baseline, head]);
      range = `${baseline}..${head}`;
    } catch {
      console.error(
        `note: peer "${peer.name}" baseline ${baseline.slice(0, 8)} is not an ancestor of its head` +
          ` - rebased or rewritten. Falling back to every unpushed commit.`,
      );
    }
  }
  const pending = git(['log', '--reverse', '--date=short', '--format=%h%x09%ad%x09%s', range, '--not', 'origin/main']);
  if (pending) {
    peerFindings.push({ peer, head, lines: pending.split('\n') });
  } else if (Number(unpushedCount) > 0) {
    console.error(
      `note: peer "${peer.name}" holds ${unpushedCount} commit(s) origin/main does not, all dispositioned` +
        ` (baseline ${baseline ? baseline.slice(0, 8) : 'none'}). Still unpushed upstream.`,
    );
  }
}

function rowsFrom(lines) {
  return lines.map((line) => {
    const [sha, date, ...subject] = line.split('\t');
    return `| \`${sha}\` | ${date} | ${subject.join('\t').replace(/\|/g, '\\|')} | OPEN - |`;
  });
}

function printRows(rows) {
  console.error('| upstream | date | subject | disposition |');
  console.error('|---|---|---|---|');
  for (const row of rows) console.error(row);
}

/* ------------------------------- the audit itself ------------------------------- */

const log = git(['log', '--reverse', '--date=short', '--format=%h%x09%ad%x09%s', `${recorded}..origin/main`]);

if (!log && peerFindings.length === 0) {
  console.log(`parity:audit OK - ledger current at ${recorded.slice(0, 8)} (origin/main ${upstreamHead.slice(0, 8)})`);
  if (peersAudited.length) console.log(`  peers audited: ${peersAudited.join(', ')}`);
  // Stated on the SUCCESS line too, not only as a note above it: "OK" next to a silently skipped
  // peer is the same false reassurance the origin-only audit used to give.
  if (peersSkipped.length) console.log(`  peers NOT audited (unreachable): ${peersSkipped.join(', ')}`);
  process.exit(0);
}

if (log) {
  const rows = rowsFrom(log.split('\n'));
  console.error(`parity:audit - ${rows.length} upstream commit(s) past the recorded SHA need a disposition in docs/dev-parity.md:\n`);
  printRows(rows);
  console.error(`\nDisposition each row (PORTED / NOT-NEEDED / OPEN), append to the ledger, and update the`);
  console.error(`"Last audited upstream commit" line to \`${upstreamHead}\`.`);
}

for (const finding of peerFindings) {
  const rows = rowsFrom(finding.lines);
  console.error(
    `\nparity:audit - peer "${finding.peer.name}" has ${rows.length} commit(s) that origin/main does NOT.` +
      ` This work is UNPUSHED: it is invisible to GitHub, to prod, and to anyone auditing only origin.\n`,
  );
  printRows(rows);
  console.error(`\nRead them with: git -C <ekoa-dev> show <sha>   (fetched as refs/remotes/parity-peer-${finding.peer.name}/main)`);
}

console.error(`\nProcess: .claude/skills/ekoa-dev-parity/SKILL.md`);
process.exit(1);
