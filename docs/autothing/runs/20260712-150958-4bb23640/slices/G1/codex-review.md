Reading additional input from stdin...
OpenAI Codex v0.142.5
--------
workdir: /Users/ggomes/dev/ekoa-code
model: gpt-5.4
provider: openai
approval: never
sandbox: read-only
reasoning effort: medium
reasoning summaries: none
session id: 019f5ad1-fbbf-77e0-9076-a42f71f5939e
--------
user
You are an adversarial cross-model code reviewer. Repo: /Users/ggomes/dev/ekoa-code, branch operator-run. Review COMMIT 20b1c70 (git show 20b1c70) - slice G1 'billing-truth probe for the served-app assistant plane' of a gated run. It is a PROOF slice: no production code changed; the deliverable is the live e2e probe api/tests/e2e/assistant-billing.e2e.mjs + evidence (docs/autothing/runs/20260712-150958-4bb23640/slices/G1/live-output.txt: 14 PASS + 'G1 LIVE GATE: PASS'). The probe claims to prove: (1) two real assistant turns driven by a DISTINCT provisioned visitor produce EXACTLY two new agentType='assistant-chat' rows on the artifact OWNER's billing ledger while the visitor's ledger is unchanged (owner-attribution: POST /api/app-assistant is header-scoped via X-Ekoa-App-Id -> resolveApp -> ownerUserId; caller JWT never read - verify in api/src/apps/app-assistant-route.ts + app-assistant.ts:280-287); (2) GET /api/v1/billing/breakdown (super-admin, grouped by agentType) shows an assistant-chat line; (3) full tour playback via the E2 teach launcher is FREE (zero client POSTs to /api/app-assistant AND zero new ledger rows); (4) a registry-only action via window.__ekoaActions.execute is FREE (same dual proof). Worker's ground-truth analysis in slices/G1/impl-notes.md - verify its claims against source, do not trust. Find REAL defects with concrete failure scenarios, especially: assertions that could pass while the property fails (delta baselines taken at the wrong time, row-count filters too broad/narrow, POST-counter URL matching missing sibling assistant paths, ledger reads racing the async billing write with no convergence polling), token-budget enforcement holes (could a retry loop burn unbounded turns?), provisioning/cleanup residue that breaks re-runs or sibling drivers on the shared stack, console-allowlist broadening, and any ground-truth misreading of the attribution path (that would be High - it would mean the probe proves the wrong thing). DO NOT run the driver (real tokens, shared stack) - static review only. Number findings High/Medium/Low + file:line; end APPROVE or NEEDS-WORK.
hook: SessionStart
hook: SessionStart Completed
hook: UserPromptSubmit
hook: UserPromptSubmit Completed
codex
Reviewing commit `20b1c70` as a static code review. I’ll first load repo guidance files and inspect the commit plus the relevant assistant/billing paths, then I’ll trace whether the probe’s assertions actually prove the stated billing properties.
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "pwd && ls -1 && test -d .codegraph && echo CODEGRAPH_PRESENT || echo CODEGRAPH_ABSENT && rg --files -g 'PRD.md' -g 'PLANING.md' -g 'TASKS.md' -g 'AGENTS.md'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
/Users/ggomes/dev/ekoa-code
CLAUDE.md
Dockerfile.api
Dockerfile.web
RUN_LOG.md
api
backend.port
deploy
docs
ekoa-data
node_modules
package-lock.json
package.json
playwright.config.ts
scripts
shared
test-results
tsconfig.base.json
web
CODEGRAPH_PRESENT

exec
/bin/zsh -lc 'git show --stat --summary 20b1c70' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-fywxIcep' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UBfRYNvb' (errno=Operation not permitted)
commit 20b1c7056c67d7c9595e2e4d20e7905b0d87417b
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 10:31:27 2026 +0100

    feat(operator-run/g1): billing-truth probe for the assistant plane - metered/attributed/tours-free
    
    Proof slice, NO production code change: D1's metering held under adversarial
    probing (no attribution gap found; api/src/billing untouched).
    
    assistant-billing.e2e.mjs proves live, on two separate ledgers: (1) N=2 real
    assistant turns driven by a DISTINCT provisioned visitor -> exactly 2 new
    assistant-chat rows on the OWNER's ledger (tokens 1134+3230), visitor ledger
    unchanged (billed to the resolved owner, never the caller - observable proof
    of the D1 by-construction property); (2) /billing/breakdown groups an
    assistant-chat line; (3) a FULL overview tour through the E2 teach launcher
    fires zero assistant POSTs and zero billing rows (zero-token playback,
    ledger-verified); (4) a registry-only action via window.__ekoaActions.execute
    runs in-page with zero POSTs and zero rows. Zero-cost claims run FIRST so a
    broken panel fails before any turn is burned; hard LLM_BUDGET=3 cap;
    idempotent visitor provisioning; strict console gate (verbatim D2/D3/E2
    allowlist); document-access contrast (owner 200/non-owner 410/featured 200)
    pins the sharing setup honestly; cleanup un-features the test app.
    
    Loop history: first run failed at openPanel from the scaffold-mid-edit
    collision (E2 fix batch in flight - RUN_LOG E2 entry records the sequencing
    rule); second failure was the driver's own click-interception on the planted
    fixture, fixed. Driver hardened with a page diagnostic on launcher-mount
    timeout. Evidence: slices/G1 cast + 3 screenshots + live-output (G1 LIVE
    GATE: PASS, 14 PASS lines).
    
    Claude-Session: https://claude.ai/code/session_015PyYEsLxYr7bEe5EP6pNd3

 api/tests/e2e/assistant-billing.e2e.mjs            | 517 +++++++++++++++++++++
 .../slices/G1/brief-draft.md                       |  21 +
 .../slices/G1/impl-notes.md                        | 106 +++++
 .../slices/G1/live-output.txt                      |  15 +
 4 files changed, 659 insertions(+)
 create mode 100644 api/tests/e2e/assistant-billing.e2e.mjs
 create mode 100644 docs/autothing/runs/20260712-150958-4bb23640/slices/G1/brief-draft.md
 create mode 100644 docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
 create mode 100644 docs/autothing/runs/20260712-150958-4bb23640/slices/G1/live-output.txt

codex
The repo is indexed by CodeGraph, so I’m using that first for the attribution path and the new e2e probe. After that I’ll inspect the exact assertions in the committed test and compare them to the worker notes/evidence.
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'for f in AGENTS.md PRD.md PLANING.md TASKS.md; do [ -f "$f" ] && { echo "===== $f ====="; sed -n '"'1,220p' \""'$f"; }; done' in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
hook: PreToolUse
hook: PreToolUse Completed
Static review of the proof-slice commit, focusing on whether the new e2e probe really proves the claimed billing behavior and whether there are false-positive/cleanup/race risks.
  → Load repo guidance files and commit contents relevant to the review
  • Trace owner-attribution and billing-write paths in source
  • Inspect the new e2e probe assertions and evidence for false positives or gaps
  • Summarize findings with severity, file:line, and final verdict
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg --files | rg '("'^|/)(AGENTS'"\\.md|PRD\\.md|PLANING\\.md|TASKS\\.md)"'$'"'" in /Users/ggomes/dev/ekoa-code
 exited 1 in 0ms:
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
codex
I’ve confirmed the repo has no checked-in `PRD.md`, `PLANING.md`, or `TASKS.md` in the workspace root/path scan, so there’s no project planning context to update for this review. Now I’m narrowing onto the assistant route and the new probe file line-by-line, because the main risk here is a test that can pass without proving the billing property.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git show --format=medium --no-ext-diff --unified=80 20b1c70 -- api/tests/e2e/assistant-billing.e2e.mjs docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md docs/autothing/runs/20260712-150958-4bb23640/slices/G1/live-output.txt' in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-IsijHuDX' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-10rKzgYx' (errno=Operation not permitted)
commit 20b1c7056c67d7c9595e2e4d20e7905b0d87417b
Author: goncalo.gomes <goncalo.p.gomes@gmail.com>
Date:   Mon Jul 13 10:31:27 2026 +0100

    feat(operator-run/g1): billing-truth probe for the assistant plane - metered/attributed/tours-free
    
    Proof slice, NO production code change: D1's metering held under adversarial
    probing (no attribution gap found; api/src/billing untouched).
    
    assistant-billing.e2e.mjs proves live, on two separate ledgers: (1) N=2 real
    assistant turns driven by a DISTINCT provisioned visitor -> exactly 2 new
    assistant-chat rows on the OWNER's ledger (tokens 1134+3230), visitor ledger
    unchanged (billed to the resolved owner, never the caller - observable proof
    of the D1 by-construction property); (2) /billing/breakdown groups an
    assistant-chat line; (3) a FULL overview tour through the E2 teach launcher
    fires zero assistant POSTs and zero billing rows (zero-token playback,
    ledger-verified); (4) a registry-only action via window.__ekoaActions.execute
    runs in-page with zero POSTs and zero rows. Zero-cost claims run FIRST so a
    broken panel fails before any turn is burned; hard LLM_BUDGET=3 cap;
    idempotent visitor provisioning; strict console gate (verbatim D2/D3/E2
    allowlist); document-access contrast (owner 200/non-owner 410/featured 200)
    pins the sharing setup honestly; cleanup un-features the test app.
    
    Loop history: first run failed at openPanel from the scaffold-mid-edit
    collision (E2 fix batch in flight - RUN_LOG E2 entry records the sequencing
    rule); second failure was the driver's own click-interception on the planted
    fixture, fixed. Driver hardened with a page diagnostic on launcher-mount
    timeout. Evidence: slices/G1 cast + 3 screenshots + live-output (G1 LIVE
    GATE: PASS, 14 PASS lines).
    
    Claude-Session: https://claude.ai/code/session_015PyYEsLxYr7bEe5EP6pNd3

diff --git a/api/tests/e2e/assistant-billing.e2e.mjs b/api/tests/e2e/assistant-billing.e2e.mjs
new file mode 100644
index 0000000..94e779b
--- /dev/null
+++ b/api/tests/e2e/assistant-billing.e2e.mjs
@@ -0,0 +1,517 @@
+#!/usr/bin/env node
+/**
+ * ASSISTANT METERING + BILLING-TRUTH live gate — committed, re-runnable end-to-end driver
+ * (operator-run G1).
+ *
+ * D1 built the served-app assistant (`POST /api/app-assistant`) so that every turn runs ONE model
+ * call through the llm/ chokepoint one-shot, metered + attributed to the RESOLVED ARTIFACT OWNER
+ * (agentType 'assistant-chat', a UserWorkAgentType), never the anonymous visitor. E2 built the
+ * in-app tour player (100% client-side, zero model calls). G1 does NOT re-implement any of that; it
+ * PROVES the billing truth live on the credentialed boot-b stack and extends the journeys'
+ * billing-truth reconciliation (actions-log vs GET /api/v1/billing/history) to the assistant plane:
+ *
+ *   1. METERED + ATTRIBUTED. The app is BUILT by admin (so the artifact owner is admin) and then
+ *      FEATURED (a fresh app is an owner-only preview — non-owners get 410; featuring makes it
+ *      shareable so the visitor can load it — reverted in cleanup). The assistant panel is then
+ *      driven by a DISTINCT visitor (the browser context is authenticated as a separate, non-owner
+ *      user). N=2 real assistant turns each fire exactly one `POST
+ *      /api/app-assistant` -> exactly TWO new `assistant-chat` rows land in the OWNER's ledger (GET
+ *      /api/v1/billing/history) with metered tokens > 0 — while the VISITOR's ledger gains ZERO.
+ *      That is the billing truth: the caller is not the billee; the resolved owner is. (The endpoint
+ *      is header-scoped and never reads the caller's JWT — app-assistant-route.ts bills
+ *      admission.owner.userId — so this holds by construction; the probe makes it observable.)
+ *   2. BREAKDOWN. GET /api/v1/billing/breakdown (super-admin, grouped by agentType) now carries an
+ *      `assistant-chat` line with tokens > 0.
+ *   3. TOUR PLAYBACK IS FREE. A FULL overview tour played through the E2 teach launcher issues ZERO
+ *      `POST /api/app-assistant` and adds ZERO new billing rows (the player is client-side).
+ *   4. REGISTRY-ONLY ACTIONS ARE FREE. A registry action dispatched through window.__ekoaActions
+ *      .execute (the C3 runtime the panel itself uses) runs entirely in-page — ZERO model POSTs,
+ *      ZERO new billing rows.
+ *   5. Zero non-benign page JS console errors throughout (the SAME documented allowlist as the
+ *      D2/D3/E2 drivers: favicon 404 + anonymous whoami 401 + dev-proxy app-health 5xx).
+ *
+ * DETERMINISM. A committed gate cannot depend on model prose, so every assertion is STRUCTURAL:
+ * ledger ROW COUNTS by agentType + billee, the browser-side `POST /api/app-assistant` request
+ * counter, and the C3 runtime's own result status / DOM effect. The served tour is the same
+ * schema-valid overview fixture E2 uses, fulfilled at the browser boundary (page.route) — the only
+ * stub QA permits. The two metered turns are plain informational prompts (no operate surface
+ * needed): metering fires on the one-shot regardless of whether the turn proposes actions. The
+ * model is called at most 3 times total (2 turns + at most one transient retry).
+ *
+ * NO PRODUCTION CODE CHANGE — this is a proof slice. Black-box over the running dev cortex
+ * (backend.port, the boot-b proxy) + a real Chromium. Builds ONE fresh app-base app (verify OFF).
+ * Run: node tests/e2e/assistant-billing.e2e.mjs
+ */
+import { readFileSync } from 'node:fs';
+import { join, dirname } from 'node:path';
+import { fileURLToPath } from 'node:url';
+import { chromium } from 'playwright';
+
+const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
+const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
+const BASE = `http://localhost:${PORT}`;
+const ADMIN = { username: 'admin', password: 'tmp12345' };
+const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'G1');
+
+const BUILD_TIMEOUT_MS = 10 * 60_000;
+const TURN_TIMEOUT_MS = 150_000;
+const LLM_BUDGET = 3; // hard ceiling on real model calls (2 turns + at most 1 transient retry)
+
+// The distinct VISITOR principal that drives the assistant panel (a separate, non-owner user, so
+// "billed to the owner, not the visitor" is observable on two separate ledgers). Fixed creds keep
+// the probe idempotent across re-runs (the ephemeral dev Mongo may already carry the user).
+const VISITOR = { orgName: 'g1-visitor-org', username: 'g1-visitor', password: 'pw123456' };
+
+// The app-specific (non-landmark) registry-ID target the tour spotlights — planted in the page like
+// the E2/D3 gates so the surface is deterministic.
+const TOUR_TARGET = 'e2-tour-alvo';
+// A planted setField landmark the registry-only action drives (same technique as the D3 gate).
+const REG_TARGET = 'g1-set-target';
+const REG_VALUE = 'REGISTO-LOCAL-G1';
+
+// The schema-valid overview tour the panel fetches — the SAME fixture E2 validates against
+// demoSpecSchema, so this "stub" is a schema-validated stub (the only stub QA permits).
+const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
+const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;
+function buildTour(appId) { return { ...TOUR_FIXTURE, appId }; }
+
+// Two plain informational turns — no operate surface required; each fires exactly one metered
+// one-shot. PT-PT (the served assistant answers in PT-PT).
+const TURNS = [
+  'Dê-me uma visão geral do que esta aplicação permite fazer.',
+  'Explique-me, de forma geral, como está organizada esta aplicação.',
+];
+
+// `fail` THROWS (not process.exit) so the tail's catch runs cleanup (un-feature the test app) on any
+// failure before exiting non-zero. Set once the app is featured, so cleanup knows what to revert.
+let cleanupFeatured = null;
+function fail(msg) { throw new Error(msg); }
+function ok(msg) { console.log(`PASS ${msg}`); }
+function assert(cond, msg) { if (!cond) fail(msg); }
+
+// ---------------------------------------------------------------------------------------------
+// HTTP kit (direct fetch, off the browser) — provisioning + ledger reads.
+// ---------------------------------------------------------------------------------------------
+/** Log in, returning the token or null (never exits) — used for the idempotent visitor check. */
+async function tryLogin(username, password) {
+  const r = await fetch(`${BASE}/api/v1/auth/login`, {
+    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
+  });
+  if (!r.ok) return null;
+  return (await r.json()).token;
+}
+
+/** Log in, hard-failing the gate on any non-200. */
+async function login(username, password) {
+  const token = await tryLogin(username, password);
+  assert(token, `login(${username}) failed`);
+  return token;
+}
+
+async function userIdOf(token) {
+  const me = await (await fetch(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => ({}));
+  return (me && (me.user?.id || me.id)) || null;
+}
+
+/** Provision the distinct visitor (org + builder user) as admin, then log them in. IDEMPOTENT: if
+ *  the fixed-cred visitor already exists (re-run on the same boot), it just logs in — no duplicate
+ *  org/user is created. */
+async function provisionVisitor(adminToken) {
+  const existing = await tryLogin(VISITOR.username, VISITOR.password);
+  if (existing) return { token: existing, userId: await userIdOf(existing) };
+
+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
+  const orgRes = await fetch(`${BASE}/api/v1/orgs`, { method: 'POST', headers: H, body: JSON.stringify({ name: VISITOR.orgName, displayName: VISITOR.orgName }) });
+  assert(orgRes.ok, `visitor org create ${orgRes.status}`);
+  const orgId = (await orgRes.json()).id;
+  const userRes = await fetch(`${BASE}/api/v1/users`, {
+    method: 'POST', headers: H,
+    body: JSON.stringify({ username: VISITOR.username, password: VISITOR.password, role: 'builder', orgId }),
+  });
+  assert(userRes.ok, `visitor user create ${userRes.status}`);
+  const token = await login(VISITOR.username, VISITOR.password);
+  return { token, userId: await userIdOf(token) };
+}
+
+/** Build ONE fresh app-base app through the real jobs pipeline as ADMIN, so the artifact OWNER is
+ *  admin (verify OFF — nondeterministic + orthogonal, same pattern as C5/D2/D3/E2). */
+async function buildSampleApp(token) {
+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
+  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
+  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'g1-assistant-billing' }) })).json();
+  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
+    method: 'POST', headers: H,
+    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
+  })).json();
+  const jobId = created.job.id;
+  const deadline = Date.now() + BUILD_TIMEOUT_MS;
+  for (;;) {
+    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 10min`);
+    await new Promise((r) => setTimeout(r, 6000));
+    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
+    if (job.status === 'completed') return job.artifactId;
+    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
+  }
+}
+
+/**
+ * Toggle the artifact's `featured` flag (super-admin `PUT /:id/featured`). A freshly built app is
+ * shareability-gated (owner-only: a NON-owner or anonymous `GET /apps/:id/` returns 410 — the app is
+ * an unpublished owner preview). Featuring makes it shareable (share-lookup: featured => always
+ * shareable), so the DISTINCT visitor can load the served document and drive the panel — the real
+ * "published app, anonymous/other visitor, owner billed" scenario. Reverted at the end (setFeatured
+ * is a pure flag flip — app-paths.setFeaturedFlag — no rebuild, no side effect).
+ */
+async function featureApp(adminToken, artifactId, on) {
+  const r = await fetch(`${BASE}/api/v1/artifacts/${artifactId}/featured`, {
+    method: 'PUT',
+    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
+    body: JSON.stringify({ featured: on }),
+  });
+  return r.ok;
+}
+
+/** The caller's OWN billing ledger (GET /api/v1/billing/history is actor-scoped). Returns rows;
+ *  each row's `type` is the token_events agentType (billing/service.ts historyFor). */
+async function ledgerRows(token) {
+  const r = await fetch(`${BASE}/api/v1/billing/history`, { headers: { Authorization: `Bearer ${token}` } });
+  assert(r.ok, `billing/history ${r.status}`);
+  const body = await r.json();
+  return (body && body.items) || [];
+}
+const assistantChatRows = (rows) => rows.filter((x) => x.type === 'assistant-chat');
+async function assistantChatCount(token) { return assistantChatRows(await ledgerRows(token)).length; }
+
+/** GET /api/v1/billing/breakdown (super-admin, platform-wide, grouped by agentType). */
+async function billingBreakdown(token) {
+  const r = await fetch(`${BASE}/api/v1/billing/breakdown`, { headers: { Authorization: `Bearer ${token}` } });
+  assert(r.ok, `billing/breakdown ${r.status}`);
+  return ((await r.json()).items) || [];
+}
+
+/**
+ * A console-error entry is benign ONLY if it is one of these KNOWN, pre-existing platform /
+ * dev-harness failed-resource logs — COPIED VERBATIM from the D2/D3/E2 drivers. None is G1 code;
+ * each fires on EVERY served app. Every OTHER console error fails the gate (strict).
+ */
+function benign(entry) {
+  const url = String(entry.url || '');
+  const text = String(entry.text || '');
+  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
+  if (/favicon/i.test(`${url} ${text}`)) return true;
+  // 2. Anonymous SSO whoami probe (injected-context.ts:110): window.__ekoa.whoami() GETs
+  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
+  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
+  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
+  // 3. Injected health beacon (injected-context.ts:244): POSTs /api/app-health (keepalive) on load;
+  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
+  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G1 code.
+  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
+  return false;
+}
+
+// ---------------------------------------------------------------------------------------------
+// Panel + tour driving (mirrors D3/E2).
+// ---------------------------------------------------------------------------------------------
+let llmTurns = 0;
+
+/** Fire ONE assistant turn through the panel; resolve { status, body }. Counts against LLM_BUDGET. */
+async function fireTurn(page, text) {
+  if (llmTurns >= LLM_BUDGET) fail(`LLM budget (${LLM_BUDGET}) exhausted before "${text.slice(0, 40)}"`);
+  llmTurns += 1;
+  const respP = page.waitForResponse(
+    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
+    { timeout: TURN_TIMEOUT_MS },
+  );
+  await page.locator('.ekoa-assistant-textarea').fill(text);
+  await page.locator('.ekoa-assistant-send').click();
+  const resp = await respP;
+  let body = null;
+  try { body = await resp.json(); } catch { /* non-JSON body */ }
+  return { status: resp.status(), body };
+}
+
+/** A metered turn: fire, absorb ONE transient non-200 (budget-permitting), then assert 200 + reply. */
+async function meteredTurn(page, text) {
+  let r = await fireTurn(page, text);
+  if (r.status !== 200 && llmTurns < LLM_BUDGET) r = await fireTurn(page, text);
+  assert(r.status === 200, `app-assistant responded ${r.status} for "${text.slice(0, 40)}"`);
+  assert(r.body && typeof r.body.reply === 'string' && r.body.reply.trim().length > 0, `empty reply for "${text.slice(0, 40)}"`);
+  return r.body;
+}
+
+async function openPanel(page) {
+  const launcher = page.locator('.ekoa-assistant-launcher');
+  try {
+    await launcher.waitFor({ state: 'visible', timeout: 30_000 });
+  } catch {
+    // The launcher never mounted. Emit a diagnostic that distinguishes an ABSENT/BROKEN panel bundle
+    // (e.g. a scaffold snapshotted mid-edit into this build) from a genuine launcher regression, so a
+    // rerun reader can tell WHICH without re-driving. Diagnostics only — it changes nothing the gate
+    // asserts; it just turns an opaque 30s timeout into an actionable signal.
+    const diag = await page
+      .evaluate(() => ({
+        title: document.title,
+        hasEkoaGlobal: typeof window.__ekoa !== 'undefined',
+        runtimeInstalledSeen: typeof window.__ekoaActionRuntimeInstalled !== 'undefined',
+        assistantEls: Array.from(document.querySelectorAll('[class*="ekoa-assistant"]')).map((n) => n.className).slice(0, 10),
+        scriptSrcs: Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 20),
+      }))
+      .catch(() => null);
+    fail(`assistant launcher never mounted (panel bundle absent/broken in this build?). page diagnostic: ${JSON.stringify(diag)}`);
+  }
+  await launcher.click();
+  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
+  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
+}
+
+/** Geometry check: the C3 spotlight ring is drawn AROUND the real element carrying
+ *  data-demo-target=<name> (proves the highlight matches a real element). Copied from E2. */
+async function spotlightSurrounds(page, name) {
+  return page.evaluate((n) => {
+    const overlay = document.querySelector('[data-ekoa-actions-ui="spotlight"]');
+    if (!overlay) return { ok: false, reason: 'no-spotlight-overlay' };
+    const ring = overlay.firstElementChild;
+    const target = document.querySelector('[data-demo-target="' + n + '"]');
+    if (!ring) return { ok: false, reason: 'no-ring' };
+    if (!target) return { ok: false, reason: 'no-target' };
+    const rr = ring.getBoundingClientRect();
+    const tr = target.getBoundingClientRect();
+    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
+    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
+  }, name);
+}
+
+async function advance(page) { await page.locator('.ekoa-assistant-tour-next').click(); }
+
+async function main() {
+  const adminToken = await login(ADMIN.username, ADMIN.password);
+  ok('admin login (artifact owner + super-admin for breakdown)');
+
+  const visitor = await provisionVisitor(adminToken);
+  assert(visitor.token, 'visitor provisioning: no token');
+  ok(`distinct visitor provisioned + logged in (userId=${visitor.userId}) — drives the panel, must never be billed`);
+
+  const artifactId = await buildSampleApp(adminToken);
+  ok(`fresh app-base app built by admin (owner=admin, artifact=${artifactId})`);
+
+  // Document-access contrast (zero model cost): a fresh app is an OWNER-ONLY preview — the OWNER
+  // sees the served document, the distinct VISITOR gets 410 (proving the visitor is a genuine
+  // non-owner principal). We then FEATURE the app so it is shareable and the visitor can load it +
+  // drive the panel (the real "published app, other visitor, owner billed" scenario). Reverted in
+  // cleanup.
+  const docStatus = async (token) => {
+    const r = await fetch(`${BASE}/apps/${artifactId}/`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
+    return r.status;
+  };
+  const ownerDoc = await docStatus(adminToken);
+  const visitorDocBefore = await docStatus(visitor.token);
+  assert(ownerDoc === 200, `owner GET /apps/:id/ -> ${ownerDoc}, expected 200`);
+  assert(visitorDocBefore === 410, `visitor GET /apps/:id/ -> ${visitorDocBefore}, expected 410 (non-owner cannot view an unpublished app)`);
+  assert(await featureApp(adminToken, artifactId, true), 'PUT /:id/featured{true} failed');
+  cleanupFeatured = { adminToken, artifactId };
+  const visitorDocAfter = await docStatus(visitor.token);
+  assert(visitorDocAfter === 200, `after featuring, visitor GET /apps/:id/ -> ${visitorDocAfter}, expected 200 (shareable)`);
+  ok('document-access contrast: owner 200 / non-owner 410 unpublished; featured -> visitor 200 (visitor is a genuine non-owner who can now drive the shared app)');
+
+  const routeProbe = await fetch(`${BASE}/api/demos/${artifactId}`);
+  assert(routeProbe.status === 404 || routeProbe.status === 200, `GET /api/demos/:appId returned ${routeProbe.status}`);
+  ok(`tour serving route live (GET /api/demos/:appId -> ${routeProbe.status})`);
+
+  // --- Browser: the context is authenticated as the VISITOR (a distinct, non-owner principal). ---
+  const browser = await chromium.launch();
+  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${visitor.token}` } });
+  const page = await context.newPage();
+
+  const consoleErrors = [];
+  page.on('console', (msg) => {
+    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
+  });
+  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));
+
+  // Count EVERY assistant model POST for the whole session — the client-side "free" proof.
+  let assistantPosts = 0;
+  page.on('request', (req) => {
+    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
+  });
+
+  // Deterministic served tour: fulfil GET /api/demos/:appId with the schema-valid overview fixture.
+  await page.route('**/api/demos/**', (route) =>
+    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) }),
+  );
+
+  const appUrl = `${BASE}/apps/${artifactId}/`;
+  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
+
+  // Plant both landmarks as direct children of <body> (React never reclaims them — C5/D3/E2 technique):
+  // the tour target, and a setField wrapper+input for the registry-only action. CRITICAL:
+  // `pointer-events:none` makes these fixed overlays CLICK-THROUGH — they sit at the top-left where
+  // they can overlap the real app-nav, and without this their subtree would intercept the tour's
+  // step-4 click on the real app-nav button. It does NOT affect the assertions: setField writes the
+  // input value programmatically (not via a click) and the spotlight geometry reads getBoundingClientRect.
+  await page.evaluate(({ tourTarget, regTarget }) => {
+    if (!document.querySelector('[data-demo-target="' + tourTarget + '"]')) {
+      const el = document.createElement('div');
+      el.setAttribute('data-demo-target', tourTarget);
+      el.style.cssText = 'position:fixed;top:8px;left:8px;width:200px;height:36px;z-index:1;background:#fff;border:1px solid #ccc;pointer-events:none;';
+      document.body.appendChild(el);
+    }
+    if (!document.querySelector('[data-demo-target="' + regTarget + '"]')) {
+      const wrap = document.createElement('div');
+      wrap.setAttribute('data-demo-target', regTarget);
+      wrap.style.cssText = 'position:fixed;top:52px;left:8px;width:220px;height:38px;z-index:1;background:#fff;border:1px solid #ccc;pointer-events:none;';
+      const input = document.createElement('input');
+      input.id = 'g1-set-input';
+      input.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
+      wrap.appendChild(input);
+      document.body.appendChild(wrap);
+    }
+  }, { tourTarget: TOUR_TARGET, regTarget: REG_TARGET });
+
+  await openPanel(page);
+  ok('panel opened as the visitor; same-document C3 action runtime installed');
+
+  // ============================================================================================
+  // 1. REGISTRY-ONLY ACTION IS FREE. Dispatch a setField through window.__ekoaActions.execute (the
+  //    C3 runtime the panel itself uses). It runs entirely in-page: the field changes, the promise
+  //    resolves 'done', and NO model POST fires + NO billing row lands.
+  // ============================================================================================
+  const ownerBeforeReg = await assistantChatCount(adminToken);
+  const postsBeforeReg = assistantPosts;
+  await page.evaluate(({ target, value }) => {
+    document.getElementById('g1-set-input').value = '';
+    window.__g1SetResult = null;
+    window.__ekoaActions
+      .execute({ id: 'g1-set', kind: 'setField', labelPt: 'Preencher', description: 'x', target, params: { valor: value } })
+      .then((r) => { window.__g1SetResult = r; });
+  }, { target: REG_TARGET, value: REG_VALUE });
+  await page.waitForFunction(() => window.__g1SetResult && window.__g1SetResult.status === 'done', { timeout: 8_000 });
+  const regField = await page.evaluate(() => document.getElementById('g1-set-input').value);
+  assert(regField.includes(REG_VALUE), `registry setField did not drive the field: "${regField}"`);
+  assert(assistantPosts === postsBeforeReg, `registry action fired ${assistantPosts - postsBeforeReg} assistant POST(s) — must be zero`);
+  const ownerAfterReg = await assistantChatCount(adminToken);
+  assert(ownerAfterReg === ownerBeforeReg, `registry action added ${ownerAfterReg - ownerBeforeReg} owner billing row(s) — must be zero`);
+  await page.screenshot({ path: join(EVID, 'live-01-registry-action.png') });
+  ok(`REGISTRY: setField ran in-page (field -> "${regField}"); zero assistant POSTs; zero new owner billing rows`);
+
+  // ============================================================================================
+  // 2. TOUR PLAYBACK IS FREE. Play the FULL overview tour through the E2 teach launcher and assert
+  //    zero model POSTs + zero new billing rows across the whole playback.
+  // ============================================================================================
+  const ownerBeforeTour = await assistantChatCount(adminToken);
+  const postsBeforeTour = assistantPosts;
+  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
+  const startBtn = page.locator('.ekoa-assistant-tour-start');
+  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
+  await startBtn.click();
+  const tour = page.locator('.ekoa-assistant-tour');
+  await tour.waitFor({ state: 'visible', timeout: 10_000 });
+
+  // Step 1 (navigate "Bem-vindo").
+  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
+  await advance(page);
+  // Step 2 (spotlight app-nav — a rebuild-stable shell landmark).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
+  let geo = await spotlightSurrounds(page, 'app-nav');
+  assert(geo.ok, `spotlight did not surround app-nav: ${JSON.stringify(geo)}`);
+  await advance(page);
+  // Step 3 (spotlight the planted tour target).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  geo = await spotlightSurrounds(page, TOUR_TARGET);
+  assert(geo.ok, `spotlight did not surround ${TOUR_TARGET}: ${JSON.stringify(geo)}`);
+  await advance(page);
+  // Step 4 (await-action app-nav click — advances only on a real click).
+  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
+  await page.locator('[data-demo-target="app-nav"] button').first().click();
+  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });
+  // Step 5 (spotlight app-content).
+  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
+  geo = await spotlightSurrounds(page, 'app-content');
+  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
+  await advance(page);
+  // Step 6 (inject-prompt — the suggestion lands in the composer, unsent).
+  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
+  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
+  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
+  await advance(page);
+  // Done.
+  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
+  await page.screenshot({ path: join(EVID, 'live-02-tour-done.png') });
+
+  assert(assistantPosts === postsBeforeTour, `tour playback fired ${assistantPosts - postsBeforeTour} assistant POST(s) — tours must be zero-token`);
+  const ownerAfterTour = await assistantChatCount(adminToken);
+  assert(ownerAfterTour === ownerBeforeTour, `tour playback added ${ownerAfterTour - ownerBeforeTour} owner billing row(s) — must be zero`);
+  ok('TOUR: full overview tour reached "concluído"; zero assistant POSTs; zero new owner billing rows (client-side, zero-token)');
+
+  // Close the tour so the composer is clear for the metered turns.
+  await page.locator('.ekoa-assistant-tour-close').click();
+  await page.locator('.ekoa-assistant-textarea').waitFor({ state: 'visible', timeout: 10_000 });
+
+  // ============================================================================================
+  // 3. METERED + ATTRIBUTED. N=2 real assistant turns (driven by the VISITOR) -> exactly TWO new
+  //    'assistant-chat' rows in the OWNER's ledger with tokens>0; the VISITOR's ledger unchanged.
+  // ============================================================================================
+  const ownerBefore = await assistantChatCount(adminToken);
+  const visitorBefore = await assistantChatCount(visitor.token);
+  for (let i = 0; i < TURNS.length; i++) {
+    const body = await meteredTurn(page, TURNS[i]);
+    ok(`turn ${i + 1}/2 fired (200, mode="${body.mode}", reply ${body.reply.length} chars)`);
+  }
+  await page.screenshot({ path: join(EVID, 'live-03-metered-turns.png') });
+
+  const ownerRowsAfter = assistantChatRows(await ledgerRows(adminToken));
+  const ownerAfter = ownerRowsAfter.length;
+  const visitorAfter = await assistantChatCount(visitor.token);
+  assert(ownerAfter - ownerBefore === TURNS.length, `owner gained ${ownerAfter - ownerBefore} assistant-chat rows, expected exactly ${TURNS.length}`);
+  assert(visitorAfter - visitorBefore === 0, `visitor (the caller) gained ${visitorAfter - visitorBefore} assistant-chat rows — must be ZERO (owner is the billee)`);
+  // The two NEW rows (history is newest-first) each carry metered tokens > 0.
+  const newRows = ownerRowsAfter.slice(0, TURNS.length);
+  for (const row of newRows) {
+    assert(row.type === 'assistant-chat', `new owner row type "${row.type}", expected "assistant-chat"`);
+    assert(typeof row.tokens === 'number' && row.tokens > 0, `new owner assistant-chat row metered ${row.tokens} tokens, expected > 0`);
+  }
+  // Ties the ledger rows to browser-issued turns: every POST since the tour is a turn we fired
+  // (the tour + registry fired none), so the count equals llmTurns (== TURNS.length, or +1 if a
+  // transient non-200 was retried — a retried failure writes NO ledger row, so owner still gained
+  // exactly TURNS.length rows above).
+  assert(assistantPosts - postsBeforeTour === llmTurns, `assistant POSTs since the tour (${assistantPosts - postsBeforeTour}) != turns fired (${llmTurns})`);
+  ok(`METERED: ${TURNS.length} visitor-driven turns -> exactly ${TURNS.length} new 'assistant-chat' rows on the OWNER ledger (tokens=${newRows.map((r) => r.tokens).join(',')}); VISITOR ledger unchanged (billed to owner, NOT the caller)`);
+
+  // ============================================================================================
+  // 4. BREAKDOWN carries the assistant-chat agentType with tokens > 0.
+  // ============================================================================================
+  const breakdown = await billingBreakdown(adminToken);
+  const acLine = breakdown.find((x) => x.agentType === 'assistant-chat');
+  assert(acLine && acLine.tokens > 0, `breakdown missing assistant-chat with tokens>0: ${JSON.stringify(breakdown)}`);
+  ok(`BREAKDOWN: /billing/breakdown groups an 'assistant-chat' line (tokens=${acLine.tokens})`);
+
+  // ============================================================================================
+  // 5. ZERO non-benign page JS console errors throughout.
+  // ============================================================================================
+  const errors = consoleErrors.filter((e) => !benign(e));
+  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
+  ok('zero non-benign page JS console errors throughout');
+
+  await browser.close();
+
+  // Cleanup: revert the temporary featuring so the test app returns to its owner-only state.
+  if (cleanupFeatured) {
+    const reverted = await featureApp(cleanupFeatured.adminToken, cleanupFeatured.artifactId, false);
+    cleanupFeatured = null;
+    ok(`test app un-featured (cleanup ${reverted ? 'ok' : 'FAILED — revert manually'})`);
+  }
+
+  console.log('G1 LIVE GATE: PASS');
+}
+
+main()
+  .then(() => process.exit(0))
+  .catch(async (e) => {
+    // Best-effort cleanup on ANY failure: never leave the test app publicly featured.
+    if (cleanupFeatured) {
+      try { await featureApp(cleanupFeatured.adminToken, cleanupFeatured.artifactId, false); } catch { /* best effort */ }
+    }
+    console.error(`E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
+    process.exit(1);
+  });
diff --git a/docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md b/docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
new file mode 100644
index 0000000..690cb0d
--- /dev/null
+++ b/docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md
@@ -0,0 +1,106 @@
+# G1 — Assistant metering + billing-truth probe extension (tours/registry provably free)
+
+Kind: api · Size: 3 · Dep: D1 (passed) · Branch: `operator-run`
+Status: **LIVE GATE PENDING RESUME** (paused by the lead mid-run for an unrelated scaffold-edit collision; see §6). Proof slice — **no production code change**.
+
+## 1. What G1 proves (acceptance)
+
+D1 already meters the served-app assistant: `POST /api/app-assistant` runs one model call through the llm/ chokepoint one-shot, metered + attributed to the RESOLVED ARTIFACT OWNER (`agentType: 'assistant-chat'`, a UserWorkAgentType), never the anonymous visitor. G1 does **not** re-implement any of that — it PROVES it live and extends the journeys' billing-truth reconciliation (actions-log vs `GET /api/v1/billing/history`) to the assistant plane, with four claims:
+
+1. **Metered + attributed to the owner, not the caller.** N=2 real assistant turns -> exactly TWO new `assistant-chat` rows in the OWNER's ledger with metered tokens > 0, while the driving VISITOR's ledger gains ZERO.
+2. **Breakdown.** `GET /api/v1/billing/breakdown` (super-admin, grouped by `agentType`) now carries an `assistant-chat` line with tokens > 0.
+3. **Tour playback is free.** A full overview tour played through the E2 teach launcher fires ZERO `POST /api/app-assistant` and adds ZERO new billing rows.
+4. **Registry-only actions are free.** A registry action dispatched through `window.__ekoaActions.execute` runs entirely in-page — ZERO model POSTs, ZERO new billing rows.
+
+Deliverable driver: `api/tests/e2e/assistant-billing.e2e.mjs` (committed, re-runnable; modeled on the D3 driver `assistant-modes.e2e.mjs` + the E2 driver `tour-playback.e2e.mjs`).
+
+## 2. Ground truth (verified by reading the code, before writing the probe)
+
+- **agentType string** = `assistant-chat`. `api/src/apps/app-assistant.ts:280-285` builds the attribution `{ kind:'user_work', agentType:'assistant-chat', billeeUserId: input.owner.userId, artifactId: input.artifactId }` and passes it to the injected `deps.oneShot` (`:287`). This is the ONLY model egress in the turn — `deps.ground` (grounding) and `deps.decide` (`decideForTask(..., 'WORKHORSE')`) are both SYNCHRONOUS/pure (no model call, no billing). So **one turn -> exactly one metered row**; there is no memory-extract or secondary metered call on this path (unlike hosted chat).
+- **Owner is server-resolved, caller is never read.** `api/src/apps/app-assistant-route.ts` is HEADER-SCOPED (`POST /api/app-assistant`, no `requireAuth`). The owner comes from `X-Ekoa-App-Id -> resolveApp -> ownerUserId` (`:70-111`); billing is billed to `admission.owner.userId` (the allowance gate `:124` and the metering attribution). The endpoint NEVER reads the caller's JWT — so "billed to owner, not the visitor" holds by construction. G1 makes it observable by driving the panel as a DISTINCT visitor.
+- **Ledger surfaces.** `token_events` rows carry `agentType` (`api/src/billing/tracker.ts:47,194`) and are single-writer (only the chokepoint records). `GET /api/v1/billing/history` is actor-scoped (`api/src/routes/billing.ts:38-42` -> `historyFor(actorOf(req).userId)`; `service.ts:77-93` exposes each row's `agentType` as `type` and `metered` as `tokens`). `GET /api/v1/billing/breakdown` is super-admin, platform-wide, grouped by `agentType` (`billing.ts:60-62`; `service.ts:99-112`).
+- **Admin is a super-admin** (`api/src/auth/service.ts:57-72` seeds role `super-admin`) — so `/breakdown` is readable with the admin token.
+- **Serving is public** (`api/src/apps/serving.ts:435` "ALL public") and **new users are active** (`api/src/auth/users-service.ts:39` `setActivation(id,{active:true,...})`) — so a distinct visitor can drive the served app, and the owner-activation admission gate passes.
+
+**No attribution gap found.** The metering + attribution path is correct and complete in static review; per the slice contract this is a proof slice with NO production code change and NO contract test needed. `api/src/billing/**` was reserved contingently and left untouched.
+
+## 3. Probe design + rationale
+
+- **Owner = admin** (builds the app, so `artifact.userId = admin`). This follows the proven D3/E2 build pattern (guaranteed-activated owner) and keeps the metered assertion clean: at baseline admin has **0** `assistant-chat` rows (verified — see §5), so a delta of exactly 2 is unambiguous. The metered assertion filters on `type === 'assistant-chat'` specifically (admin's ledger already holds ~92 rows of other agentTypes from builds), so it is immune to concurrent non-assistant billing.
+- **Caller = a distinct visitor.** The browser context is authenticated as a separate, non-owner builder user (`g1-visitor`). Because the endpoint ignores the caller identity, this makes billing-truth OBSERVABLE on two separate ledgers: owner +2, visitor +0. Provisioning is idempotent (`tryLogin` first; create org+user only if absent) so re-runs on the same boot never duplicate.
+- **Ordering: registry -> tour -> metered.** The two zero-cost (LLM-free) claims run FIRST, so the N=2 assistant budget is only spent once the panel is proven healthy. A broken panel/tour therefore fails BEFORE any real turn is burned (which is exactly what happened in the first run — §6).
+- **Determinism.** Every assertion is STRUCTURAL: ledger row counts by agentType + billee, the browser-side `POST /api/app-assistant` request counter (client-side proof that playback/registry issue no model call), and the C3 runtime's own result status / DOM effect. The served tour is the same schema-valid `e2-overview-tour.json` fixture E2 uses, fulfilled at the browser boundary (`page.route`) — the only stub QA permits. The two metered turns are plain informational PT-PT prompts (no operate surface needed; metering fires on the one-shot regardless of whether the turn proposes actions).
+- **Budget cap.** A hard `LLM_BUDGET = 3` ceiling: 2 turns + at most one transient non-200 retry. `fireTurn` refuses to exceed it.
+- **Console gate** copied VERBATIM from the D2/D3/E2 drivers: favicon 404 + anonymous whoami 401 (`/api/app-sso/me`) + dev-proxy app-health 5xx. The lead's "two documented allowlists" are the two app-specific platform behaviours (whoami 401 + app-health 5xx); the favicon 404 is the universal served-app 404 already allowlisted by every sibling driver, so it is included to match the proven, passing allowlist ("copy from the D2 driver").
+- **Driver hardening (added while paused):** `openPanel` now, on a launcher-mount timeout, dumps a page diagnostic (ekoa globals present? runtime installed? which `ekoa-assistant` elements exist? script srcs) and fails with an actionable message — so a rerun reader can tell an ABSENT/BROKEN panel bundle (e.g. a scaffold snapshotted mid-edit) from a genuine launcher regression, without re-driving.
+
+## 4. Commands run + results
+
+| Step | Command | Result |
+|---|---|---|
+| Stack liveness | `curl POST /api/v1/auth/login {admin}` | HTTP 200 (stack up: api :4211, proxy :4111, web :3000) |
+| Syntax | `node --check api/tests/e2e/assistant-billing.e2e.mjs` | OK (before + after hardening) |
+| Tooling | `command -v asciinema`; `import('playwright')` | both available |
+| Non-LLM plumbing smoke (scratchpad `g1-smoke.mjs`) | admin login / visitor provision / ledger reads / breakdown | all green (see §5) |
+| **Live probe (asciinema)** | `node tests/e2e/assistant-billing.e2e.mjs` | **FAILED at openPanel** (external cause — §6) |
+
+## 5. Static smoke test (non-LLM plumbing) — all green
+
+Ran a scratchpad script against the live stack to de-risk every HTTP shape BEFORE spending a build/turn:
+
+- admin login 200; admin is super-admin (`/billing/breakdown` -> 200).
+- visitor provisioning: `POST /orgs` 201, `POST /users` 201 (role builder, `active:true`), visitor login 200; `GET /auth/me` returns `{id,...}`.
+- visitor `GET /billing/history` -> 200, 0 items, 0 `assistant-chat`.
+- admin `GET /billing/history` -> 200, 92 items, **0 `assistant-chat`** (other agentTypes present: `memory-extract`, `pi-fast-loop`, `build`, `classify-in-build-intent`). Row shape: `{id,type,amountUsd,createdAt,description,tokens}`.
+- admin `GET /billing/breakdown` -> 200, 4 agentTypes, no `assistant-chat` yet.
+
+=> confirms the metered assertion is unambiguous (admin baseline `assistant-chat` = 0; expect exactly 2 after the run) and the visitor-ledger-unchanged assertion is meaningful.
+
+## 6. First live run — FAILED at panel-open (external, paused by lead). Token budget intact.
+
+`live-output.txt` / `evidence-live.cast` (both in this dir):
+
+```
+PASS admin login (artifact owner + super-admin for breakdown)
+PASS distinct visitor provisioned + logged in (userId=14fb2aca-...) — drives the panel, must never be billed
+PASS fresh app-base app built by admin (owner=admin, artifact=3a4be859-5426-4d70-8f22-c5f3363fcd39)
+PASS tour serving route live (GET /api/demos/:appId -> 404)
+E2E FAIL: locator.waitFor: Timeout 30000ms exceeded.
+  - waiting for locator('.ekoa-assistant-launcher') to be visible
+    at openPanel (assistant-billing.e2e.mjs)
+```
+
+**Cause (per lead, not my bug):** the E2 worker was concurrently rewriting the scaffold panel files (`AssistantPanel.jsx` / `tour-player.js`) for a review-fix batch. A fresh app build snapshots the scaffold at build time, so artifact `3a4be859` baked in a mid-edit, transiently broken panel — the launcher never mounted. The lead paused the live probe and will send RESUME LIVE once E2's fix batch is complete and statically green.
+
+**Token budget honesty:**
+- **Assistant (LLM) turns burned: 0.** The probe fires the N=2 metered turns LAST (after the registry action + full tour); it died at `openPanel`, before any turn. `grep "turn ... fired" live-output.txt` = 0.
+- **Build cycles spent: 1** (artifact `3a4be859`, billed to admin as `build`/related agentTypes — NOT part of the N=2 assistant budget). This artifact is considered POISONED (mid-edit scaffold) and will be discarded; RESUME will build a FRESH artifact.
+
+## 7. On RESUME LIVE (remaining work)
+
+1. Build a FRESH app (new artifactId — do NOT reuse `3a4be859`).
+2. Run `node api/tests/e2e/assistant-billing.e2e.mjs` under asciinema (overwrites `evidence-live.cast` + `live-output.txt`).
+3. Green = the four PASS blocks (metered owner +2 / visitor +0, breakdown, tour-free, registry-free) + the console gate + final line `G1 LIVE GATE: PASS`.
+4. Update this file's §4/§6 with the green output and flip the status to PASS.
+
+## 8. Suite-ledger note (flagged, NOT edited — outside reserved paths)
+
+`scripts/suite-ledger-run.mjs` censuses every `api/tests/e2e/*.e2e.mjs` on disk against `SUITE_LEDGER.json` `node_drivers.drivers` (a count-match in both directions). Disk now has **19** `.e2e.mjs` (my new driver makes it the 20th on RESUME... it is already present -> 19 total counting it), but the ledger lists **14**. The four sibling operator-run drivers (`action-registry`/C5, `assistant-panel`/D2, `assistant-modes`/D3, `tour-playback`/E2) are ALSO unregistered — i.e. the operator-run drivers are reconciled into the ledger in a BATCH (by the lead at gate time), not self-registered per slice, and this census is already red on the branch independently of G1.
+
+Per the constraint "do not edit anything outside reserved paths; flag the reason first", I did **not** touch `SUITE_LEDGER.json`. When the lead reconciles the ledger, my entry (matching the minimal `{name,targetGate,note?}` schema) is:
+
+```json
+{ "name": "assistant-billing", "targetGate": "G1", "note": "operator-run G1: assistant metering + billing-truth live probe (owner-billed, visitor-free, tour+registry zero-token)" }
+```
+
+(and the 4 sibling operator-run drivers need entries too, for the census to go green).
+
+## 9. Constraints honored
+
+- No security/auth/permission logic touched (H block).
+- Egress chokepoint untouched.
+- No production code change (proof slice; no attribution gap found).
+- No diagram change — this is a proof slice; it alters no structure, flow, or data shape (the diagram invariant does not apply). Stated explicitly per the delegation.
+- PT-PT: the two turn prompts are PT-PT; no new user-facing strings.
+- Reserved paths only: created `api/tests/e2e/assistant-billing.e2e.mjs`; wrote `slices/G1/**`; left `api/src/billing/**` untouched (no gap). Did not commit (lead runs the gates).
+- Real-token discipline: 0 assistant turns on the failed run; budget cap `LLM_BUDGET=3` enforced in the driver.
diff --git a/docs/autothing/runs/20260712-150958-4bb23640/slices/G1/live-output.txt b/docs/autothing/runs/20260712-150958-4bb23640/slices/G1/live-output.txt
new file mode 100644
index 0000000..08fe82b
--- /dev/null
+++ b/docs/autothing/runs/20260712-150958-4bb23640/slices/G1/live-output.txt
@@ -0,0 +1,15 @@
+PASS admin login (artifact owner + super-admin for breakdown)
+PASS distinct visitor provisioned + logged in (userId=14fb2aca-1f55-49e8-a36d-d781376ee0c9) — drives the panel, must never be billed
+PASS fresh app-base app built by admin (owner=admin, artifact=6a513cdd-cfea-4b7f-8273-4196620f05ec)
+PASS document-access contrast: owner 200 / non-owner 410 unpublished; featured -> visitor 200 (visitor is a genuine non-owner who can now drive the shared app)
+PASS tour serving route live (GET /api/demos/:appId -> 404)
+PASS panel opened as the visitor; same-document C3 action runtime installed
+PASS REGISTRY: setField ran in-page (field -> "REGISTO-LOCAL-G1"); zero assistant POSTs; zero new owner billing rows
+PASS TOUR: full overview tour reached "concluído"; zero assistant POSTs; zero new owner billing rows (client-side, zero-token)
+PASS turn 1/2 fired (200, mode="teach", reply 1724 chars)
+PASS turn 2/2 fired (200, mode="teach", reply 1668 chars)
+PASS METERED: 2 visitor-driven turns -> exactly 2 new 'assistant-chat' rows on the OWNER ledger (tokens=1134,3230); VISITOR ledger unchanged (billed to owner, NOT the caller)
+PASS BREAKDOWN: /billing/breakdown groups an 'assistant-chat' line (tokens=4364)
+PASS zero non-benign page JS console errors throughout
+PASS test app un-featured (cleanup ok)
+G1 LIVE GATE: PASS

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc 'git diff 20b1c70''^ 20b1c70 -- api/tests/e2e/assistant-billing.e2e.mjs | nl -ba | sed -n '"'1,320p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-XjdLHfK8' (errno=Operation not permitted)
git: warning: confstr() failed with code 5: couldn't get path of DARWIN_USER_TEMP_DIR; using /tmp instead
git: error: couldn't create cache file '/tmp/xcrun_db-UwrWh463' (errno=Operation not permitted)
     1	diff --git a/api/tests/e2e/assistant-billing.e2e.mjs b/api/tests/e2e/assistant-billing.e2e.mjs
     2	new file mode 100644
     3	index 0000000..94e779b
     4	--- /dev/null
     5	+++ b/api/tests/e2e/assistant-billing.e2e.mjs
     6	@@ -0,0 +1,517 @@
     7	+#!/usr/bin/env node
     8	+/**
     9	+ * ASSISTANT METERING + BILLING-TRUTH live gate — committed, re-runnable end-to-end driver
    10	+ * (operator-run G1).
    11	+ *
    12	+ * D1 built the served-app assistant (`POST /api/app-assistant`) so that every turn runs ONE model
    13	+ * call through the llm/ chokepoint one-shot, metered + attributed to the RESOLVED ARTIFACT OWNER
    14	+ * (agentType 'assistant-chat', a UserWorkAgentType), never the anonymous visitor. E2 built the
    15	+ * in-app tour player (100% client-side, zero model calls). G1 does NOT re-implement any of that; it
    16	+ * PROVES the billing truth live on the credentialed boot-b stack and extends the journeys'
    17	+ * billing-truth reconciliation (actions-log vs GET /api/v1/billing/history) to the assistant plane:
    18	+ *
    19	+ *   1. METERED + ATTRIBUTED. The app is BUILT by admin (so the artifact owner is admin) and then
    20	+ *      FEATURED (a fresh app is an owner-only preview — non-owners get 410; featuring makes it
    21	+ *      shareable so the visitor can load it — reverted in cleanup). The assistant panel is then
    22	+ *      driven by a DISTINCT visitor (the browser context is authenticated as a separate, non-owner
    23	+ *      user). N=2 real assistant turns each fire exactly one `POST
    24	+ *      /api/app-assistant` -> exactly TWO new `assistant-chat` rows land in the OWNER's ledger (GET
    25	+ *      /api/v1/billing/history) with metered tokens > 0 — while the VISITOR's ledger gains ZERO.
    26	+ *      That is the billing truth: the caller is not the billee; the resolved owner is. (The endpoint
    27	+ *      is header-scoped and never reads the caller's JWT — app-assistant-route.ts bills
    28	+ *      admission.owner.userId — so this holds by construction; the probe makes it observable.)
    29	+ *   2. BREAKDOWN. GET /api/v1/billing/breakdown (super-admin, grouped by agentType) now carries an
    30	+ *      `assistant-chat` line with tokens > 0.
    31	+ *   3. TOUR PLAYBACK IS FREE. A FULL overview tour played through the E2 teach launcher issues ZERO
    32	+ *      `POST /api/app-assistant` and adds ZERO new billing rows (the player is client-side).
    33	+ *   4. REGISTRY-ONLY ACTIONS ARE FREE. A registry action dispatched through window.__ekoaActions
    34	+ *      .execute (the C3 runtime the panel itself uses) runs entirely in-page — ZERO model POSTs,
    35	+ *      ZERO new billing rows.
    36	+ *   5. Zero non-benign page JS console errors throughout (the SAME documented allowlist as the
    37	+ *      D2/D3/E2 drivers: favicon 404 + anonymous whoami 401 + dev-proxy app-health 5xx).
    38	+ *
    39	+ * DETERMINISM. A committed gate cannot depend on model prose, so every assertion is STRUCTURAL:
    40	+ * ledger ROW COUNTS by agentType + billee, the browser-side `POST /api/app-assistant` request
    41	+ * counter, and the C3 runtime's own result status / DOM effect. The served tour is the same
    42	+ * schema-valid overview fixture E2 uses, fulfilled at the browser boundary (page.route) — the only
    43	+ * stub QA permits. The two metered turns are plain informational prompts (no operate surface
    44	+ * needed): metering fires on the one-shot regardless of whether the turn proposes actions. The
    45	+ * model is called at most 3 times total (2 turns + at most one transient retry).
    46	+ *
    47	+ * NO PRODUCTION CODE CHANGE — this is a proof slice. Black-box over the running dev cortex
    48	+ * (backend.port, the boot-b proxy) + a real Chromium. Builds ONE fresh app-base app (verify OFF).
    49	+ * Run: node tests/e2e/assistant-billing.e2e.mjs
    50	+ */
    51	+import { readFileSync } from 'node:fs';
    52	+import { join, dirname } from 'node:path';
    53	+import { fileURLToPath } from 'node:url';
    54	+import { chromium } from 'playwright';
    55	+
    56	+const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    57	+const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
    58	+const BASE = `http://localhost:${PORT}`;
    59	+const ADMIN = { username: 'admin', password: 'tmp12345' };
    60	+const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'G1');
    61	+
    62	+const BUILD_TIMEOUT_MS = 10 * 60_000;
    63	+const TURN_TIMEOUT_MS = 150_000;
    64	+const LLM_BUDGET = 3; // hard ceiling on real model calls (2 turns + at most 1 transient retry)
    65	+
    66	+// The distinct VISITOR principal that drives the assistant panel (a separate, non-owner user, so
    67	+// "billed to the owner, not the visitor" is observable on two separate ledgers). Fixed creds keep
    68	+// the probe idempotent across re-runs (the ephemeral dev Mongo may already carry the user).
    69	+const VISITOR = { orgName: 'g1-visitor-org', username: 'g1-visitor', password: 'pw123456' };
    70	+
    71	+// The app-specific (non-landmark) registry-ID target the tour spotlights — planted in the page like
    72	+// the E2/D3 gates so the surface is deterministic.
    73	+const TOUR_TARGET = 'e2-tour-alvo';
    74	+// A planted setField landmark the registry-only action drives (same technique as the D3 gate).
    75	+const REG_TARGET = 'g1-set-target';
    76	+const REG_VALUE = 'REGISTO-LOCAL-G1';
    77	+
    78	+// The schema-valid overview tour the panel fetches — the SAME fixture E2 validates against
    79	+// demoSpecSchema, so this "stub" is a schema-validated stub (the only stub QA permits).
    80	+const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
    81	+const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;
    82	+function buildTour(appId) { return { ...TOUR_FIXTURE, appId }; }
    83	+
    84	+// Two plain informational turns — no operate surface required; each fires exactly one metered
    85	+// one-shot. PT-PT (the served assistant answers in PT-PT).
    86	+const TURNS = [
    87	+  'Dê-me uma visão geral do que esta aplicação permite fazer.',
    88	+  'Explique-me, de forma geral, como está organizada esta aplicação.',
    89	+];
    90	+
    91	+// `fail` THROWS (not process.exit) so the tail's catch runs cleanup (un-feature the test app) on any
    92	+// failure before exiting non-zero. Set once the app is featured, so cleanup knows what to revert.
    93	+let cleanupFeatured = null;
    94	+function fail(msg) { throw new Error(msg); }
    95	+function ok(msg) { console.log(`PASS ${msg}`); }
    96	+function assert(cond, msg) { if (!cond) fail(msg); }
    97	+
    98	+// ---------------------------------------------------------------------------------------------
    99	+// HTTP kit (direct fetch, off the browser) — provisioning + ledger reads.
   100	+// ---------------------------------------------------------------------------------------------
   101	+/** Log in, returning the token or null (never exits) — used for the idempotent visitor check. */
   102	+async function tryLogin(username, password) {
   103	+  const r = await fetch(`${BASE}/api/v1/auth/login`, {
   104	+    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
   105	+  });
   106	+  if (!r.ok) return null;
   107	+  return (await r.json()).token;
   108	+}
   109	+
   110	+/** Log in, hard-failing the gate on any non-200. */
   111	+async function login(username, password) {
   112	+  const token = await tryLogin(username, password);
   113	+  assert(token, `login(${username}) failed`);
   114	+  return token;
   115	+}
   116	+
   117	+async function userIdOf(token) {
   118	+  const me = await (await fetch(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => ({}));
   119	+  return (me && (me.user?.id || me.id)) || null;
   120	+}
   121	+
   122	+/** Provision the distinct visitor (org + builder user) as admin, then log them in. IDEMPOTENT: if
   123	+ *  the fixed-cred visitor already exists (re-run on the same boot), it just logs in — no duplicate
   124	+ *  org/user is created. */
   125	+async function provisionVisitor(adminToken) {
   126	+  const existing = await tryLogin(VISITOR.username, VISITOR.password);
   127	+  if (existing) return { token: existing, userId: await userIdOf(existing) };
   128	+
   129	+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
   130	+  const orgRes = await fetch(`${BASE}/api/v1/orgs`, { method: 'POST', headers: H, body: JSON.stringify({ name: VISITOR.orgName, displayName: VISITOR.orgName }) });
   131	+  assert(orgRes.ok, `visitor org create ${orgRes.status}`);
   132	+  const orgId = (await orgRes.json()).id;
   133	+  const userRes = await fetch(`${BASE}/api/v1/users`, {
   134	+    method: 'POST', headers: H,
   135	+    body: JSON.stringify({ username: VISITOR.username, password: VISITOR.password, role: 'builder', orgId }),
   136	+  });
   137	+  assert(userRes.ok, `visitor user create ${userRes.status}`);
   138	+  const token = await login(VISITOR.username, VISITOR.password);
   139	+  return { token, userId: await userIdOf(token) };
   140	+}
   141	+
   142	+/** Build ONE fresh app-base app through the real jobs pipeline as ADMIN, so the artifact OWNER is
   143	+ *  admin (verify OFF — nondeterministic + orthogonal, same pattern as C5/D2/D3/E2). */
   144	+async function buildSampleApp(token) {
   145	+  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
   146	+  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
   147	+  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'g1-assistant-billing' }) })).json();
   148	+  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
   149	+    method: 'POST', headers: H,
   150	+    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
   151	+  })).json();
   152	+  const jobId = created.job.id;
   153	+  const deadline = Date.now() + BUILD_TIMEOUT_MS;
   154	+  for (;;) {
   155	+    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 10min`);
   156	+    await new Promise((r) => setTimeout(r, 6000));
   157	+    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
   158	+    if (job.status === 'completed') return job.artifactId;
   159	+    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
   160	+  }
   161	+}
   162	+
   163	+/**
   164	+ * Toggle the artifact's `featured` flag (super-admin `PUT /:id/featured`). A freshly built app is
   165	+ * shareability-gated (owner-only: a NON-owner or anonymous `GET /apps/:id/` returns 410 — the app is
   166	+ * an unpublished owner preview). Featuring makes it shareable (share-lookup: featured => always
   167	+ * shareable), so the DISTINCT visitor can load the served document and drive the panel — the real
   168	+ * "published app, anonymous/other visitor, owner billed" scenario. Reverted at the end (setFeatured
   169	+ * is a pure flag flip — app-paths.setFeaturedFlag — no rebuild, no side effect).
   170	+ */
   171	+async function featureApp(adminToken, artifactId, on) {
   172	+  const r = await fetch(`${BASE}/api/v1/artifacts/${artifactId}/featured`, {
   173	+    method: 'PUT',
   174	+    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
   175	+    body: JSON.stringify({ featured: on }),
   176	+  });
   177	+  return r.ok;
   178	+}
   179	+
   180	+/** The caller's OWN billing ledger (GET /api/v1/billing/history is actor-scoped). Returns rows;
   181	+ *  each row's `type` is the token_events agentType (billing/service.ts historyFor). */
   182	+async function ledgerRows(token) {
   183	+  const r = await fetch(`${BASE}/api/v1/billing/history`, { headers: { Authorization: `Bearer ${token}` } });
   184	+  assert(r.ok, `billing/history ${r.status}`);
   185	+  const body = await r.json();
   186	+  return (body && body.items) || [];
   187	+}
   188	+const assistantChatRows = (rows) => rows.filter((x) => x.type === 'assistant-chat');
   189	+async function assistantChatCount(token) { return assistantChatRows(await ledgerRows(token)).length; }
   190	+
   191	+/** GET /api/v1/billing/breakdown (super-admin, platform-wide, grouped by agentType). */
   192	+async function billingBreakdown(token) {
   193	+  const r = await fetch(`${BASE}/api/v1/billing/breakdown`, { headers: { Authorization: `Bearer ${token}` } });
   194	+  assert(r.ok, `billing/breakdown ${r.status}`);
   195	+  return ((await r.json()).items) || [];
   196	+}
   197	+
   198	+/**
   199	+ * A console-error entry is benign ONLY if it is one of these KNOWN, pre-existing platform /
   200	+ * dev-harness failed-resource logs — COPIED VERBATIM from the D2/D3/E2 drivers. None is G1 code;
   201	+ * each fires on EVERY served app. Every OTHER console error fails the gate (strict).
   202	+ */
   203	+function benign(entry) {
   204	+  const url = String(entry.url || '');
   205	+  const text = String(entry.text || '');
   206	+  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
   207	+  if (/favicon/i.test(`${url} ${text}`)) return true;
   208	+  // 2. Anonymous SSO whoami probe (injected-context.ts:110): window.__ekoa.whoami() GETs
   209	+  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
   210	+  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
   211	+  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
   212	+  // 3. Injected health beacon (injected-context.ts:244): POSTs /api/app-health (keepalive) on load;
   213	+  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
   214	+  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G1 code.
   215	+  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
   216	+  return false;
   217	+}
   218	+
   219	+// ---------------------------------------------------------------------------------------------
   220	+// Panel + tour driving (mirrors D3/E2).
   221	+// ---------------------------------------------------------------------------------------------
   222	+let llmTurns = 0;
   223	+
   224	+/** Fire ONE assistant turn through the panel; resolve { status, body }. Counts against LLM_BUDGET. */
   225	+async function fireTurn(page, text) {
   226	+  if (llmTurns >= LLM_BUDGET) fail(`LLM budget (${LLM_BUDGET}) exhausted before "${text.slice(0, 40)}"`);
   227	+  llmTurns += 1;
   228	+  const respP = page.waitForResponse(
   229	+    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
   230	+    { timeout: TURN_TIMEOUT_MS },
   231	+  );
   232	+  await page.locator('.ekoa-assistant-textarea').fill(text);
   233	+  await page.locator('.ekoa-assistant-send').click();
   234	+  const resp = await respP;
   235	+  let body = null;
   236	+  try { body = await resp.json(); } catch { /* non-JSON body */ }
   237	+  return { status: resp.status(), body };
   238	+}
   239	+
   240	+/** A metered turn: fire, absorb ONE transient non-200 (budget-permitting), then assert 200 + reply. */
   241	+async function meteredTurn(page, text) {
   242	+  let r = await fireTurn(page, text);
   243	+  if (r.status !== 200 && llmTurns < LLM_BUDGET) r = await fireTurn(page, text);
   244	+  assert(r.status === 200, `app-assistant responded ${r.status} for "${text.slice(0, 40)}"`);
   245	+  assert(r.body && typeof r.body.reply === 'string' && r.body.reply.trim().length > 0, `empty reply for "${text.slice(0, 40)}"`);
   246	+  return r.body;
   247	+}
   248	+
   249	+async function openPanel(page) {
   250	+  const launcher = page.locator('.ekoa-assistant-launcher');
   251	+  try {
   252	+    await launcher.waitFor({ state: 'visible', timeout: 30_000 });
   253	+  } catch {
   254	+    // The launcher never mounted. Emit a diagnostic that distinguishes an ABSENT/BROKEN panel bundle
   255	+    // (e.g. a scaffold snapshotted mid-edit into this build) from a genuine launcher regression, so a
   256	+    // rerun reader can tell WHICH without re-driving. Diagnostics only — it changes nothing the gate
   257	+    // asserts; it just turns an opaque 30s timeout into an actionable signal.
   258	+    const diag = await page
   259	+      .evaluate(() => ({
   260	+        title: document.title,
   261	+        hasEkoaGlobal: typeof window.__ekoa !== 'undefined',
   262	+        runtimeInstalledSeen: typeof window.__ekoaActionRuntimeInstalled !== 'undefined',
   263	+        assistantEls: Array.from(document.querySelectorAll('[class*="ekoa-assistant"]')).map((n) => n.className).slice(0, 10),
   264	+        scriptSrcs: Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 20),
   265	+      }))
   266	+      .catch(() => null);
   267	+    fail(`assistant launcher never mounted (panel bundle absent/broken in this build?). page diagnostic: ${JSON.stringify(diag)}`);
   268	+  }
   269	+  await launcher.click();
   270	+  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
   271	+  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
   272	+}
   273	+
   274	+/** Geometry check: the C3 spotlight ring is drawn AROUND the real element carrying
   275	+ *  data-demo-target=<name> (proves the highlight matches a real element). Copied from E2. */
   276	+async function spotlightSurrounds(page, name) {
   277	+  return page.evaluate((n) => {
   278	+    const overlay = document.querySelector('[data-ekoa-actions-ui="spotlight"]');
   279	+    if (!overlay) return { ok: false, reason: 'no-spotlight-overlay' };
   280	+    const ring = overlay.firstElementChild;
   281	+    const target = document.querySelector('[data-demo-target="' + n + '"]');
   282	+    if (!ring) return { ok: false, reason: 'no-ring' };
   283	+    if (!target) return { ok: false, reason: 'no-target' };
   284	+    const rr = ring.getBoundingClientRect();
   285	+    const tr = target.getBoundingClientRect();
   286	+    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
   287	+    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
   288	+  }, name);
   289	+}
   290	+
   291	+async function advance(page) { await page.locator('.ekoa-assistant-tour-next').click(); }
   292	+
   293	+async function main() {
   294	+  const adminToken = await login(ADMIN.username, ADMIN.password);
   295	+  ok('admin login (artifact owner + super-admin for breakdown)');
   296	+
   297	+  const visitor = await provisionVisitor(adminToken);
   298	+  assert(visitor.token, 'visitor provisioning: no token');
   299	+  ok(`distinct visitor provisioned + logged in (userId=${visitor.userId}) — drives the panel, must never be billed`);
   300	+
   301	+  const artifactId = await buildSampleApp(adminToken);
   302	+  ok(`fresh app-base app built by admin (owner=admin, artifact=${artifactId})`);
   303	+
   304	+  // Document-access contrast (zero model cost): a fresh app is an OWNER-ONLY preview — the OWNER
   305	+  // sees the served document, the distinct VISITOR gets 410 (proving the visitor is a genuine
   306	+  // non-owner principal). We then FEATURE the app so it is shareable and the visitor can load it +
   307	+  // drive the panel (the real "published app, other visitor, owner billed" scenario). Reverted in
   308	+  // cleanup.
   309	+  const docStatus = async (token) => {
   310	+    const r = await fetch(`${BASE}/apps/${artifactId}/`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
   311	+    return r.status;
   312	+  };
   313	+  const ownerDoc = await docStatus(adminToken);
   314	+  const visitorDocBefore = await docStatus(visitor.token);
   315	+  assert(ownerDoc === 200, `owner GET /apps/:id/ -> ${ownerDoc}, expected 200`);
   316	+  assert(visitorDocBefore === 410, `visitor GET /apps/:id/ -> ${visitorDocBefore}, expected 410 (non-owner cannot view an unpublished app)`);
   317	+  assert(await featureApp(adminToken, artifactId, true), 'PUT /:id/featured{true} failed');
   318	+  cleanupFeatured = { adminToken, artifactId };
   319	+  const visitorDocAfter = await docStatus(visitor.token);
   320	+  assert(visitorDocAfter === 200, `after featuring, visitor GET /apps/:id/ -> ${visitorDocAfter}, expected 200 (shareable)`);

codex
I have the probe logic now. Next I’m checking the billing read/write semantics themselves, because several likely defects depend on whether ledger writes are synchronous, how history is ordered/paginated, and whether the probe is filtering the right rows.
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_node started
mcp: codegraph/codegraph_node (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_search started
hook: PermissionRequest
hook: PermissionRequest Completed
mcp: codegraph/codegraph_search (failed)
user cancelled MCP tool call
hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "rg -n \"app-assistant\" api web shared | sed -n '1,200p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
shared/src/app-assistant.ts:89:    path: '/api/app-assistant',
shared/src/index.ts:28:import { appAssistantEndpoints } from './app-assistant.js';
shared/src/index.ts:61:export * from './app-assistant.js';
api/src/services/demo-registry.ts:103:// arbitrary same-origin path (e.g. `../app-assistant`). Defence in depth alongside the
api/src/server.ts:50:import { appAssistantRouter } from './apps/app-assistant-route.js';
api/src/server.ts:609:  // Served-app assistant (operator-run D1): POST /api/app-assistant, header-scoped, runs under the
api/src/apps/assistant-tools.ts:93:  void logActivity(actor, 'app-assistant', `action.${input.outcome}`, deps, {
api/tests/apps/assistant-tools.test.ts:14:    const rows = (await activityLogs.find({ category: 'app-assistant' })) as ActivityLogDoc[];
api/tests/apps/assistant-tools.test.ts:18:  return (await activityLogs.find({ category: 'app-assistant' })) as ActivityLogDoc[];
api/src/apps/app-assistant-route.ts:2: * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
api/src/apps/app-assistant-route.ts:34:import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
api/src/apps/app-assistant-route.ts:118:      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
api/src/apps/app-assistant-route.ts:126:  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
api/src/apps/app-assistant-route.ts:161:      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
api/src/apps/app-assistant.ts:4: * The brain behind `POST /api/app-assistant`: given a visitor's message, the resolved artifact
api/src/apps/app-assistant.ts:9: * tests with a canned model and no live egress. The route (app-assistant-route.ts) binds the real
api/tests/apps/app-assistant.test.ts:11:} from '../../src/apps/app-assistant.js';
api/tests/apps/tour-player.behavior.test.ts:139:      steps: [{ id: 'img', type: 'external-image-step', image: '../../app-assistant', copy: { titlePt: 't', bodyPt: 'b' } }],
api/tests/apps/tour-player.behavior.test.ts:209:    expect(fetched.some((u) => u.includes('/api/app-assistant'))).toBe(false);
api/tests/e2e/tour-playback.e2e.mjs:20: *   B. ZERO TOKENS. NO POST /api/app-assistant fires at any point during playback
api/tests/e2e/tour-playback.e2e.mjs:77:// A schema-valid app-assistant reply that carries a startTour ACTION — the SECOND
api/tests/e2e/tour-playback.e2e.mjs:247:    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
api/tests/e2e/tour-playback.e2e.mjs:323:  assert(assistantPosts === 0, `playback issued ${assistantPosts} POST /api/app-assistant — tours must be zero-token`);
api/tests/e2e/tour-playback.e2e.mjs:324:  ok('B: zero POST /api/app-assistant during playback (client-side, zero-token)');
api/tests/e2e/tour-playback.e2e.mjs:354:  //    the ONE app-assistant POST here is the trigger — the playback it starts must
api/tests/e2e/tour-playback.e2e.mjs:358:  await page.route('**/api/app-assistant', (route) => {
api/tests/apps/tour-player.test.ts:18: *    the network — it NEVER calls /api/app-assistant, so no model turn (no token)
api/tests/apps/tour-player.test.ts:55:  it('makes ZERO model calls during playback — it never touches /api/app-assistant', () => {
api/tests/apps/tour-player.test.ts:58:    expect(PLAYER).not.toContain('/api/app-assistant');
api/tests/apps/tour-player.test.ts:258:    for (const bad of ['../../app-assistant', '../frame.svg', '/api/app-assistant', 'http://evil/x', 'a\\b', '..']) {
api/tests/apps/assistant-panel.test.ts:11: * first-open copy, the three mode labels, the /api/app-assistant fetch with the
api/tests/apps/assistant-panel.test.ts:56:  it('POSTs to /api/app-assistant with the X-Ekoa-App-Id header read from window.__EKOA_APP_ID', () => {
api/tests/apps/assistant-panel.test.ts:57:    expect(PANEL).toContain('/api/app-assistant');
api/tests/e2e/assistant-billing.e2e.mjs:6: * D1 built the served-app assistant (`POST /api/app-assistant`) so that every turn runs ONE model
api/tests/e2e/assistant-billing.e2e.mjs:18: *      /api/app-assistant` -> exactly TWO new `assistant-chat` rows land in the OWNER's ledger (GET
api/tests/e2e/assistant-billing.e2e.mjs:21: *      is header-scoped and never reads the caller's JWT — app-assistant-route.ts bills
api/tests/e2e/assistant-billing.e2e.mjs:26: *      `POST /api/app-assistant` and adds ZERO new billing rows (the player is client-side).
api/tests/e2e/assistant-billing.e2e.mjs:34: * ledger ROW COUNTS by agentType + billee, the browser-side `POST /api/app-assistant` request
api/tests/e2e/assistant-billing.e2e.mjs:223:    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
api/tests/e2e/assistant-billing.e2e.mjs:238:  assert(r.status === 200, `app-assistant responded ${r.status} for "${text.slice(0, 40)}"`);
api/tests/e2e/assistant-billing.e2e.mjs:335:    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:15: * The player NEVER calls the app-assistant model endpoint - no model turn is
api/assets/bases/app/scaffold/frontend/src/lib/assistant/tour-player.js:49: * same-origin path (e.g. `../app-assistant`), so an unsafe image is SKIPPED, never
api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:7: *   1. POST /api/app-assistant (D1) - the served-app assistant endpoint. It carries
api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:32:const ENDPOINT = '/api/app-assistant';
api/assets/bases/app/scaffold/frontend/src/lib/assistant/AssistantPanel.jsx:260:  // the composer - never auto-sent. No path here calls /api/app-assistant.
api/tests/e2e/assistant-panel.e2e.mjs:15: *      /api/app-assistant carrying the X-Ekoa-App-Id header, the endpoint answers 200 (a REAL model
api/tests/e2e/assistant-panel.e2e.mjs:26: * DOCUMENT (the panel fetches /api/app-assistant and calls window.__ekoaActions.execute itself — no
api/tests/e2e/assistant-panel.e2e.mjs:108:  // panel's own fetch to /api/app-assistant is header-scoped (X-Ekoa-App-Id) and ignores the bearer.
api/tests/e2e/assistant-panel.e2e.mjs:112:  // --- Instrumentation: console errors + the app-assistant POST (request header + response status).
api/tests/e2e/assistant-panel.e2e.mjs:122:    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) {
api/tests/e2e/assistant-panel.e2e.mjs:127:    if (res.request().method() === 'POST' && res.url().includes('/api/app-assistant')) {
api/tests/e2e/assistant-panel.e2e.mjs:171:  assert(assistantReq !== null, 'no POST to /api/app-assistant was observed');
api/tests/e2e/assistant-panel.e2e.mjs:173:  assert(typeof appIdHeader === 'string' && appIdHeader.length > 0, `POST /api/app-assistant missing X-Ekoa-App-Id header (got ${JSON.stringify(appIdHeader)})`);
api/tests/e2e/assistant-panel.e2e.mjs:174:  ok(`C: POST /api/app-assistant fired with X-Ekoa-App-Id=${appIdHeader}`);
api/tests/e2e/assistant-panel.e2e.mjs:175:  assert(assistantStatus === 200, `app-assistant responded ${assistantStatus}, expected 200 (a real turn)`);
api/tests/contract/app-assistant.contract.test.ts:12: * operator-run D1 — contract suite for the served-app assistant endpoint (`POST /api/app-assistant`).
api/tests/contract/app-assistant.contract.test.ts:89:    expect(d.path).toBe('/api/app-assistant');
api/tests/contract/app-assistant.contract.test.ts:101:describe('app-assistant error envelope (D1, CONV-2)', () => {
api/tests/e2e/assistant-modes.e2e.mjs:140: *  admission middleware reads art.data.actionManifest on every /api/app-assistant request, so this
api/tests/e2e/assistant-modes.e2e.mjs:186:    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
api/tests/e2e/assistant-modes.e2e.mjs:192:  assert(resp.status() === 200, `app-assistant responded ${resp.status()} for "${text.slice(0, 40)}"`);
api/assets/bases/app/skills/using-the-assistant-panel.md:17:- Talks to the served-app assistant (`POST /api/app-assistant`): it answers in the

hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
hook: PreToolUse
hook: PreToolUse Completed
mcp: codegraph/codegraph_explore started
mcp: codegraph/codegraph_explore (completed)
codex
The remaining checks are around re-run safety and evidence claims in the notes. I’m verifying whether the “idempotent visitor provisioning” and “hard budget=3” claims hold against the actual auth/user services, not just the probe comments.
hook: PreToolUse
hook: PreToolUse
hook: PreToolUse Completed
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba docs/autothing/runs/20260712-150958-4bb23640/slices/G1/impl-notes.md | sed -n '1,220p'" in /Users/ggomes/dev/ekoa-code
exec
/bin/zsh -lc "nl -ba api/tests/e2e/assistant-billing.e2e.mjs | sed -n '170,520p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   170	  });
   171	  return r.ok;
   172	}
   173	
   174	/** The caller's OWN billing ledger (GET /api/v1/billing/history is actor-scoped). Returns rows;
   175	 *  each row's `type` is the token_events agentType (billing/service.ts historyFor). */
   176	async function ledgerRows(token) {
   177	  const r = await fetch(`${BASE}/api/v1/billing/history`, { headers: { Authorization: `Bearer ${token}` } });
   178	  assert(r.ok, `billing/history ${r.status}`);
   179	  const body = await r.json();
   180	  return (body && body.items) || [];
   181	}
   182	const assistantChatRows = (rows) => rows.filter((x) => x.type === 'assistant-chat');
   183	async function assistantChatCount(token) { return assistantChatRows(await ledgerRows(token)).length; }
   184	
   185	/** GET /api/v1/billing/breakdown (super-admin, platform-wide, grouped by agentType). */
   186	async function billingBreakdown(token) {
   187	  const r = await fetch(`${BASE}/api/v1/billing/breakdown`, { headers: { Authorization: `Bearer ${token}` } });
   188	  assert(r.ok, `billing/breakdown ${r.status}`);
   189	  return ((await r.json()).items) || [];
   190	}
   191	
   192	/**
   193	 * A console-error entry is benign ONLY if it is one of these KNOWN, pre-existing platform /
   194	 * dev-harness failed-resource logs — COPIED VERBATIM from the D2/D3/E2 drivers. None is G1 code;
   195	 * each fires on EVERY served app. Every OTHER console error fails the gate (strict).
   196	 */
   197	function benign(entry) {
   198	  const url = String(entry.url || '');
   199	  const text = String(entry.text || '');
   200	  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
   201	  if (/favicon/i.test(`${url} ${text}`)) return true;
   202	  // 2. Anonymous SSO whoami probe (injected-context.ts:110): window.__ekoa.whoami() GETs
   203	  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
   204	  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
   205	  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
   206	  // 3. Injected health beacon (injected-context.ts:244): POSTs /api/app-health (keepalive) on load;
   207	  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
   208	  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G1 code.
   209	  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
   210	  return false;
   211	}
   212	
   213	// ---------------------------------------------------------------------------------------------
   214	// Panel + tour driving (mirrors D3/E2).
   215	// ---------------------------------------------------------------------------------------------
   216	let llmTurns = 0;
   217	
   218	/** Fire ONE assistant turn through the panel; resolve { status, body }. Counts against LLM_BUDGET. */
   219	async function fireTurn(page, text) {
   220	  if (llmTurns >= LLM_BUDGET) fail(`LLM budget (${LLM_BUDGET}) exhausted before "${text.slice(0, 40)}"`);
   221	  llmTurns += 1;
   222	  const respP = page.waitForResponse(
   223	    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
   224	    { timeout: TURN_TIMEOUT_MS },
   225	  );
   226	  await page.locator('.ekoa-assistant-textarea').fill(text);
   227	  await page.locator('.ekoa-assistant-send').click();
   228	  const resp = await respP;
   229	  let body = null;
   230	  try { body = await resp.json(); } catch { /* non-JSON body */ }
   231	  return { status: resp.status(), body };
   232	}
   233	
   234	/** A metered turn: fire, absorb ONE transient non-200 (budget-permitting), then assert 200 + reply. */
   235	async function meteredTurn(page, text) {
   236	  let r = await fireTurn(page, text);
   237	  if (r.status !== 200 && llmTurns < LLM_BUDGET) r = await fireTurn(page, text);
   238	  assert(r.status === 200, `app-assistant responded ${r.status} for "${text.slice(0, 40)}"`);
   239	  assert(r.body && typeof r.body.reply === 'string' && r.body.reply.trim().length > 0, `empty reply for "${text.slice(0, 40)}"`);
   240	  return r.body;
   241	}
   242	
   243	async function openPanel(page) {
   244	  const launcher = page.locator('.ekoa-assistant-launcher');
   245	  try {
   246	    await launcher.waitFor({ state: 'visible', timeout: 30_000 });
   247	  } catch {
   248	    // The launcher never mounted. Emit a diagnostic that distinguishes an ABSENT/BROKEN panel bundle
   249	    // (e.g. a scaffold snapshotted mid-edit into this build) from a genuine launcher regression, so a
   250	    // rerun reader can tell WHICH without re-driving. Diagnostics only — it changes nothing the gate
   251	    // asserts; it just turns an opaque 30s timeout into an actionable signal.
   252	    const diag = await page
   253	      .evaluate(() => ({
   254	        title: document.title,
   255	        hasEkoaGlobal: typeof window.__ekoa !== 'undefined',
   256	        runtimeInstalledSeen: typeof window.__ekoaActionRuntimeInstalled !== 'undefined',
   257	        assistantEls: Array.from(document.querySelectorAll('[class*="ekoa-assistant"]')).map((n) => n.className).slice(0, 10),
   258	        scriptSrcs: Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 20),
   259	      }))
   260	      .catch(() => null);
   261	    fail(`assistant launcher never mounted (panel bundle absent/broken in this build?). page diagnostic: ${JSON.stringify(diag)}`);
   262	  }
   263	  await launcher.click();
   264	  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
   265	  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
   266	}
   267	
   268	/** Geometry check: the C3 spotlight ring is drawn AROUND the real element carrying
   269	 *  data-demo-target=<name> (proves the highlight matches a real element). Copied from E2. */
   270	async function spotlightSurrounds(page, name) {
   271	  return page.evaluate((n) => {
   272	    const overlay = document.querySelector('[data-ekoa-actions-ui="spotlight"]');
   273	    if (!overlay) return { ok: false, reason: 'no-spotlight-overlay' };
   274	    const ring = overlay.firstElementChild;
   275	    const target = document.querySelector('[data-demo-target="' + n + '"]');
   276	    if (!ring) return { ok: false, reason: 'no-ring' };
   277	    if (!target) return { ok: false, reason: 'no-target' };
   278	    const rr = ring.getBoundingClientRect();
   279	    const tr = target.getBoundingClientRect();
   280	    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
   281	    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
   282	  }, name);
   283	}
   284	
   285	async function advance(page) { await page.locator('.ekoa-assistant-tour-next').click(); }
   286	
   287	async function main() {
   288	  const adminToken = await login(ADMIN.username, ADMIN.password);
   289	  ok('admin login (artifact owner + super-admin for breakdown)');
   290	
   291	  const visitor = await provisionVisitor(adminToken);
   292	  assert(visitor.token, 'visitor provisioning: no token');
   293	  ok(`distinct visitor provisioned + logged in (userId=${visitor.userId}) — drives the panel, must never be billed`);
   294	
   295	  const artifactId = await buildSampleApp(adminToken);
   296	  ok(`fresh app-base app built by admin (owner=admin, artifact=${artifactId})`);
   297	
   298	  // Document-access contrast (zero model cost): a fresh app is an OWNER-ONLY preview — the OWNER
   299	  // sees the served document, the distinct VISITOR gets 410 (proving the visitor is a genuine
   300	  // non-owner principal). We then FEATURE the app so it is shareable and the visitor can load it +
   301	  // drive the panel (the real "published app, other visitor, owner billed" scenario). Reverted in
   302	  // cleanup.
   303	  const docStatus = async (token) => {
   304	    const r = await fetch(`${BASE}/apps/${artifactId}/`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
   305	    return r.status;
   306	  };
   307	  const ownerDoc = await docStatus(adminToken);
   308	  const visitorDocBefore = await docStatus(visitor.token);
   309	  assert(ownerDoc === 200, `owner GET /apps/:id/ -> ${ownerDoc}, expected 200`);
   310	  assert(visitorDocBefore === 410, `visitor GET /apps/:id/ -> ${visitorDocBefore}, expected 410 (non-owner cannot view an unpublished app)`);
   311	  assert(await featureApp(adminToken, artifactId, true), 'PUT /:id/featured{true} failed');
   312	  cleanupFeatured = { adminToken, artifactId };
   313	  const visitorDocAfter = await docStatus(visitor.token);
   314	  assert(visitorDocAfter === 200, `after featuring, visitor GET /apps/:id/ -> ${visitorDocAfter}, expected 200 (shareable)`);
   315	  ok('document-access contrast: owner 200 / non-owner 410 unpublished; featured -> visitor 200 (visitor is a genuine non-owner who can now drive the shared app)');
   316	
   317	  const routeProbe = await fetch(`${BASE}/api/demos/${artifactId}`);
   318	  assert(routeProbe.status === 404 || routeProbe.status === 200, `GET /api/demos/:appId returned ${routeProbe.status}`);
   319	  ok(`tour serving route live (GET /api/demos/:appId -> ${routeProbe.status})`);
   320	
   321	  // --- Browser: the context is authenticated as the VISITOR (a distinct, non-owner principal). ---
   322	  const browser = await chromium.launch();
   323	  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${visitor.token}` } });
   324	  const page = await context.newPage();
   325	
   326	  const consoleErrors = [];
   327	  page.on('console', (msg) => {
   328	    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
   329	  });
   330	  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));
   331	
   332	  // Count EVERY assistant model POST for the whole session — the client-side "free" proof.
   333	  let assistantPosts = 0;
   334	  page.on('request', (req) => {
   335	    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
   336	  });
   337	
   338	  // Deterministic served tour: fulfil GET /api/demos/:appId with the schema-valid overview fixture.
   339	  await page.route('**/api/demos/**', (route) =>
   340	    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) }),
   341	  );
   342	
   343	  const appUrl = `${BASE}/apps/${artifactId}/`;
   344	  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
   345	
   346	  // Plant both landmarks as direct children of <body> (React never reclaims them — C5/D3/E2 technique):
   347	  // the tour target, and a setField wrapper+input for the registry-only action. CRITICAL:
   348	  // `pointer-events:none` makes these fixed overlays CLICK-THROUGH — they sit at the top-left where
   349	  // they can overlap the real app-nav, and without this their subtree would intercept the tour's
   350	  // step-4 click on the real app-nav button. It does NOT affect the assertions: setField writes the
   351	  // input value programmatically (not via a click) and the spotlight geometry reads getBoundingClientRect.
   352	  await page.evaluate(({ tourTarget, regTarget }) => {
   353	    if (!document.querySelector('[data-demo-target="' + tourTarget + '"]')) {
   354	      const el = document.createElement('div');
   355	      el.setAttribute('data-demo-target', tourTarget);
   356	      el.style.cssText = 'position:fixed;top:8px;left:8px;width:200px;height:36px;z-index:1;background:#fff;border:1px solid #ccc;pointer-events:none;';
   357	      document.body.appendChild(el);
   358	    }
   359	    if (!document.querySelector('[data-demo-target="' + regTarget + '"]')) {
   360	      const wrap = document.createElement('div');
   361	      wrap.setAttribute('data-demo-target', regTarget);
   362	      wrap.style.cssText = 'position:fixed;top:52px;left:8px;width:220px;height:38px;z-index:1;background:#fff;border:1px solid #ccc;pointer-events:none;';
   363	      const input = document.createElement('input');
   364	      input.id = 'g1-set-input';
   365	      input.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
   366	      wrap.appendChild(input);
   367	      document.body.appendChild(wrap);
   368	    }
   369	  }, { tourTarget: TOUR_TARGET, regTarget: REG_TARGET });
   370	
   371	  await openPanel(page);
   372	  ok('panel opened as the visitor; same-document C3 action runtime installed');
   373	
   374	  // ============================================================================================
   375	  // 1. REGISTRY-ONLY ACTION IS FREE. Dispatch a setField through window.__ekoaActions.execute (the
   376	  //    C3 runtime the panel itself uses). It runs entirely in-page: the field changes, the promise
   377	  //    resolves 'done', and NO model POST fires + NO billing row lands.
   378	  // ============================================================================================
   379	  const ownerBeforeReg = await assistantChatCount(adminToken);
   380	  const postsBeforeReg = assistantPosts;
   381	  await page.evaluate(({ target, value }) => {
   382	    document.getElementById('g1-set-input').value = '';
   383	    window.__g1SetResult = null;
   384	    window.__ekoaActions
   385	      .execute({ id: 'g1-set', kind: 'setField', labelPt: 'Preencher', description: 'x', target, params: { valor: value } })
   386	      .then((r) => { window.__g1SetResult = r; });
   387	  }, { target: REG_TARGET, value: REG_VALUE });
   388	  await page.waitForFunction(() => window.__g1SetResult && window.__g1SetResult.status === 'done', { timeout: 8_000 });
   389	  const regField = await page.evaluate(() => document.getElementById('g1-set-input').value);
   390	  assert(regField.includes(REG_VALUE), `registry setField did not drive the field: "${regField}"`);
   391	  assert(assistantPosts === postsBeforeReg, `registry action fired ${assistantPosts - postsBeforeReg} assistant POST(s) — must be zero`);
   392	  const ownerAfterReg = await assistantChatCount(adminToken);
   393	  assert(ownerAfterReg === ownerBeforeReg, `registry action added ${ownerAfterReg - ownerBeforeReg} owner billing row(s) — must be zero`);
   394	  await page.screenshot({ path: join(EVID, 'live-01-registry-action.png') });
   395	  ok(`REGISTRY: setField ran in-page (field -> "${regField}"); zero assistant POSTs; zero new owner billing rows`);
   396	
   397	  // ============================================================================================
   398	  // 2. TOUR PLAYBACK IS FREE. Play the FULL overview tour through the E2 teach launcher and assert
   399	  //    zero model POSTs + zero new billing rows across the whole playback.
   400	  // ============================================================================================
   401	  const ownerBeforeTour = await assistantChatCount(adminToken);
   402	  const postsBeforeTour = assistantPosts;
   403	  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
   404	  const startBtn = page.locator('.ekoa-assistant-tour-start');
   405	  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
   406	  await startBtn.click();
   407	  const tour = page.locator('.ekoa-assistant-tour');
   408	  await tour.waitFor({ state: 'visible', timeout: 10_000 });
   409	
   410	  // Step 1 (navigate "Bem-vindo").
   411	  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
   412	  await advance(page);
   413	  // Step 2 (spotlight app-nav — a rebuild-stable shell landmark).
   414	  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
   415	  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
   416	  let geo = await spotlightSurrounds(page, 'app-nav');
   417	  assert(geo.ok, `spotlight did not surround app-nav: ${JSON.stringify(geo)}`);
   418	  await advance(page);
   419	  // Step 3 (spotlight the planted tour target).
   420	  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
   421	  geo = await spotlightSurrounds(page, TOUR_TARGET);
   422	  assert(geo.ok, `spotlight did not surround ${TOUR_TARGET}: ${JSON.stringify(geo)}`);
   423	  await advance(page);
   424	  // Step 4 (await-action app-nav click — advances only on a real click).
   425	  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
   426	  await page.locator('[data-demo-target="app-nav"] button').first().click();
   427	  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });
   428	  // Step 5 (spotlight app-content).
   429	  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
   430	  geo = await spotlightSurrounds(page, 'app-content');
   431	  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
   432	  await advance(page);
   433	  // Step 6 (inject-prompt — the suggestion lands in the composer, unsent).
   434	  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
   435	  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
   436	  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
   437	  await advance(page);
   438	  // Done.
   439	  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
   440	  await page.screenshot({ path: join(EVID, 'live-02-tour-done.png') });
   441	
   442	  assert(assistantPosts === postsBeforeTour, `tour playback fired ${assistantPosts - postsBeforeTour} assistant POST(s) — tours must be zero-token`);
   443	  const ownerAfterTour = await assistantChatCount(adminToken);
   444	  assert(ownerAfterTour === ownerBeforeTour, `tour playback added ${ownerAfterTour - ownerBeforeTour} owner billing row(s) — must be zero`);
   445	  ok('TOUR: full overview tour reached "concluído"; zero assistant POSTs; zero new owner billing rows (client-side, zero-token)');
   446	
   447	  // Close the tour so the composer is clear for the metered turns.
   448	  await page.locator('.ekoa-assistant-tour-close').click();
   449	  await page.locator('.ekoa-assistant-textarea').waitFor({ state: 'visible', timeout: 10_000 });
   450	
   451	  // ============================================================================================
   452	  // 3. METERED + ATTRIBUTED. N=2 real assistant turns (driven by the VISITOR) -> exactly TWO new
   453	  //    'assistant-chat' rows in the OWNER's ledger with tokens>0; the VISITOR's ledger unchanged.
   454	  // ============================================================================================
   455	  const ownerBefore = await assistantChatCount(adminToken);
   456	  const visitorBefore = await assistantChatCount(visitor.token);
   457	  for (let i = 0; i < TURNS.length; i++) {
   458	    const body = await meteredTurn(page, TURNS[i]);
   459	    ok(`turn ${i + 1}/2 fired (200, mode="${body.mode}", reply ${body.reply.length} chars)`);
   460	  }
   461	  await page.screenshot({ path: join(EVID, 'live-03-metered-turns.png') });
   462	
   463	  const ownerRowsAfter = assistantChatRows(await ledgerRows(adminToken));
   464	  const ownerAfter = ownerRowsAfter.length;
   465	  const visitorAfter = await assistantChatCount(visitor.token);
   466	  assert(ownerAfter - ownerBefore === TURNS.length, `owner gained ${ownerAfter - ownerBefore} assistant-chat rows, expected exactly ${TURNS.length}`);
   467	  assert(visitorAfter - visitorBefore === 0, `visitor (the caller) gained ${visitorAfter - visitorBefore} assistant-chat rows — must be ZERO (owner is the billee)`);
   468	  // The two NEW rows (history is newest-first) each carry metered tokens > 0.
   469	  const newRows = ownerRowsAfter.slice(0, TURNS.length);
   470	  for (const row of newRows) {
   471	    assert(row.type === 'assistant-chat', `new owner row type "${row.type}", expected "assistant-chat"`);
   472	    assert(typeof row.tokens === 'number' && row.tokens > 0, `new owner assistant-chat row metered ${row.tokens} tokens, expected > 0`);
   473	  }
   474	  // Ties the ledger rows to browser-issued turns: every POST since the tour is a turn we fired
   475	  // (the tour + registry fired none), so the count equals llmTurns (== TURNS.length, or +1 if a
   476	  // transient non-200 was retried — a retried failure writes NO ledger row, so owner still gained
   477	  // exactly TURNS.length rows above).
   478	  assert(assistantPosts - postsBeforeTour === llmTurns, `assistant POSTs since the tour (${assistantPosts - postsBeforeTour}) != turns fired (${llmTurns})`);
   479	  ok(`METERED: ${TURNS.length} visitor-driven turns -> exactly ${TURNS.length} new 'assistant-chat' rows on the OWNER ledger (tokens=${newRows.map((r) => r.tokens).join(',')}); VISITOR ledger unchanged (billed to owner, NOT the caller)`);
   480	
   481	  // ============================================================================================
   482	  // 4. BREAKDOWN carries the assistant-chat agentType with tokens > 0.
   483	  // ============================================================================================
   484	  const breakdown = await billingBreakdown(adminToken);
   485	  const acLine = breakdown.find((x) => x.agentType === 'assistant-chat');
   486	  assert(acLine && acLine.tokens > 0, `breakdown missing assistant-chat with tokens>0: ${JSON.stringify(breakdown)}`);
   487	  ok(`BREAKDOWN: /billing/breakdown groups an 'assistant-chat' line (tokens=${acLine.tokens})`);
   488	
   489	  // ============================================================================================
   490	  // 5. ZERO non-benign page JS console errors throughout.
   491	  // ============================================================================================
   492	  const errors = consoleErrors.filter((e) => !benign(e));
   493	  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
   494	  ok('zero non-benign page JS console errors throughout');
   495	
   496	  await browser.close();
   497	
   498	  // Cleanup: revert the temporary featuring so the test app returns to its owner-only state.
   499	  if (cleanupFeatured) {
   500	    const reverted = await featureApp(cleanupFeatured.adminToken, cleanupFeatured.artifactId, false);
   501	    cleanupFeatured = null;
   502	    ok(`test app un-featured (cleanup ${reverted ? 'ok' : 'FAILED — revert manually'})`);
   503	  }
   504	
   505	  console.log('G1 LIVE GATE: PASS');
   506	}
   507	
   508	main()
   509	  .then(() => process.exit(0))
   510	  .catch(async (e) => {
   511	    // Best-effort cleanup on ANY failure: never leave the test app publicly featured.
   512	    if (cleanupFeatured) {
   513	      try { await featureApp(cleanupFeatured.adminToken, cleanupFeatured.artifactId, false); } catch { /* best effort */ }
   514	    }
   515	    console.error(`E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
   516	    process.exit(1);
   517	  });

 succeeded in 0ms:
     1	# G1 — Assistant metering + billing-truth probe extension (tours/registry provably free)
     2	
     3	Kind: api · Size: 3 · Dep: D1 (passed) · Branch: `operator-run`
     4	Status: **LIVE GATE PENDING RESUME** (paused by the lead mid-run for an unrelated scaffold-edit collision; see §6). Proof slice — **no production code change**.
     5	
     6	## 1. What G1 proves (acceptance)
     7	
     8	D1 already meters the served-app assistant: `POST /api/app-assistant` runs one model call through the llm/ chokepoint one-shot, metered + attributed to the RESOLVED ARTIFACT OWNER (`agentType: 'assistant-chat'`, a UserWorkAgentType), never the anonymous visitor. G1 does **not** re-implement any of that — it PROVES it live and extends the journeys' billing-truth reconciliation (actions-log vs `GET /api/v1/billing/history`) to the assistant plane, with four claims:
     9	
    10	1. **Metered + attributed to the owner, not the caller.** N=2 real assistant turns -> exactly TWO new `assistant-chat` rows in the OWNER's ledger with metered tokens > 0, while the driving VISITOR's ledger gains ZERO.
    11	2. **Breakdown.** `GET /api/v1/billing/breakdown` (super-admin, grouped by `agentType`) now carries an `assistant-chat` line with tokens > 0.
    12	3. **Tour playback is free.** A full overview tour played through the E2 teach launcher fires ZERO `POST /api/app-assistant` and adds ZERO new billing rows.
    13	4. **Registry-only actions are free.** A registry action dispatched through `window.__ekoaActions.execute` runs entirely in-page — ZERO model POSTs, ZERO new billing rows.
    14	
    15	Deliverable driver: `api/tests/e2e/assistant-billing.e2e.mjs` (committed, re-runnable; modeled on the D3 driver `assistant-modes.e2e.mjs` + the E2 driver `tour-playback.e2e.mjs`).
    16	
    17	## 2. Ground truth (verified by reading the code, before writing the probe)
    18	
    19	- **agentType string** = `assistant-chat`. `api/src/apps/app-assistant.ts:280-285` builds the attribution `{ kind:'user_work', agentType:'assistant-chat', billeeUserId: input.owner.userId, artifactId: input.artifactId }` and passes it to the injected `deps.oneShot` (`:287`). This is the ONLY model egress in the turn — `deps.ground` (grounding) and `deps.decide` (`decideForTask(..., 'WORKHORSE')`) are both SYNCHRONOUS/pure (no model call, no billing). So **one turn -> exactly one metered row**; there is no memory-extract or secondary metered call on this path (unlike hosted chat).
    20	- **Owner is server-resolved, caller is never read.** `api/src/apps/app-assistant-route.ts` is HEADER-SCOPED (`POST /api/app-assistant`, no `requireAuth`). The owner comes from `X-Ekoa-App-Id -> resolveApp -> ownerUserId` (`:70-111`); billing is billed to `admission.owner.userId` (the allowance gate `:124` and the metering attribution). The endpoint NEVER reads the caller's JWT — so "billed to owner, not the visitor" holds by construction. G1 makes it observable by driving the panel as a DISTINCT visitor.
    21	- **Ledger surfaces.** `token_events` rows carry `agentType` (`api/src/billing/tracker.ts:47,194`) and are single-writer (only the chokepoint records). `GET /api/v1/billing/history` is actor-scoped (`api/src/routes/billing.ts:38-42` -> `historyFor(actorOf(req).userId)`; `service.ts:77-93` exposes each row's `agentType` as `type` and `metered` as `tokens`). `GET /api/v1/billing/breakdown` is super-admin, platform-wide, grouped by `agentType` (`billing.ts:60-62`; `service.ts:99-112`).
    22	- **Admin is a super-admin** (`api/src/auth/service.ts:57-72` seeds role `super-admin`) — so `/breakdown` is readable with the admin token.
    23	- **Serving is public** (`api/src/apps/serving.ts:435` "ALL public") and **new users are active** (`api/src/auth/users-service.ts:39` `setActivation(id,{active:true,...})`) — so a distinct visitor can drive the served app, and the owner-activation admission gate passes.
    24	
    25	**No attribution gap found.** The metering + attribution path is correct and complete in static review; per the slice contract this is a proof slice with NO production code change and NO contract test needed. `api/src/billing/**` was reserved contingently and left untouched.
    26	
    27	## 3. Probe design + rationale
    28	
    29	- **Owner = admin** (builds the app, so `artifact.userId = admin`). This follows the proven D3/E2 build pattern (guaranteed-activated owner) and keeps the metered assertion clean: at baseline admin has **0** `assistant-chat` rows (verified — see §5), so a delta of exactly 2 is unambiguous. The metered assertion filters on `type === 'assistant-chat'` specifically (admin's ledger already holds ~92 rows of other agentTypes from builds), so it is immune to concurrent non-assistant billing.
    30	- **Caller = a distinct visitor.** The browser context is authenticated as a separate, non-owner builder user (`g1-visitor`). Because the endpoint ignores the caller identity, this makes billing-truth OBSERVABLE on two separate ledgers: owner +2, visitor +0. Provisioning is idempotent (`tryLogin` first; create org+user only if absent) so re-runs on the same boot never duplicate.
    31	- **Ordering: registry -> tour -> metered.** The two zero-cost (LLM-free) claims run FIRST, so the N=2 assistant budget is only spent once the panel is proven healthy. A broken panel/tour therefore fails BEFORE any real turn is burned (which is exactly what happened in the first run — §6).
    32	- **Determinism.** Every assertion is STRUCTURAL: ledger row counts by agentType + billee, the browser-side `POST /api/app-assistant` request counter (client-side proof that playback/registry issue no model call), and the C3 runtime's own result status / DOM effect. The served tour is the same schema-valid `e2-overview-tour.json` fixture E2 uses, fulfilled at the browser boundary (`page.route`) — the only stub QA permits. The two metered turns are plain informational PT-PT prompts (no operate surface needed; metering fires on the one-shot regardless of whether the turn proposes actions).
    33	- **Budget cap.** A hard `LLM_BUDGET = 3` ceiling: 2 turns + at most one transient non-200 retry. `fireTurn` refuses to exceed it.
    34	- **Console gate** copied VERBATIM from the D2/D3/E2 drivers: favicon 404 + anonymous whoami 401 (`/api/app-sso/me`) + dev-proxy app-health 5xx. The lead's "two documented allowlists" are the two app-specific platform behaviours (whoami 401 + app-health 5xx); the favicon 404 is the universal served-app 404 already allowlisted by every sibling driver, so it is included to match the proven, passing allowlist ("copy from the D2 driver").
    35	- **Driver hardening (added while paused):** `openPanel` now, on a launcher-mount timeout, dumps a page diagnostic (ekoa globals present? runtime installed? which `ekoa-assistant` elements exist? script srcs) and fails with an actionable message — so a rerun reader can tell an ABSENT/BROKEN panel bundle (e.g. a scaffold snapshotted mid-edit) from a genuine launcher regression, without re-driving.
    36	
    37	## 4. Commands run + results
    38	
    39	| Step | Command | Result |
    40	|---|---|---|
    41	| Stack liveness | `curl POST /api/v1/auth/login {admin}` | HTTP 200 (stack up: api :4211, proxy :4111, web :3000) |
    42	| Syntax | `node --check api/tests/e2e/assistant-billing.e2e.mjs` | OK (before + after hardening) |
    43	| Tooling | `command -v asciinema`; `import('playwright')` | both available |
    44	| Non-LLM plumbing smoke (scratchpad `g1-smoke.mjs`) | admin login / visitor provision / ledger reads / breakdown | all green (see §5) |
    45	| **Live probe (asciinema)** | `node tests/e2e/assistant-billing.e2e.mjs` | **FAILED at openPanel** (external cause — §6) |
    46	
    47	## 5. Static smoke test (non-LLM plumbing) — all green
    48	
    49	Ran a scratchpad script against the live stack to de-risk every HTTP shape BEFORE spending a build/turn:
    50	
    51	- admin login 200; admin is super-admin (`/billing/breakdown` -> 200).
    52	- visitor provisioning: `POST /orgs` 201, `POST /users` 201 (role builder, `active:true`), visitor login 200; `GET /auth/me` returns `{id,...}`.
    53	- visitor `GET /billing/history` -> 200, 0 items, 0 `assistant-chat`.
    54	- admin `GET /billing/history` -> 200, 92 items, **0 `assistant-chat`** (other agentTypes present: `memory-extract`, `pi-fast-loop`, `build`, `classify-in-build-intent`). Row shape: `{id,type,amountUsd,createdAt,description,tokens}`.
    55	- admin `GET /billing/breakdown` -> 200, 4 agentTypes, no `assistant-chat` yet.
    56	
    57	=> confirms the metered assertion is unambiguous (admin baseline `assistant-chat` = 0; expect exactly 2 after the run) and the visitor-ledger-unchanged assertion is meaningful.
    58	
    59	## 6. First live run — FAILED at panel-open (external, paused by lead). Token budget intact.
    60	
    61	`live-output.txt` / `evidence-live.cast` (both in this dir):
    62	
    63	```
    64	PASS admin login (artifact owner + super-admin for breakdown)
    65	PASS distinct visitor provisioned + logged in (userId=14fb2aca-...) — drives the panel, must never be billed
    66	PASS fresh app-base app built by admin (owner=admin, artifact=3a4be859-5426-4d70-8f22-c5f3363fcd39)
    67	PASS tour serving route live (GET /api/demos/:appId -> 404)
    68	E2E FAIL: locator.waitFor: Timeout 30000ms exceeded.
    69	  - waiting for locator('.ekoa-assistant-launcher') to be visible
    70	    at openPanel (assistant-billing.e2e.mjs)
    71	```
    72	
    73	**Cause (per lead, not my bug):** the E2 worker was concurrently rewriting the scaffold panel files (`AssistantPanel.jsx` / `tour-player.js`) for a review-fix batch. A fresh app build snapshots the scaffold at build time, so artifact `3a4be859` baked in a mid-edit, transiently broken panel — the launcher never mounted. The lead paused the live probe and will send RESUME LIVE once E2's fix batch is complete and statically green.
    74	
    75	**Token budget honesty:**
    76	- **Assistant (LLM) turns burned: 0.** The probe fires the N=2 metered turns LAST (after the registry action + full tour); it died at `openPanel`, before any turn. `grep "turn ... fired" live-output.txt` = 0.
    77	- **Build cycles spent: 1** (artifact `3a4be859`, billed to admin as `build`/related agentTypes — NOT part of the N=2 assistant budget). This artifact is considered POISONED (mid-edit scaffold) and will be discarded; RESUME will build a FRESH artifact.
    78	
    79	## 7. On RESUME LIVE (remaining work)
    80	
    81	1. Build a FRESH app (new artifactId — do NOT reuse `3a4be859`).
    82	2. Run `node api/tests/e2e/assistant-billing.e2e.mjs` under asciinema (overwrites `evidence-live.cast` + `live-output.txt`).
    83	3. Green = the four PASS blocks (metered owner +2 / visitor +0, breakdown, tour-free, registry-free) + the console gate + final line `G1 LIVE GATE: PASS`.
    84	4. Update this file's §4/§6 with the green output and flip the status to PASS.
    85	
    86	## 8. Suite-ledger note (flagged, NOT edited — outside reserved paths)
    87	
    88	`scripts/suite-ledger-run.mjs` censuses every `api/tests/e2e/*.e2e.mjs` on disk against `SUITE_LEDGER.json` `node_drivers.drivers` (a count-match in both directions). Disk now has **19** `.e2e.mjs` (my new driver makes it the 20th on RESUME... it is already present -> 19 total counting it), but the ledger lists **14**. The four sibling operator-run drivers (`action-registry`/C5, `assistant-panel`/D2, `assistant-modes`/D3, `tour-playback`/E2) are ALSO unregistered — i.e. the operator-run drivers are reconciled into the ledger in a BATCH (by the lead at gate time), not self-registered per slice, and this census is already red on the branch independently of G1.
    89	
    90	Per the constraint "do not edit anything outside reserved paths; flag the reason first", I did **not** touch `SUITE_LEDGER.json`. When the lead reconciles the ledger, my entry (matching the minimal `{name,targetGate,note?}` schema) is:
    91	
    92	```json
    93	{ "name": "assistant-billing", "targetGate": "G1", "note": "operator-run G1: assistant metering + billing-truth live probe (owner-billed, visitor-free, tour+registry zero-token)" }
    94	```
    95	
    96	(and the 4 sibling operator-run drivers need entries too, for the census to go green).
    97	
    98	## 9. Constraints honored
    99	
   100	- No security/auth/permission logic touched (H block).
   101	- Egress chokepoint untouched.
   102	- No production code change (proof slice; no attribution gap found).
   103	- No diagram change — this is a proof slice; it alters no structure, flow, or data shape (the diagram invariant does not apply). Stated explicitly per the delegation.
   104	- PT-PT: the two turn prompts are PT-PT; no new user-facing strings.
   105	- Reserved paths only: created `api/tests/e2e/assistant-billing.e2e.mjs`; wrote `slices/G1/**`; left `api/src/billing/**` untouched (no gap). Did not commit (lead runs the gates).
   106	- Real-token discipline: 0 assistant turns on the failed run; budget cap `LLM_BUDGET=3` enforced in the driver.

hook: PreToolUse
hook: PreToolUse Completed
exec
/bin/zsh -lc "nl -ba api/src/llm/client.ts | sed -n '880,905p'; printf '\\n'; nl -ba api/src/auth/users-service.ts | sed -n '19,41p'; printf '\\n'; nl -ba api/src/auth/service.ts | sed -n '75,97p'; printf '\\n'; nl -ba api/src/billing/service.ts | sed -n '73,112p'" in /Users/ggomes/dev/ekoa-code
 succeeded in 0ms:
   880	      prompt: promptAnon.text,
   881	      model: decision.model,
   882	      effort: decision.effort,
   883	      env,
   884	      systemPrompt: systemAnon?.text,
   885	      images: opts.images,
   886	      cwd: sandbox,
   887	      disallowedTools: ['*'], // no tools on a one-shot
   888	      // Tool-less, so >1 turn is only a model continuation (observed live 2026-07-11: an
   889	      // EXPERT thinking run needs a second turn to emit the text after a thinking-heavy
   890	      // first turn — maxTurns:1 made the SDK error with "Reached maximum number of turns").
   891	      // A small ceiling keeps the runaway-loop guarantee.
   892	      maxTurns: 3,
   893	      signal: opts.signal,
   894	    });
   895	    // Bill the reported usage even on abort (P-19), THEN reject abort as abort.
   896	    const metered = await meter(attribution, decision.tier, decision.model, res.usage);
   897	    recordSpend({ ...capKey, metered }); // accrue the admitted call's spend (§6.6.4)
   898	    const text = deanonymize(res.text, promptAnon.handle);
   899	    if (res.aborted) throw new LlmAbortedError();
   900	    return { text, usage: res.usage };
   901	  } finally {
   902	    discardSandbox(sandbox); // F25: the per-run sandbox never outlives the run
   903	    // Clear the ephemeral vault on EVERY exit - success, transport error, or abort (§17.5, Codex
   904	    // checkpoint M1): the re-identification key must not linger to TTL after a failed call.
   905	    if (sk.ephemeral) endSession(promptAnon.handle);

    19	export async function createUser(
    20	  input: { username: string; password: string; role: UserDoc['role']; orgId?: string },
    21	  deps: Deps,
    22	): Promise<{ ok: true; user: AuthUserView } | { ok: false; reason: 'taken' }> {
    23	  let orgId = input.orgId;
    24	  if (!orgId) {
    25	    orgId = deps.genId();
    26	    await orgs.insert({ _id: orgId, name: input.username, createdAt: new Date(deps.now()).toISOString() });
    27	  }
    28	  const id = deps.genId();
    29	  const inserted = await users.insert({
    30	    _id: id,
    31	    username: input.username,
    32	    passwordHash: await hashPassword(input.password),
    33	    role: input.role,
    34	    orgId,
    35	    active: true,
    36	    passwordChangeRequired: true,
    37	  });
    38	  if (!inserted) return { ok: false, reason: 'taken' };
    39	  setActivation(id, { active: true, billingLocked: false });
    40	  return { ok: true, user: authUserView((await users.get(id)) as UserDoc) };
    41	}

    75	export async function login(username: string, password: string, rememberMe: boolean, deps: Deps): Promise<{ token: string; user: AuthUserView; passwordChangeRequired: boolean; expiresIn: number }> {
    76	  const matches = await users.find({ username });
    77	  const u = matches[0];
    78	  if (!u || !(await verifyPassword(password, u.passwordHash))) {
    79	    throw new AuthError('UNAUTHENTICATED', 401, 'Credenciais inválidas.');
    80	  }
    81	  // Deactivated accounts cannot mint a token (ACCOUNT_DISABLED). Check the AUTHORITATIVE
    82	  // store field (login holds the row — no cache-miss window) and sync the write-through
    83	  // map so the middleware is consistent. A billing lock does NOT block login — the account
    84	  // authenticates and is refused per-request at the admission plane (middleware) with
    85	  // BILLING_LOCKED (ch09 §9.7.1); that lock is preserved in the map from its cached value.
    86	  const cached = getActivation(u._id);
    87	  setActivation(u._id, { active: u.active, billingLocked: cached?.billingLocked ?? false });
    88	  if (!u.active) throw new AuthError('ACCOUNT_DISABLED', 403, 'A sua conta está bloqueada. Contacte o suporte.');
    89	  const { token, expiresIn } = signToken(
    90	    { sub: u._id, role: u.role, scope: 'user', orgId: u.orgId, username: u.username, jti: `${u._id}.${deps.genId()}`, iat: mintIat(u._id) },
    91	    rememberMe,
    92	  );
    93	  // Registo (F3): a login is an org-visible activity — metadata-only, never the password. The
    94	  // single audit write path (FIXED-8); best-effort so a bookkeeping write never fails a login.
    95	  await logActivity({ userId: u._id, username: u.username, orgId: u.orgId }, 'auth', 'login', deps, { rememberMe }).catch(() => undefined);
    96	  return { token, user: view(u), passwordChangeRequired: !!u.passwordChangeRequired, expiresIn };
    97	}

    73	/**
    74	 * GET /billing/history (§3.8.21). The user's ledger events as transaction rows validating the
    75	 * shared `BillingHistoryEntry` shape. Newest first; paginated by the router.
    76	 */
    77	export async function historyFor(userId: string, opts: { limit?: number; offset?: number } = {}) {
    78	  const rows = (await tokenEvents.find({ billeeUserId: userId }, { timestamp: -1 })) as Array<
    79	    Doc & { agentType?: string; metered?: number; timestamp?: number }
    80	  >;
    81	  const total = rows.length;
    82	  const offset = opts.offset ?? 0;
    83	  const page = rows.slice(offset, offset + (opts.limit ?? total));
    84	  const items = page.map((e) => ({
    85	    id: e._id,
    86	    type: e.agentType ?? 'unknown',
    87	    amountUsd: 0,
    88	    createdAt: new Date(e.timestamp ?? 0).toISOString(),
    89	    description: `${e.metered ?? 0} tokens`,
    90	    tokens: e.metered ?? 0,
    91	  }));
    92	  return { items, total };
    93	}
    94	
    95	/**
    96	 * GET /billing/breakdown (§3.8.21, super-admin): group the ledger by `agentType` (§6.3 rule 4).
    97	 * Platform-wide across all billees, matching the super-admin usage page the endpoint mounts on.
    98	 */
    99	export async function breakdownFor() {
   100	  const rows = (await tokenEvents.find({})) as Array<Doc & { agentType?: string; metered?: number }>;
   101	  const byAgent = new Map<string, number>();
   102	  let total = 0;
   103	  for (const e of rows) {
   104	    const m = e.metered ?? 0;
   105	    byAgent.set(e.agentType ?? 'unknown', (byAgent.get(e.agentType ?? 'unknown') ?? 0) + m);
   106	    total += m;
   107	  }
   108	  const items = Array.from(byAgent.entries())
   109	    .map(([agentType, tokens]) => ({ agentType, tokens, percentage: total > 0 ? (tokens / total) * 100 : 0 }))
   110	    .sort((a, b) => b.tokens - a.tokens);
   111	  return { items };
   112	}

hook: PreToolUse
hook: PreToolUse Completed
The attribution path is verified: `POST /api/app-assistant` resolves owner from `X-Ekoa-App-Id` and `runAppAssistant` bills `assistant-chat` to `input.owner.userId`. The remaining work is packaging the concrete review findings and verdict.
  ✓ Load repo guidance files and commit contents relevant to the review
  ✓ Trace owner-attribution and billing-write paths in source
  ✓ Inspect the new e2e probe assertions and evidence for false positives or gaps
  → Summarize findings with severity, file:line, and final verdict
codex
1. High – the core “owner +2 / visitor +0” proof is not isolated to this artifact’s traffic, so it can pass on unrelated admin ledger rows. The probe reads the owner ledger as “all `assistant-chat` rows for admin”, then only checks the count delta and the newest two rows. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:455) [api/src/billing/service.ts](/Users/ggomes/dev/ekoa-code/api/src/billing/service.ts:77) On the shared stack, if another run or human fires two assistant turns on a different admin-owned artifact between `ownerBefore` and `ownerRowsAfter`, this test still goes green even if this app’s turns were mis-attributed or never billed. The same problem weakens the breakdown check, because `/billing/breakdown` is platform-wide and non-delta. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:484) [api/src/billing/service.ts](/Users/ggomes/dev/ekoa-code/api/src/billing/service.ts:99)

2. Medium – the claimed hard budget of “3 real model calls total” is false. The driver caps HTTP turn attempts at 3, but each `runOneShot` can internally continue for up to 3 SDK/model turns via `maxTurns: 3`. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:58) [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:218) [api/src/llm/client.ts](/Users/ggomes/dev/ekoa-code/api/src/llm/client.ts:888) In the concrete worst case, 2 probe turns plus 1 retry can burn 9 provider turns, not 3, so the proof slice’s “real-token discipline” evidence is overstated.

3. Medium – `provisionVisitor()` is not actually idempotent on a dirty shared stack. It only short-circuits when `tryLogin(username,password)` succeeds; if an old `g1-visitor` exists with a changed password or deactivated account, the probe falls through to create another same-username user. `createUser()` does not enforce username uniqueness, and `login()` later just uses `matches[0]`, so reruns can accumulate duplicate `g1-visitor` rows and become flaky or fail permanently depending on which row `find({ username })` returns first. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:119) [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:19) [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:75)

4. Medium – the “tour playback is free” and “registry-only action is free” assertions do not prove “zero new ledger rows”; they only prove zero `/api/app-assistant` POSTs and zero new owner `assistant-chat` rows. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:379) [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:401) If those flows ever regress to bill the visitor, or bill under a different `agentType` without hitting `/api/app-assistant`, this slice still passes while the stated property is false.

5. Low – the console allowlist is broader than the documented favicon 404. `if (/favicon/i.test(\`\${url} \${text}\`))` suppresses any console error whose text merely mentions “favicon”. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:197) A real app error like `ReferenceError: faviconConfig is undefined` would be silently allowlisted.

I did verify the attribution path itself: [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:70) resolves `ownerUserId` from `X-Ekoa-App-Id`, and [api/src/apps/app-assistant.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant.ts:280) bills `assistant-chat` to `input.owner.userId`; the caller JWT is not consulted on that path.

NEEDS-WORK
hook: Stop
hook: Stop Completed
tokens used
128,162
1. High – the core “owner +2 / visitor +0” proof is not isolated to this artifact’s traffic, so it can pass on unrelated admin ledger rows. The probe reads the owner ledger as “all `assistant-chat` rows for admin”, then only checks the count delta and the newest two rows. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:455) [api/src/billing/service.ts](/Users/ggomes/dev/ekoa-code/api/src/billing/service.ts:77) On the shared stack, if another run or human fires two assistant turns on a different admin-owned artifact between `ownerBefore` and `ownerRowsAfter`, this test still goes green even if this app’s turns were mis-attributed or never billed. The same problem weakens the breakdown check, because `/billing/breakdown` is platform-wide and non-delta. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:484) [api/src/billing/service.ts](/Users/ggomes/dev/ekoa-code/api/src/billing/service.ts:99)

2. Medium – the claimed hard budget of “3 real model calls total” is false. The driver caps HTTP turn attempts at 3, but each `runOneShot` can internally continue for up to 3 SDK/model turns via `maxTurns: 3`. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:58) [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:218) [api/src/llm/client.ts](/Users/ggomes/dev/ekoa-code/api/src/llm/client.ts:888) In the concrete worst case, 2 probe turns plus 1 retry can burn 9 provider turns, not 3, so the proof slice’s “real-token discipline” evidence is overstated.

3. Medium – `provisionVisitor()` is not actually idempotent on a dirty shared stack. It only short-circuits when `tryLogin(username,password)` succeeds; if an old `g1-visitor` exists with a changed password or deactivated account, the probe falls through to create another same-username user. `createUser()` does not enforce username uniqueness, and `login()` later just uses `matches[0]`, so reruns can accumulate duplicate `g1-visitor` rows and become flaky or fail permanently depending on which row `find({ username })` returns first. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:119) [api/src/auth/users-service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/users-service.ts:19) [api/src/auth/service.ts](/Users/ggomes/dev/ekoa-code/api/src/auth/service.ts:75)

4. Medium – the “tour playback is free” and “registry-only action is free” assertions do not prove “zero new ledger rows”; they only prove zero `/api/app-assistant` POSTs and zero new owner `assistant-chat` rows. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:379) [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:401) If those flows ever regress to bill the visitor, or bill under a different `agentType` without hitting `/api/app-assistant`, this slice still passes while the stated property is false.

5. Low – the console allowlist is broader than the documented favicon 404. `if (/favicon/i.test(\`\${url} \${text}\`))` suppresses any console error whose text merely mentions “favicon”. [api/tests/e2e/assistant-billing.e2e.mjs](/Users/ggomes/dev/ekoa-code/api/tests/e2e/assistant-billing.e2e.mjs:197) A real app error like `ReferenceError: faviconConfig is undefined` would be silently allowlisted.

I did verify the attribution path itself: [api/src/apps/app-assistant-route.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant-route.ts:70) resolves `ownerUserId` from `X-Ekoa-App-Id`, and [api/src/apps/app-assistant.ts](/Users/ggomes/dev/ekoa-code/api/src/apps/app-assistant.ts:280) bills `assistant-chat` to `input.owner.userId`; the caller JWT is not consulted on that path.

NEEDS-WORK
