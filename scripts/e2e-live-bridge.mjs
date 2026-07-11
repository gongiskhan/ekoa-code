#!/usr/bin/env node
/**
 * s8 — the cross-repo LIVE evidence lane (run 20260711-053853-0c6e0041; brief S8).
 *
 * Drives the REAL ekoa-bridge daemon (sibling checkout ../ekoa-bridge) against this repo's
 * running dev stack: pair via the real device flow approved through the REAL /settings/devices
 * page, serve, watch presence flip to "Ponte ligada" in the REAL privacy surface, mint a grant.
 * NOT a CI gate (the run brief is explicit) — a scripted, repeatable evidence lane; the
 * chat-file-read leg additionally needs a live model credential and self-skips without one.
 *
 * Usage:  node scripts/e2e-live-bridge.mjs
 * Requires: the dev stack up (node .claude/skills/run-ekoa-code/driver.mjs up) and a built
 * sibling daemon (cd ../ekoa-bridge && npm run build).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIDGE_CLI = join(ROOT, '..', 'ekoa-bridge', 'dist', 'cli', 'index.js');

async function ok(url) {
  try {
    const res = await fetch(url);
    return res.ok;
  } catch {
    return false;
  }
}

if (!(await ok('http://localhost:4111/health'))) {
  console.error('[live-bridge] api not reachable on :4111 — start the stack first: node .claude/skills/run-ekoa-code/driver.mjs up');
  process.exit(1);
}
if (!(await ok('http://localhost:3000/login'))) {
  console.error('[live-bridge] web not reachable on :3000 — start the stack first: node .claude/skills/run-ekoa-code/driver.mjs up');
  process.exit(1);
}
if (!existsSync(BRIDGE_CLI)) {
  console.error(`[live-bridge] daemon CLI missing at ${BRIDGE_CLI} — build the sibling: cd ../ekoa-bridge && npm run build`);
  process.exit(1);
}

const res = spawnSync('npx', ['playwright', 'test', 'web/e2e/live-bridge.spec.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, LIVE_BRIDGE: '1', EKOA_BRIDGE_CLI: BRIDGE_CLI },
});
process.exit(res.status ?? 1);
