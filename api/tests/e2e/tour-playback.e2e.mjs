#!/usr/bin/env node
/**
 * SAME-DOCUMENT TOUR PLAYBACK + REBUILD SELECTOR-STABILITY live gate — committed,
 * re-runnable end-to-end driver (operator-run E2).
 *
 * E1 generates + stores per-app tours; D2/D3 proved the assistant panel. E2 is the
 * IN-APP tour PLAYER: the panel plays a pre-generated declarative tour SAME-DOCUMENT
 * (not the dashboard cross-origin iframe), reusing the C3 runtime's spotlight
 * primitive, with ZERO model calls. This driver proves the three E2 properties live
 * in a REAL served app-base app driven by a real Chromium on the credentialed
 * boot-b stack:
 *
 *   A. PLAYBACK. Pinning Ensinar (teach) surfaces the "Iniciar tutorial guiado"
 *      launcher; clicking it makes the panel FETCH GET /api/demos/:appId and play
 *      the tour step-by-step IN THE PAGE: a navigate step, spotlight steps that draw
 *      the C3 highlight ring ON the real data-demo-target element, an await-action
 *      step that advances when the user actually clicks the target, and an
 *      inject-prompt step that drops a suggested prompt into the composer (never
 *      sent). The tour reaches "Tutorial concluído." (data-tour-status="done").
 *   B. ZERO TOKENS. NO POST /api/app-assistant fires at any point during playback
 *      (asserted by a request counter): the player is 100% client-side.
 *   C. REBUILD SELECTOR-STABILITY. The SAME app is REBUILT (a follow-up build on the
 *      same artifactId — the product's real "rebuild the app" path), then the tour is
 *      replayed: the spotlight still resolves the shell-landmark targets
 *      (data-demo-target NAMES survive the rebuild — the A2 requirement (ii):
 *      registry-ID selectors, not DOM paths).
 *   D. ZERO non-benign page JS console errors throughout (the SAME documented
 *      allowlist as the D2/D3 drivers).
 *
 * DETERMINISM. A committed gate cannot depend on what a given generation produced,
 * nor on the model authoring a tour. So the served tour is a schema-valid overview
 * spec fulfilled at the browser boundary (page.route) — a schema-validated stub, the
 * only stub QA permits; the SAME spec shape a real E1 capture would serve (E1's
 * capture + the serving route are covered by tests/apps/{tour-writer,serving-tours}
 * .test.ts). The app under it is REAL: built through the jobs pipeline, so its shell
 * landmarks (app-nav / app-content, data-demo-target on the platform App.jsx SHELL —
 * present on every route, unlike the replaceable HomePage placeholder) are genuinely
 * emitted and genuinely re-emitted after the rebuild. One app-specific
 * registry-ID target (e2-tour-alvo) is planted in the page (same technique as the
 * C5/D3 gates) so the tour also exercises a non-landmark target. Every assertion is
 * STRUCTURAL — tour status, spotlight geometry over the real element, composer
 * value, request count — never on model prose.
 *
 * Black-box over the running dev cortex (backend.port, the boot-b proxy) + a real
 * Chromium. Builds ONE fresh app-base app (verify OFF), then rebuilds it via a
 * follow-up build on the same artifactId. Run: node tests/e2e/tour-playback.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };
const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'E2');

const BUILD_TIMEOUT_MS = 10 * 60_000;
// The app-specific (non-landmark) registry-ID target the tour spotlights - planted
// in the page like the C5/D3 gates so the surface is deterministic.
const PLANTED_TARGET = 'e2-tour-alvo';

// The schema-valid overview tour the panel fetches - the SAME fixture the unit test
// validates against demoSpecSchema (tests/apps/tour-player.test.ts), so this "stub"
// is a schema-validated stub. Targets are data-demo-target NAMES: SHELL-CHROME
// landmarks (app-nav/app-content, present on every route + rebuild-stable) plus the
// planted app target.
const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;

/** The fixture tour with `appId` stamped to the built artifact (as a real serve would). */
function buildTour(appId) {
  return { ...TOUR_FIXTURE, appId };
}

// A schema-valid app-assistant reply that carries a startTour ACTION — the SECOND
// trigger (per acceptance a): the assistant proposes startTour and the panel routes it
// to the player. Fulfilled at the browser boundary so the section is deterministic (no
// real model turn), the way the D3 driver stubs assistant surfaces.
const ASSISTANT_STARTTOUR_REPLY = {
  reply: 'Vou mostrar-lhe um tutorial guiado.',
  mode: 'teach',
  citations: [],
  actions: [{ toolName: 'app_action__ver_tutorial', action: { kind: 'startTour', tourId: 'visao-geral' }, input: {} }],
};

function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`PASS ${msg}`); }
function assert(cond, msg) { if (!cond) fail(msg); }

async function login() {
  const r = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN),
  });
  assert(r.ok, `login ${r.status}`);
  return (await r.json()).token;
}

/** Build ONE fresh app-base app through the real jobs pipeline (verify OFF —
 *  nondeterministic + orthogonal, same pattern as C5/D2/D3). */
async function buildSampleApp(token) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'e2-tour-playback' }) })).json();
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

/** REBUILD the SAME app — a FOLLOW-UP build on the same artifactId (the product's
 *  real "rebuild the app" path: POST a build job carrying the artifactId + a
 *  modification, which re-runs the pipeline + re-activation in place). This is the
 *  faithful "rebuild the SAME app" and, unlike bundle-update, carries no large body.
 *  The modification is generation-agnostic (add a page) and the coding agent never
 *  touches the platform shell, so the shell landmarks the tour targets (app-nav /
 *  app-content) are guaranteed to survive — that is exactly the selector-stability
 *  claim under test. Model is used to modify the app, but tour PLAYBACK stays
 *  zero-token (asserted separately for the replay). */
async function followUpRebuild(token, artifactId) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'e2-tour-rebuild' }) })).json();
  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ kind: 'build', sessionId: s.id, artifactId, language: 'pt', description: 'Adicione uma nova página chamada Definições com um campo para o nome do escritório.' }),
  })).json();
  if (!created.job || !created.job.id) fail(`follow-up rebuild not created (classifier deflected?): ${JSON.stringify(created)}`);
  const jobId = created.job.id;
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) fail(`follow-up rebuild ${jobId} did not finish in 10min`);
    await new Promise((r) => setTimeout(r, 6000));
    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
    if (job.status === 'completed') return;
    if (job.status === 'failed') fail(`follow-up rebuild failed: ${JSON.stringify(job.error)}`);
  }
}

/**
 * Benign console-error allowlist — COPIED VERBATIM from the D2/D3 drivers
 * (assistant-panel.e2e.mjs / assistant-modes.e2e.mjs). None is E2 code; each fires
 * on EVERY served app. Every OTHER console error fails the gate (strict).
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
  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not E2 code.
  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
  return false;
}

/** Plant the app-specific tour target + a fresh spotlight-UI observer as direct
 *  children of <body> (React never reclaims them — same technique as the C5/D3
 *  gates). Re-run after every navigation/reload. */
async function plant(page) {
  await page.evaluate((target) => {
    if (!document.querySelector('[data-demo-target="' + target + '"]')) {
      const el = document.createElement('div');
      el.setAttribute('data-demo-target', target);
      el.style.cssText = 'position:fixed;top:8px;left:8px;width:200px;height:36px;z-index:1;background:#fff;border:1px solid #ccc;';
      document.body.appendChild(el);
    }
  }, PLANTED_TARGET);
}

/** Geometry check: the tour spotlight ring is drawn AROUND the real element that
 *  carries `data-demo-target=<name>` (proves the highlight matches a real element). */
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
    // buildRingOverlay draws the ring at the target rect inflated by 4px each side.
    const near = Math.abs(rr.left - (tr.left - 4)) < 8 && Math.abs(rr.top - (tr.top - 4)) < 8 && Math.abs(rr.width - (tr.width + 8)) < 12 && Math.abs(rr.height - (tr.height + 8)) < 12;
    return { ok: near, ring: { l: rr.left, t: rr.top, w: rr.width, h: rr.height }, target: { l: tr.left, t: tr.top, w: tr.width, h: tr.height } };
  }, name);
}

async function openPanelAndStartTour(page) {
  const launcher = page.locator('.ekoa-assistant-launcher');
  await launcher.waitFor({ state: 'visible', timeout: 30_000 });
  await launcher.click();
  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
  // Pin Ensinar (teach) — a pure client action, no model call — to surface the launcher.
  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
  const startBtn = page.locator('.ekoa-assistant-tour-start');
  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await startBtn.click();
  await page.locator('.ekoa-assistant-tour').waitFor({ state: 'visible', timeout: 10_000 });
}

async function advance(page) {
  await page.locator('.ekoa-assistant-tour-next').click();
}

async function main() {
  const token = await login();
  ok('admin login');

  const artifactId = await buildSampleApp(token);
  ok(`fresh app-base app built (${artifactId})`);

  // Soft probe: the serving route is live (a fresh app has no captured tour -> 404,
  // or a valid overview if the generation authored one). Either way the route works;
  // playback below runs against the deterministic schema-valid spec.
  const routeProbe = await fetch(`${BASE}/api/demos/${artifactId}`);
  assert(routeProbe.status === 404 || routeProbe.status === 200, `GET /api/demos/:appId returned ${routeProbe.status} (route not live)`);
  ok(`serving route live for the built app (GET /api/demos/:appId -> ${routeProbe.status})`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
  });
  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));

  // Zero-token counter: count EVERY assistant model POST for the whole session.
  let assistantPosts = 0;
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
  });

  // Deterministic served tour: fulfil the panel's GET /api/demos/:appId at the
  // browser boundary with the schema-valid overview spec (a schema-validated stub).
  // Count the fulfils so the gate PROVES the panel actually fetched the route (not a
  // cached/embedded tour) — a regression that stopped fetching would drop this to 0.
  let demosFetches = 0;
  await page.route('**/api/demos/**', (route) => {
    demosFetches += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) });
  });

  const appUrl = `${BASE}/apps/${artifactId}/`;
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await plant(page);

  // ============================================================================
  // A. PLAYBACK — teach launcher -> fetch -> play step-by-step in the page.
  // ============================================================================
  await openPanelAndStartTour(page);
  const tour = page.locator('.ekoa-assistant-tour');
  assert(demosFetches >= 1, `panel never actually fetched GET /api/demos/:appId (fulfil count ${demosFetches})`);
  ok(`A: teach launcher started the tour; panel actually fetched GET /api/demos/:appId (${demosFetches}x) and rendered the tour block`);

  // Step 1 (navigate, "Bem-vindo") — the counter + copy render.
  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
  assert((await tour.locator('.ekoa-assistant-tour-copy-title').innerText()).includes('Bem-vindo'), 'step 1 copy missing "Bem-vindo"');
  await page.screenshot({ path: join(EVID, 'live-01-tour-start.png') });
  await advance(page);

  // Step 2 (spotlight app-nav) — the C3 ring is drawn AROUND the real app-nav.
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
  let geo = await spotlightSurrounds(page, 'app-nav');
  assert(geo.ok, `spotlight did not surround real app-nav: ${JSON.stringify(geo)}`);
  await page.screenshot({ path: join(EVID, 'live-02-spotlight-appnav.png') });
  ok('A: spotlight ring drawn on the real app-nav element (highlight matches a real element)');
  await advance(page);

  // Step 3 (spotlight the planted app target).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  geo = await spotlightSurrounds(page, PLANTED_TARGET);
  assert(geo.ok, `spotlight did not surround ${PLANTED_TARGET}: ${JSON.stringify(geo)}`);
  ok(`A: spotlight ring drawn on the planted app target ${PLANTED_TARGET}`);
  await advance(page);

  // Step 4 (await-action app-nav click) — advances only when the user really clicks.
  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-demo-target="app-nav"] button').first().click();
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });
  ok('A: await-action advanced on a real user click on the target');

  // Step 5 (spotlight app-content — a stable shell landmark present on every route,
  // unlike the default HomePage's home-empty which a generated app replaces).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  geo = await spotlightSurrounds(page, 'app-content');
  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
  await advance(page);

  // Step 6 (inject-prompt) — the suggested prompt lands in the composer, unsent.
  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
  assert(assistantPosts === 0, `inject-prompt auto-sent (assistant POSTs=${assistantPosts})`);
  await page.screenshot({ path: join(EVID, 'live-03-inject-prompt.png') });
  ok('A: inject-prompt dropped the suggestion into the composer and did NOT send it');
  await advance(page);

  // Done.
  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
  ok('A: tour reached "concluído" (data-tour-status=done)');

  // ============================================================================
  // B. ZERO TOKENS — no assistant model POST fired during the whole playback.
  // ============================================================================
  assert(assistantPosts === 0, `playback issued ${assistantPosts} POST /api/app-assistant — tours must be zero-token`);
  ok('B: zero POST /api/app-assistant during playback (client-side, zero-token)');

  // Close the tour before the rebuild.
  await page.locator('.ekoa-assistant-tour-close').click();

  // ============================================================================
  // C. REBUILD SELECTOR-STABILITY — rebuild the SAME app, replay, targets resolve.
  // ============================================================================
  await followUpRebuild(token, artifactId);
  ok('C: the SAME app was rebuilt (follow-up build on the same artifactId)');

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await plant(page);
  const postsBeforeReplay = assistantPosts;
  await openPanelAndStartTour(page);
  // Advance to the app-nav spotlight (step index 1) and assert it STILL resolves the
  // rebuilt app's real app-nav — the data-demo-target NAME survived the rebuild.
  await advance(page);
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
  geo = await spotlightSurrounds(page, 'app-nav');
  assert(geo.ok, `after rebuild the spotlight no longer resolves app-nav: ${JSON.stringify(geo)}`);
  await page.screenshot({ path: join(EVID, 'live-04-rebuild-replay.png') });
  assert(assistantPosts === postsBeforeReplay, `rebuild replay issued ${assistantPosts - postsBeforeReplay} assistant POST(s)`);
  ok('C: after the rebuild the same tour selectors still resolve real elements (selector stability via registry-ID names)');

  // ============================================================================
  // E. STARTTOUR ACTION PATH — the assistant-returned startTour action drives the
  //    player (the SECOND trigger), distinct from the teach launcher exercised in A.
  //    Deterministic: the assistant reply is a schema-valid stub carrying the action;
  //    the ONE app-assistant POST here is the trigger — the playback it starts must
  //    still be zero-token.
  // ============================================================================
  await page.locator('.ekoa-assistant-tour-close').click(); // close the replay tour -> composer reachable
  await page.route('**/api/app-assistant', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ASSISTANT_STARTTOUR_REPLY) });
  });
  const postsBeforeAction = assistantPosts;
  const demosBeforeAction = demosFetches;
  await page.locator('.ekoa-assistant-textarea').fill('Mostre-me um tutorial');
  await page.locator('.ekoa-assistant-send').click();
  // The reply's startTour action routes to the player, which FETCHES the tour and plays
  // it — proving the assistant-action trigger, not the teach launcher, started it.
  await page.locator('.ekoa-assistant-tour[data-tour-status]').waitFor({ state: 'visible', timeout: 15_000 });
  assert(demosFetches > demosBeforeAction, 'startTour action did not drive a GET /api/demos fetch');
  assert(assistantPosts === postsBeforeAction + 1, `startTour playback was not zero-token (${assistantPosts - postsBeforeAction} assistant POSTs, expected only the 1 trigger)`);
  await page.screenshot({ path: join(EVID, 'live-05-starttour-action.png') });
  ok('E: an assistant startTour action routed to the player, fetched the tour, and started playback (zero further tokens)');

  // ============================================================================
  // D. ZERO non-benign page JS console errors throughout.
  // ============================================================================
  const errors = consoleErrors.filter((e) => !benign(e));
  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
  ok('D: zero non-benign page JS console errors throughout');

  await browser.close();
  console.log('E2 LIVE GATE: PASS');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
