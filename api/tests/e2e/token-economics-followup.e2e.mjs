#!/usr/bin/env node
/**
 * TOKEN-ECONOMICS FOLLOW-UP live gate - committed, re-runnable end-to-end driver (operator-run;
 * runs on the credentialed dev-madrid stack, it burns real builds). LIVE proof of the
 * token-economics port (docs/token-economics.md): follow-up builds run a FRESH SDK session (no
 * transcript resume), floor at WORKHORSE (Sonnet) instead of EXPERT (Opus), yet a genuine rebuild
 * still escalates to Opus - and the router reads the RAW request (originalMessage), never the
 * chat-agent's paraphrase.
 *
 * The tier is server-observable on the job SSE stream as the `routing` event ({type,tier,reason},
 * shared/events.ts). Crucially the tier is DETERMINISTIC: routing is pure keyword scoring
 * (llm/router.ts classify()), no model call - so these assertions are exact, not best-effort. What
 * is nondeterministic (whether the model finishes a build) is handled the same way as
 * edit-journey.e2e.mjs / fees-knowledge.e2e.mjs (poll to terminal with bounded transient tolerance).
 *
 * WHAT IT ASSERTS (all server-observable):
 *   1. FIRST BUILD keeps the high floor. The setup build's routing tier is EXPERT or GENIUS - a
 *      first build never floors at WORKHORSE (its floor is ambition-routed: basic->EXPERT,
 *      ambitious->GENIUS).
 *   2. ROUTINE FOLLOW-UP floors at WORKHORSE. A plain edit ("muda a cor do titulo") carries no
 *      Tier-4 keyword, so with the follow-up WORKHORSE floor its routing tier is exactly WORKHORSE
 *      (Sonnet) - the core token-economics win (a routine follow-up no longer over-serves on Opus).
 *      The build completes and advances HEAD (continuity holds across a FRESH session).
 *   3. BIG-CHANGE FOLLOW-UP escalates via the RAW request. A follow-up whose `description` is a
 *      bland paraphrase ("atualiza a aplicacao") but whose `originalMessage` carries big-change
 *      verbs ("reconstroi ... do zero ... arquitetura") routes EXPERT (Opus). This proves the
 *      router classifies the raw request (originalMessage/buildQuery), NOT the paraphrase - the
 *      review-found bug the port's floor-lowering would otherwise have introduced. The build is
 *      CANCELLED right after the tier is observed (no full Opus rebuild is spent).
 *   4. RESTORE runs clean after a follow-up. A forward-restore to the pre-follow-up head returns 200
 *      and advances HEAD (the restore path also clears the running summary; here we assert it does
 *      not fail the restore).
 *
 * BUDGET (hard-capped): 2 full builds (setup + routine follow-up) + 1 routing-only build (the
 * big-change follow-up, cancelled once its tier is seen) + 1 restore. Set TOKENECON_APP_ID=<id> to
 * reuse an existing admin-owned, admin-writable app and skip the setup build.
 *
 * NO PRODUCTION CODE CHANGE - black-box over the running dev stack (backend.port).
 * Run: node tests/e2e/token-economics-followup.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };

const BUILD_TIMEOUT_MS = 20 * 60_000; // a cold-stack build can take ~12min (see fees-knowledge)
const MAX_POLL_TRANSIENTS = 30;
const MAX_SSE_RECONNECTS = 20;
const ROUTING_TIMEOUT_MS = 3 * 60_000; // routing fires right after the billing gate, before the agent runs
const MAX_BUILDS = 3; // setup + routine follow-up + big-change (cancelled) — hard cap

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();
const SETUP_DESC = 'Uma aplicacao simples de lista de tarefas com um titulo e itens.';
const ROUTINE_DESC = 'Muda a cor do titulo principal para azul.';
// Big change carried in originalMessage; description is a bland paraphrase with NO Tier-4 verbs, so a
// tier of EXPERT proves the router read originalMessage (the raw request), not description.
const BIG_DESC = 'Atualiza a aplicacao.';
const BIG_ORIGINAL = 'Reconstroi a aplicacao toda do zero, com uma arquitetura nova e varias seccoes.';
const REUSE_APP_ID = process.env.TOKENECON_APP_ID || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class E2EFailure extends Error {}
function fail(msg) { throw new E2EFailure(`E2E FAIL: ${msg}`); }
function ok(msg) { console.log(`PASS ${msg}`); }
function assert(cond, msg) { if (!cond) fail(msg); }

let buildsSpent = 0;

/** Fetch + parse JSON WITHOUT throwing (transient-tolerant): { ok, status, json, text }. */
async function safeJson(url, init) {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON: proxy error text, HTML, empty */ }
    return { ok: r.ok && json !== null, status: r.status, json, text };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String(e && e.message ? e.message : e) };
  }
}

async function login(creds) {
  for (let i = 0; i < 10; i++) {
    const res = await safeJson(`${BASE}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds),
    });
    if (res.ok && res.json.token) return res.json.token;
    await sleep(500);
  }
  fail(`login failed for ${creds.username} after retries`);
}

/**
 * Subscribe to the job SSE (GET /jobs/:id/events?token=) and accumulate every parsed JobEvent into
 * `events`. Copied from fees-knowledge.e2e.mjs: RESILIENT (bounded reconnect with Last-Event-ID so
 * the per-job replay ring re-delivers only the gap), and Last-Event-ID:0 on the first connect
 * replays anything buffered before we attached (closes the attach-after-fire race for `routing`,
 * which fires early). Resolves when aborted or reconnects exhausted; never throws.
 */
async function collectJobEvents(jobId, token, events, signal, health) {
  let lastId = 0;
  let reconnects = 0;
  while (!signal.aborted) {
    try {
      const res = await fetch(`${BASE}/api/v1/jobs/${jobId}/events?token=${encodeURIComponent(token)}`, {
        headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(lastId) },
        signal,
      });
      if (!res.ok || !res.body) {
        if (++reconnects > MAX_SSE_RECONNECTS) { health.lost = true; return; }
        await sleep(1000);
        continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const lines = frame.split('\n');
          const idLine = lines.find((l) => l.startsWith('id:'));
          if (idLine) { const n = Number(idLine.slice(3).trim()); if (Number.isFinite(n)) lastId = Math.max(lastId, n); }
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          try { events.push(JSON.parse(dataLine.slice(5).trim())); } catch { /* partial/non-JSON */ }
        }
      }
    } catch { /* aborted or dropped */ }
    if (signal.aborted) return;
    if (++reconnects > MAX_SSE_RECONNECTS) { health.lost = true; return; }
    await sleep(1000);
  }
}

/** Create a session, then POST a build. Returns the job id. SINGLE-SHOT create (never retried). */
async function startBuild(token, { description, originalMessage, artifactId }) {
  if (buildsSpent >= MAX_BUILDS) fail(`build budget (${MAX_BUILDS}) exhausted before "${description.slice(0, 40)}"`);
  buildsSpent += 1;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // Verify OFF (nondeterministic + orthogonal to routing; same pattern as edit-journey/fees).
  await safeJson(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  let sessionId = null;
  for (let i = 0; i < 10 && !sessionId; i++) {
    const s = await safeJson(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: `token-econ-${RUN}` }) });
    if (s.ok && s.json.id) sessionId = s.json.id; else await sleep(500);
  }
  assert(sessionId, 'could not create a session after retries');
  const body = {
    kind: 'build', sessionId, language: 'pt', description,
    ...(originalMessage ? { originalMessage } : {}),
    ...(artifactId ? { artifactId } : { templateId: 'app' }),
  };
  const created = await safeJson(`${BASE}/api/v1/jobs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert(created.ok && created.json.job && created.json.job.id, `job not created (status ${created.status}): ${created.text.slice(0, 200)}`);
  return created.json.job.id;
}

/** Attach to a job's SSE and return the routing tier as soon as the `routing` event arrives. The
 *  returned `stop()` aborts the SSE subscription; the caller decides whether to also await/cancel
 *  the build. Fails loud if no routing event arrives within ROUTING_TIMEOUT_MS. */
async function observeRoutingTier(jobId, token) {
  const events = [];
  const ctl = new AbortController();
  const health = { lost: false };
  const sse = collectJobEvents(jobId, token, events, ctl.signal, health);
  const deadline = Date.now() + ROUTING_TIMEOUT_MS;
  let routing = null;
  while (!routing) {
    routing = events.find((e) => e && e.type === 'routing');
    if (routing) break;
    if (Date.now() > deadline) { ctl.abort(); await sse; fail(`no routing event for job ${jobId} within ${ROUTING_TIMEOUT_MS / 60_000}min (sseLost=${health.lost})`); }
    // A terminal error before routing (e.g. billing-blocked) must fail loud, not hang to the deadline.
    const err = events.find((e) => e && e.type === 'error');
    if (err) { ctl.abort(); await sse; fail(`job ${jobId} errored before routing: ${JSON.stringify(err).slice(0, 200)}`); }
    await sleep(1000);
  }
  assert(typeof routing.tier === 'string' && routing.tier, `routing event has no tier: ${JSON.stringify(routing)}`);
  return { tier: routing.tier, stop: async () => { ctl.abort(); await sse; } };
}

/** Poll GET /jobs/:id until terminal, tolerating bounded transient blips. Returns the artifactId. */
async function awaitBuild(token, jobId) {
  const H = { Authorization: `Bearer ${token}` };
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  let transients = 0;
  for (;;) {
    if (Date.now() > deadline) fail(`build ${jobId} did not finish in ${BUILD_TIMEOUT_MS / 60_000}min`);
    await sleep(6000);
    const res = await safeJson(`${BASE}/api/v1/jobs/${jobId}`, { headers: H });
    if (!res.ok) {
      if (res.json && res.status >= 400 && res.status < 500) fail(`build poll: deterministic API error ${res.status}: ${res.text.slice(0, 200)}`);
      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: ${transients} consecutive transient responses (last ${res.status})`);
      await sleep(1000);
      continue;
    }
    transients = 0;
    const job = res.json;
    if (job.status === 'completed') { assert(job.artifactId, `completed build ${jobId} has no artifactId`); return job.artifactId; }
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
    if (job.status === 'cancelled') fail(`build ${jobId} was cancelled unexpectedly`);
  }
}

/** GET /versions -> items array (newest first; items[0].sha = HEAD). */
async function versions(token, appId) {
  const res = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}/versions`, { headers: { Authorization: `Bearer ${token}` } });
  assert(res.ok && res.json && Array.isArray(res.json.items), `GET /versions failed (status ${res.status}): ${res.text.slice(0, 160)}`);
  return res.json.items;
}

const HIGH_TIERS = new Set(['EXPERT', 'GENIUS']);

async function main() {
  const token = await login(ADMIN);
  ok('admin login');

  // --- 1. FIRST BUILD keeps the high floor -------------------------------------------------------
  let appId = REUSE_APP_ID;
  if (appId) {
    ok(`reusing TOKENECON_APP_ID=${appId} (no setup build)`);
  } else {
    const setupJob = await startBuild(token, { description: SETUP_DESC });
    const setupRouting = await observeRoutingTier(setupJob, token);
    assert(HIGH_TIERS.has(setupRouting.tier), `first build must floor at EXPERT/GENIUS, got ${setupRouting.tier}`);
    await setupRouting.stop();
    ok(`FIRST BUILD floored at ${setupRouting.tier} (high floor kept)`);
    appId = await awaitBuild(token, setupJob);
    ok(`setup build completed -> app ${appId}`);
  }

  // --- 2. ROUTINE FOLLOW-UP floors at WORKHORSE + continuity (HEAD advances) ----------------------
  const preRoutine = await versions(token, appId);
  const preRoutineSha = preRoutine[0] && preRoutine[0].sha;
  assert(preRoutineSha, 'no pre-follow-up HEAD sha from /versions');

  const routineJob = await startBuild(token, { description: ROUTINE_DESC, artifactId: appId });
  const routineRouting = await observeRoutingTier(routineJob, token);
  assert(routineRouting.tier === 'WORKHORSE', `a routine follow-up must floor at WORKHORSE (Sonnet), got ${routineRouting.tier}`);
  await routineRouting.stop();
  ok('ROUTINE FOLLOW-UP floored at WORKHORSE (Sonnet) — the token-economics win');

  const routineArtifact = await awaitBuild(token, routineJob);
  assert(routineArtifact === appId, `follow-up returned a different artifact (${routineArtifact} != ${appId})`);
  const afterRoutine = await versions(token, appId);
  const afterRoutineSha = afterRoutine[0] && afterRoutine[0].sha;
  assert(afterRoutineSha && afterRoutineSha !== preRoutineSha, `follow-up did not advance HEAD (continuity broke): pre ${preRoutineSha}, post ${afterRoutineSha}`);
  ok(`CONTINUITY: fresh-session follow-up completed; HEAD advanced ${preRoutineSha.slice(0, 8)} -> ${afterRoutineSha.slice(0, 8)}`);

  // --- 3. BIG-CHANGE FOLLOW-UP escalates via the RAW request (originalMessage), then CANCEL -------
  const bigJob = await startBuild(token, { description: BIG_DESC, originalMessage: BIG_ORIGINAL, artifactId: appId });
  const bigRouting = await observeRoutingTier(bigJob, token);
  // description alone (BIG_DESC) carries no Tier-4 verb -> would be WORKHORSE; EXPERT proves the
  // router classified originalMessage (the raw request), not the paraphrase.
  assert(bigRouting.tier === 'EXPERT', `a big-change follow-up (verbs only in originalMessage) must escalate to EXPERT, got ${bigRouting.tier} — the router is reading the paraphrase, not the raw request`);
  await bigRouting.stop();
  ok('BIG-CHANGE FOLLOW-UP escalated to EXPERT (Opus) from originalMessage — raw request is classified, not the paraphrase');
  // Cancel so no full Opus rebuild is spent (the tier is all this step needed).
  const cancel = await safeJson(`${BASE}/api/v1/jobs/${encodeURIComponent(bigJob)}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}',
  });
  assert(cancel.status === 200 || cancel.status === 202 || cancel.status === 409, `cancel of ${bigJob} unexpected status ${cancel.status}: ${cancel.text.slice(0, 160)}`);
  ok(`big-change build cancelled (${cancel.status}) — no Opus rebuild spent`);

  // --- 4. RESTORE runs clean after a follow-up (forward-restore; also clears the running summary) -
  // Give the cancel a moment to release the per-artifact build lock before the restore.
  await sleep(3000);
  const restore = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(preRoutineSha)}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}',
  });
  assert(restore.ok, `restore after a follow-up failed (status ${restore.status}): ${restore.text.slice(0, 200)}`);
  const afterRestore = await versions(token, appId);
  const restoredSha = afterRestore[0] && afterRestore[0].sha;
  assert(restoredSha && restoredSha !== afterRoutineSha, `restore did not advance HEAD (still ${afterRoutineSha.slice(0, 8)})`);
  ok(`RESTORE: forward-restore after a follow-up succeeded; HEAD -> ${restoredSha.slice(0, 8)} (summary-clear path ran clean)`);

  console.log('TOKEN-ECONOMICS FOLLOW-UP LIVE GATE: PASS');
}

main().catch((e) => {
  console.error(e instanceof E2EFailure ? e.message : `E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
  process.exit(1);
});
