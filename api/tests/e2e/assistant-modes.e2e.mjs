#!/usr/bin/env node
/**
 * Operator assistant THREE-MODE + OPERATE-LOOP live gate — committed, re-runnable driver
 * (operator-run D3).
 *
 * D2 proved the panel mounts, opens, and completes ONE real model turn in a real served app. D3
 * proves the three MODES end-to-end plus the operate-loop properties D2 deferred, live in a real
 * served app-base app driven by a real Chromium, on the credentialed boot-b stack:
 *
 *   1. DO (Operar)  — a PT-PT operate request maps to a declared ui_action; the response carries
 *      the action, the panel dispatches it through window.__ekoaActions, and the C3 runtime VISIBLY
 *      drives it (highlight/badge appear; the target field's value actually changes in the DOM);
 *      the panel renders the "Ação executada." result line. Plus: a DESTRUCTIVE action prompts the
 *      PT-PT confirmation card BEFORE anything runs (C5 sentinel technique), and only runs on
 *      confirm.
 *   2. PAUSE-ON-USER-INPUT — while a driven action is executing with another queued behind it, a
 *      REAL (isTrusted) user click cancels the active AND the queued action; the queue does NOT
 *      continue (the queued setField never overwrites the field).
 *   3. SHOW (Mostrar) — an unpinned overview request; the SERVER infers mode 'show', echoed on the
 *      response and reflected on the panel toggle; a non-empty reply renders.
 *   4. TEACH (Ensinar) — an unpinned "passo a passo" request; the server infers mode 'teach',
 *      reflected on the toggle; a step-structured reply renders.
 *   5. CITED — a domain question grounded on a seeded knowledge doc surfaces a non-empty citations
 *      set; the panel renders the "Fontes" block.
 *   6. Zero non-benign page JS console errors throughout (the SAME documented allowlist as the D2
 *      driver: the anonymous whoami 401 + the dev-proxy app-health 5xx, both pre-existing platform
 *      behaviours, not D3 code).
 *
 * DETERMINISM. A committed gate cannot depend on what a given generation produced, so the operate
 * surface is CONTROLLED, not scraped: after building one fresh app-base app, the driver PATCHes a
 * known action manifest onto the artifact data bag (a non-destructive setField + a destructive
 * custom), and plants the matching data-demo-target landmark in the served page (same technique as
 * the C5 action-registry gate). The manifest is real (validated by the admission middleware against
 * the shared AppActionManifest contract on every request), the DOM target is real, and the assertions
 * are STRUCTURAL — action presence, server-echoed mode, citation presence, DOM state — never on
 * exact model prose. The destructive-confirm and pause-on-user-input properties are driven directly
 * through the same-document window.__ekoaActions API the panel itself uses (no model call), so they
 * are fully deterministic; the model is called at most 5 times (do[+1 retry], show, teach, cited).
 *
 * Black-box over the running dev cortex (backend.port, the boot-b proxy) + a real Chromium. Builds
 * ONE fresh app-base app through the real jobs pipeline (verify stage OFF — nondeterministic +
 * orthogonal). Idempotent. Run: node tests/e2e/assistant-modes.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
const ADMIN = { username: 'admin', password: 'tmp12345' };
const EVID = join(REPO_ROOT, 'docs', 'autothing', 'runs', '20260712-150958-4bb23640', 'slices', 'D3');

const TURN_TIMEOUT_MS = 150_000;

// The planted operate target (data-demo-target) the declared setField action drives.
const TARGET = 'd3-nome-cliente';
// The manifest the driver PATCHes onto the artifact so the operate surface is deterministic. Both
// actions are validated by the admission middleware against the shared AppActionManifest contract.
const MANIFEST = {
  version: 1,
  actions: [
    {
      id: 'adicionar-cliente',
      kind: 'setField',
      labelPt: 'Adicionar cliente',
      description:
        'Preenche o nome de um novo cliente no campo de registo de clientes. Use esta ação sempre que o utilizador pedir para adicionar ou criar um cliente com um determinado nome.',
      target: TARGET,
      params: [{ name: 'valor', type: 'string', required: true, labelPt: 'Nome do cliente' }],
      destructive: false,
    },
    {
      id: 'apagar-todos-clientes',
      kind: 'custom',
      labelPt: 'Apagar todos os clientes',
      description: 'Remove permanentemente todos os clientes do registo. Ação destrutiva e irreversível.',
      params: [],
      destructive: true,
    },
  ],
};

// A seeded knowledge doc in the owner's org so the CITED turn has something real to ground on.
const KB_DOC = {
  collection: 'manual-interno',
  title: 'Política de Retenção de Documentos',
  text:
    'Segundo a política interna do escritório, os documentos dos clientes devem ser retidos durante um ' +
    'período mínimo de dez anos após o encerramento do processo. Findo esse prazo, os documentos são ' +
    'arquivados de forma segura ou eliminados de acordo com o regulamento de proteção de dados.',
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

/** Build ONE fresh app-base app through the real jobs pipeline. Verify stage OFF (its verdict is
 *  nondeterministic + orthogonal — same pattern as C5/D2). */
async function buildSampleApp(token) {
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  await fetch(`${BASE}/api/v1/settings/me`, { method: 'PATCH', headers: H, body: JSON.stringify({ build: { verifyBuilds: false } }) });
  const s = await (await fetch(`${BASE}/api/v1/sessions`, { method: 'POST', headers: H, body: JSON.stringify({ title: 'd3-assistant-modes' }) })).json();
  const created = await (await fetch(`${BASE}/api/v1/jobs`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ kind: 'build', sessionId: s.id, language: 'pt', templateId: 'app', description: 'Um registo simples de clientes do escritório com nome e telefone' }),
  })).json();
  const jobId = created.job.id;
  const deadline = Date.now() + 10 * 60_000;
  for (;;) {
    if (Date.now() > deadline) fail(`build ${jobId} did not finish in 10min`);
    await new Promise((r) => setTimeout(r, 6000));
    const job = await (await fetch(`${BASE}/api/v1/jobs/${jobId}`, { headers: H })).json();
    if (job.status === 'completed') return job.artifactId;
    if (job.status === 'failed') fail(`build failed: ${JSON.stringify(job.error)}`);
  }
}

/** PATCH a known action manifest onto the artifact data bag (merges — appUrl etc. preserved). The
 *  admission middleware reads art.data.actionManifest on every /api/app-assistant request, so this
 *  makes the operate surface deterministic without depending on what the generation declared. */
async function setManifest(token, artifactId) {
  const r = await fetch(`${BASE}/api/v1/artifacts/${artifactId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { actionManifest: MANIFEST } }),
  });
  assert(r.ok, `manifest PATCH ${r.status}`);
}

/** Seed one knowledge doc into the owner's org so the CITED turn grounds on real content. */
async function seedKnowledge(token) {
  const r = await fetch(`${BASE}/api/v1/knowledge/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(KB_DOC),
  });
  assert(r.status === 201, `knowledge seed ${r.status}`);
}

/**
 * A console-error entry is benign ONLY if it is one of these KNOWN, pre-existing platform /
 * dev-harness failed-resource logs — COPIED VERBATIM from the D2 driver (assistant-panel.e2e.mjs).
 * None is D3 code; each fires on EVERY served app. Every OTHER console error fails the gate.
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
  //    not proxy the beacon). Pre-existing dev-harness noise on every served app, not D3 code.
  if (url.endsWith('/api/app-health') && /\b5\d\d\b/.test(text)) return true;
  return false;
}

/** Fire one assistant turn through the panel (type + send), and resolve the parsed response body.
 *  Sets up waitForResponse BEFORE sending so the body is captured deterministically. */
async function assistantTurn(page, text) {
  const respP = page.waitForResponse(
    (r) => r.url().includes('/api/app-assistant') && r.request().method() === 'POST',
    { timeout: TURN_TIMEOUT_MS },
  );
  await page.locator('.ekoa-assistant-textarea').fill(text);
  await page.locator('.ekoa-assistant-send').click();
  const resp = await respP;
  assert(resp.status() === 200, `app-assistant responded ${resp.status()} for "${text.slice(0, 40)}"`);
  return resp.json();
}

/** The mode currently reflected on the panel toggle (the aria-pressed button's label). */
async function pressedMode(page) {
  return page.locator('.ekoa-assistant-mode[aria-pressed="true"]').innerText();
}

async function main() {
  const token = await login();
  ok('admin login');

  const artifactId = await buildSampleApp(token);
  ok(`fresh app-base app built (${artifactId})`);
  await setManifest(token, artifactId);
  ok('deterministic action manifest PATCHed onto the artifact (setField + destructive custom)');
  await seedKnowledge(token);
  ok('knowledge doc seeded into the owner org (for the cited turn)');

  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') { const loc = msg.location(); consoleErrors.push({ text: msg.text(), url: loc && loc.url }); }
  });
  page.on('pageerror', (err) => consoleErrors.push({ text: `pageerror: ${err && err.message}`, url: '' }));

  await page.goto(`${BASE}/apps/${artifactId}/`, { waitUntil: 'domcontentloaded' });

  // Open the panel.
  const launcher = page.locator('.ekoa-assistant-launcher');
  await launcher.waitFor({ state: 'visible', timeout: 30_000 });
  await launcher.click();
  await page.locator('.ekoa-assistant-intro-lead').waitFor({ state: 'visible', timeout: 10_000 });
  // The runtime installs early, but confirm it before we drive actions through it.
  await page.waitForFunction(() => typeof window.__ekoaActionRuntimeInstalled !== 'undefined', { timeout: 15_000 });
  ok('panel opened; same-document action runtime installed');

  // Plant the operate landmark (top-left, clear of the bottom-right panel), a MutationObserver that
  // records any transient runtime UI (highlight/badge), and the destructive-action sentinel — all
  // as direct children of <body> so React never reclaims them (same technique as the C5 gate).
  await page.evaluate((target) => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-demo-target', target);
    wrap.style.cssText = 'position:fixed;top:8px;left:8px;width:220px;height:38px;z-index:1;background:#fff;border:1px solid #ccc;';
    const input = document.createElement('input');
    input.id = 'd3-nome-input';
    input.style.cssText = 'width:100%;height:100%;box-sizing:border-box;';
    wrap.appendChild(input);
    document.body.appendChild(wrap);

    window.__d3SawActionsUi = false;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if ((n.matches && n.matches('[data-ekoa-actions-ui]')) || (n.querySelector && n.querySelector('[data-ekoa-actions-ui]'))) {
          window.__d3SawActionsUi = true;
        }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    window.__d3SentinelRan = false;
    window.__ekoaApp = window.__ekoaApp || {};
    window.__ekoaApp.actions = window.__ekoaApp.actions || {};
    window.__ekoaApp.actions['apagar-todos-clientes'] = () => { window.__d3SentinelRan = true; };
  }, TARGET);

  // ============================================================================================
  // 1. DO (Operar): an operate request maps to the declared setField; the panel dispatches it and
  //    the runtime VISIBLY drives it (field value changes; highlight/badge appear). One retry
  //    margin for model nondeterminism (the only place the model must emit a structured action).
  // ============================================================================================
  let doBody = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.evaluate(() => {
      window.__d3SawActionsUi = false;
      const el = document.getElementById('d3-nome-input');
      if (el) el.value = '';
    });
    const body = await assistantTurn(page, 'Adicione um cliente chamado Ana');
    assert(body.mode === 'do', `DO turn: server mode "${body.mode}", expected "do"`);
    if (!Array.isArray(body.actions) || body.actions.length === 0) {
      if (attempt === 2) fail('DO turn: response carried no actions after retry');
      continue;
    }
    // Wait for the panel to render the terminal run line for this turn.
    await page.locator('.ekoa-assistant-run[data-status="done"]').last().waitFor({ state: 'visible', timeout: 20_000 });
    const fieldVal = await page.evaluate(() => document.getElementById('d3-nome-input').value);
    const sawUi = await page.evaluate(() => window.__d3SawActionsUi === true);
    if (fieldVal && /ana/i.test(fieldVal) && sawUi) { doBody = body; break; }
    if (attempt === 2) fail(`DO turn: field value "${fieldVal}" / sawRuntimeUI=${sawUi} after retry`);
  }
  const runLabel = (await page.locator('.ekoa-assistant-run[data-status="done"]').last().innerText()).trim();
  assert(/executada/i.test(runLabel), `DO run line "${runLabel}" missing "executada"`);
  await page.screenshot({ path: join(EVID, 'live-01-do-highlight.png') });
  ok(`DO: operate request -> ${doBody.actions.length} action(s); runtime drove the field to "Ana" + drew runtime UI; panel line "${runLabel}"`);

  // ============================================================================================
  // 1b. DESTRUCTIVE confirm-before-dispatch (direct drive through the same-document runtime API the
  //     panel uses — no model call). The destructive custom action must show the PT-PT confirm card
  //     and NOT run before confirmation; confirming then runs it (sentinel flips).
  // ============================================================================================
  await page.evaluate(() => {
    window.__d3SentinelRan = false;
    window.__d3DestrResult = null;
    window.__ekoaActions
      .execute({ id: 'apagar-todos-clientes', kind: 'custom', labelPt: 'Apagar todos os clientes', description: 'x', destructive: true, params: {} })
      .then((r) => { window.__d3DestrResult = r; });
  });
  const confirmBtn = page.locator('[data-demo-target="ekoa-confirm-acao"]');
  await confirmBtn.waitFor({ state: 'visible', timeout: 8_000 });
  const ranBeforeConfirm = await page.evaluate(() => window.__d3SentinelRan === true);
  assert(ranBeforeConfirm === false, 'destructive action RAN before the user confirmed');
  await page.screenshot({ path: join(EVID, 'live-02-confirm.png') });
  ok('destructive action prompted the PT-PT confirmation card and did NOT run before confirm');
  await confirmBtn.click();
  await page.waitForFunction(() => window.__d3DestrResult && window.__d3DestrResult.status === 'done', { timeout: 8_000 });
  const ranAfterConfirm = await page.evaluate(() => window.__d3SentinelRan === true);
  assert(ranAfterConfirm === true, 'destructive action did NOT run after the user confirmed');
  ok('destructive action ran only AFTER the user confirmed (confirm-before-dispatch holds)');

  // ============================================================================================
  // 2. PAUSE-ON-USER-INPUT (direct drive). An active action (highlight polling a missing target)
  //    with a setField QUEUED behind it; a REAL isTrusted click cancels BOTH — the queue does not
  //    continue (the queued setField never overwrites the field).
  // ============================================================================================
  await page.evaluate(() => {
    document.getElementById('d3-nome-input').value = 'Ana'; // known pre-state
    window.__d3Pause1 = null;
    window.__d3Pause2 = null;
    // Active: highlight a target that does not exist -> the runtime polls (stays active ~8s).
    window.__ekoaActions
      .execute({ id: 'destacar-em-falta', kind: 'highlight', labelPt: 'Destacar', description: 'x', target: 'alvo-inexistente-d3', params: {} })
      .then((r) => { window.__d3Pause1 = r; });
    // Queued behind it: a setField that, IF it ran, would overwrite the field — it must NOT.
    window.__ekoaActions
      .execute({ id: 'adicionar-cliente', kind: 'setField', labelPt: 'x', description: 'x', target: 'd3-nome-cliente', params: { valor: 'NAO-DEVE-CORRER' } })
      .then((r) => { window.__d3Pause2 = r; });
  });
  // A REAL user interaction on an app element (isTrusted true). data-demo-target landmark, NOT the
  // runtime's own UI, so the runtime treats it as the human taking over.
  await page.locator('#d3-nome-input').click();
  await page.waitForFunction(() => window.__d3Pause1 && window.__d3Pause2, { timeout: 8_000 });
  const pause = await page.evaluate(() => ({
    p1: window.__d3Pause1,
    p2: window.__d3Pause2,
    field: document.getElementById('d3-nome-input').value,
  }));
  assert(pause.p1.status === 'cancelled' && pause.p1.detail === 'user-input', `active action not cancelled on user input: ${JSON.stringify(pause.p1)}`);
  assert(pause.p2.status === 'cancelled' && pause.p2.detail === 'user-input', `queued action not cancelled on user input: ${JSON.stringify(pause.p2)}`);
  assert(pause.field === 'Ana', `queue continued despite user input — field is "${pause.field}", expected untouched "Ana"`);
  ok('pause-on-user-input: trusted click cancelled the active AND queued action; the queue did not continue');

  // ============================================================================================
  // 3. SHOW (Mostrar): unpinned overview request -> server infers mode 'show', echoed + reflected
  //    on the toggle; non-empty reply.
  // ============================================================================================
  const showBody = await assistantTurn(page, 'Dê-me uma visão geral da aplicação');
  assert(showBody.mode === 'show', `SHOW turn: server mode "${showBody.mode}", expected "show"`);
  assert(typeof showBody.reply === 'string' && showBody.reply.trim().length > 0, 'SHOW turn: empty reply');
  await page.waitForFunction(() => {
    const b = document.querySelector('.ekoa-assistant-mode[aria-pressed="true"]');
    return b && b.textContent.trim() === 'Mostrar';
  }, { timeout: 10_000 });
  ok(`SHOW: server-inferred mode 'show' reflected on the toggle ("${(await pressedMode(page)).trim()}"); reply ${showBody.reply.length} chars`);

  // ============================================================================================
  // 4. TEACH (Ensinar): unpinned "passo a passo" request -> server infers mode 'teach', reflected
  //    on the toggle; a step-structured reply (numbered steps or "passo" markers).
  // ============================================================================================
  const teachBody = await assistantTurn(page, 'Ensine-me passo a passo como criar um cliente');
  assert(teachBody.mode === 'teach', `TEACH turn: server mode "${teachBody.mode}", expected "teach"`);
  const teachReply = String(teachBody.reply || '');
  assert(/\d+[.)]/.test(teachReply) || /passo/i.test(teachReply), `TEACH turn: reply is not step-structured: "${teachReply.slice(0, 160)}"`);
  await page.waitForFunction(() => {
    const b = document.querySelector('.ekoa-assistant-mode[aria-pressed="true"]');
    return b && b.textContent.trim() === 'Ensinar';
  }, { timeout: 10_000 });
  await page.screenshot({ path: join(EVID, 'live-03-teach.png') });
  ok(`TEACH: server-inferred mode 'teach' reflected on the toggle; step-structured reply (${teachReply.length} chars)`);

  // ============================================================================================
  // 5. CITED: a domain question grounded on the seeded doc -> non-empty citations -> panel renders
  //    the "Fontes" block.
  // ============================================================================================
  const citedBody = await assistantTurn(page, 'Durante quanto tempo devemos reter os documentos dos clientes segundo a política interna?');
  assert(Array.isArray(citedBody.citations) && citedBody.citations.length > 0, `CITED turn: response carried no citations: ${JSON.stringify(citedBody.citations)}`);
  const fontes = page.locator('.ekoa-assistant-citations-title', { hasText: 'Fontes' }).last();
  await fontes.waitFor({ state: 'visible', timeout: 10_000 });
  await page.screenshot({ path: join(EVID, 'live-04-fontes.png') });
  ok(`CITED: ${citedBody.citations.length} citation(s); panel rendered the "Fontes" block (${citedBody.citations.map((c) => c.title).join(', ')})`);

  // ============================================================================================
  // 6. ZERO non-benign page JS console errors throughout.
  // ============================================================================================
  const errors = consoleErrors.filter((e) => !benign(e));
  if (errors.length) fail(`page console errors: ${JSON.stringify(errors, null, 2)}`);
  ok('zero non-benign page JS console errors throughout');

  await browser.close();
  console.log('D3 LIVE GATE: PASS');
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)));
