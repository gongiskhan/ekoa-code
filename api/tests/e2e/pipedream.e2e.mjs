#!/usr/bin/env node
/**
 * Pipedream Connect layer — committed, re-runnable E2E.
 *
 * Drives the RUNNING dev cortex through the whole PA slice against a LOCAL mock
 * Pipedream server (no real Pipedream account needed, nothing leaves the box):
 *
 *   1. login admin/tmp12345 → JWT
 *   2. ekoa.pipedream configure — seed the global project keys, pointing the
 *      service's base URL at the local mock via the config's `apiBase` (so NO
 *      cortex restart-with-env is required; PIPEDREAM_API_BASE is an alternative
 *      when cortex was booted with it).
 *   3. ekoa.pipedream status → { configured:true, enabled:true }
 *   4. ekoa.pipedream run-action (slack:send-message) → success against the mock
 *   5. ekoa.billing get-breakdown → the `pipedream:slack:send-message` row is present
 *
 * Cleanup: ekoa.pipedream remove-config (best-effort) before + after.
 * Requires a running dev cortex. Run: node cortex/tests/e2e/pipedream.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { startMockPipedream } from '../helpers/mock-pipedream-server.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try {
    return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
  } catch {
    return '4111';
  }
})();
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

function fail(m) {
  console.error(`E2E FAIL: ${m}`);
  process.exitCode = 1;
  throw new Error('__ASSERT__');
}
function assert(c, m) {
  if (!c) fail(m);
}
function ok(m) {
  console.log(`  PASS: ${m}`);
}
function note(m) {
  console.log(`  NOTE: ${m}`);
}

let TOKEN = null;
async function action(app, intent, params = {}) {
  const r = await fetch(`${BASE}/api/v1/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ app, intent, params, request_id: randomUUID() }),
  });
  const t = await r.text();
  try {
    return JSON.parse(t);
  } catch {
    return { _raw: t, _status: r.status };
  }
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  const mock = await startMockPipedream();
  const apiBase = process.env.PIPEDREAM_API_BASE || mock.url;
  note(`local mock Pipedream at ${mock.url}; config apiBase=${apiBase}`);

  try {
    // ---- Login ----
    const login = await action('ekoa.auth', 'login', { username: 'admin', password: 'tmp12345', rememberMe: true });
    TOKEN = login?.data?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- Clean any prior config, then configure ----
    await action('ekoa.pipedream', 'remove-config', {});
    const cfg = await action('ekoa.pipedream', 'configure', {
      clientId: 'e2e-client-id',
      clientSecret: `e2e-secret-${randomUUID().slice(0, 8)}`,
      projectId: 'proj_e2e',
      environment: 'development',
      apiBase,
    });
    assert(cfg?.data?.configured, `configure failed: ${JSON.stringify(cfg).slice(0, 300)}`);
    ok('global Pipedream config saved (keys encrypted, apiBase → mock)');

    // ---- Status ----
    const status = await action('ekoa.pipedream', 'status', {});
    assert(status?.data?.configured === true, `status.configured expected true: ${JSON.stringify(status).slice(0, 200)}`);
    assert(status?.data?.enabled === true, `status.enabled expected true: ${JSON.stringify(status).slice(0, 200)}`);
    ok(`status: configured=${status.data.configured} enabled=${status.data.enabled} accounts=${status.data.accountCount}`);

    // ---- Run an action ----
    const run = await action('ekoa.pipedream', 'run-action', {
      app: 'slack',
      actionKey: 'send-message',
      args: { text: 'e2e ping' },
      sessionId: 'e2e-pipedream',
    });
    assert(run?.data?.success === true, `run-action expected success: ${JSON.stringify(run).slice(0, 300)}`);
    assert(mock.stats.runCalls === 1, `mock should have received exactly 1 run, got ${mock.stats.runCalls}`);
    ok('run-action succeeded against the mock (slack:send-message)');

    // ---- Breakdown includes the pipedream row ----
    const bd = await action('ekoa.billing', 'get-breakdown', {});
    const breakdown = bd?.data?.breakdown || [];
    const row = breakdown.find((b) => b.agentType === 'pipedream:slack:send-message');
    assert(row, `breakdown missing pipedream:slack:send-message row: ${JSON.stringify(breakdown).slice(0, 400)}`);
    assert(row.tokens > 0, `pipedream breakdown row has no tokens: ${JSON.stringify(row)}`);
    ok(`usage breakdown includes pipedream:slack:send-message (${row.tokens} tokens)`);
  } finally {
    if (TOKEN) {
      const d = await action('ekoa.pipedream', 'remove-config', {});
      if (d?.data?.deleted) note('cleaned up Pipedream config');
    }
    await mock.close();
  }
}

main().then(
  () => {
    if (process.exitCode) {
      console.error('\nE2E: FAILURES above.');
      process.exit(process.exitCode);
    }
    console.log('\nE2E PASS: Pipedream configure → status → run → metered breakdown verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
