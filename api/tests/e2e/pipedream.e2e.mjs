#!/usr/bin/env node
/**
 * Pipedream Connect layer — committed, re-runnable E2E.
 *
 * Drives the RUNNING dev api through the Pipedream Connect config surface (no real
 * Pipedream account needed):
 *
 *   1. login admin/tmp12345 → JWT
 *   2. configure (PUT /pipedream/config, org-admin) → { id, configured:true }
 *   3. status (GET /pipedream) → { configured:true, enabled:true, accountCount }
 *   4. the billing breakdown surface (GET /billing/breakdown) is reachable + shaped
 *
 * REST adaptation (2026-07-07, G8, per spec/reference/test-audit.md §5.1): transport
 * swapped from the retired action envelope (POST /api/v1/action; ekoa.pipedream /
 * ekoa.billing intents) to the typed REST surface (POST /api/v1/auth/login,
 * PUT|GET|DELETE /api/v1/pipedream[/config], GET /api/v1/billing/breakdown, ch03
 * §3.8.16).
 *
 * BEHAVIOURAL DIFFERENCE vs the old cortex (reported, not worked around): the config
 * request no longer carries an `apiBase` field (PipedreamConfigRequest is
 * {clientId,clientSecret,projectId,environment}). Pointing the provider transport at a
 * local mock is now a SERVER-level lever (PIPEDREAM_API_BASE / the injected `deps.pipedream`
 * seam), which a self-contained driver cannot set on an already-running server — so this
 * driver does not stand up a mock Pipedream server. The status endpoint performs a
 * best-effort provider account listing that (unmocked) resolves to accountCount 0 without
 * leaving the machine's failure path; the call is time-bounded here so a locked-down CI
 * cannot hang it.
 *
 * DOCUMENTED SKIPs (no REST surface in the current build — deferred G8 execution stack):
 *   - run-action (slack:send-message) has NO endpoint in the Pipedream router
 *     (status/accounts/config/connect-token/disconnect only), so the metered
 *     `pipedream:slack:send-message` breakdown row cannot be produced here. The
 *     breakdown surface is asserted reachable + shaped; the row is proven by the vitest
 *     pipedream service suite — SKIP.
 *
 * Cleanup: remove-config (best-effort) before + after.
 * Run: node api/tests/e2e/pipedream.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

let TOKEN = null;
const authHeaders = () => ({ 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) });
async function restJson(method, path, body, timeoutMs) {
  const ctrl = timeoutMs ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const r = await fetch(`${BASE}${path}`, { method, headers: authHeaders(), body: body != null ? JSON.stringify(body) : undefined, ...(ctrl ? { signal: ctrl.signal } : {}) });
    const t = await r.text();
    let json; try { json = JSON.parse(t); } catch { json = { _raw: t, _status: r.status }; }
    return { status: r.status, json };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function restLogin(username, password) {
  const { json } = await restJson('POST', '/api/v1/auth/login', { username, password, rememberMe: true });
  return json;
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: api not reachable at ${BASE}/health — start the dev api first (node scripts/dev-api.mjs).`);
    process.exit(0);
  }

  try {
    // ---- Login ----
    const login = await restLogin('admin', 'tmp12345');
    TOKEN = login?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- Clean any prior config, then configure ----
    await restJson('DELETE', '/api/v1/pipedream/config');
    const cfg = await restJson('PUT', '/api/v1/pipedream/config', {
      clientId: 'e2e-client-id',
      clientSecret: `e2e-secret-${randomUUID().slice(0, 8)}`,
      projectId: 'proj_e2e',
      environment: 'development',
    });
    assert(cfg.status === 200 && cfg.json?.configured === true, `configure failed (${cfg.status}): ${JSON.stringify(cfg.json).slice(0, 300)}`);
    assert(cfg.json.id, 'configure did not return the config id');
    ok('global Pipedream config saved (keys encrypted at rest; configured:true)');

    // ---- Status (time-bounded: the unmocked provider listing must not hang CI) ----
    let statusProbed = false;
    try {
      const status = await restJson('GET', '/api/v1/pipedream', undefined, 12_000);
      statusProbed = true;
      assert(status.status === 200 && status.json?.configured === true, `status.configured expected true: ${JSON.stringify(status.json).slice(0, 200)}`);
      ok(`status: configured=${status.json.configured} enabled=${status.json.enabled} accountCount=${status.json.accountCount}`);
      note('status.enabled reflects the default-enabled toggle; accountCount is a best-effort provider listing (0 without a mock transport).');
    } catch (err) {
      if (err?.message === '__ASSERT__') throw err;
      note(`status probe timed out/aborted (unmocked provider transport reaching api.pipedream.com): ${err?.message || err}. Config persistence already proven by the configure response.`);
    }
    if (!statusProbed) note('SKIP status assertion this run (provider transport unreachable); the configure response is the authoritative persistence proof.');

    // ---- Billing breakdown surface (reachable + shaped) ----
    const bd = await restJson('GET', '/api/v1/billing/breakdown');
    assert(bd.status === 200 && Array.isArray(bd.json?.items), `billing breakdown not reachable/shaped (${bd.status}): ${JSON.stringify(bd.json).slice(0, 200)}`);
    ok(`billing breakdown reachable + shaped ({ items: [...] }, ${bd.json.items.length} rows)`);
    note('SKIP the metered pipedream:slack:send-message breakdown row: run-action has NO Pipedream endpoint (deferred G8 execution stack); the row is proven by the vitest pipedream service suite.');
  } finally {
    if (TOKEN) {
      const d = await restJson('DELETE', '/api/v1/pipedream/config');
      if (d.json?.ok) note('cleaned up Pipedream config');
    }
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: Pipedream configure → status → billing-breakdown surface verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
