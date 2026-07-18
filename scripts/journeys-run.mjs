#!/usr/bin/env node
/**
 * Journey-probe lanes (ledger `journeys` section; ekoa-testing layer-2/3 evidence).
 *
 *   npm run journeys:credless        node scripts/journeys-run.mjs
 *   npm run journeys:credentialed    node scripts/journeys-run.mjs --credentialed
 *
 * Credless lane (per-PR capable): boots the api ALONE (dev-api.mjs --built on
 * EKOA_JOURNEYS_PORT, default 4123 — parameterized so it runs beside a live dev
 * stack), waits for DEV-API READY, then runs each credless probe with
 * EKOA_BASE pointed at that api. LLM-free, credential-free, deterministic.
 *
 * Credentialed lane (opt-in; NEVER a per-PR gate): boots the full seeded stack via
 * api/tests/journeys/boot-b.mjs (operator keychain credential, real model egress,
 * fixed ports 4211/4111/3000) and runs the credentialed probes against its proxy.
 *
 * Gate semantics (_lib.mjs unchanged): a probe FAILS the lane iff it exits nonzero
 * or emits a `FAIL <id>` line. PASS/INFO both pass — INFO is a recorded observation,
 * not a defect. Evidence regenerates under api/tests/evidence/.
 *
 * Census (§14.2.5 discipline, enforced here because these lanes never pass through
 * suite-ledger-run.mjs): the *.mjs files under api/tests/journeys/ must equal the
 * ledger's `journeys` helpers + both lanes' probes, both directions, every run.
 */
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attachWatcher, makeTeardown } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const JOURNEYS_DIR = join(ROOT, 'api', 'tests', 'journeys');
const LEDGER = join(ROOT, 'api', 'tests', 'SUITE_LEDGER.json');

const credentialed = process.argv.includes('--credentialed');

const children = [];
function log(m) { process.stdout.write(`[journeys] ${m}\n`); }

const teardown = makeTeardown({ children });
process.on('SIGINT', () => teardown(130));
process.on('SIGTERM', () => teardown(143));

/** Run one probe; returns { name, exitCode, failLines } with stdout/stderr echoed. */
function runProbe(name, base) {
  return new Promise((resolvePromise) => {
    log(`probe ${name} (EKOA_BASE=${base})`);
    const child = spawn('node', [join(JOURNEYS_DIR, `${name}.mjs`)], {
      cwd: ROOT,
      env: { ...process.env, EKOA_BASE: base },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // tracked below: teardown must reach a mid-flight probe
    });
    children.push(child);
    let out = '';
    child.stdout.on('data', (b) => { const t = b.toString(); out += t; process.stdout.write(t); });
    child.stderr.on('data', (b) => process.stderr.write(b.toString()));
    child.on('exit', (code) => {
      const failLines = out.split('\n').filter((l) => /^FAIL /.test(l));
      resolvePromise({ name, exitCode: code ?? 1, failLines });
    });
  });
}

async function main() {
  const journeys = JSON.parse(readFileSync(LEDGER, 'utf8')).journeys;
  if (!journeys) throw new Error('SUITE_LEDGER.json has no `journeys` section');

  // Two-way census: disk == helpers + credless.probes + credentialed.probes.
  const onDisk = readdirSync(JOURNEYS_DIR).filter((f) => f.endsWith('.mjs')).map((f) => f.replace(/\.mjs$/, ''));
  const inLedger = [...journeys.helpers, ...journeys.credless.probes, ...journeys.credentialed.probes];
  const diskSet = new Set(onDisk);
  const ledgerSet = new Set(inLedger);
  const missing = inLedger.filter((n) => !diskSet.has(n));
  const unregistered = onDisk.filter((n) => !ledgerSet.has(n));
  if (missing.length || unregistered.length || inLedger.length !== ledgerSet.size) {
    for (const n of missing) log(`[FAIL] ledger journey missing on disk: ${n}.mjs`);
    for (const n of unregistered) log(`[FAIL] journey on disk not in ledger: ${n}.mjs`);
    if (inLedger.length !== ledgerSet.size) log('[FAIL] duplicate journey name in ledger');
    throw new Error('journeys census mismatch (disk != ledger)');
  }
  log(`census OK: ${onDisk.length} files (${journeys.helpers.length} helpers, ${journeys.credless.probes.length} credless, ${journeys.credentialed.probes.length} credentialed)`);

  let base;
  let probes;
  if (credentialed) {
    // boot-b owns its fixed ports (4211/4111/3000) and its own keychain/seeding flow.
    probes = journeys.credentialed.probes;
    log('booting the credentialed stack (api/tests/journeys/boot-b.mjs up)');
    const boot = spawn('node', [join(JOURNEYS_DIR, 'boot-b.mjs'), 'up'], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so teardown reaches the stack under the boot wrapper
    });
    boot.on('exit', (code) => { if (!teardown.started) { log(`boot-b exited (${code})`); teardown(1); } });
    children.push(boot);
    await attachWatcher(boot).waitForLine(/\bREADY api\(proxy\)=:/, 15 * 60_000, 'boot-b READY');
    // boot-b's proxy port is fixed by its own contract (:4111). Deliberately NOT
    // overridable from the shell: a lingering EKOA_BASE would silently retarget the
    // whole lane at another server (review finding, 2026-07-18) — the same env-drift
    // next.config.ts avoids for the api origin.
    base = 'http://localhost:4111';
  } else {
    probes = journeys.credless.probes;
    const port = process.env.EKOA_JOURNEYS_PORT || '4123';
    base = `http://127.0.0.1:${port}`;
    log(`booting api on :${port} (dev-api --built)`);
    const api = spawn('node', [join(ROOT, 'scripts', 'dev-api.mjs'), '--built'], {
      cwd: ROOT,
      env: { ...process.env, PORT: port },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true, // own process group, so teardown reaches mongod under the wrapper
    });
    api.on('exit', (code) => { if (!teardown.started) { log(`api exited (${code})`); teardown(1); } });
    children.push(api);
    await attachWatcher(api).waitForLine(/DEV-API READY/, 180_000, 'DEV-API READY');
  }

  const results = [];
  for (const name of probes) results.push(await runProbe(name, base));

  let failed = false;
  for (const r of results) {
    const bad = r.exitCode !== 0 || r.failLines.length > 0;
    if (bad) failed = true;
    log(`${bad ? 'LANE-FAIL' : 'ok'} ${r.name} exit=${r.exitCode} failLines=${r.failLines.length}`);
    for (const l of r.failLines) log(`  ${l}`);
  }
  log(failed ? `lane FAILED (${credentialed ? 'credentialed' : 'credless'})` : `lane OK (${credentialed ? 'credentialed' : 'credless'}, ${results.length} probes)`);
  teardown(failed ? 1 : 0);
}

main().catch((err) => {
  log(`FAILED: ${err instanceof Error ? err.message : err}`);
  teardown(1);
});
