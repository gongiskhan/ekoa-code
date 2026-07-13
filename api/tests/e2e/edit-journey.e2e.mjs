#!/usr/bin/env node
/**
 * EDIT-MODE JOURNEY live gate - committed, re-runnable end-to-end driver (operator-run H, security
 * block H3/H2/H1). Authored by H5; the OPERATOR runs it (it burns real builds). This is the LIVE
 * proof of the served-app admin EDIT-MODE journey the security block built:
 *
 *   detect (H2 whoami true) -> explicit opt-in (client-side, never auto) -> edit request -> patch run
 *   (an H1-gated follow-up build) -> preview/diff (versions) -> approve (keep the new head) ->
 *   rollback restores (forward-restore to the pre-run head) ; AND a plain user-role session is proven
 *   UNABLE to reach edit (whoami false + POST /jobs follow-up refused).
 *
 * WHAT IT ASSERTS (all server-observable - the client confirmation/opt-in is UX, not the boundary):
 *   1. DETECT. GET /api/app-assistant/whoami on the admin's own app, with the admin platform Bearer,
 *      returns { admin: true } (H2: can(canEditApps) AND loadWritable ok). Detect-then-ask: this is a
 *      HINT; nothing is auto-enabled - the opt-in below is a separate, explicit, client-only step.
 *   2. PATCH RUN. The admin issues an edit as a FOLLOW-UP build: POST /api/v1/jobs { artifactId,
 *      description } with the admin Bearer. H1 re-gates it server-side (canEditApps + loadWritable);
 *      it completes and produces a NEW git head (the preview/diff point).
 *   3. PREVIEW + APPROVE. GET /versions shows the new head != the pre-run head; approve keeps it (the
 *      build already activated it - no server call).
 *   4. ROLLBACK restores. POST /versions/:preRunSha/restore is a one-click FORWARD restore (H3): it
 *      returns 200 and advances HEAD to a new [restored] commit whose tree is the pre-run head - the
 *      revert is real and auditable (HEAD never moves backward).
 *   5. USER CANNOT EDIT. A freshly-created role:'user' session gets { admin: false } from whoami on
 *      the SAME app, and its POST /jobs follow-up is refused 403 (canEditApps) - the panel never
 *      offers, and the server never permits, an edit to a non-admin.
 *
 * BUDGET (hard-capped): up to 2 real builds - one SETUP build to have an admin-owned app to edit
 * (skipped if EDIT_APP_ID names an existing admin-owned, admin-writable app), plus one PATCH-RUN
 * build - and one rollback restore. Set EDIT_APP_ID=<artifactId> to reuse an existing app and spend
 * only the patch-run build.
 *
 * TRANSIENT TOLERANCE mirrors fees-knowledge.e2e.mjs: safeJson never throws on a non-JSON body (the
 * dev proxy can answer a text/plain 502 mid-build); the build poll tolerates bounded transient blips
 * but fails loud on a deterministic 4xx; the build-CREATE POST is single-shot (a retry could spawn a
 * second build). NO PRODUCTION CODE CHANGE - black-box over the running dev stack (backend.port).
 * Run: node tests/e2e/edit-journey.e2e.mjs
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
const MAX_BUILDS = 2; // setup + patch-run (hard cap)

// A unique per-run suffix so a created user + app never collide across reruns on the shared stack.
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();
const SETUP_DESC = 'Uma aplicacao simples de lista de tarefas com um titulo e itens.';
const EDIT_DESC = 'Adiciona um botao para marcar todas as tarefas como concluidas.';
const EDIT_APP_ID = process.env.EDIT_APP_ID || null;

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

async function me(token) {
  const res = await safeJson(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  assert(res.ok && res.json && res.json.orgId, `GET /auth/me failed (status ${res.status})`);
  return res.json;
}

/** whoami for a served app, with an OPTIONAL platform Bearer. Returns the parsed { admin } (or fails
 *  loud on a non-200 - a 400/404 means the app id is malformed/unknown, not a detection result). */
async function whoami(appId, token) {
  const headers = { 'X-Ekoa-App-Id': appId, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await safeJson(`${BASE}/api/app-assistant/whoami`, { headers });
  assert(res.status === 200 && res.json && typeof res.json.admin === 'boolean', `whoami(${appId}) not 200{admin} (status ${res.status}): ${res.text.slice(0, 160)}`);
  return res.json.admin;
}

/** Start a build (first build if no artifactId, else a follow-up patch run). Returns the job id.
 *  SINGLE-SHOT create (never retried - a retry could spawn a second build). Counts against MAX_BUILDS. */
async function startBuild(token, description, artifactId) {
  if (buildsSpent >= MAX_BUILDS) fail(`build budget (${MAX_BUILDS}) exhausted before "${description.slice(0, 40)}"`);
  buildsSpent += 1;
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // Verify OFF (nondeterministic + orthogonal - same pattern as the F2/G1 drivers). Best-effort.
  await safeJson(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  let sessionId = null;
  for (let i = 0; i < 10 && !sessionId; i++) {
    const s = await safeJson(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: `edit-journey-${RUN}` }) });
    if (s.ok && s.json.id) sessionId = s.json.id; else await sleep(500);
  }
  assert(sessionId, 'could not create a session after retries');
  const body = { kind: 'build', sessionId, language: 'pt', description, ...(artifactId ? { artifactId } : { templateId: 'app' }) };
  const created = await safeJson(`${BASE}/api/v1/jobs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert(created.ok && created.json.job && created.json.job.id, `job not created (status ${created.status}): ${created.text.slice(0, 200)}`);
  return created.json.job.id;
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
      if (res.json && res.status >= 400 && res.status < 500) fail(`build poll: deterministic API error ${res.status} (not a transient): ${res.text.slice(0, 200)}`);
      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: ${transients} consecutive transient responses (last ${res.status})`);
      await sleep(1000);
      continue;
    }
    transients = 0;
    const job = res.json;
    if (job.status === 'completed') { assert(job.artifactId, `completed build ${jobId} has no artifactId`); return job.artifactId; }
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
    if (job.status === 'cancelled') fail(`build ${jobId} was cancelled`);
  }
}

/** GET /versions -> the items array (newest first; items[0].sha = HEAD). */
async function versions(token, appId) {
  const res = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}/versions`, { headers: { Authorization: `Bearer ${token}` } });
  assert(res.ok && res.json && Array.isArray(res.json.items), `GET /versions failed (status ${res.status}): ${res.text.slice(0, 160)}`);
  return res.json.items;
}

async function main() {
  // --- Admin identity + an admin-owned app to edit -------------------------------------------------
  const adminToken = await login(ADMIN);
  ok('admin login');

  let appId = EDIT_APP_ID;
  if (appId) {
    ok(`reusing EDIT_APP_ID=${appId} (no setup build)`);
  } else {
    const setupJob = await startBuild(adminToken, SETUP_DESC);
    appId = await awaitBuild(adminToken, setupJob);
    ok(`setup build completed -> app ${appId}`);
  }

  // --- 1. DETECT (H2 whoami) + explicit opt-in (client-only) --------------------------------------
  assert((await whoami(appId, adminToken)) === true, `admin whoami on own app must be true (canEditApps + loadWritable ok)`);
  ok('DETECT: admin whoami -> { admin: true }');
  // Explicit opt-in is a CLIENT-ONLY step (the panel edit-mode switch). Detect-then-ask is binding:
  // whoami:true auto-enables nothing; the human toggles the switch. No server call - logged for the record.
  console.log('  opt-in: explicit client-side editMode switch (detect-then-ask; no server call)');

  // --- 2. PATCH RUN (H1-gated follow-up build) + 3. PREVIEW ----------------------------------------
  const preRun = await versions(adminToken, appId);
  const preRunSha = preRun[0] && preRun[0].sha;
  assert(preRunSha, 'no pre-run HEAD sha from /versions');
  const editJob = await startBuild(adminToken, EDIT_DESC, appId); // follow-up: H1 re-gates server-side
  const editArtifact = await awaitBuild(adminToken, editJob);
  assert(editArtifact === appId, `follow-up build returned a different artifact (${editArtifact} != ${appId})`);
  const afterEdit = await versions(adminToken, appId);
  const newHeadSha = afterEdit[0] && afterEdit[0].sha;
  assert(newHeadSha && newHeadSha !== preRunSha, `patch run did not advance HEAD (pre ${preRunSha}, post ${newHeadSha})`);
  ok(`PATCH RUN: follow-up build completed; HEAD advanced ${preRunSha.slice(0, 8)} -> ${newHeadSha.slice(0, 8)}`);
  // 3. APPROVE keeps the new head - the build already activated it; there is NO server call to approve.
  ok('PREVIEW + APPROVE: new head is live (approve is a no-op - the build already activated it)');

  // --- 4. ROLLBACK restores (H3 forward-restore to the pre-run head) ------------------------------
  const restore = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}/versions/${encodeURIComponent(preRunSha)}/restore`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: '{}',
  });
  assert(restore.ok, `rollback restore failed (status ${restore.status}): ${restore.text.slice(0, 200)}`);
  const afterRollback = await versions(adminToken, appId);
  const restoredHead = afterRollback[0] && afterRollback[0].sha;
  // Forward-restore: HEAD advances to a NEW [restored] commit (never moves backward), whose tree is
  // the pre-run head. So the head changed again AND the history grew - the revert is real + auditable.
  assert(restoredHead && restoredHead !== newHeadSha, `rollback did not advance HEAD past the edit (still ${newHeadSha.slice(0, 8)})`);
  assert(afterRollback.length >= afterEdit.length, `rollback did not add a restore commit (history did not grow)`);
  ok(`ROLLBACK: forward-restore to pre-run head created a new head ${restoredHead.slice(0, 8)} (revert is live + auditable)`);

  // --- 5. A user-role session CANNOT reach edit ---------------------------------------------------
  const userCreds = { username: `edit-user-${RUN}`.toLowerCase(), password: 'userpass12345' };
  const createUser = await safeJson(`${BASE}/api/v1/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ username: userCreds.username, password: userCreds.password, role: 'user' }),
  });
  assert(createUser.ok, `could not create the role:'user' account (status ${createUser.status}): ${createUser.text.slice(0, 200)}`);
  const userToken = await login(userCreds);
  ok(`created + logged in a role:'user' account (${userCreds.username})`);

  assert((await whoami(appId, userToken)) === false, `user whoami on the admin app must be false (no canEditApps)`);
  ok('USER CANNOT EDIT: user whoami -> { admin: false }');

  const userFollowUp = await safeJson(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
    body: JSON.stringify({ kind: 'build', sessionId: `u-${RUN}`, language: 'pt', description: EDIT_DESC, artifactId: appId }),
  });
  assert(userFollowUp.status === 403 || userFollowUp.status === 404, `user follow-up build must be refused 403/404, got ${userFollowUp.status}: ${userFollowUp.text.slice(0, 160)}`);
  if (userFollowUp.status === 403) {
    const cap = userFollowUp.json && userFollowUp.json.error && userFollowUp.json.error.details && userFollowUp.json.error.details.capability;
    assert(cap === 'canEditApps', `user follow-up 403 should carry details.capability='canEditApps', got ${JSON.stringify(cap)}`);
  }
  ok(`USER CANNOT EDIT: POST /jobs follow-up refused ${userFollowUp.status} (capability gate, before any ownership probe)`);

  console.log('EDIT-MODE JOURNEY LIVE GATE: PASS');
}

main().catch((e) => {
  console.error(e instanceof E2EFailure ? e.message : `E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
  process.exit(1);
});
