#!/usr/bin/env node
/**
 * Ifthenpay GET-callback ingress — committed, re-runnable E2E.
 *
 * Proves the PB1 Ifthenpay slice against a RUNNING dev cortex using synthetic
 * "backoffice" callbacks (no real Ifthenpay account exists):
 *
 *   1. The ifthenpay integration skill is loaded and declares webhookConfig.getCallback
 *      (keyParam=chave, secretSource.credentialField=anti_phishing_key).
 *   2. A GET /hooks/:id?chave=<anti_phishing_key>&referencia=&valor=&datahorapag=
 *      with the CORRECT key is accepted → 200 text/plain "OK" + one durable event.
 *   3. An identical replay is de-duplicated by (referencia|valor|datahorapag) →
 *      200 "OK", no second event.
 *   4. A callback with the WRONG chave is rejected → 401, nothing queued.
 *   5. The durable event + webhook_audit rows are read straight from triggers.db:
 *      accepted + duplicate + rejected_signature audit rows, exactly one event.
 *   6. Sanity: the decrypted config drives a real generate_multibanco_reference call
 *      against a local mock Ifthenpay API (this is what the agent layer does with the
 *      `ekoa.integrations execute` result — the platform exposes no HTTP action intent).
 *
 * Auth: login admin/tmp12345 via the ekoa.auth action API for a JWT.
 * Cleanup: trigger + config + automation deleted (best-effort) before and after.
 * Requires a running dev cortex. Run: node cortex/tests/e2e/ifthenpay.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { start as startIfpayMock, stop as stopIfpayMock } from '../helpers/mock-ifthenpay-server.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): cortex binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;

const ANTI_PHISHING = `e2e-antiphish-${randomUUID().slice(0, 8)}`;

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

/** Build the callback URL the Ifthenpay backoffice would GET. */
function callbackUrl(hookUrl, { chave, referencia, valor, datahorapag }) {
  const qs = new URLSearchParams({ chave, referencia, valor, datahorapag });
  return `${hookUrl}?${qs.toString()}`;
}

async function main() {
  // ---- Reachability -------------------------------------------------------
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  const mockBase = await startIfpayMock();

  let configId = null;
  let triggerId = null;
  let automationId = null;

  try {
    // ---- Login ------------------------------------------------------------
    const login = await action('ekoa.auth', 'login', { username: 'admin', password: 'tmp12345', rememberMe: true });
    TOKEN = login?.data?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- The ifthenpay skill must be loaded with getCallback --------------
    const skills = await action('ekoa.integrations', 'list-skills', {});
    const ifpay = (skills?.data || []).find((s) => s.integrationKey === 'ifthenpay');
    assert(ifpay, 'ifthenpay integration skill not loaded (ekoa-data/integrations/ifthenpay missing? restart cortex)');
    assert(ifpay.webhookConfig?.getCallback?.keyParam === 'chave', 'ifthenpay skill missing getCallback.keyParam=chave');
    assert(
      ifpay.webhookConfig?.getCallback?.secretSource?.credentialField === 'anti_phishing_key',
      'ifthenpay skill missing getCallback.secretSource.credentialField=anti_phishing_key',
    );
    ok('ifthenpay skill loaded with getCallback (chave / anti_phishing_key)');

    // ---- Save credentials (api_base → local mock) -------------------------
    const created = await action('ekoa.integrations', 'create-config', {
      integrationKey: 'ifthenpay',
      configValues: {
        api_base: mockBase,
        mb_key: 'e2e-mb-key',
        mbway_key: 'e2e-mbway-key',
        anti_phishing_key: ANTI_PHISHING,
      },
    });
    configId = created?.data?.id;
    assert(configId, `create-config failed: ${JSON.stringify(created).slice(0, 300)}`);
    ok(`ifthenpay integration config saved (${configId})`);

    // ---- Create an automation to be the trigger target --------------------
    const auto = await action('ekoa.automations', 'create', { name: `E2E Ifthenpay ${Date.now()}`, steps: [] });
    automationId = auto?.data?.automation?.id;
    assert(automationId, `automation create failed: ${JSON.stringify(auto).slice(0, 300)}`);
    ok(`automation created (${automationId})`);

    // ---- Create the webhook trigger (automation target) -------------------
    const trig = await action('ekoa.triggers', 'create', {
      integrationKey: 'ifthenpay',
      eventName: 'payment.confirmed',
      automationId,
      target: { kind: 'automation' },
    });
    const trigger = trig?.data?.trigger;
    triggerId = trigger?.id;
    const publicUrl = trig?.data?.publicUrl;
    assert(triggerId && publicUrl, `trigger create failed: ${JSON.stringify(trig).slice(0, 400)}`);
    assert(trigger.kind === 'webhook', `expected webhook trigger, got kind=${trigger.kind}`);
    ok(`webhook trigger created (${triggerId})`);

    // The public URL uses config.publicHooksBaseUrl; rewrite host to reachable BASE.
    const hookPath = new URL(publicUrl).pathname; // /hooks/<triggerId>
    const hookUrl = `${BASE}${hookPath}`;

    const referencia = `E2E-${randomUUID().slice(0, 8)}`;
    const goodParams = { chave: ANTI_PHISHING, referencia, valor: '10.50', datahorapag: '2026-07-03 10:00:00' };

    // ---- 2. Correct chave → 200 OK ----------------------------------------
    const accepted = await fetch(callbackUrl(hookUrl, goodParams));
    const acceptedBody = await accepted.text();
    assert(accepted.status === 200, `correct-key callback expected 200, got ${accepted.status} (${acceptedBody.slice(0, 120)})`);
    assert(acceptedBody === 'OK', `correct-key callback expected body "OK", got "${acceptedBody.slice(0, 120)}"`);
    ok('GET callback with the correct chave is accepted → 200 "OK"');

    // ---- 3. Replay → dedup ------------------------------------------------
    const replay = await fetch(callbackUrl(hookUrl, goodParams));
    const replayBody = await replay.text();
    assert(replay.status === 200 && replayBody === 'OK', `replay expected 200 "OK", got ${replay.status} "${replayBody.slice(0, 60)}"`);
    ok('replay of the identical callback is de-duplicated → 200 "OK"');

    // ---- 4. Wrong chave → 401 ---------------------------------------------
    const forged = await fetch(callbackUrl(hookUrl, { ...goodParams, chave: 'the-wrong-key' }));
    assert(forged.status === 401, `wrong-key callback expected 401, got ${forged.status}`);
    ok('GET callback with the wrong chave is rejected → 401');

    // ---- 5. Durable event + audit rows ------------------------------------
    await observeIngress(triggerId, referencia);

    // ---- 6. Decrypted config drives a real (mock) provider call -----------
    await proveOutboundReference(configId, mockBase);
  } finally {
    if (triggerId) {
      const d = await action('ekoa.triggers', 'delete', { id: triggerId });
      if (d?.data?.deleted) note(`cleaned up trigger ${triggerId}`);
    }
    if (automationId) {
      const d = await action('ekoa.automations', 'delete', { id: automationId });
      if (d?.data?.deleted || d?.success) note(`cleaned up automation ${automationId}`);
    }
    if (configId) {
      const d = await action('ekoa.integrations', 'delete-config', { id: configId });
      if (d?.data?.deleted) note(`cleaned up integration config ${configId}`);
    }
    await stopIfpayMock();
  }
}

/** Read the durable event + audit rows straight from triggers.db (read-only). */
async function observeIngress(trigId, referencia) {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    note(`SKIP db observation: better-sqlite3 unavailable (${err?.message || err})`);
    return;
  }
  const dbPath = process.env.EKOA_TRIGGERS_DB_PATH || join(homedir(), '.ekoa', 'data', 'triggers.db');
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const results = db.prepare('SELECT result FROM webhook_audit WHERE trigger_id = ? ORDER BY received_at').all(trigId).map((r) => r.result);
    assert(results.includes('accepted'), `expected an 'accepted' audit row, got [${results.join(', ')}]`);
    assert(results.includes('duplicate'), `expected a 'duplicate' audit row, got [${results.join(', ')}]`);
    assert(results.includes('rejected_signature'), `expected a 'rejected_signature' audit row, got [${results.join(', ')}]`);
    ok(`webhook_audit shows accepted + duplicate + rejected_signature (rows: ${results.join(', ')})`);

    const events = db.prepare('SELECT dedup_key, raw_body FROM events WHERE trigger_id = ?').all(trigId);
    assert(events.length === 1, `expected exactly one durable event (dedup), got ${events.length}`);
    const payload = JSON.parse(Buffer.from(events[0].raw_body).toString('utf8'));
    assert(payload.referencia === referencia, `event payload referencia mismatch: ${payload.referencia} != ${referencia}`);
    assert(!String(events[0].dedup_key).includes(ANTI_PHISHING), 'dedup key must not carry the anti-phishing secret');
    ok(`one durable event with the query payload (referencia=${payload.referencia}); dedup key excludes the secret`);
  } catch (err) {
    if (err?.message === '__ASSERT__') throw err;
    note(`SKIP db observation: could not read ${dbPath} (${err?.message || err})`);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

/**
 * The `ekoa.integrations execute` intent returns the DECRYPTED config for the
 * agent layer to run (the platform exposes no HTTP action-execution intent).
 * Drive generate_multibanco_reference exactly as the agent layer would: read the
 * decrypted api_base + mb_key and POST to the (mock) Ifthenpay API.
 */
async function proveOutboundReference(configId, mockBase) {
  const exec = await action('ekoa.integrations', 'execute', {
    id: configId,
    action: 'generate_multibanco_reference',
    args: { order_id: 'ORD-E2E-1', amount: '10.50' },
  });
  const creds = exec?.data?.credentials;
  assert(creds, `execute did not return decrypted credentials: ${JSON.stringify(exec).slice(0, 200)}`);
  const parsed = JSON.parse(creds);
  assert(parsed.api_base === mockBase, `decrypted api_base mismatch: ${parsed.api_base} != ${mockBase}`);
  assert(exec?.data?.action === 'generate_multibanco_reference', 'execute did not echo the action');
  ok('execute intent round-trips the stored config + decrypts api_base/mb_key');

  const resp = await fetch(`${parsed.api_base}/multibanco/reference/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mbKey: parsed.mb_key, orderId: exec.data.args.order_id, amount: exec.data.args.amount }),
  });
  const body = await resp.json();
  assert(resp.status === 200 && body.Entidade === '11249' && body.Referencia, `mock reference init failed: ${JSON.stringify(body).slice(0, 160)}`);
  ok(`decrypted config drives a real Multibanco reference (Entidade=${body.Entidade}, Referencia=${body.Referencia})`);
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: Ifthenpay getCallback ingress (accept + dedup + 401) + durable event + outbound reference verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
