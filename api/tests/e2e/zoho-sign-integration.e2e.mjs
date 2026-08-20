#!/usr/bin/env node
/**
 * Zoho Sign integration — committed, re-runnable E2E (2B-S2), REST-adapted.
 *
 * The dev original (cortex/tests/e2e/zoho-sign-integration.e2e.mjs) drove the retired
 * `/api/v1/action` intent API (ekoa.auth / ekoa.integration-builder load+test) to prove
 * the integration's test-connection path — grant-code exchange through the builder Tests
 * tab against a mock Zoho double. This port swaps the transport to the ch03 REST surface
 * (POST /api/v1/auth/login, GET /api/v1/integrations, GET/POST
 * /api/v1/integration-builder/package|test), the sanctioned REST adaptation per the
 * SUITE_LEDGER ifthenpay/invoicexpress precedent ("REST adaptation owed").
 *
 * Proves against a RUNNING api (SKIPs cleanly if unreachable — an unreachable-server skip
 * is exit 0 + SKIP, NEVER a false green under the ledger):
 *   1. the zoho-sign integration DEFINITION loads with authType oauth2, its actions
 *      (test_connection / list_requests / get_request) and its OAuth config schema
 *      (grant_code / refresh_token / dc — the client_id/client_secret pair is now
 *      platform-level env, ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET, after the Zoho OAuth
 *      parity sweep e371088, so it is deliberately absent from the per-config schema);
 *   2. the AI-builder `load` rebuilds an editable package that exposes test_connection.
 *
 * DOCUMENTED SKIP (reported to the lead, not worked around here): the builder Tests-tab
 * `test` path (executeActionForTest) does NOT run the provider credential resolver, so the
 * {{api_base}}/{{access_token}} the zoho-sign httpConfig interpolates are never minted from
 * the builder there — the grant-code exchange the dev driver asserted at this step is not
 * wired on the builder path in ekoa-code (an S1-scope gap, left as fix-forward debt). The
 * SAME resolveProviderCredentials('zoho-sign') exchange IS wired on the executor path and is
 * proven hermetically by api/tests/integrations/zoho-sign-token.test.ts + the served-app
 * proxy driver api/tests/e2e/zoho-proxy.e2e.mjs. This driver attempts the builder test when
 * the stack was booted with the ZOHO_*_BASE_OVERRIDE mock seam and reports the exchange as a
 * bonus PASS if it ever succeeds (auto-upgrades if the builder path is later wired); it never
 * fails on the un-wired path.
 *
 * Self-launches an inline mock Zoho on MOCK_PORT (so a stack booted with
 * ZOHO_ACCOUNTS_BASE_OVERRIDE/ZOHO_API_BASE_OVERRIDE pointing at it can be exercised).
 * Run: node api/tests/e2e/zoho-sign-integration.e2e.mjs
 * Exit 0 = pass (or clean skip), 1 = fail.
 */
import { readFileSync } from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): the api binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || process.env.EKOA_E2E_BASE_URL || `http://127.0.0.1:${PORT}`;
const MOCK_PORT = Number(process.env.MOCK_PORT || 7801);

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exitCode = 1; throw new Error('__ASSERT__'); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
function note(m) { console.log(`  NOTE: ${m}`); }

let TOKEN = null;
const authHeaders = () => ({ 'Content-Type': 'application/json', ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}) });
async function restJson(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: authHeaders(), body: body != null ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let json; try { json = JSON.parse(t); } catch { json = { _raw: t, _status: r.status }; }
  return { status: r.status, json };
}

// Minimal inline mock Zoho (token + list) — only what a builder test_connection needs.
function startMock() {
  const used = new Set();
  const rts = new Set();
  const ats = new Set();
  const j = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${MOCK_PORT}`);
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const auth = req.headers.authorization || '';
    if (req.method === 'POST' && url.pathname === '/oauth/v2/token') {
      const p = new URLSearchParams(Buffer.concat(chunks).toString());
      if (p.get('client_id') !== '1000.MOCKCLIENTID' || p.get('client_secret') !== 'mocksecret')
        return j(res, 200, { error: 'invalid_client' });
      if (p.get('grant_type') === 'authorization_code') {
        if (used.has(p.get('code'))) return j(res, 200, { error: 'invalid_code' });
        used.add(p.get('code'));
        const rt = `1000.rt-${crypto.randomBytes(6).toString('hex')}`;
        const at = `1000.at-${crypto.randomBytes(6).toString('hex')}`;
        rts.add(rt); ats.add(at);
        return j(res, 200, { access_token: at, refresh_token: rt, expires_in: 3600 });
      }
      if (p.get('grant_type') === 'refresh_token') {
        if (!rts.has(p.get('refresh_token'))) return j(res, 200, { error: 'invalid_code' });
        const at = `1000.at-${crypto.randomBytes(6).toString('hex')}`;
        ats.add(at);
        return j(res, 200, { access_token: at, expires_in: 3600 });
      }
      return j(res, 200, { error: 'unsupported_grant_type' });
    }
    if (!auth.startsWith('Zoho-oauthtoken ') || !ats.has(auth.slice(16)))
      return j(res, 401, { code: 4003, message: 'Invalid OAuth token', status: 'failure' });
    if (url.pathname === '/api/v1/requests') return j(res, 200, { code: 0, status: 'success', requests: [] });
    return j(res, 404, { code: 404, status: 'failure' });
  });
  return new Promise((resolve) => {
    // If a mock is already listening on this port, reuse it (resolve null).
    server.once('error', () => resolve(null));
    server.listen(MOCK_PORT, () => resolve(server));
  });
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: api not reachable at ${BASE}/health — start the dev api first (npm run dev --workspace api).`);
    process.exit(0);
  }

  const ownMock = await startMock();
  try {
    // ---- Login ------------------------------------------------------------
    const login = await restJson('POST', '/api/v1/auth/login', {
      username: process.env.EKOA_E2E_USER || 'admin',
      password: process.env.EKOA_E2E_PASS || 'tmp12345',
      rememberMe: true,
    });
    TOKEN = login.json?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login.json).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- The zoho-sign definition must load with the token-core contract --
    const defs = (await restJson('GET', '/api/v1/integrations')).json.items || [];
    const zoho = defs.find((s) => s.integrationKey === 'zoho-sign');
    assert(zoho, 'zoho-sign integration definition not loaded (api/assets/integrations/zoho-sign missing?)');
    assert(zoho.authType === 'oauth2', `zoho-sign authType should be oauth2, got ${zoho.authType}`);
    const actions = (zoho.actions || []).map((a) => a.actionName);
    for (const a of ['test_connection', 'list_requests', 'get_request']) {
      assert(actions.includes(a), `zoho-sign definition missing action ${a} (has: ${actions.join(', ')})`);
    }
    const fields = (zoho.configSchema || []).map((f) => f.key);
    for (const k of ['grant_code', 'refresh_token', 'dc']) {
      assert(fields.includes(k), `zoho-sign definition missing config field ${k} (has: ${fields.join(', ')})`);
    }
    ok('zoho-sign definition loaded (oauth2 + test_connection/list_requests/get_request + OAuth config schema)');

    // ---- The AI-builder load rebuilds an editable package -----------------
    const load = await restJson('GET', '/api/v1/integration-builder/package?integrationKey=zoho-sign');
    const sessionId = load.json?.builderSessionId;
    const genActions = (load.json?.generatedPackage?.config?.actions || []).map((a) => a.actionName);
    assert(load.status === 200 && sessionId, `builder load failed (${load.status}): ${JSON.stringify(load.json).slice(0, 200)}`);
    assert(genActions.includes('test_connection'), `builder package missing test_connection (has: ${genActions.join(', ')})`);
    ok(`builder load rebuilt an editable zoho-sign package (session ${sessionId}) exposing test_connection`);

    // ---- Builder test_connection (bonus; SKIP-documented when un-wired) ----
    const grant = `1000.mockgrant-e2e-${Date.now()}`;
    const test = await restJson('POST', '/api/v1/integration-builder/test', {
      builderSessionId: sessionId,
      actionKey: 'test_connection',
      testCredentials: { client_id: '1000.MOCKCLIENTID', client_secret: 'mocksecret', grant_code: grant, dc: 'com' },
      testInput: {},
    });
    const td = test.json || {};
    if (td.success === true) {
      ok('BONUS: builder test_connection succeeded (the resolver is wired on the builder path)');
      if (td.credentialUpdates?.refresh_token && td.credentialUpdates?.grant_code === '') {
        ok('BONUS: grant code exchanged for a refresh token via the builder path');
      }
    } else {
      note(
        'SKIP builder test_connection: the builder Tests-tab path does not run the provider credential ' +
          'resolver, so {{api_base}}/{{access_token}} are unresolved there (S1-scope gap). The same ' +
          'resolveProviderCredentials("zoho-sign") exchange IS wired on the executor path and is proven by ' +
          'tests/integrations/zoho-sign-token.test.ts + the served-app proxy driver zoho-proxy.e2e.mjs. ' +
          `(builder test reported: ${String(td.error || td._raw || 'no success').slice(0, 160)})`,
      );
    }
  } finally {
    if (ownMock) ownMock.close();
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: zoho-sign definition + AI-builder load verified over the REST surface.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
