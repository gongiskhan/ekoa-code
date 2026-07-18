#!/usr/bin/env node
/**
 * Server-backed ledger run (ch14 §14.2.5 + the gate suites from G6 on).
 *
 * From G6 the due estate needs a LIVE api (the 37 served-app specs drive
 * /apps/* on backend.port; the node drivers preflight /health). This harness
 * makes `npm run e2e` reproducible with zero machine setup:
 *
 *   1. boots scripts/dev-api.mjs --built (ephemeral memory-mongo, seeded admin,
 *      featured seeding at boot) - requires `npm run build` output to exist;
 *   2. waits for DEV-API READY, then for the featured prebuild summary
 *      ("[featured-builder] built ...") so the served legal apps serve real
 *      bundles, not placeholders (the prebuild FAILURE line rejects fast);
 *   3. runs `node scripts/suite-ledger-run.mjs --run`;
 *   4. tears the server down (process-group kill via scripts/lib/harness.mjs,
 *      so mongod under the wrapper dies too) and exits with the runner's code.
 *
 * Screenshots stay enabled unless EKOA_SCREENSHOTS_DISABLED is set by the
 * caller (CI sets it: capture adds minutes and the gate does not assert PNGs).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureDemosSpine, attachWatcher, killTree } from './lib/harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREBUILD_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 90_000;

ensureDemosSpine(ROOT);

const server = spawn('node', [join(ROOT, 'scripts', 'dev-api.mjs'), '--built'], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true, // own process group, so the final kill reaches mongod under the wrapper
});

let exitCode = 1;
try {
  const watch = attachWatcher(server);
  await watch.waitForLine(/DEV-API READY/, READY_TIMEOUT_MS, 'DEV-API READY');
  await watch.waitForLine(/\[featured-builder\] built /, PREBUILD_TIMEOUT_MS, 'featured prebuild', {
    failPattern: /\[featured-builder\] prebuild failed/,
    failLabel: 'featured prebuild FAILED (see [featured-builder] output above)',
  });

  exitCode = await new Promise((resolvePromise) => {
    const runner = spawn('node', [join(ROOT, 'scripts', 'suite-ledger-run.mjs'), '--run'], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: 'inherit',
    });
    runner.on('exit', (code) => resolvePromise(code ?? 1));
  });
} catch (err) {
  console.error(`[e2e-with-server] ${err instanceof Error ? err.message : err}`);
  exitCode = 1;
} finally {
  killTree(server, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  // .killed only records that a signal was SENT; exitCode/signalCode still null is
  // the actual "ignored SIGTERM" condition (the old check here could never fire).
  if (server.exitCode === null && server.signalCode === null) killTree(server, 'SIGKILL');
}

process.exit(exitCode);
