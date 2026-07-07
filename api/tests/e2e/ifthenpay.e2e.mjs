#!/usr/bin/env node
/**
 * Ifthenpay payment integration — committed, re-runnable E2E.
 *
 * Proves the PB1 Ifthenpay slice against a RUNNING dev api using the typed REST
 * surface (no real Ifthenpay account exists):
 *
 *   1. The ifthenpay integration DEFINITION is loaded and declares the GET-callback
 *      contract (webhookConfig.getCallback.keyParam='chave',
 *      secretSource.credentialField='anti_phishing_key', responseBody 'OK') and the
 *      three outbound actions (generate_multibanco_reference / mbway_payment /
 *      mbway_status) over the api_base/mb_key/mbway_key/anti_phishing_key schema.
 *   2. A config is saved (POST /configs → 201; credentials redacted in the summary)
 *      and round-trips through the config list, then is deleted.
 *   3. A webhook trigger targeting an automation is created (POST /triggers → 201):
 *      the one-time secret is returned exactly once (landmine 2) and publicUrl is
 *      shaped (landmine 3).
 *
 * REST adaptation (2026-07-07, G8, per spec/reference/test-audit.md §5.1): transport
 * swapped from the retired action envelope (POST /api/v1/action; ekoa.auth /
 * ekoa.integrations / ekoa.automations / ekoa.triggers intents) + direct triggers.db
 * (better-sqlite3) reads to the typed REST surface (POST /api/v1/auth/login,
 * GET /api/v1/integrations, /api/v1/integrations/configs, /api/v1/automations,
 * /api/v1/triggers).
 *
 * DOCUMENTED SKIPs (no REST surface in the current build — the deferred G8 execution
 * + webhook-ingress stack; reported to the lead, not worked around here):
 *   - The GET /hooks/:id?chave=… payment callback (accept → 200 "OK"; replay dedup by
 *     referencia|valor|datahorapag; wrong chave → 401) is NOT wired: the generic hooks
 *     router serves only an HMAC POST ingress + a Meta hub-challenge GET. The chave
 *     query-param getCallback ingress is declared in the definition (asserted in step 1)
 *     but not yet served, so the accept/dedup/reject ingress checks are SKIP.
 *   - The durable event + webhook_audit rows were read straight from triggers.db; there
 *     is no REST endpoint that echoes them (MongoDB store) — SKIP.
 *   - The outbound generate_multibanco_reference call drove the decrypted config via the
 *     `ekoa.integrations execute` intent, which the rebuild does not expose (execution
 *     stack deferred to G8); the config summary never returns credentials. The outbound
 *     reference is proven by the vitest service suite — SKIP here.
 *
 * Auth: login admin/tmp12345 via POST /api/v1/auth/login for a JWT.
 * Cleanup: trigger + config + automation deleted (best-effort) before and after.
 * Run: node api/tests/e2e/ifthenpay.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): the api binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

const ANTI_PHISHING = `e2e-antiphish-${randomUUID().slice(0, 8)}`;

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

  let triggerId = null;
  let automationId = null;

  try {
    // ---- Login ------------------------------------------------------------
    const login = await restLogin('admin', 'tmp12345');
    TOKEN = login?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- The ifthenpay definition must be loaded with the getCallback contract ----
    const defs = (await restJson('GET', '/api/v1/integrations')).json.items || [];
    const ifpay = defs.find((s) => s.integrationKey === 'ifthenpay');
    assert(ifpay, 'ifthenpay integration definition not loaded (api/assets/integrations/ifthenpay missing?)');
    assert(ifpay.webhookConfig?.getCallback?.keyParam === 'chave', 'ifthenpay definition missing getCallback.keyParam=chave');
    assert(
      ifpay.webhookConfig?.getCallback?.secretSource?.credentialField === 'anti_phishing_key',
      'ifthenpay definition missing getCallback.secretSource.credentialField=anti_phishing_key',
    );
    const ifpayActions = (ifpay.actions || []).map((a) => a.actionName);
    for (const a of ['generate_multibanco_reference', 'mbway_payment', 'mbway_status']) {
      assert(ifpayActions.includes(a), `ifthenpay definition missing action ${a} (has: ${ifpayActions.join(', ')})`);
    }
    const ifpayFields = (ifpay.configSchema || []).map((f) => f.key);
    for (const k of ['api_base', 'mb_key', 'mbway_key', 'anti_phishing_key']) {
      assert(ifpayFields.includes(k), `ifthenpay definition missing config field ${k}`);
    }
    ok('ifthenpay definition loaded (getCallback chave/anti_phishing_key + 3 outbound actions + config schema)');

    // ---- Save credentials + prove the config round-trips + summary redacts ----
    const created = await restJson('POST', '/api/v1/integrations/configs', {
      integrationKey: 'ifthenpay',
      configValues: { api_base: 'http://127.0.0.1:1/ifthenpay-mock', mb_key: 'e2e-mb-key', mbway_key: 'e2e-mbway-key', anti_phishing_key: ANTI_PHISHING },
    });
    assert(created.status === 201 && created.json?.id, `create-config failed (${created.status}): ${JSON.stringify(created.json).slice(0, 300)}`);
    assert(!JSON.stringify(created.json).includes(ANTI_PHISHING), 'config summary must never echo credential values (anti_phishing_key leaked)');
    ok(`ifthenpay config saved (${created.json.id}); summary carries no credential values`);

    const listed = (await restJson('GET', '/api/v1/integrations/configs')).json.items || [];
    assert(listed.some((c) => c.integrationKey === 'ifthenpay'), 'saved ifthenpay config not visible in the config list');
    ok('ifthenpay config visible in the org config list');

    // ---- Create an automation to be the trigger target --------------------
    const auto = await restJson('POST', '/api/v1/automations', { name: `E2E Ifthenpay ${Date.now()}` });
    automationId = auto.json?.id;
    assert(auto.status === 201 && automationId, `automation create failed (${auto.status}): ${JSON.stringify(auto.json).slice(0, 300)}`);
    ok(`automation created (${automationId})`);

    // ---- Create the webhook trigger (automation target, flat wire shape) ---
    const trig = await restJson('POST', '/api/v1/triggers', {
      integrationKey: 'ifthenpay',
      eventName: 'payment.confirmed',
      automationId,
    });
    triggerId = trig.json?.trigger?.id;
    const publicUrl = trig.json?.publicUrl;
    const secret = trig.json?.secret;
    assert(trig.status === 201 && triggerId && secret, `trigger create failed (${trig.status}): ${JSON.stringify(trig.json).slice(0, 400)}`);
    assert(typeof publicUrl === 'string' && publicUrl.endsWith(`/hooks/${triggerId}`), `publicUrl not returned/shaped (landmine 3): ${publicUrl}`);
    assert(trig.json.trigger.automationId === automationId, 'trigger did not bind to the automation target');
    ok(`webhook trigger created (${triggerId}) bound to the automation; one-time secret + publicUrl returned`);

    // ---- GET-callback payment ingress (the old driver's steps 2-4, carried) ----
    const cbUrl = (params) => `${BASE}/hooks/${triggerId}?${new URLSearchParams(params)}`;
    const cbParams = { chave: ANTI_PHISHING, referencia: `E2E-${Date.now().toString(36)}`, valor: '12.34', datahorapag: '2026-07-07 12:00:00' };

    const cb1 = await fetch(cbUrl(cbParams));
    const cb1Body = await cb1.text();
    assert(cb1.status === 200 && cb1Body === 'OK', `callback accept failed: ${cb1.status} body=${cb1Body.slice(0, 120)}`);
    ok('payment callback accepted → 200 "OK" (anti-phishing key verified)');

    const cb2 = await fetch(cbUrl(cbParams));
    const cb2Body = await cb2.text();
    assert(cb2.status === 200 && cb2Body === 'OK', `callback replay must still answer OK: ${cb2.status} body=${cb2Body.slice(0, 120)}`);
    ok('identical callback replay → 200 "OK" (dedup: the provider resends until it sees OK)');

    const cbBad = await fetch(cbUrl({ ...cbParams, chave: 'chave-errada' }));
    assert(cbBad.status === 401, `wrong anti-phishing key must be 401, got ${cbBad.status}`);
    ok('wrong anti-phishing key → 401 (nothing queued)');

    // ---- Deferred / out-of-surface observations ---------------------------
    note('SKIP durable event + webhook_audit rows: no REST surface echoes them (MongoDB store); ingress outcomes proven by the response codes above.');
    note('SKIP outbound generate_multibanco_reference: needs the deferred G8 integration-action executor (the retired `execute` intent returned decrypted creds); proven by the vitest service suite.');
  } finally {
    if (triggerId) {
      const d = await restJson('DELETE', `/api/v1/triggers/${triggerId}`);
      if (d.json?.ok) note(`cleaned up trigger ${triggerId}`);
    }
    if (automationId) {
      await restJson('DELETE', `/api/v1/automations/${automationId}`);
      note(`cleaned up automation ${automationId}`);
    }
    const dc = await restJson('DELETE', '/api/v1/integrations/ifthenpay');
    if (dc.json?.ok) note('cleaned up ifthenpay integration config');
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: Ifthenpay definition (getCallback + actions) + config CRUD + automation-bound webhook trigger verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
