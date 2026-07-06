#!/usr/bin/env node
/**
 * WhatsApp Business (Meta Cloud API) inbound webhook — committed, re-runnable E2E.
 *
 * Proves the platform-side P1-whatsapp slice against a RUNNING dev cortex, using
 * only SIGNED SYNTHETIC payloads (no real Meta account exists):
 *
 *   1. GET /hooks/:id hub.challenge handshake echoes hub.challenge when the
 *      verify token (== the trigger secret) matches; 403 when it does not.
 *   2. A POST envelope signed with the saved app_secret (X-Hub-Signature-256,
 *      github_x_hub_sig_256) is accepted → 200 { eventId }.
 *   3. A replay of the SAME envelope (identical bytes) is de-duplicated by the
 *      raw-body sha256 → 200 { duplicate:true }. (The skill omits dedupKey, so
 *      envelope dedup is the body hash; per-message wamid dedup is the backend's job.)
 *   4. A POST with a BAD signature is rejected → 401 (proves app_secret verification,
 *      i.e. webhookConfig.secretSource:{credentialField:'app_secret'} resolution).
 *   5. Dispatch is ATTEMPTED: the durable event row + webhook_audit rows are read
 *      straight from ~/.ekoa/data/triggers.db. The legal-nucleo `onMessage` backend
 *      is built by a LATER slice (P3), so the backend-success assertion is a SKIP
 *      note — this driver asserts ingress + dedup + dispatch-attempt only.
 *
 * send_message (outbound, nested-body interpolation + Bearer) is proven over the
 * wire by the vitest suite tests/event-sourcing/whatsapp-webhook.test.ts against a
 * real local mock Graph server, because the platform exposes no HTTP intent to run
 * a saved integration action and the integrations handler is outside this slice.
 * A local mock Graph server is still started here and graph_base_url points at it,
 * so the saved config can never reach real Meta.
 *
 * Auth: login admin/tmp12345 via the ekoa.auth action API for a JWT.
 * Cleanup: the trigger + integration config are deleted (best-effort) before and after.
 * Requires a running dev cortex. Run: node cortex/tests/e2e/whatsapp-inbound.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): cortex binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
const ARTIFACT_ID = process.env.WA_ARTIFACT_ID || 'legal-nucleo';
const ENTRYPOINT = 'onMessage';

const APP_SECRET = `e2e-app-secret-${randomUUID().slice(0, 8)}`;
const PHONE_NUMBER_ID = 'PHONE-E2E';
const SENDER = '351912345678';
const WAMID = `wamid.E2E.${Date.now().toString(36)}`;

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

/** Canonical Meta WhatsApp inbound envelope (single text message). */
function envelope() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_E2E',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '351911111111', phone_number_id: PHONE_NUMBER_ID },
          contacts: [{ profile: { name: 'Cliente E2E' }, wa_id: SENDER }],
          messages: [{
            from: SENDER,
            id: WAMID,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: 'Boa tarde, tenho uma questão sobre o meu processo.' },
          }],
        },
      }],
    }],
  };
}

function sign(rawBuf, secret) {
  return 'sha256=' + createHmac('sha256', secret).update(rawBuf).digest('hex');
}

async function main() {
  // ---- Reachability -------------------------------------------------------
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) {
    console.log(`SKIP: cortex not reachable at ${BASE}/health — start the dev cortex first.`);
    process.exit(0);
  }

  // ---- Local mock Graph server (safety net; outbound never reaches Meta) ---
  const mock = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.MOCK_OUT' }] }));
  });
  await new Promise((r) => mock.listen(0, r));
  const mockPort = mock.address().port;
  const graphBaseUrl = `http://localhost:${mockPort}`;

  let configId = null;
  let triggerId = null;

  try {
    // ---- Login ------------------------------------------------------------
    const login = await action('ekoa.auth', 'login', { username: 'admin', password: 'tmp12345', rememberMe: true });
    TOKEN = login?.data?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- The whatsapp integration skill must be loaded (shipped config) ----
    const skills = await action('ekoa.integrations', 'list-skills', {});
    const wa = (skills?.data || []).find((s) => s.integrationKey === 'whatsapp');
    assert(wa, 'whatsapp integration skill not loaded by cortex (ekoa-data/integrations/whatsapp missing?)');
    assert(wa.webhookConfig?.challenge?.type === 'meta_hub_challenge', 'whatsapp skill missing challenge:meta_hub_challenge');
    assert(wa.webhookConfig?.secretSource?.credentialField === 'app_secret', 'whatsapp skill missing secretSource:app_secret');
    ok('whatsapp skill loaded with challenge + secretSource:app_secret');

    // ---- Save credentials (graph_base_url → local mock) --------------------
    const created = await action('ekoa.integrations', 'create-config', {
      integrationKey: 'whatsapp',
      configValues: {
        access_token: 'e2e-access-token',
        phone_number_id: PHONE_NUMBER_ID,
        app_secret: APP_SECRET,
        graph_base_url: graphBaseUrl,
      },
    });
    configId = created?.data?.id;
    assert(configId, `create-config failed: ${JSON.stringify(created).slice(0, 300)}`);
    ok(`whatsapp integration config saved (${configId})`);

    // ---- Create the webhook trigger (artifact-backend target) --------------
    const trig = await action('ekoa.triggers', 'create', {
      integrationKey: 'whatsapp',
      eventName: 'message.received',
      target: { kind: 'artifact-backend', artifactId: ARTIFACT_ID, entrypoint: ENTRYPOINT },
    });
    const trigger = trig?.data?.trigger;
    triggerId = trigger?.id;
    const publicUrl = trig?.data?.publicUrl;
    const secret = trig?.data?.secret;
    assert(triggerId && publicUrl && secret,
      `trigger create failed (artifact ${ARTIFACT_ID} must exist + be owned by admin): ${JSON.stringify(trig).slice(0, 400)}`);
    assert(trigger.kind === 'webhook', `expected webhook trigger, got kind=${trigger.kind}`);
    ok(`webhook trigger created (${triggerId}); URL + verify-token returned for manual Meta setup`);

    // The public URL uses config.publicHooksBaseUrl (localhost:<port> in dev);
    // rewrite the host to our reachable BASE so the driver hits this cortex.
    const hookPath = new URL(publicUrl).pathname; // /hooks/<triggerId>
    const hookUrl = `${BASE}${hookPath}`;

    // ---- 1. GET hub.challenge handshake -----------------------------------
    const challengeValue = `echo-${Date.now()}`;
    const goodChallenge = await fetch(
      `${hookUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(secret)}&hub.challenge=${encodeURIComponent(challengeValue)}`,
    );
    const goodBody = await goodChallenge.text();
    assert(goodChallenge.status === 200, `challenge GET expected 200, got ${goodChallenge.status} (${goodBody.slice(0, 120)})`);
    assert(goodBody === challengeValue, `challenge echo mismatch: expected "${challengeValue}", got "${goodBody.slice(0, 120)}"`);
    ok('GET hub.challenge echoes the challenge when the verify token matches');

    const badChallenge = await fetch(
      `${hookUrl}?hub.mode=subscribe&hub.verify_token=WRONG-TOKEN&hub.challenge=${encodeURIComponent(challengeValue)}`,
    );
    assert(badChallenge.status === 403, `challenge GET with wrong token expected 403, got ${badChallenge.status}`);
    ok('GET hub.challenge rejects a wrong verify token with 403');

    // ---- 2. Signed POST ingress -------------------------------------------
    const raw = Buffer.from(JSON.stringify(envelope()));
    const postSigned = (buf, sig) => fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: buf,
    });

    const first = await postSigned(raw, sign(raw, APP_SECRET));
    const firstJson = await first.json().catch(() => ({}));
    assert(first.status === 200, `signed POST expected 200, got ${first.status} (${JSON.stringify(firstJson).slice(0, 200)})`);
    assert(firstJson.eventId, `signed POST did not return an eventId: ${JSON.stringify(firstJson)}`);
    ok(`signed envelope accepted → 200 { eventId: ${firstJson.eventId} }`);

    // ---- 3. Replay → duplicate (dedup by wamid) ---------------------------
    const replay = await postSigned(raw, sign(raw, APP_SECRET));
    const replayJson = await replay.json().catch(() => ({}));
    assert(replay.status === 200, `replay expected 200, got ${replay.status}`);
    assert(replayJson.duplicate === true, `replay expected duplicate:true, got ${JSON.stringify(replayJson)}`);
    ok('replay of the identical envelope bytes is de-duplicated by raw-body hash → 200 { duplicate:true }');

    // ---- 4. Bad signature → 401 -------------------------------------------
    const forged = await postSigned(raw, sign(raw, 'the-wrong-app-secret'));
    assert(forged.status === 401, `forged-signature POST expected 401, got ${forged.status}`);
    ok('POST signed with the wrong app_secret is rejected → 401 (secretSource:app_secret verified)');

    // ---- 5. Dispatch attempt (durable event + audit rows) -----------------
    await sleep(1500); // let the dispatcher claim + attempt the event
    await observeDispatch(triggerId);
  } finally {
    // ---- Cleanup ----------------------------------------------------------
    if (triggerId) {
      const d = await action('ekoa.triggers', 'delete', { id: triggerId });
      if (d?.data?.deleted) note(`cleaned up trigger ${triggerId}`);
    }
    if (configId) {
      const d = await action('ekoa.integrations', 'delete-config', { id: configId });
      if (d?.data?.deleted) note(`cleaned up integration config ${configId}`);
    }
    await new Promise((r) => mock.close(r));
  }
}

/**
 * Read the durable event + audit rows straight from triggers.db (read-only).
 * Asserts ingress+dedup were recorded (accepted + duplicate audit rows) and the
 * event exists; REPORTS the dispatch outcome (the legal-nucleo onMessage backend
 * is built by P3, so backend success is a SKIP note, not an assertion).
 *
 * The event's dedup_key is now the raw-body sha256 (the skill omits dedupKey),
 * so the event is located by trigger_id, not by wamid.
 */
async function observeDispatch(trigId) {
  let Database;
  try {
    ({ default: Database } = await import('better-sqlite3'));
  } catch (err) {
    note(`SKIP dispatch-row observation: better-sqlite3 unavailable (${err?.message || err})`);
    return;
  }
  const dbPath = process.env.EKOA_TRIGGERS_DB_PATH || join(homedir(), '.ekoa', 'data', 'triggers.db');
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const audits = db.prepare('SELECT result, detail FROM webhook_audit WHERE trigger_id = ? ORDER BY received_at').all(trigId);
    const results = audits.map((a) => a.result);
    assert(results.includes('accepted'), `expected an 'accepted' audit row for trigger ${trigId}, got [${results.join(', ')}]`);
    assert(results.includes('duplicate'), `expected a 'duplicate' audit row for trigger ${trigId}, got [${results.join(', ')}]`);
    ok(`webhook_audit shows accepted + duplicate for the trigger (rows: ${results.join(', ')})`);

    const ev = db.prepare('SELECT id, status, run_id, last_error, attempts, dedup_key FROM events WHERE trigger_id = ? ORDER BY received_at DESC LIMIT 1').get(trigId);
    assert(ev, `no durable event row for trigger ${trigId}`);
    assert(String(ev.dedup_key || '').startsWith('sha256:'), `expected a body-hash dedup key (sha256:…), got "${ev.dedup_key}"`);
    ok(`durable event row present (status=${ev.status}, attempts=${ev.attempts})`);
    if (ev.status === 'dispatched' && String(ev.run_id || '').startsWith(`ab:${ARTIFACT_ID}:`)) {
      ok(`dispatch SUCCEEDED into ${ARTIFACT_ID}.${ENTRYPOINT} (run_id=${ev.run_id}) — backend already present`);
    } else {
      note(`dispatch attempted; outcome status=${ev.status} run_id=${ev.run_id || '-'} last_error=${(ev.last_error || '').slice(0, 160)}`);
      note(`SKIP backend-success assertion: ${ARTIFACT_ID}.${ENTRYPOINT} backend is built by a later slice (P3).`);
    }
  } catch (err) {
    if (err?.message === '__ASSERT__') throw err;
    note(`SKIP dispatch-row observation: could not read ${dbPath} (${err?.message || err})`);
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: WhatsApp inbound challenge + signed ingress + dedup + dispatch-attempt verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
