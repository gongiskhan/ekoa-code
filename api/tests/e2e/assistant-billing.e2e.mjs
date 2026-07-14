#!/usr/bin/env node
/**
 * ASSISTANT METERING + BILLING-TRUTH live gate — committed, re-runnable end-to-end driver
 * (operator-run G1).
 *
 * D1 built the served-app assistant (`POST /api/app-assistant`) so that every turn runs ONE model
 * call through the llm/ chokepoint one-shot, metered + attributed to the RESOLVED ARTIFACT OWNER
 * (agentType 'assistant-chat', a UserWorkAgentType), never the anonymous visitor. E2 built the
 * in-app tour player (100% client-side, zero model calls). G1 does NOT re-implement any of that; it
 * PROVES the billing truth live on the credentialed boot-b stack and extends the journeys'
 * billing-truth reconciliation (actions-log vs GET /api/v1/billing/history) to the assistant plane:
 *
 *   1. METERED + ATTRIBUTED. The app is BUILT by admin (so the artifact owner is admin) and then
 *      FEATURED (a fresh app is an owner-only preview — non-owners get 410; featuring makes it
 *      shareable so the visitor can load it — reverted in cleanup). The assistant panel is then
 *      driven by a DISTINCT visitor (the browser context is authenticated as a separate, non-owner
 *      user). N=2 real assistant turns each fire exactly one `POST
 *      /api/app-assistant` -> exactly TWO new `assistant-chat` rows land in the OWNER's ledger (GET
 *      /api/v1/billing/history) with metered tokens > 0 — while the VISITOR's ledger gains ZERO.
 *      That is the billing truth: the caller is not the billee; the resolved owner is. (The endpoint
 *      is header-scoped and never reads the caller's JWT — app-assistant-route.ts bills
 *      admission.owner.userId — so this holds by construction; the probe makes it observable.)
 *   2. BREAKDOWN. GET /api/v1/billing/breakdown (super-admin, grouped by agentType) now carries an
 *      `assistant-chat` line with tokens > 0.
 *   3. TOUR PLAYBACK IS FREE. A FULL overview tour played through the E2 teach launcher issues ZERO
 *      `POST /api/app-assistant` and adds ZERO new billing rows (the player is client-side).
 *   4. REGISTRY-ONLY ACTIONS ARE FREE. A registry action dispatched through window.__ekoaActions
 *      .execute (the C3 runtime the panel itself uses) runs entirely in-page — ZERO model POSTs,
 *      ZERO new billing rows.
 *   5. Zero non-benign page JS console errors throughout (the SAME documented allowlist as the
 *      D2/D3/E2 drivers: favicon 404 + anonymous whoami 401 + dev-proxy app-health 5xx).
 *
 * DETERMINISM. A committed gate cannot depend on model prose, so every assertion is STRUCTURAL:
 * ledger ROW COUNTS by agentType + billee, the browser-side `POST /api/app-assistant` request
 * counter, and the C3 runtime's own result status / DOM effect. The served tour is the same
 * schema-valid overview fixture E2 uses, fulfilled at the browser boundary (page.route) — the only
 * stub QA permits. The two metered turns are plain informational prompts (no operate surface
 * needed): metering fires on the one-shot regardless of whether the turn proposes actions. The
 * driver issues at most 3 /api/app-assistant HTTP turns (2 turns + at most one transient retry); each
 * turn's runOneShot may run up to maxTurns:3 provider turns internally (client.ts:892), so the true
 * provider-turn worst case is 9, not 3 — the driver bounds HTTP turns, which is what it can enforce.
 *
 * NO PRODUCTION CODE CHANGE — this is a proof slice. Black-box over the running dev cortex
 * (backend.port, the boot-b proxy) + a real Chromium. Builds ONE fresh app-base app (verify OFF).
 * Run: node tests/e2e/assistant-billing.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };
const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'G1');

const BUILD_TIMEOUT_MS = 10 * 60_000;
const TURN_TIMEOUT_MS = 150_000;
// Caps the number of /api/app-assistant HTTP TURNS the driver issues at 3 (2 turns + at most one
// transient retry). NOTE (finding 2): this bounds HTTP turns, NOT provider turns — each turn's
// runOneShot may itself run up to maxTurns:3 model continuations internally (client.ts:892), which the
// driver cannot cap. Worst case = 3 HTTP turns x 3 = 9 provider turns. We count only what we can count.
const LLM_BUDGET = 3;

// The distinct VISITOR principal that drives the assistant panel (a separate, non-owner user, so
// "billed to the owner, not the visitor" is observable on two separate ledgers). A per-RUN unique
// username (finding 3) — usernames are not enforced unique and login() picks matches[0], so a fixed
// name accumulates duplicate rows on a dirty stack and reruns get flaky. The runstamp gives every run
// a fresh principal; tryLogin still short-circuits the same-run re-provision case.
const RUNSTAMP = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
const VISITOR = { orgName: `g1-visitor-org-${RUNSTAMP}`, username: `g1-visitor-${RUNSTAMP}`, password: 'pw123456' };

// The app-specific (non-landmark) registry-ID target the tour spotlights — planted in the page like
// the E2/D3 gates so the surface is deterministic.
const TOUR_TARGET = 'e2-tour-alvo';
// A planted setField landmark the registry-only action drives (same technique as the D3 gate).
const REG_TARGET = 'g1-set-target';
const REG_VALUE = 'REGISTO-LOCAL-G1';

// The schema-valid overview tour the panel fetches — the SAME fixture E2 validates against
// demoSpecSchema, so this "stub" is a schema-validated stub (the only stub QA permits).
const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;
function buildTour(appId) { return { ...TOUR_FIXTURE, appId }; }

// Two plain informational turns — no operate surface required; each fires exactly one metered
// one-shot. PT-PT (the served assistant answers in PT-PT).
const TURNS = [
  'Dê-me uma visão geral do que esta aplicação permite fazer.',
  'Explique-me, de forma geral, como está organizada esta aplicação.',
];

// `fail` THROWS (not process.exit) so the tail's catch runs cleanup (un-feature the test app) on any
// failure before exiting non-zero. Set once the app is featured, so cleanup knows what to revert.
let cleanupFeatured = null;
function fail(msg) { throw new Error(msg); }
function ok(msg) { console.log(`PASS ${msg}`); }
function assert(cond, msg) { if (!cond) fail(msg); }

// ---------------------------------------------------------------------------------------------
// HTTP kit (direct fetch, off the browser) — provisioning + ledger reads.
// ---------------------------------------------------------------------------------------------
/** Log in, returning the token or null (never exits) — used for the idempotent visitor check. */
async function tryLogin(username, password) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
  });
  if (!r.ok) return null;
  return (await r.json()).token;
}

/** Log in, hard-failing the gate on any non-200. */
async function login(username, password) {
  const token = await tryLogin(username, password);
  assert(token, `login(${username}) failed`);
  return token;
}

async function userIdOf(token) {
  const me = await (await fetch(`${BASE}/api/v1/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => ({}));
  return (me && (me.user?.id || me.id)) || null;
}

/** Provision the distinct visitor (org + builder user) as admin, then log them in. IDEMPOTENT: if
 *  the fixed-cred visitor already exists (re-run on the same boot), it just logs in — no duplicate
 *  org/user is created. */
async function provisionVisitor(adminToken) {
  const existing = await tryLogin(VISITOR.username, VISITOR.password);
  if (existing) return { token: existing, userId: await userIdOf(existing) };

  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` };
  const orgRes = await fetch(`${BASE}/api/v1/orgs`, { method: 'POST', headers: H, body: JSON.stringify({ name: VISITOR.orgName, displayName: VISITOR.orgName }) });
  assert(orgRes.ok, `visitor org create ${orgRes.status}`);
  const orgId = (await orgRes.json()).id;
  const userRes = await fetch(`${BASE}/api/v1/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ username: VISITOR.username, password: VISITOR.password, role: 'user', orgId }),
  });
  assert(userRes.ok, `visitor user create ${userRes.status}`);
  const token = await login(VISITOR.username, VISITOR.password);
  return { token, userId: await userIdOf(token) };
}

/** Build ONE fresh app-base app through the real jobs pipeline as ADMIN, so the artifact OWNER is
 *  admin (verify OFF — nondeterministic + orthogonal, same pattern as C5/D2/D3/E2). */
async function buildSampleApp(token) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'g1-assistant-billing' }) })).json();
  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
  })).json();
  const jobId = created.job.id;
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 10min`);
    await new Promise((r) => setTimeout(r, 6000));
    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
    if (job.status === 'completed') return job.artifactId;
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
  }
}

/**
 * Toggle the artifact's `featured` flag (super-admin `PUT /:id/featured`). A freshly built app is
 * shareability-gated (owner-only: a NON-owner or anonymous `GET /apps/:id/` returns 410 — the app is
 * an unpublished owner preview). Featuring makes it shareable (share-lookup: featured => always
 * shareable), so the DISTINCT visitor can load the served document and drive the panel — the real
 * "published app, anonymous/other visitor, owner billed" scenario. Reverted at the end (setFeatured
 * is a pure flag flip — app-paths.setFeaturedFlag — no rebuild, no side effect).
 */
async function featureApp(adminToken, artifactId, on) {
  const r = await fetch(`${BASE}/api/v1/artifacts/${artifactId}/featured`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ featured: on }),
  });
  return r.ok;
}

/** The caller's OWN billing ledger (GET /api/v1/billing/history is actor-scoped). Returns rows;
 *  each row's `type` is the token_events agentType (billing/service.ts historyFor). */
async function ledgerRows(token) {
  const r = await fetch(`${BASE}/api/v1/billing/history`, { headers: { Authorization: `Bearer ${token}` } });
  assert(r.ok, `billing/history ${r.status}`);
  const body = await r.json();
  return (body && body.items) || [];
}
/** TOTAL ledger row count (ALL agentTypes) for a billee. Used for the VISITOR (which has NO billable
 *  activity, so ANY new row of ANY agentType is a real regression) — NOT for the owner, whose own
 *  build+anonymisation billing legitimately lands async and would make a total-diff flap. */
async function totalRows(token) { return (await ledgerRows(token)).length; }
/** The SET of assistant-chat row ids for a billee — the OWNER free-path/metered assertions diff THIS
 *  (the assistant surface), never the owner's total, so the owner's own build-family billing is free
 *  to accrue without failing the gate while any EXTRA assistant-chat billing is still caught. */
async function ownerAssistantChatIds(token) {
  return new Set((await ledgerRows(token)).filter((r) => r.type === 'assistant-chat').map((r) => r.id));
}

/** GET /api/v1/billing/breakdown (super-admin, platform-wide, grouped by agentType). */
async function billingBreakdown(token) {
  const r = await fetch(`${BASE}/api/v1/billing/breakdown`, { headers: { Authorization: `Bearer ${token}` } });
  assert(r.ok, `billing/breakdown ${r.status}`);
  return ((await r.json()).items) || [];
}
/** The assistant-chat token total in a breakdown snapshot (0 if the line is absent). */
const breakdownAssistantChatTokens = (items) => (items.find((x) => x.agentType === 'assistant-chat')?.tokens ?? 0);

/**
 * Convergence poll for the metered assertion (finding 1: never race the ledger write). Metering is
 * awaited inside runOneShot (client.ts:896 meter() -> recordTokenEvent) BEFORE the /api/app-assistant
 * 200 returns, so the rows are already committed when a turn resolves — but we poll (up to timeoutMs)
 * for the expected number of NEW assistant-chat rows (by row IDENTITY vs the before-set) so any future
 * async-write change cannot make this flake. Returns the NEW rows (all agentTypes) once >= `expected`
 * new assistant-chat rows are visible, else throws on timeout.
 */
async function waitForNewOwnerRows(token, idsBefore, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await ledgerRows(token);
    const newRows = rows.filter((r) => !idsBefore.has(r.id));
    const newAc = newRows.filter((r) => r.type === 'assistant-chat');
    if (newAc.length >= expected) return { rows, newRows, newAc };
    if (Date.now() > deadline) return { rows, newRows, newAc, timedOut: true };
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * A console-error entry is benign ONLY if it is one of these KNOWN, pre-existing platform /
 * dev-harness failed-resource logs — COPIED VERBATIM from the D2/D3/E2 drivers. None is G1 code;
 * each fires on EVERY served app. Every OTHER console error fails the gate (strict).
 */
function benign(entry) {
  const url = String(entry.url || '');
  const text = String(entry.text || '');
  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
  //    Match the request URL PATH only (finding 5) — NOT the message text — so a real app error whose
  //    text merely mentions "favicon" (e.g. `ReferenceError: faviconConfig is undefined`) still fails.
  if (/\/favicon\.ico(\?|$)/i.test(url)) return true;
  // 2. Anonymous SSO whoami probe (injected-context.ts:110): window.__ekoa.whoami() GETs
  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
  // 3. Injected health beacon (injected-context.ts:244): POSTs /api/app-health (keepalive) on load;
  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G1 code.
  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
  // 4. Tour-availability probe (panel fix d172c2a): the panel GETs /api/demos/:appId once on mount
  //    to decide whether to offer the teach launcher; on an app with NO stored tour this is an
  //    EXPECTED 404 (the by-design "no tour" state, same class as the app-sso/me 401) that the
  //    browser logs as a failed resource. Not an app error.
  if (/\/api\/demos\//.test(url) && /\b404\b/.test(text)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Panel + tour driving (mirrors D3/E2).
// ---------------------------------------------------------------------------------------------
let llmTurns = 0;

/** Fire ONE assistant turn through the panel; resolve { status, body }. Counts against LLM_BUDGET. */
async function fireTurn(page, text) {
  if (llmTurns >= LLM_BUDGET) fail(`LLM budget (${LLM_BUDGET}) exhausted before "${text.slice(0, 40)}"`);
  llmTurns += 1;
  const respP = page.waitForResponse(
    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
    { timeout: TURN_TIMEOUT_MS },
  );
  await page.locator('.ekoa-assistant-textarea').fill(text);
  await page.locator('.ekoa-assistant-send').click();
  const resp = await respP;
  let body = null;
  try { body = await resp.json(); } catch { /* non-JSON body */ }
  return { status: resp.status(), body };
}

/** A metered turn: fire, absorb ONE transient non-200 (budget-permitting), then assert 200 + reply. */
async function meteredTurn(page, text) {
  let r = await fireTurn(page, text);
  if (r.status !== 200 && llmTurns < LLM_BUDGET) r = await fireTurn(page, text);
  assert(r.status === 200, `app-assistant responded ${r.status} for "${text.slice(0, 40)}"`);
  assert(r.body && typeof r.body.reply === 'string' && r.body.reply.trim().length > 0, `empty reply for "${text.slice(0, 40)}"`);
  return r.body;
}

async function openPanel(page) {
  const launcher = page.locator('.ekoa-assistant-launcher');
  try {
    await launcher.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    // The launcher never mounted. Emit a diagnostic that distinguishes an ABSENT/BROKEN panel bundle
    // (e.g. a scaffold snapshotted mid-edit into this build) from a genuine launcher regression, so a
    // rerun reader can tell WHICH without re-driving. Diagnostics only — it changes nothing the gate
    // asserts; it just turns an opaque 30s timeout into an actionable signal.
    const diag = await page
      .evaluate(() => ({
        title: document.title,
        hasEkoaGlobal: typeof window.__ekoa !== 'undefined',
        runtimeInstalledSeen: typeof window.__ekoaActionRuntimeInstalled !== 'undefined',
        assistantEls: Array.from(document.querySelectorAll('[class*="ekoa-assistant"]')).map((n) => n.className).slice(0, 10),
        scriptSrcs: Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 20),
      }))
      .catch(() => null);
    fail(`assistant launcher never mounted (panel bundle absent/broken in this build?). page diagnostic: ${JSON.stringify(diag)}`);
  }
  await launcher.click();
  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
}

/** Geometry check: the C3 spotlight ring is drawn AROUND the real element carrying
 *  data-demo-target=<name> (proves the highlight matches a real element). Copied from E2. */
async function spotlightSurrounds(page, name) {
  return page.evaluate((n) => {
    const overlay = document.querySelector('[data-ekoa-actions-ui="spotlight"]');
    if (!overlay) return { ok: false, reason: 'no-spotlight-overlay' };
    const ring = overlay.firstElementChild;
    const target = document.querySelector('[data-demo-target="' + n + '"]');
    if (!ring) return { ok: false, reason: 'no-ring' };
    if (!target) return { ok: false, reason: 'no-target' };
    const rr = ring.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
  }, name);
}

async function advance(page) { await page.locator('.ekoa-assistant-tour-next').click(); }

async function main() {
  const adminToken = await login(ADMIN.username, ADMIN.password);
  ok('admin login (artifact owner + super-admin for breakdown)');

  const visitor = await provisionVisitor(adminToken);
  assert(visitor.token, 'visitor provisioning: no token');
  ok(`distinct visitor provisioned + logged in (userId=${visitor.userId}) — drives the panel, must never be billed`);

  const artifactId = await buildSampleApp(adminToken);
  ok(`fresh app-base app built by admin (owner=admin, artifact=${artifactId})`);

  // Document-access contrast (zero model cost): a fresh app is an OWNER-ONLY preview — the OWNER
  // sees the served document, the distinct VISITOR gets 410 (proving the visitor is a genuine
  // non-owner principal). We then FEATURE the app so it is shareable and the visitor can load it +
  // drive the panel (the real "published app, other visitor, owner billed" scenario). Reverted in
  // cleanup.
  const docStatus = async (token) => {
    const r = await fetch(`${BASE}/apps/${artifactId}/`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    return r.status;
  };
  const ownerDoc = await docStatus(adminToken);
  const visitorDocBefore = await docStatus(visitor.token);
  assert(ownerDoc === 200, `owner GET /apps/:id/ -> ${ownerDoc}, expected 200`);
  assert(visitorDocBefore === 410, `visitor GET /apps/:id/ -> ${visitorDocBefore}, expected 410 (non-owner cannot view an unpublished app)`);
  assert(await featureApp(adminToken, artifactId, true), 'PUT /:id/featured{true} failed');
  cleanupFeatured = { adminToken, artifactId };
  const visitorDocAfter = await docStatus(visitor.token);
  assert(visitorDocAfter === 200, `after featuring, visitor GET /apps/:id/ -> ${visitorDocAfter}, expected 200 (shareable)`);
  ok('document-access contrast: owner 200 / non-owner 410 unpublished; featured -> visitor 200 (visitor is a genuine non-owner who can now drive the shared app)');

  const routeProbe = await fetch(`${BASE}/api/demos/${artifactId}`);
  assert(routeProbe.status === 404 || routeProbe.status === 200, `GET /api/demos/:appId returned ${routeProbe.status}`);
  ok(`tour serving route live (GET /api/demos/:appId -> ${routeProbe.status})`);

  // --- Browser: the context is authenticated as the VISITOR (a distinct, non-owner principal). ---
  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${visitor.token}` } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
  });
  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));

  // Count EVERY assistant model POST for the whole session — the client-side "free" proof.
  let assistantPosts = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
  });

  // Deterministic served tour: fulfil GET /api/demos/:appId with the schema-valid overview fixture.
  await page.route('**/api/demos/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) }),
  );

  const appUrl = `${BASE}/apps/${artifactId}/`;
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

  // Plant both landmarks as direct children of <body> (React never reclaims them — C5/D3/E2 technique):
  // the tour target, and a setField wrapper+input for the registry-only action. CRITICAL:
  // `pointer-events:none` makes these fixed overlays CLICK-THROUGH — they sit at the top-left where
  // they can overlap the real app-nav, and without this their subtree would intercept the tour's
  // step-4 click on the real app-nav button. It does NOT affect the assertions: setField writes the
  // input value programmatically (not via a click) and the spotlight geometry reads getBoundingClientRect.
  await page.evaluate(({ tourTarget, regTarget }) => {
    if (!document.querySelector('[data-demo-target="' + tourTarget + '"]')) {
      const el = document.createElement('div');
      el.setAttribute('data-demo-target', tourTarget);
      el.style.cssText = 'position:fixed;top:8px;left:8px;width:200px;height:36px;z-index:1;background:#fff;border:1px solid #ccc;pointer-events:none;';
      document.body.appendChild(el);
    }
    if (!document.querySelector('[data-demo-target="' + regTarget + '"]')) {
      const wrap = document.createElement('div');
      wrap.setAttribute('data-demo-target', regTarget);
      wrap.style.cssText = 'position:fixed;top:52px;left:8px;width:220px;height:38px;z-index:1;background:#fff;border:1px solid #ccc;pointer-events:none;';
      const input = document.createElement('input');
      input.id = 'g1-set-input';
      input.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
      wrap.appendChild(input);
      document.body.appendChild(wrap);
    }
  }, { tourTarget: TOUR_TARGET, regTarget: REG_TARGET });

  await openPanel(page);
  ok('panel opened as the visitor; same-document C3 action runtime installed');

  // ============================================================================================
  // 1. REGISTRY-ONLY ACTION IS FREE. Dispatch a setField through window.__ekoaActions.execute (the
  //    C3 runtime the panel itself uses). It runs entirely in-page: the field changes, the promise
  //    resolves 'done', and NO model POST fires + NO billing row lands.
  // ============================================================================================
  // Baseline: the OWNER's assistant-chat row ids (the assistant surface) + the VISITOR's TOTAL rows
  // (any agentType — the visitor has no billable activity, so any new visitor row is a regression —
  // finding 4). We do NOT freeze the owner's TOTAL: its own build+anonymisation billing lands async.
  const ownerAcIdsBeforeReg = await ownerAssistantChatIds(adminToken);
  const visitorTotalBeforeReg = await totalRows(visitor.token);
  const postsBeforeReg = assistantPosts;
  await page.evaluate(({ target, value }) => {
    document.getElementById('g1-set-input').value = '';
    window.__g1SetResult = null;
    window.__ekoaActions
      .execute({ id: 'g1-set', kind: 'setField', labelPt: 'Preencher', description: 'x', target, params: { valor: value } })
      .then((r) => { window.__g1SetResult = r; });
  }, { target: REG_TARGET, value: REG_VALUE });
  await page.waitForFunction(() => window.__g1SetResult && window.__g1SetResult.status === 'done', { timeout: 8_000 });
  const regField = await page.evaluate(() => document.getElementById('g1-set-input').value);
  assert(regField.includes(REG_VALUE), `registry setField did not drive the field: "${regField}"`);
  assert(assistantPosts === postsBeforeReg, `registry action fired ${assistantPosts - postsBeforeReg} assistant POST(s) — must be zero`);
  const ownerAcNewReg = (await ledgerRows(adminToken)).filter((r) => r.type === 'assistant-chat' && !ownerAcIdsBeforeReg.has(r.id));
  const visitorTotalAfterReg = await totalRows(visitor.token);
  assert(ownerAcNewReg.length === 0, `registry action added ${ownerAcNewReg.length} OWNER assistant-chat row(s) — must be zero`);
  assert(visitorTotalAfterReg === visitorTotalBeforeReg, `registry action added ${visitorTotalAfterReg - visitorTotalBeforeReg} VISITOR ledger row(s) (any agentType) — must be zero`);
  await page.screenshot({ path: join(EVID, 'live-01-registry-action.png') });
  ok(`REGISTRY: setField ran in-page (field -> "${regField}"); zero assistant POSTs; zero new OWNER assistant-chat rows; zero new VISITOR rows (any agentType)`);

  // ============================================================================================
  // 2. TOUR PLAYBACK IS FREE. Play the FULL overview tour through the E2 teach launcher and assert
  //    zero model POSTs + zero new billing rows across the whole playback.
  // ============================================================================================
  const ownerAcIdsBeforeTour = await ownerAssistantChatIds(adminToken);
  const visitorTotalBeforeTour = await totalRows(visitor.token);
  const postsBeforeTour = assistantPosts;
  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
  const startBtn = page.locator('.ekoa-assistant-tour-start');
  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await startBtn.click();
  const tour = page.locator('.ekoa-assistant-tour');
  await tour.waitFor({ state: 'visible', timeout: 10_000 });

  // Step 1 (navigate "Bem-vindo").
  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
  await advance(page);
  // Step 2 (spotlight app-nav — a rebuild-stable shell landmark).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
  let geo = await spotlightSurrounds(page, 'app-nav');
  assert(geo.ok, `spotlight did not surround app-nav: ${JSON.stringify(geo)}`);
  await advance(page);
  // Step 3 (spotlight the planted tour target).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  geo = await spotlightSurrounds(page, TOUR_TARGET);
  assert(geo.ok, `spotlight did not surround ${TOUR_TARGET}: ${JSON.stringify(geo)}`);
  await advance(page);
  // Step 4 (await-action app-nav click — advances only on a real click).
  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-demo-target="app-nav"] button').first().click();
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });
  // Step 5 (spotlight app-content).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  geo = await spotlightSurrounds(page, 'app-content');
  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
  await advance(page);
  // Step 6 (inject-prompt — the suggestion lands in the composer, unsent).
  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
  await advance(page);
  // Done.
  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(EVID, 'live-02-tour-done.png') });

  assert(assistantPosts === postsBeforeTour, `tour playback fired ${assistantPosts - postsBeforeTour} assistant POST(s) — tours must be zero-token`);
  const ownerAcNewTour = (await ledgerRows(adminToken)).filter((r) => r.type === 'assistant-chat' && !ownerAcIdsBeforeTour.has(r.id));
  const visitorTotalAfterTour = await totalRows(visitor.token);
  assert(ownerAcNewTour.length === 0, `tour playback added ${ownerAcNewTour.length} OWNER assistant-chat row(s) — must be zero`);
  assert(visitorTotalAfterTour === visitorTotalBeforeTour, `tour playback added ${visitorTotalAfterTour - visitorTotalBeforeTour} VISITOR ledger row(s) (any agentType) — must be zero`);
  ok('TOUR: full overview tour reached "concluído"; zero assistant POSTs; zero new OWNER assistant-chat rows; zero new VISITOR rows (any agentType; client-side, zero-token)');

  // Close the tour so the composer is clear for the metered turns.
  await page.locator('.ekoa-assistant-tour-close').click();
  await page.locator('.ekoa-assistant-textarea').waitFor({ state: 'visible', timeout: 10_000 });

  // ============================================================================================
  // 3. METERED + ATTRIBUTED. N=2 real assistant turns (driven by the VISITOR) -> exactly TWO new
  //    'assistant-chat' rows in the OWNER's ledger with tokens>0; the VISITOR's ledger unchanged.
  // ============================================================================================
  // Capture row IDENTITY (not counts) on the OWNER ledger + the VISITOR total + the platform-wide
  // breakdown assistant-chat total, all BEFORE the turns (finding 1: isolate the proof to THIS run's
  // rows by id + timestamp window, so a concurrent admin turn on another artifact cannot satisfy it).
  const ownerIdsBefore = new Set((await ledgerRows(adminToken)).map((r) => r.id));
  const visitorTotalBefore = await totalRows(visitor.token);
  const bdAcBefore = breakdownAssistantChatTokens(await billingBreakdown(adminToken));
  const windowStart = Date.now();
  for (let i = 0; i < TURNS.length; i++) {
    const body = await meteredTurn(page, TURNS[i]);
    ok(`turn ${i + 1}/2 fired (200, mode="${body.mode}", reply ${body.reply.length} chars)`);
  }
  const windowEnd = Date.now();
  await page.screenshot({ path: join(EVID, 'live-03-metered-turns.png') });

  // Converge on the OWNER ledger: wait for the expected NEW assistant-chat rows (by id vs before-set).
  const conv = await waitForNewOwnerRows(adminToken, ownerIdsBefore, TURNS.length);
  assert(!conv.timedOut, `owner ledger did not converge to ${TURNS.length} new assistant-chat rows (saw ${conv.newAc.length})`);
  // The owner ALSO legitimately accrues NON-assistant-chat rows in this window — the build the probe
  // itself triggered, plus each turn's PII-anonymisation pass, bill the OWNER under build-family
  // agentTypes (pi-fast-loop / memory-extract / build). That is EXPECTED owner cost, not a defect, so
  // we LOG it and never fail on it (finding 1, refined by the lead: identity on the assistant surface,
  // not a freeze of the owner's own activity). We DO assert none is a mis-attributed assistant-chat.
  const otherNew = conv.newRows.filter((r) => r.type !== 'assistant-chat');
  const otherByType = otherNew.reduce((m, r) => ((m[r.type] = (m[r.type] || 0) + 1), m), {});
  console.log(`INFO owner also accrued ${otherNew.length} non-assistant-chat row(s) in-window (owner's own build+anonymisation, EXPECTED, ignored): ${JSON.stringify(otherByType)}`);
  // EXACTLY TURNS.length NEW assistant-chat rows (by id) — no EXTRA / mis-attributed assistant billing.
  assert(conv.newAc.length === TURNS.length, `owner gained ${conv.newAc.length} new assistant-chat rows, expected exactly ${TURNS.length} (no extra/mis-attributed assistant billing)`);
  // Each new assistant-chat row: metered tokens > 0, and createdAt INSIDE this run's turn window (ties
  // the rows to OUR turns — /billing/history exposes no artifactId, so the residual is the window).
  const WINDOW_SLACK_MS = 10_000;
  for (const row of conv.newAc) {
    assert(typeof row.tokens === 'number' && row.tokens > 0, `new owner assistant-chat row metered ${row.tokens} tokens, expected > 0`);
    const ts = new Date(row.createdAt).getTime();
    assert(
      Number.isFinite(ts) && ts >= windowStart - WINDOW_SLACK_MS && ts <= windowEnd + WINDOW_SLACK_MS,
      `new assistant-chat row createdAt ${row.createdAt} outside the turn window [${new Date(windowStart).toISOString()}..${new Date(windowEnd).toISOString()}]`,
    );
  }
  // The VISITOR (the caller) gained ZERO rows of ANY agentType — nothing billable ran as the visitor;
  // the owner is the billee. This is the STRICT mis-attribution guard (visitor has no legit billing).
  const visitorTotalAfter = await totalRows(visitor.token);
  assert(visitorTotalAfter - visitorTotalBefore === 0, `visitor (the caller) gained ${visitorTotalAfter - visitorTotalBefore} ledger row(s) (any agentType) — must be ZERO (owner is the billee)`);
  // POST-count tie: every /api/app-assistant POST since the tour is a turn we fired (tour+registry fired none).
  assert(assistantPosts - postsBeforeTour === llmTurns, `assistant POSTs since the tour (${assistantPosts - postsBeforeTour}) != turns fired (${llmTurns})`);
  const meteredTokens = conv.newAc.map((r) => r.tokens);
  ok(`METERED: ${TURNS.length} visitor-driven turns -> exactly ${TURNS.length} new 'assistant-chat' rows on the OWNER ledger by id (tokens=${meteredTokens.join(',')}), timestamped in-window; VISITOR ledger +0 rows (billed to owner, NOT the caller)`);

  // ============================================================================================
  // 4. BREAKDOWN DELTA: the platform-wide assistant-chat total grew by EXACTLY this run's tokens
  //    (before-vs-after delta, not mere presence — finding 1).
  // ============================================================================================
  const bdAcAfter = breakdownAssistantChatTokens(await billingBreakdown(adminToken));
  const bdDelta = bdAcAfter - bdAcBefore;
  const turnTokenSum = meteredTokens.reduce((a, b) => a + b, 0);
  assert(bdDelta === turnTokenSum, `breakdown assistant-chat delta ${bdDelta} != this run's metered tokens ${turnTokenSum} (before=${bdAcBefore}, after=${bdAcAfter})`);
  ok(`BREAKDOWN: /billing/breakdown assistant-chat total grew by EXACTLY this run's tokens (Δ=${bdDelta})`);

  // ============================================================================================
  // 5. ZERO non-benign page JS console errors throughout.
  // ============================================================================================
  const errors = consoleErrors.filter((e) => !benign(e));
  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
  ok('zero non-benign page JS console errors throughout');

  await browser.close();

  // Cleanup: revert the temporary featuring so the test app returns to its owner-only state.
  if (cleanupFeatured) {
    const reverted = await featureApp(cleanupFeatured.adminToken, cleanupFeatured.artifactId, false);
    cleanupFeatured = null;
    ok(`test app un-featured (cleanup ${reverted ? 'ok' : 'FAILED — revert manually'})`);
  }

  console.log('G1 LIVE GATE: PASS');
}

main()
  .then(() => process.exit(0))
  .catch(async (e) => {
    // Best-effort cleanup on ANY failure: never leave the test app publicly featured.
    if (cleanupFeatured) {
      try { await featureApp(cleanupFeatured.adminToken, cleanupFeatured.artifactId, false); } catch { /* best effort */ }
    }
    console.error(`E2E FAIL: ${e && e.stack ? e.stack : String(e)}`);
    process.exit(1);
  });
