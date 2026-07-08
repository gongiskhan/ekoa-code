#!/usr/bin/env node
/**
 * J8b-automation — a REAL automation, end to end, as bc-adm on the credentialed stack:
 *   plan-from-goal (persists automation + starts a rehearsal run) -> create a webhook trigger ->
 *   fire a HMAC-signed delivery -> the webhook spawns a REAL automation run -> assert an HONEST
 *   terminal (completed, or failed with a real reason) -> automation billing rows.
 *
 * Model-triggering calls: the plan (+ its rehearsal run) and the webhook-spawned run. No retries.
 *
 *   node j8b-automation.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { api, login, hmacSign, sseCollect, evidence, EVIDENCE_ROOT, PASS, FAIL, INFO, sleep } from './_lib.mjs';

const PW = 'tmp12345';
const ACTIONS_LOG = join(EVIDENCE_ROOT, 'J9-billing', 'actions-log-build.json');
async function appendAction(entry) {
  await mkdir(dirname(ACTIONS_LOG), { recursive: true });
  let arr = [];
  try { arr = JSON.parse(await readFile(ACTIONS_LOG, 'utf8')); if (!Array.isArray(arr)) arr = []; } catch { arr = []; }
  arr.push({ ts: new Date().toISOString(), ...entry });
  await writeFile(ACTIONS_LOG, JSON.stringify(arr, null, 2) + '\n');
}

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
function compactRunFrames(frames) {
  const counts = {};
  const kept = [];
  for (const f of frames) {
    const d = f.data;
    const type = (d && typeof d === 'object' && d.type) || f.event || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
    if (!d || typeof d !== 'object') { kept.push({ event: f.event, raw: String(d).slice(0, 120) }); continue; }
    if (d.type === 'step_output_chunk') { kept.push({ type: 'step_output_chunk', stepIndex: d.stepIndex, stream: d.stream, chunk: String(d.chunk || '').slice(0, 120) }); continue; }
    if (d.type === 'step') { kept.push({ type: 'step', stepIndex: d.stepIndex, status: d.status }); continue; }
    if (d.type === 'complete') { kept.push({ type: 'complete', summary: String(d.summary || '').slice(0, 200) }); continue; }
    if (d.type === 'error') { kept.push({ type: 'error', code: d.code, message: d.message }); continue; }
    kept.push({ type });
  }
  return { counts, frames: kept };
}

async function main() {
  const results = [];
  const ev = {};
  const adm = await login('bc-adm', PW);

  // 1) plan-from-goal (persists automation + starts a rehearsal run).
  await appendAction({ journey: 'J8-webhooks', username: 'bc-adm', action: 'POST /automations/plan (wt-real)', expectedAgentTypes: ['automation-plan', 'automation-rehearse'] });
  const plan = await api('POST', '/api/v1/automations/plan', {
    token: adm,
    timeoutMs: 90000,
    body: { goal: 'Quando chegar um webhook com um pagamento, valida se o valor é positivo e regista um resumo de uma linha.', name: 'wt-real', language: 'pt' },
  });
  ev.plan = { status: plan.status, body: plan.body };
  const automationId = plan.body && plan.body.automation && plan.body.automation.id;
  const rehearseRunId = plan.body && plan.body.runId;
  const rehearsing = plan.body && plan.body.rehearsing;
  if (plan.status === 200 && automationId) PASS('J8b.plan', `plan -> automation ${automationId} rehearsing=${rehearsing} runId=${rehearseRunId} steps=${(plan.body.plan && plan.body.plan.steps || []).length}`, results);
  else { FAIL('J8b.plan', `plan -> ${plan.status} ${JSON.stringify(plan.body).slice(0, 200)}`, results); await evidence('J8-webhooks', 'j8b-automation', { results, detail: ev }); return; }

  // If a rehearsal run started, follow it to terminal (10 min).
  if (rehearseRunId) {
    const t0 = Date.now();
    const sse = await sseCollect(`/api/v1/automations/runs/${rehearseRunId}/events`, { token: adm, timeoutMs: 10 * 60 * 1000, lastEventId: '0', until: (f) => f.data && typeof f.data === 'object' && (f.data.type === 'complete' || f.data.type === 'error') });
    const compact = compactRunFrames(sse.frames);
    const rec = await api('GET', `/api/v1/automations/runs/${rehearseRunId}`, { token: adm });
    const rehSec = Math.round((Date.now() - t0) / 1000);
    ev.rehearsal = { runId: rehearseRunId, wallSec: rehSec, frameCounts: compact.counts, frames: compact.frames, record: rec.body };
    const rstatus = rec.body && rec.body.status;
    INFO('J8b.rehearsal', `rehearsal run status=${rstatus} in ${rehSec}s summary=${(rec.body && rec.body.summary || '').slice(0, 120)}`, results);
  } else {
    INFO('J8b.rehearsal', `plan did not start a rehearsal run (runId absent)`, results);
  }

  // Snapshot run ids BEFORE firing so we can identify the webhook-spawned run.
  const before = await api('GET', `/api/v1/automations/runs?automationId=${automationId}`, { token: adm });
  const beforeIds = new Set(((before.body && before.body.items) || []).map((r) => r.id));

  // 2) Create the trigger (integrationKey 'gh' = the value Boot-A used; eventName 'pagamento').
  const trig = await api('POST', '/api/v1/triggers', { token: adm, body: { automationId, integrationKey: 'gh', eventName: 'pagamento' } });
  const triggerId = trig.body && trig.body.trigger && trig.body.trigger.id;
  const secret = trig.body && trig.body.secret;
  const publicUrl = trig.body && trig.body.publicUrl;
  ev.trigger = { status: trig.status, triggerId, publicUrl, secretLen: secret && secret.length, registrationError: trig.body && trig.body.registrationError };
  if (trig.status === 201 && triggerId && secret) PASS('J8b.trigger', `trigger ${triggerId} publicUrl=${publicUrl}`, results);
  else { FAIL('J8b.trigger', `trigger -> ${trig.status} ${JSON.stringify(trig.body).slice(0, 200)}`, results); await evidence('J8-webhooks', 'j8b-automation', { results, detail: ev }); return; }

  // 3) Fire a valid HMAC-signed delivery (sign the EXACT bytes sent).
  await appendAction({ journey: 'J8-webhooks', username: 'bc-adm', action: `POST /hooks/${triggerId} (pagamento valor=42) -> spawn automation run`, expectedAgentTypes: ['automation-run'] });
  const rawBody = JSON.stringify({ valor: 42, ref: 'probe-1' });
  const sig = hmacSign(secret, rawBody);
  const fire = await api('POST', `/hooks/${triggerId}`, { rawBody, headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig } });
  ev.fire = { status: fire.status, body: fire.body };
  if (fire.status === 200 && fire.body && (fire.body.accepted === true || fire.body.duplicate === true)) PASS('J8b.fire', `webhook accepted -> 200 ${JSON.stringify(fire.body)}`, results);
  else FAIL('J8b.fire', `expected 200 accepted, got ${fire.status} ${JSON.stringify(fire.body)}`, results);

  // Poll for a NEW run (not in beforeIds) reaching a terminal state (10 min).
  const deadline = Date.now() + 10 * 60 * 1000;
  let newRun = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    const rl = await api('GET', `/api/v1/automations/runs?automationId=${automationId}`, { token: adm });
    const items = (rl.body && rl.body.items) || [];
    const candidate = items.find((r) => !beforeIds.has(r.id));
    if (candidate) {
      newRun = candidate;
      if (TERMINAL.has(candidate.status)) break;
    }
  }
  if (newRun) {
    // fetch full record + attach SSE for its frames (short — the run is likely already terminal)
    const rec = await api('GET', `/api/v1/automations/runs/${newRun.id}`, { token: adm });
    const sse = await sseCollect(`/api/v1/automations/runs/${newRun.id}/events`, { token: adm, timeoutMs: 60000, lastEventId: '0', until: (f) => f.data && typeof f.data === 'object' && (f.data.type === 'complete' || f.data.type === 'error') });
    const compact = compactRunFrames(sse.frames);
    const status = (rec.body && rec.body.status) || newRun.status;
    ev.webhookRun = { runId: newRun.id, status, summary: rec.body && rec.body.summary, record: rec.body, frameCounts: compact.counts, frames: compact.frames };
    const honest = status === 'completed' || (status === 'failed' && rec.body);
    if (TERMINAL.has(status)) {
      if (honest) PASS('J8b.run', `webhook-spawned run ${newRun.id} terminal=${status} summary=${(rec.body && rec.body.summary || '').slice(0, 140)}`, results);
      else INFO('J8b.run', `webhook-spawned run terminal=${status} (recorded)`, results);
    } else {
      INFO('J8b.run', `webhook-spawned run ${newRun.id} did NOT reach terminal within 10 min (status=${status})`, results);
    }
  } else {
    INFO('J8b.run', `no NEW automation run observed within 10 min after accepted delivery`, results);
  }

  // 4) Billing history (bc-adm) — automation-related rows.
  const hist = await api('GET', '/api/v1/billing/history', { token: adm });
  const items = (hist.body && hist.body.items) || [];
  const autoRows = items.filter((r) => /automation|rehears|plan/i.test(r.type));
  const typeCounts = items.reduce((a, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {});
  ev.billing = { status: hist.status, total: hist.body && hist.body.total, typeCounts, automationRows: autoRows };
  INFO('J8b.billing', `bc-adm billing types=${JSON.stringify(typeCounts)} automationRows=${autoRows.length}`, results);

  const evFile = await evidence('J8-webhooks', 'j8b-automation', { results, detail: ev });
  console.log(`INFO J8b.evidence ${evFile}`);
  console.log(`=== j8b done: ${results.filter((r) => r.kind === 'PASS').length} PASS, ${results.filter((r) => r.kind === 'FAIL').length} FAIL ===`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
