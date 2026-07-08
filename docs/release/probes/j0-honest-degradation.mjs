/**
 * J0-degradation — how the product behaves with NO model credential (health claudeAuth.configured
 * = false). Captures the chat + build terminal SSE frames (is the error honest & user-readable?),
 * the served-app placeholder a user would see, billing zero-state, and an unimplemented contract
 * endpoint. A credential-less error surface is the EXPECTED, honest outcome — recorded, not judged.
 */
import { api, login, sseCollect, evidence, PASS, FAIL, INFO } from './_lib.mjs';

const J = 'J0-degradation';
const results = [];
const ev = {};
const stamp = Date.now();

const isTerminal = (f) => ['complete', 'error'].includes(f.event) || (f.data && typeof f.data === 'object' && ['complete', 'error'].includes(f.data.type));

async function main() {
  const admin = await login('admin', 'tmp12345');

  // (a) health / claudeAuth
  const health = await api('GET', '/health');
  ev.health = { status: health.status, body: health.body };
  const claudeAuth = health.body && health.body.claudeAuth;
  if (health.status === 200 && claudeAuth && claudeAuth.configured === false) PASS('J0a.health', `health ok, claudeAuth.configured=false (credential-less as expected)`, results);
  else INFO('J0a.health', `health status=${health.status} claudeAuth=${JSON.stringify(claudeAuth)}`, results);

  // (b) chat run → SSE terminal frame
  const sess = await api('POST', '/api/v1/sessions', { token: admin, body: { name: 'j0-chat-' + stamp } });
  const sessionId = sess.body && sess.body.id;
  ev.chatSession = { status: sess.status, id: sessionId };
  const run = await api('POST', '/api/v1/chat/runs', { token: admin, body: { sessionId, message: 'Olá', language: 'pt' } });
  ev.chatRunCreate = { status: run.status, body: run.body };
  const runId = run.body && run.body.runId;
  if (run.status === 202 && runId) PASS('J0b.create', `chat run ${runId} (202)`, results);
  else FAIL('J0b.create', `expected 202, got ${run.status} body=${JSON.stringify(run.body)}`, results);

  let chatSse = { frames: [] };
  if (runId) {
    chatSse = await sseCollect(`/api/v1/chat/runs/${runId}/events`, { token: admin, lastEventId: 0, timeoutMs: 30000, until: isTerminal });
  }
  const chatTypes = chatSse.frames.map((f) => f.event);
  const chatTerminal = chatSse.frames.find(isTerminal);
  ev.chatSse = { closedReason: chatSse.closedReason, frameTypes: chatTypes, frames: chatSse.frames };
  if (chatTerminal) {
    const d = chatTerminal.data || {};
    const kind = chatTerminal.event;
    PASS('J0b.terminal', `chat terminal='${kind}' code=${d.code || ''} message="${(d.message || '').slice(0, 120)}" frames=${JSON.stringify(chatTypes)}`, results);
  } else {
    FAIL('J0b.terminal', `no terminal frame within 30s; frames=${JSON.stringify(chatTypes)} reason=${chatSse.closedReason}`, results);
  }

  // (c) build job → SSE terminal, then job record + artifact + served page
  const jobCreate = await api('POST', '/api/v1/jobs', { token: admin, body: { kind: 'build', description: 'uma página com um botão', sessionId, language: 'pt' } });
  ev.jobCreate = { status: jobCreate.status, body: jobCreate.body };
  const jobId = jobCreate.body && jobCreate.body.job && jobCreate.body.job.id;
  if (jobCreate.status === 202 && jobId) PASS('J0c.create', `build job ${jobId} (202 created)`, results);
  else if (jobCreate.status === 200 && jobCreate.body && jobCreate.body.status === 'answered') INFO('J0c.create', `build create -> answered (no job): ${jobCreate.body.reason}`, results);
  else FAIL('J0c.create', `expected 202 created, got ${jobCreate.status} body=${JSON.stringify(jobCreate.body)}`, results);

  let jobSse = { frames: [] };
  if (jobId) {
    jobSse = await sseCollect(`/api/v1/jobs/${jobId}/events`, { token: admin, lastEventId: 0, timeoutMs: 120000, until: isTerminal });
  }
  const jobTypes = jobSse.frames.map((f) => f.event);
  const jobTerminal = jobSse.frames.find(isTerminal);
  ev.jobSse = { closedReason: jobSse.closedReason, frameTypes: jobTypes, frames: jobSse.frames };
  if (jobTerminal) {
    const d = jobTerminal.data || {};
    INFO('J0c.terminal', `build terminal='${jobTerminal.event}' code=${d.code || ''} artifactId=${d.artifactId || ''} message="${(d.message || '').slice(0, 120)}" frames=${JSON.stringify(jobTypes)}`, results);
  } else {
    INFO('J0c.terminal', `no build terminal frame within 120s; frames=${JSON.stringify(jobTypes)} reason=${jobSse.closedReason}`, results);
  }

  let jobRec = { status: 0, body: null };
  if (jobId) jobRec = await api('GET', `/api/v1/jobs/${jobId}`, { token: admin });
  ev.jobRecord = { status: jobRec.status, body: jobRec.body };
  const artifactId = (jobRec.body && jobRec.body.artifactId) || (jobTerminal && jobTerminal.data && jobTerminal.data.artifactId);
  INFO('J0c.jobrecord', `GET /jobs/:id -> ${jobRec.status} status=${jobRec.body && jobRec.body.status} artifactId=${artifactId || 'none'} error=${JSON.stringify(jobRec.body && jobRec.body.error) || 'none'}`, results);

  if (artifactId) {
    const art = await api('GET', `/api/v1/artifacts/${artifactId}`, { token: admin });
    ev.artifact = { status: art.status, body: art.body };
    INFO('J0c.artifact', `GET /artifacts/${artifactId} -> ${art.status} name=${art.body && art.body.name} health=${JSON.stringify(art.body && art.body.health) || 'none'}`, results);
    const served = await api('GET', `/apps/${artifactId}/`, { token: admin });
    const servedHtml = served.text || '';
    const userSees = /Building/i.test(servedHtml) ? 'Building placeholder' : (served.status >= 400 ? `error page (${served.status})` : `served content (${served.status})`);
    ev.servedPage = { status: served.status, contentType: served.contentType, userSees, head: servedHtml.slice(0, 200) };
    INFO('J0c.servedpage', `GET /apps/${artifactId}/ -> ${served.status}; a user sees: ${userSees}`, results);
  } else {
    INFO('J0c.artifact', `no artifactId produced (credential-less build did not reach artifact registration)`, results);
  }

  // (d) billing zero-state
  const usage = await api('GET', '/api/v1/billing/usage', { token: admin });
  const history = await api('GET', '/api/v1/billing/history', { token: admin });
  ev.billing = { usage: { status: usage.status, body: usage.body }, history: { status: history.status, body: history.body } };
  const u = usage.body || {};
  if (usage.status === 200 && u.tokensUsed === 0) PASS('J0d.usage', `billing usage zero-state tokensUsed=0 balanceUsd=${u.balanceUsd} tokenLimit=${u.tokenLimit} overage=${u.overageEnabled}`, results);
  else INFO('J0d.usage', `billing usage -> ${usage.status} tokensUsed=${u.tokensUsed} (recorded)`, results);
  const histItems = (history.body && history.body.items) || [];
  INFO('J0d.history', `billing history -> ${history.status}, ${histItems.length} entries`, results);

  // (e) branding research — contract endpoint, likely unmounted (no /api/v1/branding mount)
  const research = await api('POST', '/api/v1/branding/research', { token: admin, body: { websiteUrl: 'https://example.com' } });
  ev.brandingResearch = { status: research.status, contentType: research.contentType, isJson: research.isJson, bodyHead: (research.text || '').slice(0, 160) };
  INFO('J0e.research', `POST /branding/research -> ${research.status} json=${research.isJson} ct=${research.contentType || 'none'} (contract endpoint; expected unimplemented HTML 404)`, results);

  const evFile = await evidence(J, 'j0-degradation', { results, detail: ev });
  console.log(`INFO J0.evidence ${evFile}`);
}

main().catch((e) => { console.error('PROBE CRASH', e); process.exit(1); });
