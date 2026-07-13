#!/usr/bin/env node
/**
 * REQUEST-CHANGES JOURNEY live gate - committed, re-runnable end-to-end driver (operator-run H,
 * security block H4/H1). Authored by H5; the OPERATOR runs it. This is the LIVE proof of the H4
 * request-changes queue journey:
 *
 *   a user files a change request from INSIDE a served app (with route + screen context) -> it lands
 *   in the app OWNER org's queue (never another org's) -> an org-admin SEES it with that context ->
 *   converting it STARTS an H1-gated edit-mode patch run and links the resulting jobId.
 *
 * It also folds in H4's LIVE CROSS-ORG proof: a user in ANOTHER org filing about the same app gets a
 * uniform 404 and injects NOTHING into the owner org's queue (no cross-org write, no admin notify).
 *
 * WHAT IT ASSERTS (server-side, mostly non-LLM - file + queue read + convert are cheap):
 *   1. FILE (in-org). A role:'user' in the app owner's org POSTs /api/v1/change-requests with
 *      X-Ekoa-App-Id + {text, route, screenState}. Server stamps orgId = the OWNER org (not the
 *      caller body), status 'open', requesterUserId from the JWT, and echoes the route/screen context.
 *   2. CROSS-ORG ISOLATION. A role:'user' in a DIFFERENT org filing about the SAME app -> 404, and
 *      the request never appears in the owner org's queue (loadReadable gate; no injection oracle).
 *   3. ORG-ADMIN SEES IT WITH CONTEXT. GET /api/v1/change-requests?status=open surfaces the in-org
 *      request with its text + route + screenState + requesterName; the cross-org attempt is absent.
 *   4. CONVERT STARTS A PATCH RUN. The admin POSTs an H1-gated follow-up build (POST /jobs
 *      {artifactId}) -> jobId, then POST /:id/convert {jobId} flips the row to 'converted' + records
 *      the jobId. Per the brief, convert is asserted at the API level WITHOUT awaiting the full build
 *      (the patch run is STARTED, then cancelled) - the row flip + jobId link is the assertion.
 *
 * BUDGET (hard-capped): ONE real SETUP build (an org-shared, owner-owned app to file about; skipped
 * if REQCHG_APP_ID names one) + ONE follow-up build STARTED and immediately CANCELLED for the convert
 * (never awaited). Set REQCHG_APP_ID=<artifactId> (an admin-owned app that will be made org-shared)
 * to skip the setup build.
 *
 * NOTE (org scoping): this driver reads the queue as the seeded super-admin (which the H4 gate admits
 * exactly as an org-admin, requireRole('org-admin','super-admin')). The org-admin-own-org-only
 * scoping is proven deterministically in api/tests/routes/change-requests.test.ts; here the live
 * proof is the FILE -> owner-org stamp -> SEE-with-context -> CONVERT round-trip + the cross-org 404.
 *
 * TRANSIENT TOLERANCE + single-shot build create mirror fees-knowledge.e2e.mjs. NO PRODUCTION CODE
 * CHANGE. Run: node tests/e2e/request-changes-journey.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };

const BUILD_TIMEOUT_MS = 20 * 60_000;
const MAX_POLL_TRANSIENTS = 30;

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`.toUpperCase();
const SETUP_DESC = 'Uma aplicacao simples de registo de clientes com nome e email.';
const REQ_TEXT = `Por favor adicione um campo de telefone ao formulario de cliente (${RUN}).`;
const REQ_ROUTE = '/clientes/novo';
const REQ_SCREEN = 'formulario de novo cliente aberto, campos nome+email visiveis';
const REQCHG_APP_ID = process.env.REQCHG_APP_ID || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class E2EFailure extends Error {}
function fail(msg) { throw new E2EFailure(`E2E FAIL: ${msg}`); }
function ok(msg) { console.log(`PASS ${msg}`); }
function assert(cond, msg) { if (!cond) fail(msg); }

async function safeJson(url, init) {
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
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

/** Create a role:'user' account (super-admin only). orgId optional (absent -> a fresh org). Returns
 *  { id, token, username }. */
async function makeUser(adminToken, orgId) {
  const creds = { username: `rc-${orgId ? 'in' : 'out'}-${RUN}`.toLowerCase(), password: 'userpass12345' };
  const res = await safeJson(`${BASE}/api/v1/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ username: creds.username, password: creds.password, role: 'user', ...(orgId ? { orgId } : {}) }),
  });
  assert(res.ok && res.json && res.json.id, `create user failed (status ${res.status}): ${res.text.slice(0, 200)}`);
  const token = await login(creds);
  return { id: res.json.id, token, username: creds.username };
}

async function startBuild(token, description, artifactId) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  await safeJson(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  let sessionId = null;
  for (let i = 0; i < 10 && !sessionId; i++) {
    const s = await safeJson(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: `reqchg-${RUN}` }) });
    if (s.ok && s.json.id) sessionId = s.json.id; else await sleep(500);
  }
  assert(sessionId, 'could not create a session after retries');
  const body = { kind: 'build', sessionId, language: 'pt', description, ...(artifactId ? { artifactId } : { templateId: 'app' }) };
  const created = await safeJson(`${BASE}/api/v1/jobs`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert(created.ok && created.json.job && created.json.job.id, `job not created (status ${created.status}): ${created.text.slice(0, 200)}`);
  return created.json.job.id;
}

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
      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: ${transients} consecutive transients (last ${res.status})`);
      await sleep(1000);
      continue;
    }
    transients = 0;
    const job = res.json;
    if (job.status === 'completed') { assert(job.artifactId, `completed build ${jobId} has no artifactId`); return job.artifactId; }
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
    if (job.status === 'cancelled') fail(`setup build ${jobId} was cancelled`);
  }
}

const fileRequest = (token, appId, extra = {}) =>
  safeJson(`${BASE}/api/v1/change-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Ekoa-App-Id': appId },
    body: JSON.stringify({ text: REQ_TEXT, route: REQ_ROUTE, screenState: REQ_SCREEN, ...extra }),
  });

async function main() {
  const adminToken = await login(ADMIN);
  const admin = await me(adminToken);
  ok(`admin login (org ${admin.orgId})`);

  // --- Setup: an org-shared, admin-owned app to file about ----------------------------------------
  let appId = REQCHG_APP_ID;
  if (appId) {
    ok(`reusing REQCHG_APP_ID=${appId} (no setup build)`);
  } else {
    const setupJob = await startBuild(adminToken, SETUP_DESC);
    appId = await awaitBuild(adminToken, setupJob);
    ok(`setup build completed -> app ${appId}`);
  }
  // Make it org-shared so a same-org user can READ (loadReadable) it and file about it.
  const patch = await safeJson(`${BASE}/api/v1/artifacts/${encodeURIComponent(appId)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ visibility: 'org' }),
  });
  assert(patch.ok, `could not make app org-shared (status ${patch.status}): ${patch.text.slice(0, 200)}`);
  ok('app set to org-shared (visibility: org)');

  // --- Two users: one in the app owner's org, one in a different org -------------------------------
  const inOrgUser = await makeUser(adminToken, admin.orgId);
  const otherOrgUser = await makeUser(adminToken, null); // fresh org
  ok(`created in-org user ${inOrgUser.username} + cross-org user ${otherOrgUser.username}`);

  // --- 1. FILE from inside the app (in-org user) --------------------------------------------------
  const filed = await fileRequest(inOrgUser.token, appId);
  assert(filed.status === 200 && filed.json && filed.json.id, `file failed (status ${filed.status}): ${filed.text.slice(0, 200)}`);
  const reqId = filed.json.id;
  assert(filed.json.orgId === admin.orgId, `request stamped org ${filed.json.orgId}, expected owner org ${admin.orgId}`);
  assert(filed.json.status === 'open', `filed request status ${filed.json.status}, expected 'open'`);
  assert(filed.json.requesterUserId === inOrgUser.id, `requesterUserId ${filed.json.requesterUserId} != ${inOrgUser.id}`);
  assert(filed.json.route === REQ_ROUTE && filed.json.screenState === REQ_SCREEN, 'route/screenState context not echoed on the filed request');
  ok(`FILE: request ${reqId} filed into owner org ${admin.orgId} with route/screen context`);

  // --- 2. CROSS-ORG ISOLATION (H4 live proof) -----------------------------------------------------
  const crossOrg = await fileRequest(otherOrgUser.token, appId, { text: `INJECTION ATTEMPT ${RUN}` });
  assert(crossOrg.status === 404, `cross-org file must be 404 (no injection), got ${crossOrg.status}: ${crossOrg.text.slice(0, 160)}`);
  ok('CROSS-ORG: a different-org user filing about the app -> 404 (no injection)');

  // --- 3. ORG-ADMIN SEES IT WITH CONTEXT ----------------------------------------------------------
  const queue = await safeJson(`${BASE}/api/v1/change-requests?status=open`, { headers: { Authorization: `Bearer ${adminToken}` } });
  assert(queue.ok && queue.json && Array.isArray(queue.json.items), `queue read failed (status ${queue.status}): ${queue.text.slice(0, 160)}`);
  const seen = queue.json.items.find((c) => c.id === reqId);
  assert(seen, `the filed request ${reqId} is not visible in the org-admin queue`);
  assert(seen.text === REQ_TEXT && seen.route === REQ_ROUTE && seen.screenState === REQ_SCREEN, 'the queue row lost its text/route/screen context');
  assert(typeof seen.requesterName === 'string' && seen.requesterName.length > 0, 'the queue row has no requesterName context');
  // The cross-org injection attempt must NOT be anywhere in the queue.
  const injected = queue.json.items.find((c) => c.requesterUserId === otherOrgUser.id);
  assert(!injected, `cross-org injection LEAKED into the queue: ${JSON.stringify(injected)}`);
  ok('SEE: org-admin sees the request with full context; the cross-org attempt is absent');

  // --- 4. CONVERT starts an H1-gated patch run (asserted at the API level; build not awaited) ------
  const convertJob = await startBuild(adminToken, REQ_TEXT, appId); // H1-gated follow-up build (admin: canEditApps + loadWritable ok)
  ok(`CONVERT: admin started the patch-run follow-up build ${convertJob} (H1-gated)`);
  const converted = await safeJson(`${BASE}/api/v1/change-requests/${encodeURIComponent(reqId)}/convert`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ jobId: convertJob }),
  });
  assert(converted.ok && converted.json, `convert failed (status ${converted.status}): ${converted.text.slice(0, 200)}`);
  assert(converted.json.status === 'converted', `converted request status ${converted.json.status}, expected 'converted'`);
  assert(converted.json.jobId === convertJob, `converted request jobId ${converted.json.jobId} != ${convertJob}`);
  ok(`CONVERT: request ${reqId} -> 'converted' linked to patch-run job ${convertJob}`);
  // Budget hygiene: cancel the started patch run (the convert is asserted at the API level - we do
  // NOT await the full build). Best-effort; a cancel blip does not affect the assertions above.
  await safeJson(`${BASE}/api/v1/jobs/${encodeURIComponent(convertJob)}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` }, body: '{}',
  });
  console.log(`  cancelled the started patch-run build ${convertJob} (budget hygiene; best-effort)`);

  console.log('REQUEST-CHANGES JOURNEY LIVE GATE: PASS');
}

main().catch((e) => {
  console.error(e instanceof E2EFailure ? e.message : `E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
  process.exit(1);
});
