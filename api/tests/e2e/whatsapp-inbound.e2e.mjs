#!/usr/bin/env node
/**
 * WhatsApp Business (Meta Cloud API) inbound webhook — committed, re-runnable E2E.
 *
 * Proves the platform-side P1-whatsapp slice against a RUNNING dev api, using only
 * SIGNED SYNTHETIC payloads (no real Meta account exists):
 *
 *   1. The whatsapp integration DEFINITION is loaded and declares the Meta hub
 *      challenge + secretSource.credentialField='app_secret' (skill shape).
 *   2. GET /hooks/:id hub.challenge handshake echoes hub.challenge when the verify
 *      token matches; a wrong token is refused.
 *   3. A POST envelope signed with the owner's stored app_secret
 *      (X-Hub-Signature-256) is accepted → 200 { accepted:true }.
 *   4. A POST signed with the PER-TRIGGER secret is rejected → 401: under
 *      secretSource.credentialField the trigger secret is NOT the webhook secret.
 *   5. A POST signed with an unrelated secret is rejected → 401 (forged).
 *   6. A replay of the accepted envelope is de-duplicated → 200 { duplicate:true },
 *      byte-identical AND re-serialised (the dedup key is the wamid SET).
 *
 * REST adaptation (2026-07-07, G8, per spec/reference/test-audit.md §5.1): transport
 * swapped from the retired action envelope (POST /api/v1/action, ekoa.auth/
 * integrations/triggers intents) + direct triggers.db (better-sqlite3) reads to the
 * typed REST surface (POST /api/v1/auth/login, GET /api/v1/integrations,
 * POST /api/v1/integrations/configs, POST /api/v1/triggers, GET|POST /hooks/:id).
 *
 * BEHAVIOURAL DIFFERENCES vs the old cortex (see the report; these are the new
 * generic webhook model, ch09 invariant 9 — not regressions in this driver):
 *   - The webhook HMAC keys off the secret the INTEGRATION DEFINITION points at:
 *     whatsapp declares webhookConfig.secretSource.credentialField='app_secret', so
 *     ingress verifies against the OWNER's stored (decrypted) app_secret. Meta signs
 *     every webhook with the app secret, so nothing else could ever verify. The
 *     per-trigger secret returned at trigger creation is NOT the webhook secret for
 *     this integration — step 4 proves it is refused. Resolution fails CLOSED (a
 *     missing/undecryptable credential rejects; it never falls back to '' or to the
 *     trigger secret).
 *   - The hub-challenge verify token is a GLOBAL env value (WEBHOOK_HUB_VERIFY_TOKEN,
 *     default ''), not the per-trigger secret; a mismatch returns 400 (not 403).
 *   - Accepted ingress returns { accepted:true } (was { eventId }); dedup keys off
 *     the SET of wamids in the envelope (sha256 → `wamid:<hex>`), not the raw body
 *     and not the signature — so a Meta retry that re-serialises the same messages
 *     still collapses, while a later batch [m1,m2] stays distinct from a seen [m1].
 *
 * DOCUMENTED SKIPs (no REST surface in the current build):
 *   - webhook_audit / event-queue rows were read from triggers.db; there is no REST
 *     endpoint that echoes them. The ingress OUTCOMES they recorded (accepted /
 *     duplicate / rejected_signature) are proven directly by the HTTP response codes
 *     above, so no assertion is dropped — only the row-level introspection is a NOTE.
 *   - Dispatch into the legal-nucleo onMessage backend is a LATER slice (P3), and the
 *     integration-action executor (send_message outbound) is the deferred G8 execution
 *     stack; both remain SKIP (send_message is proven by the vitest suite
 *     tests/events/whatsapp-webhook.test.ts against a mock Graph server).
 *
 * Auth: login admin/tmp12345 via POST /api/v1/auth/login for a JWT.
 * Cleanup: the trigger + integration config are deleted (best-effort) before and after.
 * Run: node api/tests/e2e/whatsapp-inbound.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = (() => {
  try { return readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim(); } catch { return '4111'; }
})();
// 127.0.0.1 (not localhost): the api binds IPv4; Node fetch may resolve localhost to ::1.
const BASE = process.env.CORTEX_BASE || `http://127.0.0.1:${PORT}`;
// The hub-challenge verify token is a global env value shared by the server (default '').
const HUB_TOKEN = process.env.WEBHOOK_HUB_VERIFY_TOKEN ?? '';
const ARTIFACT_ID = process.env.WA_ARTIFACT_ID || 'legal-nucleo';
const ENTRYPOINT = 'onMessage';

const APP_SECRET = 'e2e-app-secret';
const PHONE_NUMBER_ID = 'PHONE-E2E';
const SENDER = '351912345678';
const WAMID = `wamid.E2E.${Date.now().toString(36)}`;

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
    console.log(`SKIP: api not reachable at ${BASE}/health — start the dev api first (node scripts/dev-api.mjs).`);
    process.exit(0);
  }

  // ---- Local mock Graph server (safety net; outbound never reaches Meta) ---
  const mock = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.MOCK_OUT' }] }));
  });
  await new Promise((r) => mock.listen(0, r));
  const graphBaseUrl = `http://127.0.0.1:${mock.address().port}`;

  let triggerId = null;

  try {
    // ---- Login ------------------------------------------------------------
    const login = await restLogin('admin', 'tmp12345');
    TOKEN = login?.token;
    assert(TOKEN, `login failed: ${JSON.stringify(login).slice(0, 200)}`);
    ok('logged in (JWT acquired)');

    // ---- The whatsapp definition must be loaded (shipped package) ----------
    const defs = (await restJson('GET', '/api/v1/integrations')).json.items || [];
    const wa = defs.find((s) => s.integrationKey === 'whatsapp');
    assert(wa, 'whatsapp integration definition not loaded (api/assets/integrations/whatsapp missing?)');
    assert(wa.webhookConfig?.challenge?.type === 'meta_hub_challenge', 'whatsapp definition missing challenge:meta_hub_challenge');
    assert(wa.webhookConfig?.secretSource?.credentialField === 'app_secret', 'whatsapp definition missing secretSource:app_secret');
    ok('whatsapp definition loaded with meta_hub_challenge + secretSource:app_secret');

    // ---- Save credentials (graph_base_url → local mock) --------------------
    // Best-effort pre-cleanup: a config left behind by an aborted run would shadow the one this
    // driver stores, and the app_secret it holds is what ingress verifies against.
    await restJson('DELETE', '/api/v1/integrations/whatsapp');
    const created = await restJson('POST', '/api/v1/integrations/configs', {
      integrationKey: 'whatsapp',
      configValues: {
        access_token: 'e2e-access-token',
        phone_number_id: PHONE_NUMBER_ID,
        app_secret: APP_SECRET,
        graph_base_url: graphBaseUrl,
      },
    });
    assert(created.status === 201 && created.json?.id, `create-config failed (${created.status}): ${JSON.stringify(created.json).slice(0, 300)}`);
    ok(`whatsapp integration config saved (${created.json.id}; credentials redacted in the summary)`);

    // ---- Create the webhook trigger (artifact-backend target) --------------
    const trig = await restJson('POST', '/api/v1/triggers', {
      integrationKey: 'whatsapp',
      eventName: 'message.received',
      target: { kind: 'artifact-backend', artifactId: ARTIFACT_ID, entrypoint: ENTRYPOINT },
    });
    triggerId = trig.json?.trigger?.id;
    const publicUrl = trig.json?.publicUrl;
    const secret = trig.json?.secret;
    assert(trig.status === 201 && triggerId && secret, `trigger create failed (${trig.status}): ${JSON.stringify(trig.json).slice(0, 400)}`);
    assert(typeof publicUrl === 'string' && publicUrl.endsWith(`/hooks/${triggerId}`), `publicUrl not returned/shaped (landmine 3): ${publicUrl}`);
    ok(`webhook trigger created (${triggerId}); publicUrl + one-time secret returned`);

    // The public URL base is config-driven (empty in dev); hit this api at 127.0.0.1.
    const hookUrl = `${BASE}/hooks/${triggerId}`;

    // ---- 1. GET hub.challenge handshake (global verify token) --------------
    const challengeValue = `echo-${Date.now()}`;
    const goodChallenge = await fetch(
      `${hookUrl}?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(HUB_TOKEN)}&hub.challenge=${encodeURIComponent(challengeValue)}`,
    );
    const goodBody = await goodChallenge.text();
    assert(goodChallenge.status === 200, `challenge GET expected 200, got ${goodChallenge.status} (${goodBody.slice(0, 120)})`);
    assert(goodBody === challengeValue, `challenge echo mismatch: expected "${challengeValue}", got "${goodBody.slice(0, 120)}"`);
    ok(`GET hub.challenge echoes the challenge when the verify token matches (WEBHOOK_HUB_VERIFY_TOKEN${HUB_TOKEN ? '' : ' default ""'})`);

    const badChallenge = await fetch(
      `${hookUrl}?hub.mode=subscribe&hub.verify_token=DEFINITELY-WRONG-${Date.now()}&hub.challenge=${encodeURIComponent(challengeValue)}`,
    );
    assert(badChallenge.status === 400, `challenge GET with a wrong token expected 400, got ${badChallenge.status}`);
    ok('GET hub.challenge rejects a wrong verify token with 400');
    note('hub-challenge verify token is a GLOBAL env value (WEBHOOK_HUB_VERIFY_TOKEN), not the per-trigger secret — the new generic webhook model (ch09).');

    // ---- 2. Rejected POSTs FIRST (nothing may be enqueued by a bad signature)
    const env = envelope();
    const raw = Buffer.from(JSON.stringify(env));
    const postSigned = (buf, sig) => fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
      body: buf,
    });

    // 2a. The PER-TRIGGER secret is NOT the webhook secret for an integration that declares
    //     secretSource.credentialField — signing with it must be refused exactly like a forgery.
    const triggerSigned = await postSigned(raw, sign(raw, secret));
    const triggerSignedJson = await triggerSigned.json().catch(() => ({}));
    assert(
      triggerSigned.status === 401,
      `POST signed with the per-trigger secret expected 401, got ${triggerSigned.status} (${JSON.stringify(triggerSignedJson).slice(0, 200)})`,
    );
    assert(
      triggerSignedJson?.error?.code === 'UNAUTHENTICATED',
      `trigger-secret POST expected the UNAUTHENTICATED error envelope, got ${JSON.stringify(triggerSignedJson).slice(0, 200)}`,
    );
    ok('POST signed with the PER-TRIGGER secret is rejected → 401 UNAUTHENTICATED (secretSource:app_secret, not the trigger secret)');

    // 2b. A wholly unrelated secret (the classic forgery) is refused too.
    const forged = await postSigned(raw, sign(raw, 'the-wrong-secret'));
    assert(forged.status === 401, `forged-signature POST expected 401, got ${forged.status}`);
    ok('POST signed with an unrelated secret is rejected → 401 (HMAC verification, ch09 invariant 9)');

    // ---- 3. Signed POST ingress (HMAC keyed off the owner's app_secret) ----
    const first = await postSigned(raw, sign(raw, APP_SECRET));
    const firstJson = await first.json().catch(() => ({}));
    assert(first.status === 200, `app_secret-signed POST expected 200, got ${first.status} (${JSON.stringify(firstJson).slice(0, 200)})`);
    // accepted (not duplicate) also proves neither rejected POST above enqueued anything: they
    // carried this exact envelope, so an enqueued forgery would make THIS delivery a duplicate.
    assert(firstJson.accepted === true, `app_secret-signed POST expected { accepted:true }, got ${JSON.stringify(firstJson)}`);
    ok('envelope signed with the owner app_secret is accepted → 200 { accepted:true } (and the two rejected POSTs enqueued nothing)');

    // ---- 4. Replay → duplicate (dedup keyed on the wamid SET) -------------
    const replay = await postSigned(raw, sign(raw, APP_SECRET));
    const replayJson = await replay.json().catch(() => ({}));
    assert(replay.status === 200 && replayJson.duplicate === true, `replay expected 200 { duplicate:true }, got ${replay.status} ${JSON.stringify(replayJson)}`);
    ok('replay of the identical envelope is de-duplicated → 200 { duplicate:true }');

    // 4b. A Meta retry that RE-SERIALISES the envelope (different bytes, same wamid) must still
    //     dedupe — this is what the wamid-set key buys over a raw-body hash.
    const rawReordered = Buffer.from(JSON.stringify({ entry: env.entry, object: env.object }));
    assert(!rawReordered.equals(raw), 're-serialised envelope must differ byte-wise for this assertion to mean anything');
    const reserialised = await postSigned(rawReordered, sign(rawReordered, APP_SECRET));
    const reserialisedJson = await reserialised.json().catch(() => ({}));
    assert(
      reserialised.status === 200 && reserialisedJson.duplicate === true,
      `re-serialised retry expected 200 { duplicate:true }, got ${reserialised.status} ${JSON.stringify(reserialisedJson)}`,
    );
    ok('re-serialised retry (different bytes, same wamid) is de-duplicated → 200 { duplicate:true }');
    note(`webhook HMAC keys off the owner's stored app_secret (webhookConfig.secretSource.credentialField), not the per-trigger secret; dedup keys off the wamid set (${WAMID}).`);

    // ---- Deferred / out-of-surface observations ---------------------------
    note('SKIP webhook_audit/event-queue row introspection: no REST surface echoes them (MongoDB store); the ingress outcomes are proven by the response codes above.');
    note(`SKIP dispatch into ${ARTIFACT_ID}.${ENTRYPOINT}: the backend is a later slice (P3).`);
    note('SKIP send_message outbound: needs the deferred G8 integration-action executor; proven over-the-wire by tests/events/whatsapp-webhook.test.ts.');
  } finally {
    if (triggerId) {
      const d = await restJson('DELETE', `/api/v1/triggers/${triggerId}`);
      if (d.json?.ok) note(`cleaned up trigger ${triggerId}`);
    }
    const dc = await restJson('DELETE', '/api/v1/integrations/whatsapp');
    if (dc.json?.ok) note('cleaned up whatsapp integration config');
    await new Promise((r) => mock.close(r));
  }
}

main().then(
  () => {
    if (process.exitCode) { console.error('\nE2E: FAILURES above.'); process.exit(process.exitCode); }
    console.log('\nE2E PASS: WhatsApp definition + hub.challenge + app_secret-keyed HMAC ingress + wamid dedup + trigger-secret/forged rejection verified.');
    process.exit(0);
  },
  (err) => {
    if (err?.message !== '__ASSERT__') console.error('E2E ERROR:', err?.stack || err);
    process.exit(process.exitCode || 1);
  },
);
