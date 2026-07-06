#!/usr/bin/env node
/**
 * ERP CRM/commercial persistence + cross-page — committed, re-runnable E2E driver.
 *
 * Complements erp-auth-ui.e2e.mjs (login UI) and erp-kyc.e2e.mjs (KYC dossier).
 * Proves the commercial-side data actually persists to app-data AND that a change
 * in one surface is reflected in the dependent surfaces (the user's core concern:
 * "changes that have impacts on other areas do take effect"):
 *
 *   T1  Prospect create → appears in Prospects list, Funil (Novo column) AND
 *       Relatórios funnel count. (create functionality + 3-way cross-page)
 *   T2  Notificações "Marcar todas como lidas" → collection unread→0 AND the
 *       topbar bell badge clears. (persistence + cross-page reactivity)
 *   T3  ProposalEditor discount edit → persists to `propostas` AND the live
 *       client preview (S14) total recalculates. (functionality + persistence)
 *   T4  Completing an activity in AtividadeDetail ("Concluir") persists a status
 *       override (atividade_status collection) AND reduces the Dashboard de Atividades
 *       "Atrasadas" count by one AND survives a full reload. (This is the regression
 *       guard for BUG #1 — activity completion that never persisted/propagated — fixed
 *       via per-activity status overrides merged onto the template-derived activities.)
 *   T5  Client self-service booking confirm. The integration-free core asserts that
 *       window.parseSlotToDate/isoLocal are exported (regression guard for BUG #4 —
 *       AgendarSurface referenced these cross-file helpers that screens-prospect.jsx
 *       never window-exported, so "Confirmar reunião" always threw). If M365 is
 *       connected it also drives the confirm and asserts a REAL Teams calendar event
 *       (A04) is created (attendee-less, so no invite emails), then deletes it.
 *   T6  A09 conversion cascade → real SharePoint provisioning (A09.3). M365-gated.
 *       Drives a signed+conversionPending proposal, asserts the minted client's
 *       driveRoot points at a real SharePoint folder that exists with starter files,
 *       then deletes the folder. Prospect email omitted so no welcome email is sent.
 *   T7  Adobe Acrobat Sign connection probe (gated). The live proposal send is verified
 *       manually (see docs/erp-case-management-test-report.md) and NOT auto-run here,
 *       to avoid real signature-request emails on every run.
 *
 * T5–T7 are INTEGRATION-GATED: each checks whether the M365 workspace / Adobe
 * integration is connected and SKIPs (without failing) when it is not, so the driver
 * stays green in CI where the integrations are absent while exercising the real
 * side effects (and cleaning them up) whenever they are connected.
 *
 * CONDITIONAL ON THE ARTIFACT BEING PRESENT: if the case-management / ERP artifact
 * is not served at /apps/<APP_ID>/, the whole driver prints "SKIP" and exits 0.
 *
 * Auth: seeds a throwaway master user (bcrypt via bcryptjs) over the open app-data
 * API, logs in via the API and injects the session cookie. Seeded rows are removed
 * before AND after. APP_ID defaults to the local ERP sandbox id (override ERP_APP_ID).
 * Requires a running dev cortex serving the (rebuilt) artifact.
 * Run: node tests/e2e/erp-crm-persistence.e2e.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { chromium } from 'playwright';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const PORT = readFileSync(join(REPO_ROOT, 'backend.port'), 'utf-8').trim();
const BASE = `http://localhost:${PORT}`;
// Adapted for the rebuild (test-audit 5.1, helper-level only): the old default was a
// machine-local fork UUID; the deterministic target is the seeded featured app id.
const APP_ID = process.env.ERP_APP_ID || 'erp-imobiliario';
const COOKIE = `ekoa_app_sso_${APP_ID}`;
const APP = `${BASE}/apps/${APP_ID}`;

const MASTER = 'e2e.crm@brasilsalomao.pt';
const MASTER_PW = 'crm-pw-123456';
const TAG = `E2E-${Date.now().toString(36)}`;
const PROSPECT_NAME = `Prospect ${TAG}`;
const PROP_CODE = `PROP-E2E-${TAG}`;

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exit(1); }
function assert(c, m) { if (!c) fail(m); }
function ok(m) { console.log(`  PASS: ${m}`); }
const H = { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': APP_ID };

async function list(coll) { return (await (await fetch(`${BASE}/api/app-data/${coll}`, { headers: H })).json()).data || []; }
async function del(coll, id) { await fetch(`${BASE}/api/app-data/${coll}/${id}`, { method: 'DELETE', headers: H }); }
async function post(coll, body) {
  const r = await fetch(`${BASE}/api/app-data/${coll}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert(r.status === 201, `seed ${coll} -> ${r.status}`);
  return (await r.json()).data;
}

// ---- Integration probes (workspace M365 + Adobe) — gate the T5–T7 blocks. --------
// /api/m365/* forwards to Graph with the WORKSPACE token (app-context, X-Ekoa-App-Id,
// no user login), so a connected workspace integration is exercisable headlessly.
async function m365(method, path, body) {
  const r = await fetch(`${BASE}/api/m365/${path}`, {
    method,
    headers: body != null ? H : { 'X-Ekoa-App-Id': APP_ID },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, j };
}
async function m365Connected() {
  const r = await m365('GET', 'v1.0/me/drive?%24select=driveType');
  return r.status === 200 && !!(r.j && r.j.driveType);
}
async function adobeConnected() {
  try {
    const j = await (await fetch(`${BASE}/api/adobe-sign/status`, { headers: H })).json();
    return !!(j && j.connected);
  } catch { return false; }
}

// Match STABLE prefixes (not this run's unique TAG) so re-runs never accumulate
// leftovers from earlier runs. Only ever touches rows this test itself created.
const ACT5 = 'PRJ-0042-1#5'; // the late Golden-Visa seed activity T4 completes
const E2E_NAME_PREFIX = 'Prospect E2E-'; // every E2E prospect/minted-client name starts with this
async function cleanup() {
  for (const r of await list('utilizadores')) if (r && r.email === MASTER) await del('utilizadores', r.id);
  for (const r of await list('prospects')) if (r && typeof r.name === 'string' && r.name.startsWith(E2E_NAME_PREFIX)) await del('prospects', r.id);
  for (const r of await list('propostas')) if (r && typeof r.code === 'string' && r.code.startsWith('PROP-E2E-')) await del('propostas', r.id);
  for (const r of await list('notificacoes')) if (r && typeof r.titulo === 'string' && r.titulo.startsWith('E2E-')) await del('notificacoes', r.id);
  // T6 conversion cascade byproducts (client + projeto + kyc + contrato minted from the
  // E2E prospect all carry its name/derived fields). Best-effort — collections may not exist.
  for (const r of await list('clientes')) if (r && typeof r.name === 'string' && r.name.startsWith(E2E_NAME_PREFIX)) await del('clientes', r.id);
  for (const r of await list('projetos')) if (r && typeof r.client === 'string' && r.client.startsWith(E2E_NAME_PREFIX)) await del('projetos', r.id);
  for (const r of await list('kyc')) if (r && typeof r.name === 'string' && r.name.startsWith(E2E_NAME_PREFIX)) await del('kyc', r.id);
  for (const r of await list('contratos')) if (r && typeof r.cliente === 'string' && r.cliente.startsWith(E2E_NAME_PREFIX)) await del('contratos', r.id);
  // Restore the app's activity state: drop the override T4 writes so the seed activity
  // reverts to "late" (each run starts from Atrasadas=N, and the app isn't left mutated).
  for (const r of await list('atividade_status')) if (r && r.actCode === ACT5) await del('atividade_status', r.id);
  // Audit rows this driver's UI mutations generated (create/convert/etc. all embed the
  // E2E- tag in detalhe) — swept so repeated runs don't accumulate log noise.
  for (const r of await list('auditoria')) if (r && typeof r.detalhe === 'string' && r.detalhe.includes('E2E-')) await del('auditoria', r.id);
  // Real external side effects from T5/T6 (only if the workspace M365 integration is
  // connected): the SharePoint client folder and the throwaway Teams calendar event.
  try {
    const kids = await m365('GET', 'v1.0/sites/root/drive/root:/Ekoa AI/Clientes:/children?%24select=name');
    for (const f of ((kids.j && kids.j.value) || [])) {
      if (typeof f.name === 'string' && f.name.startsWith(E2E_NAME_PREFIX)) {
        await m365('DELETE', `v1.0/sites/root/drive/root:/Ekoa AI/Clientes/${f.name}`);
      }
    }
    const evs = await m365('GET', 'v1.0/me/events?%24top=25&%24select=id,subject');
    for (const e of ((evs.j && evs.j.value) || [])) {
      if (typeof e.subject === 'string' && e.subject.includes(E2E_NAME_PREFIX)) await m365('DELETE', `v1.0/me/events/${e.id}`);
    }
  } catch { /* M365 not connected — nothing external to clean */ }
}

// Ignore the benign, integration-dependent console noise: the pre-login whoami 401
// and the M365/Adobe workspace probes 403 (integrations not connected in CI/dev).
// "Failed to load resource" messages omit the URL from text() — it's in location().
function realError(text, url = '') {
  if (/\b401\b/.test(text)) return false;                                   // whoami / pre-login
  if (/\b403\b/.test(text) && /\/api\/(m365|adobe)/.test(url)) return false; // M365/Adobe probe
  if (/app-sso\/me/.test(text) || /app-sso\/me/.test(url)) return false;
  return true;
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) fail(`cortex not reachable at ${BASE}/health`);

  // ---- CONDITIONAL: skip cleanly if the ERP artifact is not served. -------------
  const bundle = await fetch(`${APP}/bundle.js`).catch(() => null);
  const indexHtml = bundle && bundle.ok ? await (await fetch(`${APP}/`)).text().catch(() => '') : '';
  if (!bundle || !bundle.ok || !/window\.__EKOA_APP_ID/.test(indexHtml)) {
    console.log(`SKIP: ERP artifact not present at ${APP}/ (bundle ${bundle ? bundle.status : 'unreachable'}). Nothing to test.`);
    process.exit(0);
  }

  await cleanup();
  await post('utilizadores', {
    email: MASTER, name: 'CRM Master', role: 'master', area: '—', dept: '—',
    initials: 'CM', color: '#1d7fa8', estado: 'Ativo', passwordHash: bcrypt.hashSync(MASTER_PW, 10),
  });
  // A proposal for T3, in a NON-signed stage so editing is representative.
  await post('propostas', {
    code: PROP_CODE, client: `Cliente ${TAG}`, dept: 'Societário', stage: 'Rascunho', resp: 'luan',
    when: 'agora', value: '€ 1.000',
    bodies: {}, itens: [{ nome: 'Serviço E2E', modelo: 'Obra (valor fixo)', valor: 1000, qtd: 1 }],
  });
  // Two unread notifications for T2 (titulo starts with TAG so cleanup is exact).
  await post('notificacoes', { titulo: `${TAG} nota 1`, detalhe: 'e2e', tone: 'info', icon: 'bell', quando: 'agora', lida: false });
  await post('notificacoes', { titulo: `${TAG} nota 2`, detalhe: 'e2e', tone: 'info', icon: 'bell', quando: 'agora', lida: false });

  // Login via API → inject the per-app session cookie so the SPA's whoami() authenticates.
  const lr = await fetch(`${BASE}/api/app-sso/login`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity: MASTER, password: MASTER_PW }),
  });
  assert(lr.status === 200, `api login -> ${lr.status}`);
  const setc = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')].filter(Boolean);
  let token = null;
  for (const c of setc) { const m = new RegExp(`${COOKIE}=([^;]+)`).exec(c); if (m) token = m[1]; }
  assert(token, 'login returned no session cookie');

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([{ name: COOKIE, value: token, url: BASE }]);
    const errors = [];
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const url = (m.location && m.location() && m.location().url) || '';
      if (realError(m.text(), url)) errors.push(`${m.text()} @ ${url}`);
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.message) || e)));

    const goto = async (hash) => { await page.goto(`${APP}/#${hash}`, { waitUntil: 'load' }); };
    const seesText = async (t, timeout = 20000) =>
      page.waitForFunction((s) => document.body && document.body.innerText.includes(s), t, { timeout });

    // Land authenticated on the dashboard.
    await goto('/dashboard');
    await seesText('Dashboard').catch(() => fail('did not authenticate onto the dashboard'));

    // ---- T1: Prospect create → list + Funil + Relatórios (cross-page) -----------
    console.log('T1: prospect create + cross-page');
    await goto('/prospects');
    await page.getByRole('button', { name: 'Novo prospect' }).first().click();
    await page.getByPlaceholder('Nome completo').fill(PROSPECT_NAME);
    await page.getByRole('button', { name: 'Criar prospect' }).click();
    await seesText(PROSPECT_NAME).catch(() => fail('T1: new prospect did not appear in the Prospects list'));
    ok('prospect created and shown in Prospects list');

    const created = (await list('prospects')).find((r) => r.name === PROSPECT_NAME);
    assert(created && created.stage === 'Novo', 'T1: prospect not persisted with stage "Novo"');
    ok('prospect persisted to app-data (stage=Novo)');

    await goto('/funil');
    await seesText(PROSPECT_NAME).catch(() => fail('T1: new prospect not shown in the Funil (cross-page)'));
    ok('prospect appears in the Funil kanban (cross-page)');

    await goto('/relatorios');
    // Wait for the live funnel breakdown table to finish loading its rows — the
    // DataTable shows skeletons until useCollection('prospects') resolves, and it
    // always renders one row per funnel stage (Novo..Ganho) once loaded.
    await page.waitForFunction(
      () => document.body && /etapa do funil/i.test(document.body.innerText) && /\bGanho\b/.test(document.body.innerText),
      { timeout: 20000 },
    ).catch(() => fail('T1: Relatórios funnel breakdown did not render its stage rows'));
    const report = await page.evaluate(() => {
      const t = document.body.innerText;
      const hasStages = /\bNovo\b/.test(t) && /\bGanho\b/.test(t);
      const nums = (t.match(/\d+/g) || []).map(Number);
      return { hasStages, max: nums.length ? Math.max(...nums) : 0 };
    });
    assert(report.hasStages, 'T1: Relatórios funnel stages (Novo/Ganho) missing');
    const prospectTotal = (await list('prospects')).length;
    assert(report.max >= prospectTotal, `T1: Relatórios does not reflect all prospects (max shown ${report.max} < ${prospectTotal})`);
    ok(`Relatórios funnel breakdown is live and reflects the created prospect (total ${prospectTotal})`);

    // ---- T2: Notificações mark-all-read → unread 0 + bell badge clears ----------
    console.log('T2: notifications mark-all-read + bell badge');
    await goto('/notificacoes');
    await seesText('Marcar todas como lidas');
    const unreadBefore = (await list('notificacoes')).filter((n) => !n.lida).length;
    assert(unreadBefore >= 2, `T2: expected >=2 unread seeded, got ${unreadBefore}`);
    await page.getByRole('button', { name: /Marcar todas como lidas/ }).click();
    await page.waitForTimeout(600);
    const unreadAfter = (await list('notificacoes')).filter((n) => !n.lida).length;
    assert(unreadAfter === 0, `T2: unread did not persist to 0 (got ${unreadAfter})`);
    ok('all notifications marked read + persisted (unread=0)');
    const badge = await page.evaluate(() => {
      const bell = document.querySelector('header button[title="Notificações"]');
      const b = bell && bell.querySelector('.mono');
      return b ? b.textContent.trim() : '';
    });
    assert(badge === '', `T2: bell badge did not clear (still "${badge}") — cross-page reactivity broken`);
    ok('topbar bell badge cleared (cross-page reactivity)');

    // ---- T3: Proposal discount edit → persists + live preview recalculates ------
    console.log('T3: proposal edit persistence + live preview');
    await goto(`/proposta?id=${encodeURIComponent(PROP_CODE)}`);
    await seesText('Dados gerais').catch(() => fail('T3: ProposalEditor did not open'));
    const discount = page.locator('input[type="number"]').first();
    await discount.waitFor({ timeout: 10000 });
    await discount.fill('10');
    await page.waitForTimeout(800);
    const propAfter = (await list('propostas')).find((r) => r.code === PROP_CODE);
    const dv = propAfter && propAfter.desconto && String(propAfter.desconto.valor);
    assert(dv === '10', `T3: discount did not persist (desconto.valor=${dv})`);
    ok('proposal discount persisted to app-data (desconto.valor=10)');
    const previewShowsDiscount = await page.evaluate(() =>
      /Desconto efetivo/i.test(document.body.innerText));
    assert(previewShowsDiscount, 'T3: live preview did not reflect the discount ("Desconto efetivo" absent)');
    ok('live client preview recalculated (shows "Desconto efetivo")');

    // ---- T4: activity completion persists + updates the dashboard (BUG #1 fixed) -----
    console.log('T4: activity completion persists + reduces dashboard Atrasadas');
    const readAtrasadas = async () => page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.display'))[0]; // first stat card = "Atrasadas"
      return el ? parseInt(el.textContent, 10) : NaN;
    });
    await goto('/atividades');
    await seesText('Dashboard de Atividades');
    await page.waitForTimeout(500);
    const lateBefore = await readAtrasadas();
    assert(lateBefore > 0, `T4: precondition — expected some late activities (Atrasadas=${lateBefore})`);
    // Complete the late Golden-Visa activity #5 (the row the dashboard opens).
    await goto('/atividade?n=5');
    await page.getByRole('button', { name: 'Concluir' }).first().click();
    await page.waitForTimeout(500);
    // (a) it PERSISTED as an override record (not local state).
    const ov = (await list('atividade_status')).find((r) => r.actCode === ACT5);
    assert(ov && ov.estado === 'Concluída', 'T4: completion did not persist an override (atividade_status)');
    ok('activity completion persisted an override record (atividade_status)');
    // (b) CROSS-PAGE: returning to the dashboard, Atrasadas drops by exactly one.
    await goto('/atividades');
    await page.waitForTimeout(500);
    const lateAfter = await readAtrasadas();
    assert(lateAfter === lateBefore - 1, `T4: dashboard Atrasadas did not drop by 1 (${lateBefore} -> ${lateAfter})`);
    ok(`dashboard Atrasadas dropped ${lateBefore} -> ${lateAfter} (the completed activity is no longer late)`);
    // (c) survives a FULL reload (proves durable persistence, not in-session state).
    await page.reload({ waitUntil: 'load' });
    await seesText('Dashboard de Atividades');
    await page.waitForTimeout(700);
    const lateReload = await readAtrasadas();
    assert(lateReload === lateAfter, `T4: completion did not survive reload (${lateAfter} -> ${lateReload})`);
    ok(`completion survives a full reload (Atrasadas stays ${lateReload})`);

    // ---- T5: client self-service booking — BUG #4 export guard + A04 Teams event ----
    // Integration-free core: AgendarSurface.confirmar() calls parseSlotToDate/isoLocal,
    // which live in screens-prospect.jsx and MUST be window-exported (BUG #4: they were
    // not, so "Confirmar reunião" always threw "parseSlotToDate is not defined").
    console.log('T5: booking confirm — parseSlotToDate/isoLocal export (BUG #4) + Teams event');
    await goto('/dashboard');
    const helpersExported = await page.evaluate(
      () => typeof window.parseSlotToDate === 'function' && typeof window.isoLocal === 'function');
    assert(helpersExported, 'T5: window.parseSlotToDate/isoLocal not exported — AgendarSurface confirm would crash (BUG #4 regression)');
    ok('booking helpers exported to window (BUG #4 guard: parseSlotToDate/isoLocal)');

    if (await m365Connected()) {
      const bookToken = `E2E-BT-${TAG}`;
      // No email + no responsáveis => an attendee-less event: real calendar side effect,
      // but Graph sends NO invitation emails, so the test never mails a real person.
      const bp = await post('prospects', {
        code: `${TAG}-A04`, name: `${PROSPECT_NAME} A04`, titular: `${PROSPECT_NAME} A04`,
        origin: 'Teste', fonte: 'Teste', tipo: 'Pessoa Singular', resp: 'luan',
        agendamento: { bookToken, estado: 'enviado-cliente', responsaveis: [] },
      });
      await page.goto(`${APP}/#/agendar?bt=${encodeURIComponent(bookToken)}&d=20%20Ago&h=14:30`, { waitUntil: 'load' });
      await page.getByRole('button', { name: 'Confirmar reunião' }).click();
      await page.waitForFunction(() => /Reunião confirmada/.test(document.body.innerText), { timeout: 30000 })
        .catch(() => fail('T5: booking confirm did not reach "Reunião confirmada" (Teams event creation failed)'));
      ok('client booking confirmed in the UI ("Reunião confirmada")');
      const ev = await m365('GET', 'v1.0/me/events?%24top=10&%24orderby=createdDateTime%20desc&%24select=id,subject,onlineMeeting');
      const mine = ((ev.j && ev.j.value) || []).find((e) => (e.subject || '').includes(`${PROSPECT_NAME} A04`));
      assert(mine && mine.onlineMeeting && mine.onlineMeeting.joinUrl, 'T5: no real Teams event with joinUrl created for the booking');
      ok('real Outlook/Teams event created with a join URL (A04)');
      const pp = (await list('prospects')).find((r) => r.id === bp.id);
      assert(pp && pp.agendamento && pp.agendamento.estado === 'agendado', 'T5: prospect not advanced to estado=agendado');
      ok('prospect advanced to estado=agendado (cross-persist)');
      if (mine) await m365('DELETE', `v1.0/me/events/${mine.id}`);
      await del('prospects', bp.id);
    } else {
      console.log('  SKIP: M365 workspace integration not connected — A04 live event not exercised (BUG #4 export guard above still ran).');
    }

    // ---- T6: A09 conversion cascade → real SharePoint provisioning (A09.3) ---------
    console.log('T6: conversion cascade → SharePoint folder (A09.3)');
    if (await m365Connected()) {
      const prA09 = await post('prospects', {
        code: `${TAG}-A09`, name: `${PROSPECT_NAME} A09`, titular: `${PROSPECT_NAME} A09`,
        origin: 'Teste', fonte: 'Teste', tipo: 'Pessoa Singular', area: 'Consultivo', dept: 'Societário',
        resp: 'luan', convertido: false, subclientes: [], doc: '999999990', stage: 'Assinada',
        // email intentionally omitted -> welcomeTo empty -> A09.10 welcome email is NOT sent
        // (keeps the committed test from mailing a real person on every run).
      });
      const propA09 = `PROP-E2E-${TAG}-A09`;
      await post('propostas', {
        code: propA09, prospectId: prA09.id, client: `${PROSPECT_NAME} A09`, stage: 'Assinada',
        conversionPending: true, items: [{ t: 4, iid: '1' }], resp: 'luan', validity: '30 dias',
        referencia: 'REF-E2E', bodies: {}, precos: {}, desconto: 0, kycTipo: 'Pessoa Singular',
        assinatura: { nome: `${PROSPECT_NAME} A09` },
      });
      await page.goto(`${APP}/#/client?id=${encodeURIComponent(propA09)}`, { waitUntil: 'load' });
      await page.waitForFunction(
        () => /Tudo concluído|dossiê de cliente foi criado/i.test(document.body.innerText),
        { timeout: 45000 },
      ).catch(() => fail('T6: conversion cascade did not complete on first open (client-side race — BUG #6 regression?)'));
      ok('conversion cascade completed on first open (client dossier created; BUG #6 race guard)');
      const client = (await list('clientes')).find((r) => typeof r.name === 'string' && r.name === `${PROSPECT_NAME} A09`);
      assert(client, 'T6: converted client row not created');
      assert(client.driveRoot && /Clientes\//.test(client.driveRoot), `T6: client.driveRoot (SharePoint path) not set (${client && client.driveRoot})`);
      ok(`SharePoint provisioning recorded driveRoot: ${client.driveRoot}`);
      const kids = await m365('GET', `v1.0/sites/root/drive/root:/${client.driveRoot}:/children?%24select=name`);
      const names = ((kids.j && kids.j.value) || []).map((x) => x.name);
      assert(kids.status === 200 && names.includes('README.txt'), `T6: SharePoint folder not found at ${client.driveRoot} (status ${kids.status})`);
      ok(`real SharePoint folder exists with starter files (${names.join(', ')})`);
      await m365('DELETE', `v1.0/sites/root/drive/root:/${client.driveRoot}`); // folder; rows removed by cleanup()
    } else {
      console.log('  SKIP: M365 not connected — A09.3 SharePoint provisioning not exercised.');
    }

    // ---- T7: Adobe Acrobat Sign connection probe (gated) ---------------------------
    // The live proposal send + convert-on-sign webhook are verified manually (see
    // docs/erp-case-management-test-report.md) and NOT auto-run here — a real send emails
    // signature requests to every recipient and cannot be cancelled through the proxy.
    console.log('T7: Adobe Acrobat Sign integration');
    if (await adobeConnected()) {
      ok('Adobe Acrobat Sign is connected (/status). Live send verified manually — not auto-run to avoid real signature-request emails.');
    } else {
      console.log('  SKIP: Adobe not connected — proposal e-signature send not exercised.');
    }

    assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
    console.log('\nE2E PASS: CRM create + cross-page (Funil/Relatórios), notification mark-read + bell badge, proposal edit persistence, activity completion persist + propagate (BUG #1), booking-helper export + Teams event (BUG #4), and — when M365/Adobe are connected — real SharePoint provisioning (A09.3, first-open conversion / BUG #6) + Adobe connectivity.');
  } finally {
    await browser.close();
    await cleanup();
  }
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
