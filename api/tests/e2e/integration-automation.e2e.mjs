#!/usr/bin/env node
/**
 * integracao-por-automacao — committed, re-runnable E2E (automation-run E2E proof).
 *
 * Proves, against a RUNNING dev api, that the automation ENGINE runs end to end through
 * the real REST surface (ch03 §3.8.18): create an automation → start a run (202 +
 * server-minted runId) → the run reaches a TERMINAL status, observable via the runs
 * surface. This is the G8 automation-engine deliverable exercised over the wire.
 *
 * REST adaptation (2026-07-07, G8, per spec/reference/test-audit.md §5.1): transport
 * swapped from the retired action envelope (POST /api/v1/action; ekoa.auth /
 * ekoa.automations / ekoa.integrations intents) + on-disk sandbox-skill seeding
 * (~/.ekoa/sandboxes/**) to the typed REST surface (POST /api/v1/auth/login,
 * POST /api/v1/automations, POST /api/v1/automations/:id/runs → 202,
 * GET /api/v1/automations/runs?automationId=, GET /api/v1/automations/runs/:id).
 *
 * WHAT CHANGED (reported, not worked around): the OLD driver proved a narrower thing —
 * that an integration ACTION carrying an `automationBinding` routes into
 * runAutomationBackedAction (the deterministic `unknown_automation` / "automation not
 * found" outcome). That mechanism is the DEFERRED G8 integration-execution stack: the
 * per-user sandbox integration skills, the integration-action executor, and the
 * `integration` automation step type are not part of the current REST surface (the
 * automation wire step schema is {stepId,description,tool,argv} with no integrationKey/
 * integrationAction). There is therefore no REST way to seed the bound-action fixture or
 * to observe the httpConfig-vs-automation branch. That specific assertion is a DOCUMENTED
 * SKIP below; this driver instead proves the automation engine itself runs E2E (the
 * behaviour the old driver depended on to even reach the branch). The dispatch-branch
 * mapping remains covered by the vitest suite (integration-automation / integration-action-executor).
 *
 * Auth: login admin/tmp12345 via POST /api/v1/auth/login for a JWT.
 * Cleanup: the automation is deleted (best effort). Run: node api/tests/e2e/integration-automation.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): the api binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 20_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

let TOKEN = null;
const authHeaders = () => ({ 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) });
async function restJson(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: authHeaders(), body: body != null ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let json; try { json = JSON.parse(t); } catch { json = { _raw: t, _status: r.status }; }
  return { status: r.status, json };
}
async function restLogin(username, password) {
  const { json } = await restJson('POST', '/api/v1/auth/login', { username, password, rememberMe: true });
  return json;
}

/** Poll the runs surface until the newest run for this automation reaches a terminal status. */
async function pollTerminal(automationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await restJson('GET', `/api/v1/automations/runs?automationId=${automationId}`);
    const runs = res.json?.items || [];
    if (runs.length > 0) {
      last = [...runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
      if (last?.status && TERMINAL.has(last.status)) return last;
    }
    await sleep(400);
  }
  return last;
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: api not reachable at ${BASE}/health — start the dev api first (node scripts/dev-api.mjs).`);
    process.exit(0);
  }

  let automationId = null;

  try {
    // ---- Login ------------------------------------------------------------
    const login = await restLogin('admin', 'tmp12345');
    TOKEN = login?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- Create an automation --------------------------------------------
    const created = await restJson('POST', '/api/v1/automations', {
      name: 'E2E integracao-por-automacao (engine run proof)',
      description: 'Exercises the automation engine end to end over the REST surface.',
    });
    automationId = created.json?.id;
    assert(created.status === 201 && automationId, `create automation failed (${created.status}): ${JSON.stringify(created.json).slice(0, 300)}`);
    assert(created.json.ownerId, 'created automation missing ownerId');
    ok(`automation created (${automationId}, owner ${created.json.ownerId})`);

    // ---- Start a run (async job; 202 + server-minted runId, CONV-3) -------
    const run = await restJson('POST', `/api/v1/automations/${automationId}/runs`, {});
    const runId = run.json?.runId;
    assert(run.status === 202 && runId, `run not accepted (${run.status}): ${JSON.stringify(run.json).slice(0, 300)}`);
    ok(`run accepted (202, runId ${runId}); polling for the terminal run record`);

    // ---- Poll the runs surface for a terminal status ----------------------
    const record = await pollTerminal(automationId, RUN_TIMEOUT_MS);
    assert(record, 'no run record appeared on the runs surface within the timeout');
    assert(TERMINAL.has(record.status),
      `run did not reach a terminal status within ${Math.round(RUN_TIMEOUT_MS / 1000)}s (status=${record.status}) — the automation engine did not drain the run`);
    assert(record.id === runId && record.automationId === automationId, `runs surface returned a mismatched record: ${JSON.stringify(record).slice(0, 200)}`);
    ok(`automation engine ran the automation to a terminal status (${record.status}) — engine wired E2E`);

    // ---- The single-run fetch resolves the same terminal record -----------
    const single = await restJson('GET', `/api/v1/automations/runs/${runId}`);
    assert(single.status === 200 && single.json?.id === runId && TERMINAL.has(single.json.status),
      `GET /runs/:id did not resolve the terminal record: ${single.status} ${JSON.stringify(single.json).slice(0, 200)}`);
    ok('GET /automations/runs/:id resolves the same terminal run record');

    // ---- Deferred / out-of-surface observation ----------------------------
    note('SKIP the integration-action automationBinding branch (dispatch → runAutomationBackedAction → unknown_automation "automation not found"): the integration-execution stack — per-user sandbox skills, the integration-action executor, and the `integration` automation step type — is the deferred G8 surface (the wire step schema has no integrationKey/integrationAction). Covered by the vitest integration-automation / integration-action-executor suites.');
  } finally {
    if (automationId) {
      await restJson('DELETE', `/api/v1/automations/${automationId}`);
      note(`cleaned up automation ${automationId}`);
    }
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: automation engine runs end to end over REST (create → run 202 → terminal run record).');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
