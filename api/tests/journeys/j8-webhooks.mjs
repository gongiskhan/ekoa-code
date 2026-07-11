/**
 * J8-webhooks — webhook HMAC ingress pipeline (ch09 invariant 9). Signature verify, byte-exact
 * dedup, prefix-mismatch rejection, unknown-trigger, and the webhook→automation-run spawn under
 * a credential-less model (a failed/errored run is EXPECTED honest degradation, not a probe fail).
 */
import { api, login, hmacSign, evidence, sleep, PASS, FAIL, INFO } from './_lib.mjs';
import { createHmac } from 'node:crypto';

const J = 'J8-webhooks';
const results = [];
const ev = {};
const stamp = Date.now();

async function main() {
  const admin = await login('admin', 'tmp12345');

  // Create the automation (minimal: name only — super-admin passes the creation gate).
  const auto = await api('POST', '/api/v1/automations', { token: admin, body: { name: 'wt-probe-' + stamp } });
  ev.automation = { status: auto.status, body: auto.body };
  const autoId = auto.body && auto.body.id;
  if (auto.status === 201 && autoId) PASS('J8.auto', `automation ${autoId}`, results);
  else FAIL('J8.auto', `expected 201, got ${auto.status} body=${JSON.stringify(auto.body)}`, results);

  // Create the trigger → capture publicUrl + secret (+ note the absent `algorithm`).
  const trig = await api('POST', '/api/v1/triggers', { token: admin, body: { automationId: autoId, integrationKey: 'gh', eventName: 'push' } });
  ev.trigger = { status: trig.status, body: trig.body };
  const triggerId = trig.body && trig.body.trigger && trig.body.trigger.id;
  const secret = trig.body && trig.body.secret;
  const publicUrl = trig.body && trig.body.publicUrl;
  const hasAlgorithm = !!(trig.body && trig.body.algorithm);
  if (trig.status === 201 && triggerId && secret) PASS('J8.trigger', `trigger ${triggerId} publicUrl=${publicUrl} secretLen=${secret.length}`, results);
  else FAIL('J8.trigger', `expected 201+secret, got ${trig.status} body=${JSON.stringify(trig.body)}`, results);
  INFO('J8.algorithm', `trigger create response ${hasAlgorithm ? 'INCLUDES' : 'does NOT include'} an 'algorithm' field (brief expected one; contract TriggerCreateResponse has none)`, results);

  const hookPath = `/hooks/${triggerId}`;

  // (a) valid signature → 200 accepted:true
  const rawA = JSON.stringify({ probe: 1, n: 1 });
  const sigA = hmacSign(secret, rawA);
  const fireA = await api('POST', hookPath, { rawBody: rawA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sigA } });
  ev.fireValid = { status: fireA.status, body: fireA.body };
  if (fireA.status === 200 && fireA.body && fireA.body.accepted === true) PASS('J8a.valid', `valid sig -> 200 {accepted:true}`, results);
  else FAIL('J8a.valid', `expected 200 accepted:true, got ${fireA.status} ${JSON.stringify(fireA.body)}`, results);

  // (b) exact byte replay → 200 duplicate:true
  const fireB = await api('POST', hookPath, { rawBody: rawA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sigA } });
  ev.fireReplay = { status: fireB.status, body: fireB.body };
  if (fireB.status === 200 && fireB.body && fireB.body.duplicate === true) PASS('J8b.replay', `exact replay -> 200 {duplicate:true}`, results);
  else FAIL('J8b.replay', `expected 200 duplicate:true, got ${fireB.status} ${JSON.stringify(fireB.body)}`, results);

  // (c) same body, WRONG signature (signed with a bad secret) → 401 UNAUTHENTICATED
  const badSig = hmacSign(secret + 'x', rawA);
  const fireC = await api('POST', hookPath, { rawBody: rawA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': badSig } });
  ev.fireBadSig = { status: fireC.status, body: fireC.body };
  const cCode = fireC.body && fireC.body.error && fireC.body.error.code;
  if (fireC.status === 401 && cCode === 'UNAUTHENTICATED') PASS('J8c.badsig', `wrong sig -> 401 ${cCode}`, results);
  else FAIL('J8c.badsig', `expected 401 UNAUTHENTICATED, got ${fireC.status} ${cCode}`, results);

  // (d) correct digest but 'sha1=' prefix → 401 (mismatched sha-family prefix rejected, Codex G8)
  const digest = createHmac('sha256', secret).update(Buffer.from(rawA)).digest('hex');
  const fireD = await api('POST', hookPath, { rawBody: rawA, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha1=' + digest } });
  ev.fireSha1Prefix = { status: fireD.status, body: fireD.body };
  const dCode = fireD.body && fireD.body.error && fireD.body.error.code;
  if (fireD.status === 401 && dCode === 'UNAUTHENTICATED') PASS('J8d.sha1prefix', `sha1= prefix on sha256 digest -> 401 ${dCode}`, results);
  else FAIL('J8d.sha1prefix', `expected 401, got ${fireD.status} ${dCode}`, results);

  // (e) unknown trigger id → record (expect 404 NOT_FOUND envelope)
  const rawE = JSON.stringify({ probe: 'unknown' });
  const fireE = await api('POST', '/hooks/zzz-nonexistent-probe', { rawBody: rawE, headers: { 'content-type': 'application/json', 'x-hub-signature-256': hmacSign('whatever', rawE) } });
  ev.fireUnknown = { status: fireE.status, body: fireE.body };
  const eCode = fireE.body && fireE.body.error && fireE.body.error.code;
  if (fireE.status === 404 && eCode === 'NOT_FOUND') PASS('J8e.unknown', `unknown trigger -> 404 ${eCode}`, results);
  else INFO('J8e.unknown', `unknown trigger -> ${fireE.status} ${eCode || ''} (recorded)`, results);

  // (f) disable path — the triggers router exposes only GET/POST/DELETE; there is NO PATCH/disable.
  const disableAttempt = await api('PATCH', `/api/v1/triggers/${triggerId}`, { token: admin, body: { active: false } });
  ev.disableAttempt = { status: disableAttempt.status, contentType: disableAttempt.contentType, isJson: disableAttempt.isJson, bodyHead: (disableAttempt.text || '').slice(0, 140) };
  INFO('J8f.disable', `no REST disable endpoint: PATCH /triggers/:id -> ${disableAttempt.status} json=${disableAttempt.isJson} (410 disabled-path is covered only by the unit test, not reachable via API)`, results);

  // (g) poll for a run spawned by the accepted webhook delivery (credential-less: any status is honest)
  let runs = [];
  let lastStatus = null;
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    const rl = await api('GET', `/api/v1/automations/runs?automationId=${autoId}`, { token: admin });
    lastStatus = rl.status;
    runs = (rl.body && rl.body.items) || [];
    if (runs.length > 0) break;
  }
  const runSummary = runs.map((r) => ({ id: r.id, status: r.status, summary: r.summary, error: r.error }));
  ev.spawnedRuns = { listStatus: lastStatus, count: runs.length, runs: runSummary };
  if (runs.length > 0) {
    const statuses = runs.map((r) => r.status);
    INFO('J8g.run', `webhook spawned ${runs.length} run(s), status=${JSON.stringify(statuses)} (credential-less: failed/errored is expected honest degradation)`, results);
  } else {
    INFO('J8g.run', `no automation run observed within ~12s after accepted delivery (listStatus=${lastStatus}); recorded as-is`, results);
  }

  const evFile = await evidence(J, 'j8-webhooks', { results, detail: ev });
  console.log(`INFO J8.evidence ${evFile}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
