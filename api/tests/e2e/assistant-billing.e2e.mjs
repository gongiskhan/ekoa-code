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
 * model is called at most 3 times total (2 turns + at most one transient retry).
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
const LLM_BUDGET = 3; // hard ceiling on real model calls (2 turns + at most 1 transient retry)

// The distinct VISITOR principal that drives the assistant panel (a separate, non-owner user, so
// "billed to the owner, not the visitor" is observable on two separate ledgers). Fixed creds keep
// the probe idempotent across re-runs (the ephemeral dev Mongo may already carry the user).
const VISITOR = { orgName: 'g1-visitor-org', username: 'g1-visitor', password: 'pw123456' };

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
    body: JSON.stringify({ username: VISITOR.username, password: VISITOR.password, role: 'builder', orgId }),
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
const assistantChatRows = (rows) => rows.filter((x) => x.type === 'assistant-chat');
async function assistantChatCount(token) { return assistantChatRows(await ledgerRows(token)).length; }

/** GET /api/v1/billing/breakdown (super-admin, platform-wide, grouped by agentType). */
async function billingBreakdown(token) {
  const r = await fetch(`${BASE}/api/v1/billing/breakdown`, { headers: { Authorization: `Bearer ${token}` } });
  assert(r.ok, `billing/breakdown ${r.status}`);
  return ((await r.json()).items) || [];
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
  if (/favicon/i.test(`${url} ${text}`)) return true;
  // 2. Anonymous SSO whoami probe (injected-context.ts:110): window.__ekoa.whoami() GETs
  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
  // 3. Injected health beacon (injected-context.ts:244): POSTs /api/app-health (keepalive) on load;
  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G1 code.
  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
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
  const ownerBeforeReg = await assistantChatCount(adminToken);
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
  const ownerAfterReg = await assistantChatCount(adminToken);
  assert(ownerAfterReg === ownerBeforeReg, `registry action added ${ownerAfterReg - ownerBeforeReg} owner billing row(s) — must be zero`);
  await page.screenshot({ path: join(EVID, 'live-01-registry-action.png') });
  ok(`REGISTRY: setField ran in-page (field -> "${regField}"); zero assistant POSTs; zero new owner billing rows`);

  // ============================================================================================
  // 2. TOUR PLAYBACK IS FREE. Play the FULL overview tour through the E2 teach launcher and assert
  //    zero model POSTs + zero new billing rows across the whole playback.
  // ============================================================================================
  const ownerBeforeTour = await assistantChatCount(adminToken);
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
  const ownerAfterTour = await assistantChatCount(adminToken);
  assert(ownerAfterTour === ownerBeforeTour, `tour playback added ${ownerAfterTour - ownerBeforeTour} owner billing row(s) — must be zero`);
  ok('TOUR: full overview tour reached "concluído"; zero assistant POSTs; zero new owner billing rows (client-side, zero-token)');

  // Close the tour so the composer is clear for the metered turns.
  await page.locator('.ekoa-assistant-tour-close').click();
  await page.locator('.ekoa-assistant-textarea').waitFor({ state: 'visible', timeout: 10_000 });

  // ============================================================================================
  // 3. METERED + ATTRIBUTED. N=2 real assistant turns (driven by the VISITOR) -> exactly TWO new
  //    'assistant-chat' rows in the OWNER's ledger with tokens>0; the VISITOR's ledger unchanged.
  // ============================================================================================
  const ownerBefore = await assistantChatCount(adminToken);
  const visitorBefore = await assistantChatCount(visitor.token);
  for (let i = 0; i < TURNS.length; i++) {
    const body = await meteredTurn(page, TURNS[i]);
    ok(`turn ${i + 1}/2 fired (200, mode="${body.mode}", reply ${body.reply.length} chars)`);
  }
  await page.screenshot({ path: join(EVID, 'live-03-metered-turns.png') });

  const ownerRowsAfter = assistantChatRows(await ledgerRows(adminToken));
  const ownerAfter = ownerRowsAfter.length;
  const visitorAfter = await assistantChatCount(visitor.token);
  assert(ownerAfter - ownerBefore === TURNS.length, `owner gained ${ownerAfter - ownerBefore} assistant-chat rows, expected exactly ${TURNS.length}`);
  assert(visitorAfter - visitorBefore === 0, `visitor (the caller) gained ${visitorAfter - visitorBefore} assistant-chat rows — must be ZERO (owner is the billee)`);
  // The two NEW rows (history is newest-first) each carry metered tokens > 0.
  const newRows = ownerRowsAfter.slice(0, TURNS.length);
  for (const row of newRows) {
    assert(row.type === 'assistant-chat', `new owner row type "${row.type}", expected "assistant-chat"`);
    assert(typeof row.tokens === 'number' && row.tokens > 0, `new owner assistant-chat row metered ${row.tokens} tokens, expected > 0`);
  }
  // Ties the ledger rows to browser-issued turns: every POST since the tour is a turn we fired
  // (the tour + registry fired none), so the count equals llmTurns (== TURNS.length, or +1 if a
  // transient non-200 was retried — a retried failure writes NO ledger row, so owner still gained
  // exactly TURNS.length rows above).
  assert(assistantPosts - postsBeforeTour === llmTurns, `assistant POSTs since the tour (${assistantPosts - postsBeforeTour}) != turns fired (${llmTurns})`);
  ok(`METERED: ${TURNS.length} visitor-driven turns -> exactly ${TURNS.length} new 'assistant-chat' rows on the OWNER ledger (tokens=${newRows.map((r) => r.tokens).join(',')}); VISITOR ledger unchanged (billed to owner, NOT the caller)`);

  // ============================================================================================
  // 4. BREAKDOWN carries the assistant-chat agentType with tokens > 0.
  // ============================================================================================
  const breakdown = await billingBreakdown(adminToken);
  const acLine = breakdown.find((x) => x.agentType === 'assistant-chat');
  assert(acLine && acLine.tokens > 0, `breakdown missing assistant-chat with tokens>0: ${JSON.stringify(breakdown)}`);
  ok(`BREAKDOWN: /billing/breakdown groups an 'assistant-chat' line (tokens=${acLine.tokens})`);

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
