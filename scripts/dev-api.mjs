#!/usr/bin/env node
/**
 * Deterministic dev/test API server harness (ch13 §13.9 lane support; ch14 §14.2.5).
 *
 * Boots the api workspace against an ephemeral mongodb-memory-server so the ledger's
 * node drivers and the 37-spec byte-compat suite can run against `api/` alone with zero
 * machine setup: no local mongod, no hand-set env. Everything the server needs is set
 * here (dev-only values — never used in any deployed environment):
 *
 *   node scripts/dev-api.mjs            # boot, print base URL, stay alive until SIGINT/SIGTERM
 *   node scripts/dev-api.mjs --built    # serve api/dist/server.js (build first) instead of ts-node
 *
 * Port: the committed default 4111 (the ported drivers' expectation), overridable with
 * PORT. The process prints `DEV-API READY <base>` once /health answers, so harnesses can
 * spawn it and wait for that line.
 *
 * STORAGE. Ephemeral is the right default for a test lane: every run starts from a known
 * empty database and leaves nothing behind. It is the wrong default for a human driving the
 * stack by hand, because the state a person creates through the UI - an OAuth workspace
 * connection, a minted key - does not survive the next restart, and re-doing a third-party
 * consent screen on every boot is not a workflow. Two opt-in escapes, neither of which
 * changes the default:
 *
 *   MONGODB_URI=mongodb://...      point at a real server; this harness then provisions nothing
 *   EKOA_DEV_DB_PATH=/some/dir     keep the memory-server's files, so state survives a restart
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(ROOT, 'api', 'package.json'));
const { MongoMemoryServer } = require('mongodb-memory-server');

const PORT = process.env.PORT ?? '4111';
const BASE = `http://127.0.0.1:${PORT}`;
const useBuilt = process.argv.includes('--built');

// A cold boot registers every featured app (~200) before /health answers - observed ~90s on a
// laptop (2026-07-11). 30s killed healthy boots; default generously and allow an env override.
const HEALTH_TIMEOUT_MS = Number(process.env.DEV_API_HEALTH_TIMEOUT_MS) || 120_000;

async function waitForHealth(base, timeoutMs = HEALTH_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// An externally provisioned server wins outright: this harness then starts nothing and stops
// nothing, so a hand-driven stack can point at storage whose lifetime it does not control.
const externalUri = (process.env.MONGODB_URI ?? '').trim();
const dbPath = (process.env.EKOA_DEV_DB_PATH ?? '').trim();
if (dbPath) mkdirSync(dbPath, { recursive: true });

// wiredTiger + a fixed dbPath is what makes the memory-server's files outlive the process;
// the default (ephemeralForTest, a temp dir) is what makes it a clean-room for the test lane.
const mem = externalUri
  ? null
  : await MongoMemoryServer.create({
      instance: {
        launchTimeout: 60_000,
        ...(dbPath ? { dbPath, storageEngine: 'wiredTiger' } : {}),
      },
    });
if (externalUri) process.stdout.write('[dev-api] using MONGODB_URI from the environment\n');
else if (dbPath) process.stdout.write(`[dev-api] persistent dev database at ${dbPath}\n`);

const env = {
  ...process.env,
  PORT,
  MONGODB_URI: externalUri || mem.getUri(),
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? 'dev-only-encryption-key',
  JWT_SECRET: process.env.JWT_SECRET ?? 'dev-only-jwt-secret',
  EKOA_ADMIN_USERNAME: process.env.EKOA_ADMIN_USERNAME ?? 'admin',
  EKOA_ADMIN_PASSWORD: process.env.EKOA_ADMIN_PASSWORD ?? 'tmp12345',
  // This stack's storage is ephemeral by default, so the admin is re-seeded on EVERY boot. With
  // the production forced-rotation posture that means re-doing the password-change prompt every
  // time, and the moment the operator changes it, `scripts/dev-credential.mjs` can no longer log
  // in as admin/tmp12345 to provision the model credential (observed 2026-08-10: `[provision]
  // login failed as admin: 401`). The seeded password here IS the published dev default, so
  // rotating it protects nothing. The API ignores this flag entirely under NODE_ENV=production.
  EKOA_ADMIN_NO_FORCED_PASSWORD_CHANGE: process.env.EKOA_ADMIN_NO_FORCED_PASSWORD_CHANGE ?? '1',
};

let child;
if (useBuilt) {
  const entry = join(ROOT, 'api', 'dist', 'server.js');
  if (!existsSync(entry)) {
    process.stderr.write('[dev-api] api/dist/server.js missing — run `npm run build --workspace api` first\n');
    await mem?.stop();
    process.exit(1);
  }
  child = spawn('node', [entry], { cwd: join(ROOT, 'api'), env, stdio: 'inherit' });
} else {
  child = spawn('npm', ['run', 'dev', '--workspace', 'api'], { cwd: ROOT, env, stdio: 'inherit' });
}

const shutdown = async (code) => {
  child.kill('SIGTERM');
  await mem?.stop();
  process.exit(code);
};
process.on('SIGINT', () => void shutdown(130));
process.on('SIGTERM', () => void shutdown(143));
child.on('exit', (code) => void shutdown(code ?? 1));

if (await waitForHealth(BASE)) {
  process.stdout.write(`DEV-API READY ${BASE}\n`);
} else {
  process.stderr.write(`[dev-api] server did not answer /health at ${BASE} within ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s\n`);
  await shutdown(1);
}
