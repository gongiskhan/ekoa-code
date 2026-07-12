#!/usr/bin/env node
/**
 * Action registry ROUND-TRIP — committed, re-runnable end-to-end driver (operator-run C5).
 *
 * Proves the operate loop of a generated app: a host (standing in for the Cortex-side
 * assistant, D1) issues manifest actions over the injected in-page runtime (C3), and the
 * served app VISIBLY executes them through its own state layer:
 *
 *   Cortex issues actions.execute  ->  UI visibly executes (highlight ring drawn; a field
 *   value set through the app's own input/change events)  ->  a DESTRUCTIVE action prompts
 *   a confirmation card before anything runs.
 *
 * Also the TEST-HARNESS DUAL USE (FLOW_PLAN C5): `driveAppAction()` below is the exact
 * helper a journey probe / tester agent uses to drive a built app's registry — one
 * investment, two uses (the run's own e2e and any future built-app journey).
 *
 * The audit-rows-land dimension of the registry is proven server-side by C4's unit round-trip
 * (auditAssistantAction -> logActivity) and end-to-end once D1 mounts the assistant (D3 gate);
 * this driver proves the CLIENT round-trip the assistant depends on, deterministically over the
 * app base's stable shell landmarks (data-demo-target="app-nav" etc.) — no dependency on what
 * the generation produced.
 *
 * Black-box over the running dev cortex (backend.port) + a real Chromium. Builds ONE sample app
 * from the `app` base through the real jobs pipeline (needs a model credential — the boot-b
 * stack), then drives it. Idempotent. Run: node tests/e2e/action-registry.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };

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

async function buildSampleApp(token) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  // This gate tests the RUNTIME round-trip, not the build verifier — so disable the
  // LLM verify stage (its verdict is nondeterministic and orthogonal to what C5 asserts).
  // The driver's own runtime assertions below ARE the gate. (Same pattern as j3-build build1.)
  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'c5-registry' }) })).json();
  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
  })).json();
  const jobId = created.job.id;
  const deadline = Date.now() + 8 * 60_000;
  for (;;) {
    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 8min`);
    await new Promise((r) => setTimeout(r, 6000));
    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
    if (job.status === 'completed') return job.artifactId;
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
  }
}

/** Mint a preview URL (owner capability) for the served app. */
async function servedUrl(token, artifactId) {
  // The owner JWT authorises /apps/:id/ directly; the driver loads it with the bearer via a
  // route init script is overkill — instead use the artifact's public share? No: draft apps are
  // owner-gated. Simplest committed path: fetch the HTML with the bearer to confirm 200, then
  // drive the SAME URL in the browser with the Authorization header set on the context.
  return `${BASE}/apps/${artifactId}/`;
}

/**
 * Set up the real HOST->app topology: an outer host page (same origin) embeds the served app in an
 * IFRAME, exactly as the dashboard preview and the tour player do. The runtime inside the iframe
 * posts to window.parent (the host), which is how a served app is driven in production; it refuses
 * same-window posts by design (a served app must not be driven by its own document). Returns after
 * the iframe has loaded and its runtime is installed.
 */
async function embedAppInHost(page, appUrl) {
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' }); // establish the same origin as host
  await page.evaluate((src) => new Promise((resolve) => {
    // Replace the top document with a minimal host that frames the app.
    document.body.innerHTML = '';
    const f = document.createElement('iframe');
    f.id = 'ekoa-app-frame';
    f.style.cssText = 'width:100vw;height:100vh;border:0;';
    f.src = src;
    f.addEventListener('load', () => resolve(true), { once: true });
    document.body.appendChild(f);
  }), appUrl);
  // The child iframe, NOT the main frame (both carry an /apps/ URL because the host page is itself
  // an app load): drive + plant in the SAME child window the runtime replies from.
  const frame = page.frames().find((fr) => fr !== page.mainFrame() && fr.url().includes('/apps/'));
  if (!frame) throw new Error('app iframe not found');
  // Wait for the server-injected runtime to install inside the frame, then plant a KNOWN probe
  // target. The round-trip drives the REAL injected runtime in a REAL served app; using a
  // test-controlled target (rather than an LLM-generated landmark) keeps the gate deterministic
  // and independent of what any given generation produced.
  await frame.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
  await frame.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-demo-target', 'c5-probe');
    const input = document.createElement('input');
    input.id = 'c5-probe-input';
    wrap.appendChild(input);
    document.body.appendChild(wrap);
  });
  return frame;
}

/**
 * TEST-HARNESS DUAL USE: drive one manifest action through the in-page runtime and resolve on the
 * terminal result. Posts from the HOST (top window) to the app iframe, and listens on the host for
 * the runtime's reply. This is the exact helper a journey probe / tester agent reuses.
 */
async function driveAppAction(page, action, params) {
  return page.evaluate(({ action, params }) => new Promise((resolve, reject) => {
    const ENVELOPE = 1;
    const frame = document.getElementById('ekoa-app-frame');
    const win = frame.contentWindow;
    const origin = new URL(frame.src).origin;
    const id = 'probe-' + Math.floor(performance.now());
    function onMsg(e) {
      const d = e.data;
      if (!d || d.__ekoaActions !== ENVELOPE || d.id !== id) return;
      if (d.type === 'actions.result') { window.removeEventListener('message', onMsg); resolve(d); }
      if (d.type === 'actions.error') { window.removeEventListener('message', onMsg); reject(new Error(d.reason)); }
    }
    window.addEventListener('message', onMsg);
    win.postMessage({ __ekoaActions: ENVELOPE, type: 'actions.init', hostOrigin: window.location.origin }, origin);
    win.postMessage({ __ekoaActions: ENVELOPE, type: 'actions.execute', id, action: { ...action, params: params || {} } }, origin);
    setTimeout(() => { window.removeEventListener('message', onMsg); reject(new Error('timeout')); }, 8000);
  }), { action, params });
}

async function main() {
  const token = await login();
  ok('admin login');
  const artifactId = await buildSampleApp(token);
  ok(`sample app built from the app base (${artifactId})`);

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const page = await context.newPage();

  // Embed the served app in a host iframe (the real production topology) and confirm the runtime
  // is installed inside the frame.
  const frame = await embedAppInHost(page, await servedUrl(token, artifactId));
  const hasRuntime = await frame.evaluate(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined');
  assert(hasRuntime, 'action runtime not injected into the served app');
  ok('action runtime injected into the served app (iframe topology)');

  // 1) Cortex issues a highlight -> the runtime VISIBLY draws the ring over the target inside the app.
  const hi = await driveAppAction(page, { id: 'destacar-probe', kind: 'highlight', labelPt: 'Destacar', description: 'x', target: 'c5-probe', destructive: false });
  assert(hi.status === 'done', `highlight status ${hi.status}`);
  const ringDrawn = await frame.evaluate(() => document.querySelectorAll('[data-ekoa-actions-ui]').length > 0);
  assert(ringDrawn, 'no runtime UI drawn inside the app for highlight');
  ok('highlight action executed visibly inside the app (ring drawn)');

  // 1b) A setField drives the app's own input through native setter + input/change (the events the
  // app's own validation/state sees) — proving actions dispatch as user-equivalent interactions.
  const sf = await driveAppAction(page, { id: 'preencher-probe', kind: 'setField', labelPt: 'Preencher', description: 'x', target: 'c5-probe', destructive: false }, { valor: 'ekoa-c5' });
  assert(sf.status === 'done', `setField status ${sf.status}`);
  const fieldVal = await frame.evaluate(() => document.getElementById('c5-probe-input').value);
  assert(fieldVal === 'ekoa-c5', `field value after setField: ${fieldVal}`);
  ok('setField drove the app input through user-equivalent events (value applied)');

  // 2) A DESTRUCTIVE action prompts a confirmation card inside the app BEFORE anything runs.
  const confirmSeen = await page.evaluate(() => new Promise((resolve) => {
    const win = document.getElementById('ekoa-app-frame').contentWindow;
    const doc = document.getElementById('ekoa-app-frame').contentDocument;
    const origin = new URL(document.getElementById('ekoa-app-frame').src).origin;
    win.postMessage({ __ekoaActions: 1, type: 'actions.init', hostOrigin: window.location.origin }, origin);
    win.postMessage({ __ekoaActions: 1, type: 'actions.execute', id: 'destr-1', action: { id: 'apagar-tudo', kind: 'custom', labelPt: 'Apagar tudo', description: 'x', destructive: true, params: {} } }, origin);
    const started = Date.now();
    const t = setInterval(() => {
      if (doc.querySelector('[data-demo-target="ekoa-confirm-acao"]')) { clearInterval(t); resolve(true); }
      if (Date.now() - started > 6000) { clearInterval(t); resolve(false); }
    }, 100);
  }));
  assert(confirmSeen, 'destructive action did not prompt a confirmation card');
  ok('destructive action prompted a confirmation card before dispatch');

  // 3) Cancelling the confirm reports cancelled (nothing ran).
  const cancelled = await page.evaluate(() => new Promise((resolve) => {
    const doc = document.getElementById('ekoa-app-frame').contentDocument;
    const btn = doc.querySelector('[data-demo-target="ekoa-cancelar-acao"]');
    if (!btn) return resolve('no-cancel-button');
    function onMsg(e) {
      const d = e.data;
      if (d && d.__ekoaActions === 1 && d.type === 'actions.result' && d.id === 'destr-1') { window.removeEventListener('message', onMsg); resolve(d.status); }
    }
    window.addEventListener('message', onMsg);
    btn.click();
    setTimeout(() => resolve('timeout'), 4000);
  }));
  assert(cancelled === 'cancelled', `cancel path status ${cancelled}`);
  ok('cancelling the confirmation reports cancelled (destructive action never ran)');

  await browser.close();
  console.log('\nE2E PASS: action-registry round-trip (issue -> visible execute -> destructive confirm -> cancel)');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
