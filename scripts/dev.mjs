#!/usr/bin/env node
/**
 * Root dev entrypoint: `npm run dev`.
 *
 * Boots the FULL stack in dev mode (api via ts-node --watch on :4211, the CORS proxy on
 * :4111, next dev on :3000) and provisions the model credential into the freshly-booted
 * (ephemeral-Mongo) API - opening the browser for a one-click OAuth authorize when no
 * valid token is stored (see scripts/dev-credential.mjs).
 *
 * The stack bring-up itself is the committed driver
 * (.claude/skills/run-ekoa-code/driver.mjs) - the single implementation of the CSP/CORS
 * dev traps documented in docs/operations-runbook.md. This script only orchestrates:
 *
 *   1. preflight: ports free, shared/dist present (api+web resolve @ekoa/shared to dist)
 *   2. credential ensure (concurrent with boot - the browser can open while the API boots)
 *   3. driver up (EKOA_API_MODE defaults to dev here)
 *   4. provision the credential once /health answers
 *
 * Flags:  --built (serve api/dist instead of ts-node)   --reauth (force browser authorize)
 *         --no-credential (skip provisioning)
 * Plus every EKOA_* env override the driver honors.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureCredential, provisionCredential } from './dev-credential.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const API_MODE = args.includes('--built') ? 'built' : process.env.EKOA_API_MODE || 'dev';
const WEB_PORT = process.env.EKOA_WEB_PORT || '3000';
const API_PORT = process.env.EKOA_API_PORT || '4211';
// The proxy must occupy the port the committed backend.port file names - the origin the
// web bundle and the node drivers resolve to (same read the driver itself does).
const readBackendPort = () => {
  try {
    const p = readFileSync(join(ROOT, 'backend.port'), 'utf8').trim();
    if (/^\d+$/.test(p)) return p;
  } catch { /* fall through */ }
  return '4111';
};
const PROXY_PORT = readBackendPort();

const log = (m) => process.stdout.write(`[dev] ${m}\n`);
const fail = (m) => { process.stderr.write(`[dev] ${m}\n`); process.exit(2); };

const portInUse = (port) =>
  new Promise((resolve) => {
    const sock = net.connect({ port: Number(port), host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(500, () => done(false));
  });

async function waitForHealth(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ---- 1. preflight ------------------------------------------------------------
for (const [port, what] of [[PROXY_PORT, 'the CORS proxy'], [WEB_PORT, 'next dev'], [API_PORT, 'the api']]) {
  if (await portInUse(port)) {
    fail(`port ${port} (${what}) is already in use - a previous stack is still up.\n` +
      '      Stop it first: pkill -f "driver.mjs"; pkill -f "next dev"; pkill -f "dev-api.mjs"');
  }
}

if (!existsSync(join(ROOT, 'shared', 'dist', 'index.js'))) {
  log('shared/dist missing - building the shared workspace (seconds)');
  const r = spawnSync('npm', ['run', 'build', '--workspace', 'shared'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('shared build failed');
}
if (API_MODE === 'built' && !existsSync(join(ROOT, 'api', 'dist', 'server.js'))) {
  log('api/dist missing - building the api workspace');
  const r = spawnSync('npm', ['run', 'build', '--workspace', 'api'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) fail('api build failed');
}

// ---- 2. credential (concurrent with boot; may open the browser) ---------------
const wantCredential = !args.includes('--no-credential');
const credentialPromise = wantCredential
  ? ensureCredential({ reauth: args.includes('--reauth') }).catch((err) => { log(`credential ensure failed: ${err.message}`); return null; })
  : Promise.resolve(null);

// ---- 3. stack up ---------------------------------------------------------------
log(`booting the stack via the committed driver (api mode: ${API_MODE})`);
const driver = spawn('node', [join(ROOT, '.claude', 'skills', 'run-ekoa-code', 'driver.mjs'), 'up'], {
  cwd: ROOT,
  env: {
    ...process.env,
    EKOA_API_MODE: API_MODE,
    // dev-api.mjs self-kills if /health is silent for this long; its 120s default sits right on
    // top of the ~90s cold-boot featured-app registration, so widen it - our outer wait is 300s.
    DEV_API_HEALTH_TIMEOUT_MS: process.env.DEV_API_HEALTH_TIMEOUT_MS ?? '240000',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});
let exiting = false;
driver.on('exit', (code) => { if (!exiting) process.exit(code ?? 1); });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { exiting = true; driver.kill(sig); driver.on('exit', (code) => process.exit(code ?? 0)); });
}

// Cold boots register ~200 featured apps before /health answers (~90s observed).
if (!(await waitForHealth(`http://localhost:${PROXY_PORT}/health`, 300_000))) {
  driver.kill('SIGTERM');
  fail('the API never became healthy on :4111 - see the driver output above');
}

// ---- 4. provision ---------------------------------------------------------------
if (wantCredential) {
  const cred = await credentialPromise;
  if (cred && (await provisionCredential(cred))) {
    log('model credential provisioned - chat/build runs will reach the model');
  } else {
    log('WARNING: no model credential provisioned. Login and static pages work, but every');
    log('WARNING: chat/build run will fail with ADAPTER_ERROR. Fix it without restarting:');
    log('WARNING:   npm run dev:auth');
  }
} else {
  log('credential provisioning skipped (--no-credential)');
}

// The driver prints its own READY once next dev answers /login; sequence our summary after it.
if (!(await waitForHealth(`http://localhost:${WEB_PORT}/login`, 240_000))) {
  log('web has not answered /login yet (cold next dev compiles are slow) - it may still come up');
}
log(`ready - web=http://localhost:${WEB_PORT}  api=http://localhost:${PROXY_PORT}  (Ctrl-C stops everything)`);
