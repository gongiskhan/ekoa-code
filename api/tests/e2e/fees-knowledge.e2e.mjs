#!/usr/bin/env node
/**
 * FEES KNOWLEDGE-DURING-BUILD live gate - committed, re-runnable end-to-end driver (operator-run F2).
 *
 * This is the LIVE PROOF of F1 (knowledge-during-build). F1 shipped, deterministically tested, three
 * pieces: a domain-heavy detector (api/src/agents/domain-scoping.ts), a first-build hook in
 * executeBuildJob that narrates `plan_step{status:'knowledge-scope'}` for a domain-heavy app, ingests
 * the request's `knowledgeDocs` into the org knowledge area via the ingestBuildKnowledge seam, then
 * narrates `plan_step{status:'knowledge-indexed'}`, and the jobs route + shared contract carrying
 * `knowledgeDocs`. F1's own gate proved this at the unit/integration level (seam over real FTS). F2
 * proves it LIVE on the credentialed boot-b stack, end to end, all three parts holding at once:
 *
 *   1. NARRATED. A domain-heavy FEES build (PT-PT "calcular taxas de justiça e custas processuais")
 *      makes the build stream narrate F1: the job's SSE (GET /jobs/:id/events) carries a
 *      `plan_step{status:'knowledge-scope'}` naming the FINANCEIRA domain and a
 *      `plan_step{status:'knowledge-indexed'}` confirming exactly ONE indexed document, both PT-PT,
 *      no emoji, no em/en-dash. This proves the detector fired on the fees description and the hook
 *      ran on THIS real build.
 *   2. INGESTED (org-scoped + searchable). The build's `knowledgeDocs` carried ONE seeded reference
 *      doc (title "Circular <RUN-TOKEN>", the fee fact immediately after the distinctive token). The
 *      hook ingested it into the OWNER org's knowledge area for this run. Proven by (3): the served
 *      app's assistant, which grounds ONLY on the owner org, cites it.
 *   3. CITED. The served app's assistant (POST /api/app-assistant, header-scoped, grounds on the
 *      owner org with kind:'chat' - always grounds) answers a FEES question that names the seeded
 *      circular. The reply carries the seeded FACT ("cinquenta e cinco" / 55), is NOT a refusal, and
 *      the citations include the seeded doc (title containing THIS run's distinctive token) - the D3
 *      three-part CITED assertion set, now grounded on a doc that entered the org THROUGH the build
 *      (not a side-channel POST /knowledge/documents), which is exactly what F1 added.
 *
 * DETERMINISM. A committed gate cannot depend on model prose, so every assertion is STRUCTURAL: the
 * narration is asserted on the `plan_step` statuses + PT-PT phrase presence + the indexed COUNT; the
 * cited answer is asserted on the seeded doc's DISTINCTIVE token in `citations[].title`, the seeded
 * FACT token in the reply, and the absence of a refusal. The seed follows the D3/G1 model: the boot-b
 * owner org searches its OWN partition AND a large authority-boosted `_shared` legal corpus, so a
 * generic doc is buried below top-k; the doc therefore carries a distinctive reference token in title
 * + body, the fee fact sits IMMEDIATELY after it (so it lands inside grounding's short snippet), and
 * the query names the circular verbatim, so the seeded doc ranks #1 by a commanding margin. LLM
 * budget: ONE build + at most 3 assistant HTTP turns (1 cited turn + up to 2 retries) - hard-capped.
 *
 * RE-RUN ISOLATION. This gate lives in the suite and re-runs on the SHARED boot-b owner org, which is
 * never a clean partition again: each build re-ingests its `knowledgeDocs` fresh (the build-scoping
 * ingest inserts, it does not upsert/dedup), so identical docs would ACCUMULATE across runs. To keep
 * each run's CITED proof isolated to its OWN ingest, the reference token is UNIQUE PER RUN (KB_TOKEN,
 * below). The query names this run's token verbatim, and the CITED assertion pins on it, so a residue
 * doc from a PRIOR run (a different token) can never satisfy this run's citation - closing the
 * false-pass where a stale doc would green the CITED leg even if this run's ingest regressed to
 * "id returned but not searchable". As additional hygiene the driver best-effort DELETEs this run's
 * seeded doc at the end (via the existing knowledge delete route); a delete blip is non-fatal.
 *
 * TRANSIENT TOLERANCE. The boot-b dev CORS proxy can answer a pre-response upstream socket error with
 * a text/plain 502 "proxy error..." while a busy api is deep in a heavy build phase
 * (docs/findings.md F-2026-07-12-preview-502). Every polled/streamed read here is therefore
 * blip-tolerant: `safeJson` never throws on a non-JSON body; the build-status poll retries transients
 * (bounded); the SSE collector reconnects with Last-Event-ID replay on a drop. The one call that is
 * NEVER retried is the build-creation POST - a fresh build has no dedup key, so a retry would spawn a
 * second build; a blip there fails loud instead.
 *
 * NO PRODUCTION CODE CHANGE - this is a live-proof slice. Black-box over the running dev cortex
 * (backend.port, the boot-b proxy). Builds ONE fresh app through the real jobs pipeline (verify stage
 * OFF - nondeterministic + orthogonal, same as C5/D2/D3/E2/G1). Run: node tests/e2e/fees-knowledge.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };

// 20min: a real fees build on a fresh boot-b stack was observed COMPLETING at ~12min
// (2026-07-13, job 74556178 - the old 10min deadline bailed while the build was healthy
// and still landed), so 10min was miscalibrated for cold-stack builds, not generous.
const BUILD_TIMEOUT_MS = 20 * 60_000;
const TURN_TIMEOUT_MS = 150_000;
// Hard cap on /api/app-assistant HTTP turns (1 cited turn + up to 2 retries). The build is ONE job.
const LLM_BUDGET = 3;
// Consecutive transient (proxy-error / non-JSON) build-poll responses tolerated before failing loud.
const MAX_POLL_TRANSIENTS = 30;
// SSE reconnects tolerated on a mid-build stream drop (each replays the gap via Last-Event-ID).
const MAX_SSE_RECONNECTS = 5;

// The FEES-domain-heavy PT-PT build description. detectDomainHeavy fires FINANCEIRO on "taxas"
// (stem of "taxa") + "custas" (and juridico on "advogados"), so the first-build hook narrates
// knowledge-scope naming the financeira domain. A real, buildable app request (a court-fee/costs
// calculator).
const FEES_DESC = 'Uma aplicação para calcular taxas de justiça e custas processuais de um escritório de advogados.';

// The DISTINCTIVE reference token the seeded doc + the CITED assertions pin on (title + body + query).
// UNIQUE PER RUN (timestamp + random, base36, uppercased) so the CITED leg can only match THIS run's
// own ingest - never a residue doc a prior run left in the shared owner org (see RE-RUN ISOLATION).
const KB_TOKEN = `EKF-${(Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36)).toUpperCase()}`;
// The seeded reference doc carried on the build request's `knowledgeDocs`. The fee FACT
// ("cinquenta e cinco euros") sits IMMEDIATELY after the distinctive token so it falls inside
// grounding's short snippet window (a longer preamble would truncate the fact out of the excerpt and
// the assistant would correctly refuse). PT-PT.
const KB_DOC = {
  collection: 'circulares-internas',
  title: `Circular ${KB_TOKEN}`,
  text:
    `A Circular ${KB_TOKEN} fixa em cinquenta e cinco euros a taxa base de justiça ` +
    'aplicável à abertura de qualquer processo, antes das custas processuais adicionais.',
};
// The fees question, naming this run's seeded circular verbatim so the seeded doc ranks #1.
const FEES_Q = `Qual é o valor da taxa base de justiça fixada pela Circular ${KB_TOKEN}?`;
// A grounded answer must NAME the seeded fact, not merely avoid refusing (codex-d3 #1).
const FACT = /cinquenta\s+e\s+cinco|55/i;
// Refusal shapes (copied from the D3 CITED gate - the same owner-org grounding path).
const REFUSAL = /n[aã]o\s+(?:posso|consigo)\s+.*(?:responder|ajudar)|sem\s+conhecimento|n[aã]o\s+(?:tenho|há)\s+.*(?:conhecimento|informa|acesso)/i;

// Copy hygiene (F1 asserts PT-PT, no emoji, no em/en-dash on the narration).
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
const DASH = /[—–]/; // em-dash / en-dash detector (this line intentionally contains the chars)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`PASS ${msg}`); }
function assert(cond, msg) { if (!cond) fail(msg); }

/**
 * Fetch + parse JSON WITHOUT throwing. Returns { ok, status, json, text }. A non-2xx status or a body
 * that is not valid JSON (e.g. the dev-proxy's text/plain "proxy error" 502) comes back as ok:false
 * with the raw text, so callers can treat it as a transient rather than crashing the gate
 * (findings F-2026-07-12-preview-502).
 */
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

async function login() {
  for (let i = 0; i < 10; i++) {
    const res = await safeJson(`${BASE}/api/v1/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
    });
    if (res.ok && res.json.token) return res.json.token;
    await sleep(500);
  }
  fail('login failed after retries');
}

/**
 * Subscribe to the job's SSE (GET /jobs/:id/events?token=) and accumulate every parsed JobEvent into
 * `events`. RESILIENT: on a mid-stream drop it reconnects (bounded) with Last-Event-ID set to the
 * highest event id seen, so the per-job replay ring re-delivers only the gap (no loss, no dupes). The
 * F1 narration fires in the first handful of events (right after routing, before the agent runs), so
 * it is captured well before the build completes. Resolves when aborted or reconnects are exhausted;
 * never throws. Passing Last-Event-ID:0 on the FIRST connect replays anything buffered before we
 * attached (closes the attach-after-fire race).
 */
async function collectJobEvents(jobId, token, events, signal) {
  let lastId = 0;
  let reconnects = 0;
  while (!signal.aborted) {
    try {
      const res = await fetch(`${BASE}/api/v1/jobs/${jobId}/events?token=${encodeURIComponent(token)}`, {
        headers: { Accept: 'text/event-stream', 'Last-Event-ID': String(lastId) },
        signal,
      });
      if (!res.ok || !res.body) {
        if (++reconnects > MAX_SSE_RECONNECTS) return;
        await sleep(1000);
        continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break; // stream ended -> fall through to reconnect (replays from lastId)
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const lines = frame.split('\n');
          const idLine = lines.find((l) => l.startsWith('id:'));
          if (idLine) { const n = Number(idLine.slice(3).trim()); if (Number.isFinite(n)) lastId = Math.max(lastId, n); }
          const dataLine = lines.find((l) => l.startsWith('data:'));
          if (!dataLine) continue; // keepalive comment / non-data frame
          try { events.push(JSON.parse(dataLine.slice(5).trim())); } catch { /* partial/non-JSON */ }
        }
      }
    } catch { /* aborted or dropped */ }
    if (signal.aborted) return;
    if (++reconnects > MAX_SSE_RECONNECTS) return;
    await sleep(1000);
  }
}

/** Create a session and POST a build with the seeded knowledgeDocs. Returns the job id. */
async function startFeesBuild(token) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // Verify OFF: its verdict is nondeterministic + orthogonal to F2 (same pattern as C5/D2/D3/E2/G1).
  // Best-effort (a blip here is harmless - the build still completes even if verify stays on).
  await safeJson(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  // Session create is idempotent enough to retry a transient (a duplicate session is harmless).
  let sessionId = null;
  for (let i = 0; i < 10 && !sessionId; i++) {
    const s = await safeJson(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'f2-fees-knowledge' }) });
    if (s.ok && s.json.id) sessionId = s.json.id; else await sleep(500);
  }
  assert(sessionId, 'could not create a session after retries');
  // Build POST - SINGLE-SHOT, never retried: a fresh build has no dedup key, so a retry could spawn a
  // SECOND build. A transient here fails loud (rare: the api is not yet busy at creation time).
  const created = await safeJson(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      kind: 'build', sessionId, language: 'pt', templateId: 'app',
      description: FEES_DESC,
      knowledgeDocs: [KB_DOC],
    }),
  });
  assert(created.ok && created.json.job && created.json.job.id, `job not created (status ${created.status}): ${created.text.slice(0, 200)}`);
  return created.json.job.id;
}

/** Poll GET /jobs/:id until terminal, tolerating bounded transient (proxy-error) blips. Returns the
 *  completed build's artifactId (or fails loud). */
async function awaitBuild(token, jobId) {
  const H = { Authorization: `Bearer ${token}` };
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  let transients = 0;
  for (;;) {
    if (Date.now() > deadline) fail(`build ${jobId} did not finish in ${BUILD_TIMEOUT_MS / 60_000}min`);
    await sleep(6000);
    const res = await safeJson(`${BASE}/api/v1/jobs/${jobId}`, { headers: H });
    if (!res.ok) {
      transients += 1;
      if (transients > MAX_POLL_TRANSIENTS) fail(`build poll: ${transients} consecutive transient responses (last status ${res.status}: ${res.text.slice(0, 120)})`);
      console.log(`  build poll transient ${transients}/${MAX_POLL_TRANSIENTS} (status ${res.status}) - retrying`);
      await sleep(1000);
      continue;
    }
    transients = 0;
    const job = res.json;
    if (job.status === 'completed') { assert(job.artifactId, `completed build ${jobId} has no artifactId`); return job.artifactId; }
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
  }
}

/** The plan_step event (by status) collected off the job SSE, or undefined. */
function planStep(events, status) {
  return events.find((e) => e && e.type === 'plan_step' && e.status === status);
}

let llmTurns = 0;
/** Fire ONE assistant turn directly against POST /api/app-assistant (header-scoped: no JWT read;
 *  admission resolves the owner from X-Ekoa-App-Id). Returns { ok, status, json, text }. Counts
 *  against LLM_BUDGET. */
async function assistantTurn(artifactId, message) {
  if (llmTurns >= LLM_BUDGET) fail(`LLM budget (${LLM_BUDGET}) exhausted before "${message.slice(0, 40)}"`);
  llmTurns += 1;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TURN_TIMEOUT_MS);
  try {
    return await safeJson(`${BASE}/api/app-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': artifactId },
      body: JSON.stringify({ message }),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

/** Best-effort cleanup: DELETE this run's seeded doc(s) (the citation carrying this run's unique
 *  token) so the shared owner org does not accumulate residue across runs. Non-fatal: the gate
 *  verdict already held; a delete blip only leaves one doc behind. Uses the existing knowledge delete
 *  route (DELETE /knowledge/collections/:collection/documents/:id). */
async function cleanupSeededDoc(token, cites) {
  const H = { Authorization: `Bearer ${token}` };
  const targets = cites.filter((c) => typeof c.title === 'string' && c.title.includes(KB_TOKEN) && c.collection && c.docId);
  let removed = 0;
  for (const c of targets) {
    const del = await safeJson(
      `${BASE}/api/v1/knowledge/collections/${encodeURIComponent(c.collection)}/documents/${encodeURIComponent(c.docId)}`,
      { method: 'DELETE', headers: H },
    );
    if (del.ok) removed += 1;
  }
  console.log(`  cleanup: removed ${removed}/${targets.length} seeded doc(s) for token ${KB_TOKEN} (best-effort)`);
}

async function main() {
  const token = await login();
  ok('admin login');

  // 1. Start the FEES build carrying the seeded doc, and subscribe to its SSE BEFORE polling so the
  //    F1 narration (emitted right after routing) is captured live.
  const jobId = await startFeesBuild(token);
  ok(`fees build created (${jobId}) with 1 seeded knowledgeDoc "${KB_DOC.title}"`);
  const events = [];
  const sseCtl = new AbortController();
  const sseDone = collectJobEvents(jobId, token, events, sseCtl.signal);

  const artifactId = await awaitBuild(token, jobId);
  // Give the SSE a beat to flush any final buffered frames, then close it.
  await sleep(750);
  sseCtl.abort();
  await sseDone;
  ok(`fees build completed (artifact ${artifactId}); captured ${events.length} job stream events`);

  // 2. NARRATED - the build stream carried F1's two plan_step narrations, PT-PT, no emoji/dash.
  const seenStatuses = () => JSON.stringify(events.filter((e) => e && e.type === 'plan_step').map((e) => e.status));
  const scope = planStep(events, 'knowledge-scope');
  assert(scope, `no plan_step{status:'knowledge-scope'} in the build stream - F1 hook did not narrate. plan_step statuses seen: ${seenStatuses()}`);
  const scopeText = String(scope.description || '');
  assert(/financeira/i.test(scopeText), `knowledge-scope narration did not name the financeira domain: "${scopeText}"`);
  assert(/conhecimento/i.test(scopeText) && /organiza/i.test(scopeText), `knowledge-scope narration missing the org-knowledge-area phrasing: "${scopeText}"`);
  assert(!EMOJI.test(scopeText), `knowledge-scope narration contains an emoji: "${scopeText}"`);
  assert(!DASH.test(scopeText), `knowledge-scope narration contains an em/en-dash: "${scopeText}"`);
  ok(`NARRATED knowledge-scope: financeira domain, PT-PT, no emoji/dash ("${scopeText.slice(0, 80)}...")`);

  const indexed = planStep(events, 'knowledge-indexed');
  assert(indexed, `no plan_step{status:'knowledge-indexed'} in the build stream - the seeded doc was NOT ingested by the hook. plan_step statuses seen: ${seenStatuses()}`);
  const indexedText = String(indexed.description || '');
  // Exactly ONE doc was seeded -> the confirmation must report 1 (singular), tying the ingest to MY doc.
  assert(/\b1\s+documento\b/i.test(indexedText), `knowledge-indexed narration did not confirm exactly 1 indexed document: "${indexedText}"`);
  assert(/conhecimento/i.test(indexedText) && /organiza/i.test(indexedText), `knowledge-indexed narration missing the org-knowledge-area phrasing: "${indexedText}"`);
  assert(!EMOJI.test(indexedText), `knowledge-indexed narration contains an emoji: "${indexedText}"`);
  assert(!DASH.test(indexedText), `knowledge-indexed narration contains an em/en-dash: "${indexedText}"`);
  ok(`INGESTED (narrated) knowledge-indexed: exactly 1 document, PT-PT, no emoji/dash ("${indexedText.slice(0, 80)}...")`);

  // 3. CITED - the served app's assistant (owner-org grounding) cites the doc that entered the org
  //    THROUGH the build, answers with the seeded fact, and does not refuse. The token is unique to
  //    THIS run, so the citation can only match this run's own ingest (no prior-run residue). Retry
  //    within the HTTP turn budget for model prose nondeterminism AND transient proxy blips (grounding
  //    is deterministic: the seeded doc ranks #1 by the distinctive token).
  let cited = null;
  for (let attempt = 1; attempt <= LLM_BUDGET && !cited; attempt++) {
    const { status, json } = await assistantTurn(artifactId, FEES_Q);
    if (status !== 200 || !json) {
      if (llmTurns >= LLM_BUDGET) fail(`app-assistant did not return 200 within ${LLM_BUDGET} turns (last status ${status})`);
      console.log(`  assistant turn ${attempt} transient/non-200 (status ${status}) - retrying`);
      await sleep(1000);
      continue;
    }
    const cites = Array.isArray(json.citations) ? json.citations : [];
    const seededCited = cites.some((c) => typeof c.title === 'string' && c.title.includes(KB_TOKEN));
    const reply = String(json.reply || '');
    const factCited = FACT.test(reply);
    const refused = REFUSAL.test(reply);
    if (seededCited && factCited && !refused) { cited = { cites, reply }; break; }
    // The grounding is deterministic; if THIS run's build-ingested doc STILL does not surface + get
    // cited after the budget, that is a real knowledge-during-build defect (F1 ingest did not land
    // org-scoped + searchable, OR the served-app assistant does not ground on it). Fail loud.
    if (llmTurns >= LLM_BUDGET) {
      fail(`CITED turn: seeded doc surfaced=${seededCited}, fact-cited=${factCited}, refused=${refused}. citations=${JSON.stringify(cites.map((c) => c.title))}; reply="${reply.slice(0, 240)}"`);
    }
    console.log(`  cited retry: surfaced=${seededCited} fact=${factCited} refused=${refused}`);
  }
  ok(`CITED: assistant cited THIS run's build-ingested doc "${KB_TOKEN}" in ${cited.cites.length} citation(s); reply carries the seeded fact and is not a refusal`);
  console.log(`  reply: ${cited.reply.slice(0, 200).replace(/\s+/g, ' ')}`);
  console.log(`  citations: ${JSON.stringify(cited.cites.map((c) => c.title))}`);

  // Housekeeping (non-fatal): remove this run's seeded doc so the shared org stays clean across runs.
  await cleanupSeededDoc(token, cited.cites);

  console.log('F2 LIVE GATE: PASS');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
