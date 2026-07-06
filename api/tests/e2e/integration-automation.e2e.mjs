#!/usr/bin/env node
/**
 * integracao-por-automacao — committed, re-runnable E2E (dispatch-contract proof).
 *
 * Proves, against a RUNNING dev cortex, that the integration action executor
 * recognises an action's `automationBinding` and routes it into the
 * automation-dispatch service (runAutomationBackedAction) — i.e. the branch is
 * WIRED end to end through the real HTTP surface.
 *
 * Why the dispatch-contract shape (not a full automation run): a real
 * automation run exercises vision/LLM, which is unreliable on the degraded-LLM
 * dev machine. Instead this driver binds the action to a MISSING automation id
 * and asserts the deterministic `unknown_automation` outcome ("automation not
 * found"). That outcome is only reachable through the new branch: before this
 * change, an action with no httpConfig was rejected with "has no httpConfig".
 * The behavioural mapping (success / automation_failed / forbidden / argMap /
 * credential boundary) is covered by the vitest suite
 * tests/services/integration-automation.test.ts.
 *
 * The HTTP path into the executor is the automation `integration` step:
 *   1. Create an outer automation with a single `integration` step targeting a
 *      test integration + its `dispatch` action.
 *   2. Seed a sandbox integration skill (owned by the automation's owner) whose
 *      `dispatch` action carries automationBinding.automationId = <missing>,
 *      and refresh the integration registry so cortex loads it.
 *   3. Run the outer automation. The integration step calls the executor, which
 *      branches on automationBinding → runAutomationBackedAction → the bound
 *      (missing) automation does not resolve → unknown_automation.
 *   4. Assert the run FAILED and the failed step's error is "automation not
 *      found" (and NOT "has no httpConfig"), proving the branch fired.
 *
 * Auth: login admin/tmp12345 via the ekoa.auth action API for a JWT.
 * Cleanup: the outer automation + the seeded sandbox skill are removed (best
 * effort) and the registry is refreshed. Requires a running dev cortex.
 * Run: node cortex/tests/e2e/integration-automation.e2e.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): cortex binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
// Sandbox root must match integration-storage.ts (SANDBOX_ROOT || ~/.ekoa/sandboxes).
const SANDBOX_ROOT = process.env.SANDBOX_ROOT || join(homedir(), '.ekoa', 'sandboxes');

const INTEGRATION_KEY = `e2e-autobind-${randomUUID().slice(0, 8)}`;
const MISSING_AUTOMATION_ID = `missing-automation-${randomUUID()}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

let TOKEN = null;
async function action(app, intent, params = {}) {
  const r = await fetch(`${BASE}/api/v1/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: JSON.stringify({ app, intent, params, request_id: randomUUID() }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { _raw: t, _status: r.status }; }
}

/** Sandbox integration skill whose `dispatch` action binds to a missing automation. */
function seedSkill(ownerUserId) {
  const dir = join(SANDBOX_ROOT, `user-${ownerUserId}`, 'integration-skills', INTEGRATION_KEY);
  mkdirSync(dir, { recursive: true });
  const config = {
    version: '1.0',
    skillType: 'integration',
    integrationKey: INTEGRATION_KEY,
    displayName: 'E2E Auto-Bind (dispatch-contract proof)',
    description: 'Test-only skill seeded by integration-automation.e2e.mjs. Do not ship.',
    authType: 'none',
    provider: 'e2e',
    category: 'test',
    configSchema: [],
    actions: [
      {
        actionName: 'dispatch',
        description: 'Invokes the bound automation instead of an HTTP call.',
        argsSchema: {},
        returnSchema: {},
        mutates: true,
        automationBinding: { automationId: MISSING_AUTOMATION_ID },
      },
    ],
  };
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2), 'utf-8');
  writeFileSync(join(dir, 'SKILL.md'), '# E2E Auto-Bind\n\nTest-only. Binds `dispatch` to an automation.\n', 'utf-8');
  return dir;
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  let automationId = null;
  let skillDir = null;

  try {
    // ---- Login ------------------------------------------------------------
    const login = await action('ekoa.auth', 'login', { username: 'admin', password: 'tmp12345', rememberMe: true });
    TOKEN = login?.data?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- Create the outer automation (single integration step) ------------
    const created = await action('ekoa.automations', 'create', {
      name: 'E2E integracao-por-automacao dispatch proof',
      description: 'Runs a single integration step whose action binds to an automation.',
      steps: [
        {
          id: 'dispatch-step',
          type: 'integration',
          description: 'Invoca a accao de integracao ligada a uma automacao.',
          integrationKey: INTEGRATION_KEY,
          integrationAction: 'dispatch',
          argsTemplate: {},
        },
      ],
    });
    const automation = created?.data?.automation;
    automationId = automation?.id;
    const ownerUserId = automation?.ownerUserId;
    assert(automationId && ownerUserId, `create automation failed: ${JSON.stringify(created).slice(0, 300)}`);
    ok(`outer automation created (${automationId}, owner ${ownerUserId})`);

    // ---- Seed the sandbox skill + load it into the registry ---------------
    skillDir = seedSkill(ownerUserId);
    const refreshed = await action('ekoa.integrations', 'refresh-registry', {});
    const keys = refreshed?.data?.skills || [];
    assert(keys.includes(INTEGRATION_KEY),
      `seeded skill ${INTEGRATION_KEY} not loaded after refresh-registry (owner ${ownerUserId}); keys=${JSON.stringify(keys).slice(0, 300)}`);
    ok(`sandbox skill ${INTEGRATION_KEY} seeded + loaded (automationBinding → ${MISSING_AUTOMATION_ID})`);

    // ---- Run the automation (async; poll the run record for the outcome) --
    const run = await action('ekoa.automations', 'run', { id: automationId });
    assert(run?.data?.accepted, `run not accepted: ${JSON.stringify(run).slice(0, 300)}`);
    ok('automation run accepted; polling for the terminal run record');

    const record = await pollRun(automationId, 20_000);
    assert(record, 'no run record appeared within the timeout');
    note(`run terminal status = ${record.status}`);
    assert(record.status === 'failed',
      `expected the run to FAIL (integration step dispatches to a missing automation), got status=${record.status}`);

    const failedStep = (record.steps || []).find((s) => s.status === 'failed');
    assert(failedStep, `no failed step in the run record: ${JSON.stringify(record.steps || []).slice(0, 300)}`);
    const message = failedStep.error?.message || '';
    // The dispatch-contract proof: the executor branched on automationBinding and
    // returned unknown_automation ("automation not found"). The pre-change guard
    // would instead have rejected the action with "has no httpConfig".
    assert(/automation not found/i.test(message),
      `expected the step error to be the unknown_automation outcome ("automation not found"), got: "${message}"`);
    assert(!/has no httpConfig/i.test(message),
      `step was rejected by the old httpConfig guard, not routed to the automation branch: "${message}"`);
    ok(`integration step failed via the automationBinding branch → unknown_automation ("${message}")`);
  } finally {
    if (automationId) {
      const d = await action('ekoa.automations', 'delete', { id: automationId });
      if (d?.data?.deleted || d?.data) note(`cleaned up automation ${automationId}`);
    }
    if (skillDir) {
      try { rmSync(skillDir, { recursive: true, force: true }); note(`removed seeded skill dir`); } catch { /* ignore */ }
      await action('ekoa.integrations', 'refresh-registry', {});
    }
  }
}

/** Poll list-runs until the newest run for this automation reaches a non-running status. */
async function pollRun(automationId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await action('ekoa.automations', 'list-runs', { automationId });
    const runs = res?.data?.runs || [];
    if (runs.length > 0) {
      last = [...runs].sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
      if (last && last.status && last.status !== 'running') return last;
    }
    await sleep(500);
  }
  return last;
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: integration action automationBinding is wired — dispatch reaches runAutomationBackedAction (unknown_automation proven).');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
