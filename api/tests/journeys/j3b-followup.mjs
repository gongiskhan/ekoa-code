#!/usr/bin/env node
/**
 * J3b-followup — BUILD#2: a follow-up build on the SAME artifact with verifyBuilds=ON. It must show
 * the verification plan_step banner (contrast with build#1's verify-OFF stream) and mint a
 * 'build-verify' billing row alongside the 'build' row. REAL model call (up to 25 min); run isolated.
 *
 *   node j3b-followup.mjs
 */
import { api, login, sseCollect, evidence, PASS, FAIL, INFO } from './_lib.mjs';
import { J, PW, loadState, saveState, appendAction, compactFrames, isTerminal, terminalOf } from './j3-build.mjs';

const BUILD2_DESC = 'Acrescenta por baixo do botão um contador de quantas citações já foram mostradas.';

async function main() {
  const results = [];
  const st = await loadState();
  const u1 = await login('bc-u1', PW);

  // 8) verifyBuilds = true, confirm.
  const patch = await api('PATCH', '/api/v1/settings/me', { token: u1, body: { build: { verifyBuilds: true } } });
  const conf = await api('GET', '/api/v1/settings', { token: u1 });
  const vOn = conf.body && conf.body.build && conf.body.build.verifyBuilds;
  if (patch.status === 200 && vOn === true) PASS('J3.verifyOn', `verifyBuilds=true confirmed`, results);
  else FAIL('J3.verifyOn', `patch=${patch.status} confirmed=${JSON.stringify(vOn)}`, results);

  // BUILD#2 — follow-up on the same artifact.
  await appendAction({ journey: J, username: 'bc-u1', action: 'build#2 POST /jobs follow-up (counter, verify ON)', expectedAgentTypes: ['build', 'build-verify', 'memory-extract'] });
  const create = await api('POST', '/api/v1/jobs', {
    token: u1,
    body: { kind: 'build', description: BUILD2_DESC, sessionId: st.sessionId, language: 'pt', artifactId: st.artifactId },
  });
  const jobId = create.body && create.body.job && create.body.job.id;
  if (create.status === 202 && create.body && create.body.status === 'created' && jobId) PASS('J3.build2.create', `202 created job ${jobId}`, results);
  else { FAIL('J3.build2.create', `expected 202 created, got ${create.status} ${JSON.stringify(create.body)}`, results); await evidence(J, 'build2', { results, create: { status: create.status, body: create.body } }); return; }

  const t0 = Date.now();
  const sse = await sseCollect(`/api/v1/jobs/${jobId}/events`, { token: u1, timeoutMs: 25 * 60 * 1000, lastEventId: '0', until: isTerminal });
  const wallSec = Math.round((Date.now() - t0) / 1000);
  const compact = compactFrames(sse.frames);
  const terminal = terminalOf(compact);

  // ASSERT verification banner PRESENT (verify ON).
  if (compact.verifyBanner) PASS('J3.build2.verify', `verification plan_step present: "${compact.verifyBanner}"`, results);
  else FAIL('J3.build2.verify', `no verification plan_step with verify ON — plan_step count=${compact.counts.plan_step || 0}`, results);

  if (terminal && terminal.type === 'complete') PASS('J3.build2.terminal', `SSE complete in ${wallSec}s`, results);
  else INFO('J3.build2.terminal', `SSE terminal=${terminal ? terminal.type : 'none'} closedReason=${sse.closedReason} wall=${wallSec}s`, results);
  const verifyNote = terminal && terminal.result && (terminal.result.verifyNote || terminal.result.verificationNote || (typeof terminal.result === 'object' ? terminal.result.note : undefined));
  if (verifyNote) INFO('J3.build2.verifyNote', `complete.result verifyNote: ${String(verifyNote).slice(0, 160)}`, results);

  // Billing history: expect a 'build-verify' row alongside 'build' rows.
  const hist = await api('GET', '/api/v1/billing/history', { token: u1 });
  const items = (hist.body && hist.body.items) || [];
  const types = items.map((r) => r.type);
  const typeCounts = types.reduce((a, t) => { a[t] = (a[t] || 0) + 1; return a; }, {});
  if (types.includes('build-verify')) PASS('J3.billing.buildVerify', `billing history has 'build-verify' row (types=${JSON.stringify(typeCounts)})`, results);
  else FAIL('J3.billing.buildVerify', `no 'build-verify' row; types=${JSON.stringify(typeCounts)}`, results);
  if (types.includes('build')) PASS('J3.billing.build', `billing history has 'build' row(s)`, results);
  else INFO('J3.billing.build', `no 'build' row; types=${JSON.stringify(typeCounts)}`, results);

  await saveState({ jobId2: jobId, build2WallSec: wallSec });
  await evidence(J, 'build2', {
    results,
    create: { status: create.status, body: create.body },
    wallSec,
    frameCounts: compact.counts,
    frames: compact.frames,
    terminal,
    verifyBanner: compact.verifyBanner,
    billing: { status: hist.status, typeCounts, total: hist.body && hist.body.total, items },
  });
  console.log(`=== build2 done: ${results.filter((r) => r.kind === 'PASS').length} PASS, ${results.filter((r) => r.kind === 'FAIL').length} FAIL, wall=${wallSec}s ===`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
