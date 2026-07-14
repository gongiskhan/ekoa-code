#!/usr/bin/env node
/**
 * PANEL LAZY-LOAD PERF live gate - committed, re-runnable end-to-end driver (operator-run G2).
 *
 * Since G2 the operator assistant panel is a PLATFORM-SERVED runtime asset
 * (/__ekoa/panel-runtime.js, React + panel + tour player in one IIFE), lazily loaded by a
 * tiny plain-DOM launcher the app bundle carries (the scaffold's mount.js). It is NOT baked
 * into every generated app's bundle anymore, and the C3 action runtime stays EAGERLY
 * injected (actions work with the panel never opened). This driver proves the lazy-load
 * behaviour live in a REAL served app-base app driven by a real Chromium on the credentialed
 * boot-b stack:
 *
 *   A. LAUNCHER IMMEDIATE, PANEL NOT FETCHED. On app load the launcher ("Assistente") is
 *      visible immediately AND the panel-runtime route has NOT been requested yet (request
 *      absence asserted from page start) - the panel parses zero React on first paint.
 *   B. LOAD-ON-INTERACTION. Clicking the launcher triggers EXACTLY ONE GET
 *      /__ekoa/panel-runtime.js and the panel opens (first-open intro visible). By the end
 *      the count is still exactly one - the idle preload never double-fetches.
 *   C. TOUR STILL PLAYS after the lazy mount. The lazy-mounted panel plays a pre-generated
 *      tour SAME-DOCUMENT (E2 regression guard): teach launcher -> GET /api/demos/:appId ->
 *      navigate + spotlight (C3 ring on the real element) + await-action (real click) +
 *      inject-prompt (lands in the composer, unsent) -> "Tutorial concluído.".
 *   D. ZERO TOKENS. No POST /api/app-assistant fires at ANY point (loading/mounting the
 *      panel and playing a tour are both zero-token) - asserted by a request counter.
 *   E. ZERO non-benign page JS console errors throughout (the SAME documented allowlist as
 *      the D2/E2 drivers: favicon 404 + anonymous whoami 401 + dev-proxy app-health 5xx).
 *
 * DETERMINISM. A committed gate cannot depend on what a generation produced nor on the model
 * authoring a tour, so the served tour is the SAME schema-valid overview fixture the E2 gate
 * uses, fulfilled at the browser boundary (page.route) - a schema-validated stub, the only
 * stub QA permits. The app under it is REAL (built through the jobs pipeline), so its shell
 * landmarks (app-nav / app-content) are genuinely emitted; one app-specific registry-ID
 * target (e2-tour-alvo) is planted in the page (same technique as the E2/C5/D3 gates). Every
 * assertion is STRUCTURAL - request presence/absence + count, tour status, spotlight geometry,
 * composer value - never on model prose.
 *
 * TRANSIENT TOLERANCE. The boot-b dev CORS proxy can answer a pre-response upstream socket
 * error with a text/plain 502 while a busy api is deep in a heavy build phase
 * (docs/findings.md F-2026-07-12-preview-502). The build-status poll is therefore blip-tolerant
 * (safeJson never throws on a non-JSON body; transients are retried, bounded). The one call
 * NEVER retried is the build-creation POST - a fresh build has no dedup key, so a retry would
 * spawn a second build; a blip there fails loud.
 *
 * Black-box over the running dev cortex (backend.port, the boot-b proxy) + a real Chromium.
 * Builds ONE fresh app-base app (verify OFF - nondeterministic + orthogonal, same as
 * C5/D2/D3/E2/F2/G1). The panel-runtime asset must be BUILT + SERVED (npm run build --workspace
 * api produces assets/panel-runtime.js; restart the stack) before this runs. Run:
 * node tests/e2e/panel-perf.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };
const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'G2');

// 20min: a real build on a fresh boot-b stack was observed completing at ~12min (2026-07-13,
// fees-knowledge gate), so the old 10min deadline was miscalibrated for cold-stack builds.
const BUILD_TIMEOUT_MS = 20 * 60_000;
// Consecutive transient (proxy-error / non-JSON) build-poll responses tolerated before failing loud.
const MAX_POLL_TRANSIENTS = 30;
// The panel-runtime asset the app bundle's launcher lazily loads.
const PANEL_RUNTIME_PATH = '/__ekoa/panel-runtime.js';
// The app-specific (non-landmark) registry-ID target the tour spotlights - planted in the page
// like the E2/C5/D3 gates so the surface is deterministic.
const PLANTED_TARGET = 'e2-tour-alvo';

// The schema-valid overview tour the panel fetches - the SAME fixture the unit test validates
// against demoSpecSchema (tests/apps/tour-player.test.ts), so this "stub" is a schema-validated
// stub. Targets are data-demo-target NAMES: shell-chrome landmarks (app-nav/app-content,
// rebuild-stable) plus the planted app target.
const TOUR_FIXTURE = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'e2-overview-tour.json'), 'utf-8'));
const INJECT_PROMPT = TOUR_FIXTURE.steps.find((s) => s.type === 'inject-prompt').prompt;

/** The fixture tour with `appId` stamped to the built artifact (as a real serve would). */
function buildTour(appId) {
  return { ...TOUR_FIXTURE, appId };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(msg) { console.error(`E2E FAIL: ${msg}`); process.exit(1); }
function ok(msg) { console.log(`PASS ${msg}`); }
function assert(cond, msg) { if (!cond) fail(msg); }

/**
 * Fetch + parse JSON WITHOUT throwing. Returns { ok, status, json, text }. A non-2xx status or a
 * body that is not valid JSON (e.g. the dev-proxy's text/plain "proxy error" 502) comes back as
 * ok:false with the raw text, so callers can treat it as a transient rather than crashing the gate
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

/** Build ONE fresh app-base app through the real jobs pipeline (verify OFF - nondeterministic +
 *  orthogonal, same pattern as C5/D2/D3/E2). The build-creation POST is NEVER retried (no dedup
 *  key); the status poll tolerates bounded dev-proxy transients. */
async function buildSampleApp(token) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'g2-panel-perf' }) })).json();
  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
  })).json();
  if (!created.job || !created.job.id) fail(`build not created: ${JSON.stringify(created)}`);
  const jobId = created.job.id;
  const deadline = Date.now() + BUILD_TIMEOUT_MS;
  let transients = 0;
  for (;;) {
    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 20min`);
    await sleep(6000);
    const res = await safeJson(`${BASE}/api/v1/jobs/${jobId}`, { headers: H });
    if (!res.ok || !res.json) {
      if (++transients > MAX_POLL_TRANSIENTS) fail(`build poll: too many transients (last: ${res.status} ${String(res.text).slice(0, 120)})`);
      continue;
    }
    transients = 0;
    const job = res.json;
    if (job.status === 'completed') return job.artifactId;
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
  }
}

/**
 * Benign console-error allowlist - COPIED VERBATIM from the D2/E2 drivers
 * (assistant-panel.e2e.mjs / tour-playback.e2e.mjs). None is G2 code; each fires on EVERY served
 * app. Every OTHER console error fails the gate (strict).
 */
function benign(entry) {
  const url = String(entry.url || '');
  const text = String(entry.text || '');
  // 1. favicon: the browser auto-requests /favicon.ico and served apps ship none → 404. Not app code.
  if (/favicon/i.test(`${url} ${text}`)) return true;
  // 2. Anonymous SSO whoami probe (injected-context.ts): window.__ekoa.whoami() GETs
  //    /api/app-sso/me and treats 401 as the normal "no visitor session" state (returns null). The
  //    401 is the EXPECTED anonymous state; the browser merely logs the failed resource. Pre-existing.
  if (url.endsWith('/api/app-sso/me') && /\b401\b/.test(text)) return true;
  // 3. Injected health beacon (injected-context.ts): POSTs /api/app-health (keepalive) on load;
  //    through the boot-b dev CORS proxy this returns 5xx (a proxy artifact — same-origin prod does
  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not G2 code.
  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
  // 4. Tour-availability probe (panel fix d172c2a): the panel GETs /api/demos/:appId once on mount
  //    to decide whether to offer the teach launcher; on an app with NO stored tour this is an
  //    EXPECTED 404 (the by-design "no tour" state, same class as the app-sso/me 401) that the
  //    browser logs as a failed resource. Not an app error.
  if (/\/api\/demos\//.test(url) && /\b404\b/.test(text)) return true;
  return false;
}

/** Plant the app-specific tour target as a direct child of <body> (React never reclaims it -
 *  same technique as the E2/C5/D3 gates). */
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

/** Geometry check: the tour spotlight ring is drawn AROUND the real element that carries
 *  `data-demo-target=<name>` (proves the highlight matches a real element). */
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

async function advance(page) {
  await page.locator('.ekoa-assistant-tour-next').click();
}

async function main() {
  const token = await login();
  ok('admin login');

  const artifactId = await buildSampleApp(token);
  ok(`fresh app-base app built (${artifactId}) - the app bundle carries only the lazy launcher`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const page = await context.newPage();

  // --- Instrumentation: collect from page start. ---
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
  });
  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));

  // Panel-runtime fetches (the lazy asset) + assistant model POSTs (must stay 0), counted for the
  // whole session so the gate can prove request ABSENCE before interaction and EXACTLY ONE fetch.
  let panelRuntimeReqs = 0;
  let assistantPosts = 0;
  page.on('request', (req) => {
    if (req.url().includes(PANEL_RUNTIME_PATH)) panelRuntimeReqs += 1;
    if (req.method() === 'POST' && req.url().includes('/api/app-assistant')) assistantPosts += 1;
  });

  // Deterministic served tour: fulfil the panel's GET /api/demos/:appId at the browser boundary
  // with the schema-valid overview fixture (a schema-validated stub). Count the fulfils so the gate
  // PROVES the lazy-mounted panel actually fetched the route.
  let demosFetches = 0;
  await page.route('**/api/demos/**', (route) => {
    demosFetches += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(buildTour(artifactId)) });
  });

  const appUrl = `${BASE}/apps/${artifactId}/`;
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });

  // ============================================================================
  // A. LAUNCHER IMMEDIATE, PANEL NOT FETCHED YET.
  // ============================================================================
  const launcher = page.locator('.ekoa-assistant-launcher');
  await launcher.waitFor({ state: 'visible', timeout: 30_000 });
  const launcherText = (await launcher.innerText()).trim();
  assert(/Assistente/i.test(launcherText), `launcher text is "${launcherText}", expected to contain "Assistente"`);
  // The panel-runtime must NOT have been requested before any interaction (true lazy). The launcher
  // renders synchronously from the tiny app-bundle mount.js; the idle preload is floored well beyond
  // this point, so this holds deterministically.
  assert(panelRuntimeReqs === 0, `panel-runtime was fetched (${panelRuntimeReqs}) BEFORE any interaction - not lazy`);
  assert(assistantPosts === 0, `an assistant POST fired before interaction (${assistantPosts})`);
  await page.screenshot({ path: join(EVID, 'live-01-launcher-no-fetch.png') });
  ok('A: launcher visible immediately with NO panel-runtime fetch yet (zero React parsed on first paint)');

  // ============================================================================
  // B. LOAD-ON-INTERACTION: click -> the panel OPENS -> exactly one fetch ever.
  // The waiter is armed BEFORE the click (waitForRequest only observes FUTURE
  // requests - armed after, a fast same-origin fetch slips by: the first run of this
  // gate failed exactly that way). And it TOLERATES no-new-request: if the 2s-floored
  // idle preload won the race, the click fetches nothing new - the open-intent event
  // opens the already-mounted panel, and the once-only invariant is asserted on the
  // TOTAL fetch count below, which is the honest claim (never eager, never twice).
  // ============================================================================
  const panelReq = page
    .waitForRequest((req) => req.url().includes(PANEL_RUNTIME_PATH), { timeout: 15_000 })
    .catch(() => null);
  await launcher.click();
  const intro = page.locator('.ekoa-assistant-intro-lead');
  await intro.waitFor({ state: 'visible', timeout: 15_000 });
  void panelReq; // the waiter may have missed a pre-arm idle fetch; the counter is authoritative
  assert(panelRuntimeReqs === 1, `expected exactly one panel-runtime fetch in total, got ${panelRuntimeReqs}`);
  const introText = (await intro.innerText()).toLowerCase();
  assert(introText.includes('três formas'), `first-open lead missing "três formas": "${introText}"`);
  await page.screenshot({ path: join(EVID, 'live-02-panel-open.png') });
  ok('B: clicking the launcher triggered exactly ONE panel-runtime fetch and the panel opened');

  // ============================================================================
  // C. TOUR STILL PLAYS after the lazy mount (E2 regression guard).
  // ============================================================================
  await plant(page);
  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
  // Pin Ensinar (teach) - a pure client action, no model call - to surface the tour launcher.
  await page.locator('.ekoa-assistant-mode', { hasText: 'Ensinar' }).click();
  const startBtn = page.locator('.ekoa-assistant-tour-start');
  await startBtn.waitFor({ state: 'visible', timeout: 10_000 });
  await startBtn.click();
  const tour = page.locator('.ekoa-assistant-tour');
  await tour.waitFor({ state: 'visible', timeout: 10_000 });
  assert(demosFetches >= 1, `lazy-mounted panel never fetched GET /api/demos/:appId (fulfil count ${demosFetches})`);

  // Step 1 (navigate, "Bem-vindo").
  await tour.locator('.ekoa-assistant-tour-progress', { hasText: 'Passo 1 de 6' }).waitFor({ state: 'visible', timeout: 10_000 });
  assert((await tour.locator('.ekoa-assistant-tour-copy-title').innerText()).includes('Bem-vindo'), 'step 1 copy missing "Bem-vindo"');
  await advance(page);

  // Step 2 (spotlight app-nav) - the C3 ring is drawn AROUND the real app-nav.
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="1"]').waitFor({ timeout: 10_000 });
  let geo = await spotlightSurrounds(page, 'app-nav');
  assert(geo.ok, `spotlight did not surround real app-nav: ${JSON.stringify(geo)}`);
  await page.screenshot({ path: join(EVID, 'live-03-tour-spotlight.png') });
  await advance(page);

  // Step 3 (spotlight the planted app target).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  geo = await spotlightSurrounds(page, PLANTED_TARGET);
  assert(geo.ok, `spotlight did not surround ${PLANTED_TARGET}: ${JSON.stringify(geo)}`);
  await advance(page);

  // Step 4 (await-action app-nav click) - advances only when the user really clicks.
  await page.locator('.ekoa-assistant-tour[data-tour-status="awaiting"]').waitFor({ timeout: 10_000 });
  await page.locator('[data-demo-target="app-nav"] button').first().click();
  await page.locator('.ekoa-assistant-tour[data-tour-step-index="4"]').waitFor({ timeout: 10_000 });

  // Step 5 (spotlight app-content).
  await page.waitForSelector('[data-ekoa-actions-ui="spotlight"]', { timeout: 10_000 });
  geo = await spotlightSurrounds(page, 'app-content');
  assert(geo.ok, `spotlight did not surround app-content: ${JSON.stringify(geo)}`);
  await advance(page);

  // Step 6 (inject-prompt) - the suggested prompt lands in the composer, unsent.
  await page.locator('.ekoa-assistant-tour-note').waitFor({ timeout: 10_000 });
  const draftVal = await page.locator('.ekoa-assistant-textarea').inputValue();
  assert(draftVal.trim() === INJECT_PROMPT, `inject-prompt did not land in the composer: "${draftVal}"`);
  await advance(page);

  // Done.
  await page.locator('.ekoa-assistant-tour[data-tour-status="done"]').waitFor({ timeout: 10_000 });
  await page.screenshot({ path: join(EVID, 'live-04-tour-done.png') });
  ok('C: the lazy-mounted panel played the tour to "concluído" (navigate + spotlight + await-action + inject-prompt)');

  // ============================================================================
  // D. ZERO TOKENS throughout + still exactly one panel-runtime fetch (idle never double-loaded).
  // ============================================================================
  // Give the idle preload's floored timer time to have fired (a no-op once the click already loaded).
  await sleep(2500);
  assert(assistantPosts === 0, `an assistant model POST fired (${assistantPosts}) - loading the panel + playing a tour must be zero-token`);
  assert(panelRuntimeReqs === 1, `panel-runtime fetched ${panelRuntimeReqs} times - the idle preload must not double-load after a click`);
  ok('D: zero POST /api/app-assistant throughout; exactly one panel-runtime fetch (no idle double-load)');

  // ============================================================================
  // E. ZERO non-benign page JS console errors throughout.
  // ============================================================================
  const errors = consoleErrors.filter((e) => !benign(e));
  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
  ok('E: zero non-benign page JS console errors throughout');

  await browser.close();
  console.log('G2 LIVE GATE: PASS');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
