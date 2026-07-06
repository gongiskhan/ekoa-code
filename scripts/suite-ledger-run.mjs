#!/usr/bin/env node
/**
 * The suite-ledger runner (ch14 §14.2.5). The single source of truth for which ported
 * test artifacts run at the current gate and which are `skipped (awaiting G<N>)`.
 *
 *   node scripts/suite-ledger-run.mjs [--gate G<N>] [--run]
 *
 * Behavior:
 *  - Census: assert the ported Playwright specs and node drivers on disk match the ledger
 *    counts (55 specs, 14 drivers). A missing or extra artifact fails the run — never a
 *    silent omission (§14.2.5).
 *  - Partition every artifact into DUE (targetGate <= currentGate) vs AWAITING. AWAITING
 *    artifacts are reported `skipped (awaiting G<N>)` and NOT handed to a runner (a
 *    not-yet-runnable artifact must not fail — its stack does not exist yet).
 *  - With --run, DUE Playwright specs are executed via `playwright test` and DUE drivers
 *    via node; without --run (the census/skip lane, e.g. at G1) nothing is executed.
 *  - Ratchet: an artifact once green at its gate may never regress to skip/red. The ratchet
 *    state is the committed ledger's target gates plus this run's results; a DUE artifact
 *    that is red fails the run.
 *
 * The deliberate ledger violation (§14.4 G1): mark an artifact due at the current gate that
 * cannot pass → it becomes DUE, the runner tries to run it, it is red, the run fails.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = join(ROOT, 'api/tests/SUITE_LEDGER.json');

// Gate ordering (chapter 14). Index = "has arrived by".
const GATE_ORDER = ['G-P', 'G0', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G7A', 'G7B', 'G8', 'G8A', 'G9', 'G10', 'G11', 'G12', 'G13'];
const gateIndex = (g) => {
  const i = GATE_ORDER.indexOf(g);
  if (i < 0) throw new Error(`Unknown gate: ${g}`);
  return i;
};

/** The current gate = the highest gate-* git tag reached, unless overridden with --gate. */
function detectGateFromTags() {
  try {
    const tags = execSync('git tag --list "gate-*"', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => t.replace(/^gate-/, ''))
      .map((g) => (g === 'P' ? 'G-P' : `G${g}`));
    let best = 'G-P';
    for (const g of tags) {
      if (GATE_ORDER.includes(g) && gateIndex(g) > gateIndex(best)) best = g;
    }
    return best;
  } catch {
    return 'G-P';
  }
}

function parseArgs(ledger) {
  const args = process.argv.slice(2);
  let gate;
  let run = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--gate') gate = args[++i];
    else if (args[i] === '--run') run = true;
  }
  // Gate resolution, most-authoritative first:
  //  1. explicit --gate,
  //  2. the COMMITTED ledger.currentGate (deterministic, no git dependency),
  //  3. the highest gate-* git tag,
  //  4. fail-safe: G13 (everything due) so a tag/ledger-less checkout runs the whole estate
  //     and fails loudly on any red — never silently skips everything (which would hide regressions).
  if (!gate) gate = ledger.currentGate;
  if (!gate) gate = detectGateFromTags();
  if (!gate) {
    process.stderr.write('[suite-ledger] WARN: no --gate, no ledger.currentGate, no gate-* tag — defaulting to G13 (all due, fail-safe)\n');
    gate = 'G13';
  }
  return { gate, run };
}

function loadLedger() {
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}

/** Flatten the ledger into a list of { kind, name, file, targetGate }. */
function ledgerArtifacts(ledger) {
  const out = [];
  const pw = ledger.playwright;
  for (const band of ['band1_zero_change', 'band2_fixture_swap', 'band3_served_app']) {
    const b = pw[band];
    for (const spec of b.specs) out.push({ kind: 'spec', name: spec, file: `web/e2e/${spec}.spec.ts`, targetGate: b.targetGate });
  }
  for (const d of ledger.node_drivers.drivers) {
    out.push({ kind: 'driver', name: d.name, file: `api/tests/e2e/${d.name}.e2e.mjs`, targetGate: d.targetGate });
  }
  const fu = ledger.frontend_unit;
  for (const name of fu.surviving) {
    out.push({ kind: 'unit', name, file: `web/__tests__/${name}.test.ts`, altFile: `web/__tests__/${name}.test.tsx`, targetGate: fu.targetGate });
  }
  return out;
}

/** The dev-server base the node drivers target (committed `backend.port` file, else 4111). */
function driverServerBase() {
  try { return `http://127.0.0.1:${readFileSync(join(ROOT, 'backend.port'), 'utf8').trim()}`; }
  catch { return 'http://127.0.0.1:4111'; }
}

/**
 * A DUE driver whose server is unreachable must FAIL the run, never skip-green. The ported
 * drivers exit 0 with a "SKIP: cortex not reachable" note when /health is down — a design
 * for ad-hoc local runs. Under the ledger that would count a due artifact green without
 * executing a single assertion: exactly the silent false-green §14.2.5 exists to prevent
 * (and how the unadapted G4 drivers rode green through two gates — RUN_LOG 2026-07-06
 * resume DEVIATION). So the runner preflights /health itself and goes red, loudly.
 */
async function serverReachable(base) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(`${base}/health`, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

/** Recursively list files under a dir matching a predicate (relative paths). */
function listFiles(dir, pred, base = dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, pred, base, acc);
    else if (pred(e.name)) acc.push(p.slice(base.length + 1));
  }
  return acc;
}

async function main() {
  const ledger = loadLedger();
  const { gate, run } = parseArgs(ledger);
  const currentIdx = gateIndex(gate);
  const artifacts = ledgerArtifacts(ledger);

  const specs = artifacts.filter((a) => a.kind === 'spec');
  const drivers = artifacts.filter((a) => a.kind === 'driver');
  const units = artifacts.filter((a) => a.kind === 'unit');

  // Census against disk (count-match in BOTH directions catches omission AND drift).
  const specFilesOnDisk = existsSync(join(ROOT, 'web/e2e'))
    ? readdirSync(join(ROOT, 'web/e2e')).filter((f) => f.endsWith('.spec.ts'))
    : [];
  const driverFilesOnDisk = existsSync(join(ROOT, 'api/tests/e2e'))
    ? readdirSync(join(ROOT, 'api/tests/e2e')).filter((f) => f.endsWith('.e2e.mjs'))
    : [];
  const unitFilesOnDisk = listFiles(join(ROOT, 'web/__tests__'), (f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx'));

  let failed = false;
  const log = (s) => process.stdout.write(s + '\n');

  log(`[suite-ledger] gate=${gate} run=${run}`);
  log(`[census] specs on disk: ${specFilesOnDisk.length} (ledger: ${specs.length})`);
  log(`[census] drivers on disk: ${driverFilesOnDisk.length} (ledger: ${drivers.length})`);
  log(`[census] frontend unit files on disk: ${unitFilesOnDisk.length} (ledger: ${units.length})`);
  if (specFilesOnDisk.length !== specs.length) {
    log(`[FAIL] spec census mismatch: disk ${specFilesOnDisk.length} != ledger ${specs.length}`);
    failed = true;
  }
  if (driverFilesOnDisk.length !== drivers.length) {
    log(`[FAIL] driver census mismatch: disk ${driverFilesOnDisk.length} != ledger ${drivers.length}`);
    failed = true;
  }
  if (unitFilesOnDisk.length !== units.length) {
    log(`[FAIL] unit census mismatch: disk ${unitFilesOnDisk.length} != ledger ${units.length} (drift or omission)`);
    failed = true;
  }
  // NOTE ON SCOPE: this runner censuses the externally-authored estate that arrives before
  // the system it exercises (Playwright specs, node drivers, frontend unit files). The in-repo
  // contract tests (api/tests/contract/**) and the 146 carryover module tests travel WITH their
  // modules and are enforced by `npm test` (api/web vitest) in the CI lane — a red one fails CI
  // directly. Their target-gate mapping in SUITE_LEDGER.json is documentation; their ratchet is
  // `npm test`, not this runner. See ledger sections contract_tests_from_ruleset / module_tests_146.

  // Every ledger artifact must exist on disk (no silent omission). Unit files may be .ts or .tsx.
  for (const a of artifacts) {
    const present = existsSync(join(ROOT, a.file)) || (a.altFile && existsSync(join(ROOT, a.altFile)));
    if (!present) {
      log(`[FAIL] ledger artifact missing on disk: ${a.file}`);
      failed = true;
    }
  }

  const due = artifacts.filter((a) => gateIndex(a.targetGate) <= currentIdx);
  const awaiting = artifacts.filter((a) => gateIndex(a.targetGate) > currentIdx);

  for (const a of awaiting) log(`  skipped (awaiting ${a.targetGate}) — ${a.kind} ${a.name}`);
  log(`[summary] due-at-${gate}: ${due.length}, awaiting: ${awaiting.length}`);

  if (due.length > 0) {
    if (!run) {
      // A due artifact with no execution requested is a ledger error: it should have run.
      log(`[FAIL] ${due.length} artifact(s) are due at ${gate} but --run was not passed — cannot report them green.`);
      for (const a of due) log(`  due (unrun) — ${a.kind} ${a.name} @ ${a.targetGate}`);
      failed = true;
    } else {
      const dueSpecs = due.filter((a) => a.kind === 'spec').map((a) => a.file);
      const dueDrivers = due.filter((a) => a.kind === 'driver');
      if (dueSpecs.length > 0) {
        try {
          execSync(`npx playwright test ${dueSpecs.join(' ')}`, { cwd: ROOT, stdio: 'inherit' });
        } catch {
          log(`[FAIL] due Playwright specs red at ${gate}`);
          failed = true;
        }
      }
      if (dueDrivers.length > 0) {
        const base = driverServerBase();
        if (!(await serverReachable(base))) {
          log(`[FAIL] ${dueDrivers.length} due driver(s) require a live dev API at ${base} — start it (MONGODB_URI=... npm run dev --workspace api) and re-run. An unreachable-server skip is NOT green.`);
          for (const d of dueDrivers) log(`  due (server unreachable) — driver ${d.name} @ ${d.targetGate}`);
          failed = true;
        } else {
          for (const d of dueDrivers) {
            try {
              execSync(`node ${d.file}`, { cwd: ROOT, stdio: 'inherit' });
            } catch {
              log(`[FAIL] due driver red at ${gate}: ${d.name}`);
              failed = true;
            }
          }
        }
      }
      // Due frontend unit files run via the web workspace vitest (they become runnable at G9,
      // when the web migration lands their imports). A red due-unit fails the run.
      const dueUnits = due.filter((a) => a.kind === 'unit');
      if (dueUnits.length > 0) {
        const patterns = dueUnits.map((a) => `__tests__/${a.name}`);
        try {
          execSync(`npm run test --workspace web -- ${patterns.join(' ')}`, { cwd: ROOT, stdio: 'inherit' });
        } catch {
          log(`[FAIL] due frontend unit tests red at ${gate}`);
          failed = true;
        }
      }
    }
  }

  if (failed) {
    log('[suite-ledger] FAILED');
    process.exit(1);
  }
  log('[suite-ledger] OK — census matches, every non-due artifact ledger-skipped, ratchet holds');
}

await main();
