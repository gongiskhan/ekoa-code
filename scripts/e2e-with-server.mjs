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
 *      bundles, not placeholders;
 *   3. runs `node scripts/suite-ledger-run.mjs --run`;
 *   4. tears the server down and exits with the runner's code.
 *
 * Screenshots stay enabled unless EKOA_SCREENSHOTS_DISABLED is set by the
 * caller (CI sets it: capture adds minutes and the gate does not assert PNGs).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREBUILD_TIMEOUT_MS = 10 * 60_000;
const READY_TIMEOUT_MS = 90_000;

function waitForLine(child, pattern, timeoutMs, label) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
    const onData = (buf) => {
      const text = buf.toString();
      process.stdout.write(text);
      if (pattern.test(text)) {
        clearTimeout(timer);
        child.stdout.off('data', onData);
        child.stderr.off('data', onData);
        resolvePromise(undefined);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`dev-api exited (${code}) before ${label}`));
    });
  });
}

const server = spawn('node', [join(ROOT, 'scripts', 'dev-api.mjs'), '--built'], {
  cwd: ROOT,
  env: { ...process.env },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let exitCode = 1;
try {
  await waitForLine(server, /DEV-API READY/, READY_TIMEOUT_MS, 'DEV-API READY');
  await waitForLine(server, /\[featured-builder\] built /, PREBUILD_TIMEOUT_MS, 'featured prebuild');

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
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1500));
  if (!server.killed) server.kill('SIGKILL');
}

process.exit(exitCode);
