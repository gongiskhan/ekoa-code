#!/usr/bin/env node
/**
 * ERP operations-side persistence + cross-page — committed, re-runnable E2E driver.
 *
 * Complements erp-auth-ui.e2e.mjs (login UI), erp-kyc.e2e.mjs (KYC dossier +
 * construtor/interno/review) and erp-crm-persistence.e2e.mjs (CRM core T1–T7).
 * Covers the operations surfaces those drivers do not touch (found by the
 * 2026-07-02 vision sweep — see docs/erp-case-management-test-report.md §10):
 *
 *   T1  MinhasTarefas (/tarefas): completing a task persists onto its
 *       `atividades` row (estado='Concluída', slaState='done'), survives reload,
 *       AND the Dashboard de Atividades "Atrasadas" count drops by one
 *       (collection extras merge into that dashboard).
 *   T2  ProspectDetail stage advance: "Qualificar lead" persists prospects.stage,
 *       the Funil kanban column follows (cross-page), the transition survives a
 *       reload, "Ações > Voltar etapa" moves it back, AND the mutations are
 *       captured in the `auditoria` collection + rendered on /admin/auditoria.
 *   T3  A03 + A05: prospect create auto-assigns the responsible from the Matriz
 *       (Consultivo×Migratório→luan, ×Fiscal→joao); "Avançar sem reunião" from
 *       the detail auto-creates the proposal draft pre-filled from the catálogo
 *       (dept's default fixed-price item, € 875 Obra), and "Adicionar do
 *       catálogo" persists a second item + recomputed value (€ 1475).
 *   T4  ProjetoDetail "Adicionar atividade" persists to `atividades`
 *       (projetoCode-scoped), bumps the tab count, survives reload, and shows on
 *       the Dashboard de Atividades "No prazo" bucket. Also the regression guard
 *       for the ProjetoDetail render loop (useCollection returned a fresh []
 *       identity while loading → "Maximum update depth exceeded" on every mount;
 *       fixed via a stable EMPTY_ROWS constant in ekoa.js) — the driver-wide
 *       no-console-errors gate would catch it recurring.
 *   T5  Lembretes (A12): "Novo lembrete" on the project's Lembretes tab persists
 *       to `lembretes` (estado='agendado', Master always appended to the
 *       destinatários) and survives reload.
 *   T6  ContratoLifecycle (S15→S18): every lifecycle action persists to
 *       `contratos` — Enviar para revisão → Em revisão; Aprovar → Em assinatura;
 *       both "Marcar como assinada" → assinaturas[i].estado='assinado';
 *       Concluir e arquivar → Arquivado + arquivo.local (SharePoint path);
 *       survives reload; plus the S18 direct "Arquivar contrato" path.
 *   T7  ClienteDetail sub-client inline edit (settled by the vision sweep; the
 *       earlier "inconclusive" verdict was an innerText-vs-input-value testing
 *       artifact): rename/doc commit on blur, relação persists on change,
 *       add/remove persist immediately — all onto clientes.subclients + subs
 *       recount, all surviving reload.
 *   T8  Client portal (#/client, public): a proposal's `validity` date renders
 *       in the hero ("válida até <date>") and the EN toggle translates the body.
 *       (Known open BUG #3: rows carrying `validade` instead of `validity`
 *       render "válida até —" — a field-name mismatch in ClientSurface. Not
 *       asserted here to avoid codifying the bug; see the report.)
 *   T9  Role Switcher ("Ver como") swaps the demo persona client-side only and
 *       a reload reverts to the real role; Relatórios "Exportar CSV" fires a
 *       real browser download with the expected filename shape.
 *
 * CONDITIONAL ON THE ARTIFACT BEING PRESENT: if the case-management / ERP
 * artifact is not served at /apps/<APP_ID>/, prints "SKIP" and exits 0.
 *
 * Auth: seeds a throwaway master user (bcrypt) over the open app-data API, logs
 * in via the API and injects the session cookie. Everything this driver creates
 * uses stable "E2E-OPS" prefixes and is removed before AND after (idempotent).
 * Run: node tests/e2e/erp-ops-persistence.e2e.mjs
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

const MASTER = 'e2e.ops@brasilsalomao.pt';
const MASTER_PW = 'ops-pw-123456';
const USER_CODE = 'E2E-OPS-USER'; // MinhasTarefas filters rows by resp === me.code||id
const TAG = `E2E-OPS-${Date.now().toString(36)}`;
// Stable prefixes (not this run's TAG) so re-runs never accumulate leftovers.
const P = 'E2E-OPS';
const PROSPECT_PREFIX = 'Prospect E2E-OPS';

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
// Poll app-data until `pick` returns truthy (UI writes are optimistic + async).
async function until(coll, pick, what, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const hit = pick(await list(coll));
    if (hit) return hit;
    if (Date.now() - t0 > ms) fail(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const starts = (v, p) => typeof v === 'string' && v.startsWith(p);
async function cleanup() {
  for (const r of await list('utilizadores')) if (r && r.email === MASTER) await del('utilizadores', r.id);
  for (const r of await list('atividades')) if (r && (starts(r.code, P) || starts(r.descricao, P))) await del('atividades', r.id);
  const myProspects = (await list('prospects')).filter((r) => r && starts(r.name, PROSPECT_PREFIX));
  const prospectIds = new Set(myProspects.map((r) => r.id));
  for (const r of myProspects) await del('prospects', r.id);
  // A05 auto-created proposals carry a generated code (PROP-01xx) — match by linkage.
  for (const r of await list('propostas')) {
    if (r && (starts(r.code, `PROP-${P}`) || prospectIds.has(r.prospectId) || starts(r.client, PROSPECT_PREFIX) || starts(r.client, P))) await del('propostas', r.id);
  }
  for (const r of await list('projetos')) if (r && starts(r.code, P)) await del('projetos', r.id);
  for (const r of await list('lembretes')) if (r && starts(r.titulo, P)) await del('lembretes', r.id);
  for (const r of await list('contratos')) if (r && (starts(r.code, `CTR-${P}`) || starts(r.cliente, P))) await del('contratos', r.id);
  for (const r of await list('clientes')) if (r && starts(r.code, P)) await del('clientes', r.id);
  for (const r of await list('auditoria')) if (r && (starts(r.detalhe, P) || (typeof r.detalhe === 'string' && r.detalhe.includes(P)))) await del('auditoria', r.id);
}

// Benign console noise: pre-login whoami 401 and M365/Adobe workspace probes 403.
function realError(text, url = '') {
  if (/\b401\b/.test(text)) return false;
  if (/\b403\b/.test(text) && /\/api\/(m365|adobe)/.test(url)) return false;
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
  const seedUser = await post('utilizadores', {
    email: MASTER, name: 'E2E Ops Tester', role: 'master', area: '—', dept: '—',
    initials: 'EO', color: '#1d7fa8', estado: 'Ativo', code: USER_CODE,
    passwordHash: bcrypt.hashSync(MASTER_PW, 10),
  });
  // T1 tasks: assigned to the seeded user's code so MinhasTarefas shows exactly these.
  await post('atividades', {
    code: `${P}-AT1`, descricao: `${P} Tarefa atrasada`, proj: `${P} Projeto`, projetoCode: `${P}-PRJ0`,
    sla: 'venceu há 1d', slaState: 'late', estado: 'Por fazer', resp: USER_CODE,
  });
  await post('atividades', {
    code: `${P}-AT2`, descricao: `${P} Tarefa no prazo`, proj: `${P} Projeto`, projetoCode: `${P}-PRJ0`,
    sla: 'vence em 5d', slaState: 'ontime', estado: 'Por fazer', resp: USER_CODE,
  });
  // T4/T5 project: own row so demo projects are never mutated (type 29 = NIF template).
  const PRJ_CODE = `${P}-PRJ1`;
  const PRJ_NAME = `${P} Projeto NIF`;
  await post('projetos', {
    code: PRJ_CODE, client: `${P} Cliente Projeto`, clientCode: `${P}-CLI-PRJ`, type: 29,
    name: PRJ_NAME, descricao: 'Projeto E2E', area: 'Consultivo', dept: 'Fiscal', subtipo: '—',
    resp: 'joao', status: 'Em curso', acts: 11, done: 2, late: 0,
  });
  // T6 contracts: clausulas copied from a demo row so the clausulasHeal mount-effect
  // doesn't rewrite them; `proposta` refs that match no propostas row so the
  // signedHeal effect can't auto-advance the estado.
  const demoContrato = (await list('contratos')).find((r) => Array.isArray(r.clausulas) && r.clausulas.length > 0);
  assert(demoContrato, 'T6 precondition: no demo contrato with clausulas to copy');
  const CTR1 = `CTR-${P}-9001`;
  const CTR2 = `CTR-${P}-9002`;
  const contratoBase = (code, n) => ({
    code, cliente: `${P} Cliente ${n}`, clienteCode: `${P}-C${n}`, proposta: `PROP-${P}-none-${n}`,
    minuta: { versao: 'v1', autor: 'luan', data: '01 Jul 2026' },
    clausulas: demoContrato.clausulas,
    revisoes: [{ v: 'v1', autor: 'luan', data: '01 Jul 2026', nota: 'minuta inicial' }],
    arquivo: null,
  });
  await post('contratos', {
    ...contratoBase(CTR1, 'Um'), estado: 'Minuta',
    assinaturas: [
      { parte: 'Cliente', nome: `${P} Cliente Um`, estado: 'pendente', data: null },
      { parte: 'BSM', nome: 'Dr. Fernando Senise', estado: 'pendente', data: null },
    ],
  });
  await post('contratos', {
    ...contratoBase(CTR2, 'Dois'), estado: 'Assinado',
    assinaturas: [
      { parte: 'Cliente', nome: `${P} Cliente Dois`, estado: 'assinado', data: '01 Jul 2026' },
      { parte: 'BSM', nome: 'Dr. Fernando Senise', estado: 'assinado', data: '01 Jul 2026' },
    ],
  });
  // T7 client: own row with a sub-client hierarchy (demo clients stay untouched).
  const CLI_CODE = `${P}-SUB-9001`;
  await post('clientes', {
    code: CLI_CODE, name: `${P} Titular`, type: 'Titular', subs: 2, projects: 0,
    area: 'Consultivo', dept: 'Migratório', resp: 'luan', status: 'Ativo',
    email: 'ops-sub@example.com', phone: '+351 900 000 001', origin: 'Teste',
    tipo: 'Pessoa Singular', doc: 'NIF 000000000',
    subclients: [
      { code: `${CLI_CODE}.1`, name: `${P} Sub Um`, rel: 'Cônjuge', doc: '111111111', type: 'Particular' },
      { code: `${CLI_CODE}.2`, name: `${P} Sub Dois`, rel: 'Sociedade', doc: '', type: 'Sociedade' },
    ],
  });
  // T8 portal proposal: `validity` is the field ClientSurface renders (items must be
  // [{t,iid}] catalogue refs or the services list renders empty).
  const PROP_PORTAL = `PROP-${P}-PORTAL`;
  await post('propostas', {
    code: PROP_PORTAL, client: `${P} Cliente Portal`, dept: 'Societário', stage: 'Enviada',
    resp: 'luan', when: 'agora', value: '€ 400', bodies: {}, precos: {}, desconto: 0,
    kycTipo: 'Pessoa Singular', referencia: `REF-${P}`, items: [{ t: 4, iid: '1' }],
    validity: '2026-12-31',
  });

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
    const seesNoText = async (t, timeout = 10000) =>
      page.waitForFunction((s) => document.body && !document.body.innerText.includes(s), t, { timeout });
    // Sub-client names/docs render as <input value> — invisible to innerText.
    const seesInputValue = async (v, timeout = 15000) =>
      page.waitForFunction((s) => Array.from(document.querySelectorAll('input')).some((i) => i.value === s), v, { timeout });
    // First stat card on /tarefas + /atividades dashboards ("Atrasadas").
    const readAtrasadas = async () => page.evaluate(() => {
      const el = document.querySelectorAll('.display')[0];
      return el ? parseInt(el.textContent, 10) : NaN;
    });

    // ---- T1: task completion persists + reduces Dashboard de Atividades Atrasadas ----
    console.log('T1: MinhasTarefas completion persists + /atividades cross-page');
    await goto('/atividades');
    await seesText('Dashboard de Atividades');
    await seesText(`${P} Tarefa atrasada`); // seeded extras merge into the dashboard
    await page.waitForTimeout(500);
    const lateBefore = await readAtrasadas();
    assert(lateBefore > 0, `T1 precondition: Atrasadas=${lateBefore}`);
    await goto('/tarefas');
    await seesText('As Minhas Tarefas');
    await seesText(`${P} Tarefa atrasada`);
    await seesText(`${P} Tarefa no prazo`);
    const stats = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.display.tnum')).map((t) => t.textContent.trim()));
    assert(JSON.stringify(stats) === JSON.stringify(['1', '0', '1']),
      `T1: per-user stat cards expected [1,0,1], got [${stats}]`);
    ok('per-user task list + stat cards show exactly the seeded tasks (1 late, 1 on time)');
    // Conclude control: unlabeled square button, only handle is title="Concluir <code>".
    await page.locator(`button[title="Concluir ${P}-AT1"]`).click();
    await seesText('Tarefa concluída · estado guardado');
    await seesNoText(`${P} Tarefa atrasada`); // pending-only view
    const at1 = await until('atividades', (rs) => rs.find((r) => r.code === `${P}-AT1` && r.estado === 'Concluída'), 'T1 completion persisted');
    assert(at1.slaState === 'done', `T1: slaState not updated (${at1.slaState})`);
    const at2 = (await list('atividades')).find((r) => r.code === `${P}-AT2`);
    assert(at2 && at2.estado === 'Por fazer', 'T1: untouched control task changed state');
    ok('completion persisted onto the atividades row (estado=Concluída, slaState=done); control row untouched');
    await page.reload({ waitUntil: 'load' });
    await seesText('As Minhas Tarefas');
    await seesText(`${P} Tarefa no prazo`);
    const statsAfter = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.display.tnum')).map((t) => t.textContent.trim()));
    assert(JSON.stringify(statsAfter) === JSON.stringify(['0', '0', '1']),
      `T1: post-reload stat cards expected [0,0,1], got [${statsAfter}]`);
    ok('completion survives a full reload (stat cards 0/0/1, task gone from pending list)');
    await goto('/atividades');
    await seesText('Dashboard de Atividades');
    await page.waitForTimeout(500);
    const lateAfter = await readAtrasadas();
    assert(lateAfter === lateBefore - 1, `T1: /atividades Atrasadas did not drop by 1 (${lateBefore} -> ${lateAfter})`);
    ok(`/atividades Atrasadas dropped ${lateBefore} -> ${lateAfter} (cross-page)`);

    // ---- T2: prospect stage advance persists + Funil + auditoria (cross-page) -------
    console.log('T2: prospect stage advance + Funil column + audit capture');
    const PR_NAME = `${PROSPECT_PREFIX} ${TAG} Stage`;
    await goto('/prospects');
    await page.getByRole('button', { name: 'Novo prospect' }).first().click();
    await page.getByPlaceholder('Nome completo').fill(PR_NAME);
    await page.getByPlaceholder('email@exemplo.com').fill('ops-stage@example.com'); // email => !missing => primary action is the stage advance
    await page.getByRole('button', { name: 'Criar prospect' }).click();
    await seesText(PR_NAME);
    const prStage = await until('prospects', (rs) => rs.find((r) => r.name === PR_NAME), 'T2 prospect created');
    assert(prStage.stage === 'Novo', `T2: created stage ${prStage.stage}`);
    await goto(`/prospect?id=${encodeURIComponent(prStage.code || prStage.id)}`);
    await seesText('Qualificar lead');
    await page.getByRole('button', { name: 'Qualificar lead' }).click();
    await until('prospects', (rs) => rs.find((r) => r.id === prStage.id && r.stage === 'Qualificação'), 'T2 stage persisted to Qualificação');
    ok('stage advance persisted (Novo -> Qualificação)');
    await page.reload({ waitUntil: 'load' });
    await seesText('Agendar reunião'); // primary button is stage-derived => persisted stage survived reload
    ok('advanced stage survives a full reload (primary button re-derived)');
    await goto('/funil');
    await seesText(PR_NAME);
    const colStage = await page.evaluate((name) => {
      const cols = Array.from(document.querySelectorAll('div')).filter((d) => (d.getAttribute('style') || '').includes('width: 268px'));
      const col = cols.find((c) => c.innerText.includes(name));
      const h = col && col.querySelector('.t-h2');
      return h ? h.textContent.trim() : null;
    }, PR_NAME);
    assert(colStage === 'Qualificação', `T2: Funil column for the prospect is "${colStage}", expected "Qualificação"`);
    ok('Funil kanban shows the prospect in the Qualificação column (cross-page)');
    // Ações > Voltar etapa persists the reverse transition.
    await goto(`/prospect?id=${encodeURIComponent(prStage.code || prStage.id)}`);
    await seesText(PR_NAME);
    await page.getByRole('button', { name: 'Ações', exact: true }).click();
    await page.getByRole('button', { name: /Voltar etapa/ }).click();
    await until('prospects', (rs) => rs.find((r) => r.id === prStage.id && r.stage === 'Novo'), 'T2 stage reverted to Novo');
    ok('Ações > Voltar etapa persisted (Qualificação -> Novo)');
    // Audit capture: creation + stage transitions were logged with the actor.
    const audits = (await list('auditoria')).filter((r) => typeof r.detalhe === 'string' && r.detalhe.includes(PR_NAME));
    assert(audits.some((r) => /Criou prospect/.test(r.acao || '')), 'T2: audit log missing "Criou prospect"');
    assert(audits.some((r) => /etapa/i.test(r.acao || '')), 'T2: audit log missing the stage-change entry');
    assert(audits.every((r) => r.user === seedUser.id || r.user === USER_CODE), 'T2: audit actor does not match the logged-in user');
    ok(`auditoria captured the mutations with the actor (${audits.length} entries)`);
    await goto('/admin/auditoria');
    await seesText('Registo imutável');
    await page.getByPlaceholder('Pesquisar ação, utilizador ou detalhe…').fill(PR_NAME);
    await seesText(PR_NAME);
    ok('audit entries render on /admin/auditoria (cross-page, filtered by search)');

    // ---- T3: A03 matriz auto-assign + A05 catalogue pre-fill on proposal create -----
    console.log('T3: A03 auto-assign (matriz) + A05 proposal pre-fill + catalogue add');
    assert(prStage.resp === 'luan', `T3: A03 default rule Consultivo×Migratório expected resp=luan, got ${prStage.resp}`);
    ok('A03: default-rule prospect auto-assigned to luan (Consultivo×Migratório)');
    const PR2_NAME = `${PROSPECT_PREFIX} ${TAG} Fiscal`;
    await goto('/prospects');
    await page.getByRole('button', { name: 'Novo prospect' }).first().click();
    await page.getByPlaceholder('Nome completo').fill(PR2_NAME);
    await page.getByPlaceholder('email@exemplo.com').fill('ops-fiscal@example.com');
    // The Departamento <select> is the one carrying the DEPARTAMENTOS options (e.g. Cível).
    await page.locator('select').filter({ has: page.locator('option', { hasText: 'Cível' }) }).first().selectOption('Fiscal');
    await page.getByRole('button', { name: 'Criar prospect' }).click();
    await seesText(PR2_NAME);
    const pr2 = await until('prospects', (rs) => rs.find((r) => r.name === PR2_NAME && r.resp === 'joao'), 'T3 Fiscal prospect auto-assigned to joao');
    assert(pr2.dept === 'Fiscal', `T3: dept ${pr2.dept}`);
    ok('A03: Consultivo×Fiscal prospect auto-assigned to joao (matriz rule varies with dept)');
    // A05: "Avançar sem reunião" auto-creates the proposal draft pre-filled from the catálogo.
    await goto(`/prospect?id=${encodeURIComponent(prStage.code || prStage.id)}`);
    await seesText(PR_NAME);
    await page.getByRole('button', { name: 'Ações', exact: true }).click();
    await page.getByRole('button', { name: /Avançar sem reunião/ }).click();
    await seesText('Concessão de Autorização de Residência', 30000); // dept default item hydrated
    const itemIds = (p) => (Array.isArray(p.items) ? p.items.map((x) => (x && x.t != null ? x.t : x)) : []);
    const prop = await until('propostas', (rs) => rs.find((x) => x.prospectId === prStage.id), 'T3 proposal auto-created');
    assert(prop.stage === 'Rascunho' && prop.resp === 'luan', `T3: draft stage/resp ${prop.stage}/${prop.resp}`);
    assert(itemIds(prop).includes(13), `T3: default catalogue item 13 missing (items=${JSON.stringify(prop.items)})`);
    const pagePrefill = await page.evaluate(() => /875/.test(document.body.innerText) && /Obra \(valor fixo\)/.test(document.body.innerText));
    assert(pagePrefill, 'T3: editor does not show the pre-filled price/model (875 / Obra)');
    ok('A05: proposal auto-created as Rascunho with the dept default item pre-filled (€ 875, Obra)');
    await page.getByRole('button', { name: 'Adicionar do catálogo' }).click();
    await page.getByPlaceholder(/Procurar serviço/).fill('NIF');
    await page.getByRole('button', { name: /Pedido de NIF/ }).first().click();
    const prop2 = await until('propostas',
      (rs) => rs.find((x) => x.prospectId === prStage.id && itemIds(x).includes(13) && itemIds(x).includes(29)),
      'T3 catalogue item persisted');
    assert(String(prop2.value || '').replace(/\D/g, '') === '1475', `T3: recomputed value ${prop2.value}`);
    ok('A05: catalogue add persisted (items 13+29, value € 1475 recomputed)');
    await page.reload({ waitUntil: 'load' });
    await seesText('Pedido de NIF');
    await seesText('Concessão de Autorização de Residência');
    ok('proposal items survive a full reload');

    // ---- T4: ProjetoDetail "Adicionar atividade" persists + cross-page --------------
    console.log('T4: projeto add-activity persists + Dashboard de Atividades');
    const ACT_TEXT = `${P} atividade manual ${TAG}`;
    await goto(`/projetos/seed?id=${encodeURIComponent(PRJ_CODE)}`);
    await seesText(PRJ_NAME);
    await page.getByRole('tab', { name: /^Atividades/ }).waitFor({ timeout: 10000 });
    const tabBefore = await page.getByRole('tab', { name: /^Atividades/ }).innerText();
    await page.getByRole('button', { name: 'Adicionar atividade' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByPlaceholder('Ex.: recolher comprovativo de morada do titular').fill(ACT_TEXT);
    await dlg.getByRole('button', { name: 'Adicionar atividade' }).click();
    await seesText(ACT_TEXT);
    const added = await until('atividades', (rs) => rs.find((r) => r.descricao === ACT_TEXT), 'T4 activity persisted');
    assert(added.estado === 'Por fazer' && added.projetoCode === PRJ_CODE, `T4: persisted shape wrong (${added.estado}/${added.projetoCode})`);
    ok('manually added activity persisted to atividades (projetoCode-scoped)');
    const tabAfter = await page.getByRole('tab', { name: /^Atividades/ }).innerText();
    const n = (s) => parseInt(s.replace(/\D/g, ''), 10);
    assert(n(tabAfter) === n(tabBefore) + 1, `T4: tab count ${tabBefore} -> ${tabAfter}`);
    ok(`Atividades tab count bumped (${n(tabBefore)} -> ${n(tabAfter)})`);
    await page.reload({ waitUntil: 'load' });
    await seesText(ACT_TEXT);
    ok('added activity survives a full reload');
    await goto('/atividades');
    await seesText('Dashboard de Atividades');
    await page.locator('div.card', { hasText: 'No prazo' }).first().click();
    await seesText(ACT_TEXT);
    ok('added activity appears in the Dashboard de Atividades "No prazo" bucket (cross-page)');

    // ---- T5: Lembretes (A12) create + persist on the project's Lembretes tab --------
    console.log('T5: lembrete create persists (A12)');
    const LEMB_TEXT = `${P} lembrete ${TAG}`;
    await goto(`/projetos/seed?id=${encodeURIComponent(PRJ_CODE)}`);
    await seesText(PRJ_NAME);
    await page.getByRole('tab', { name: /Lembretes/ }).click();
    await seesText('Novo lembrete');
    await page.getByRole('button', { name: 'Novo lembrete' }).click();
    await seesText('Novo lembrete de projeto');
    await page.getByPlaceholder('Ex.: renovar contrato daqui a 6 meses').fill(LEMB_TEXT);
    await page.getByRole('button', { name: 'Agendar lembrete' }).click();
    await page.waitForFunction((t) =>
      document.body.innerText.includes(t) && !document.body.innerText.includes('Novo lembrete de projeto'),
      LEMB_TEXT, { timeout: 15000 });
    const lemb = await until('lembretes', (rs) => rs.find((r) => r.titulo === LEMB_TEXT), 'T5 lembrete persisted');
    assert(lemb.projetoCode === PRJ_CODE && lemb.estado === 'agendado', `T5: persisted shape wrong (${lemb.projetoCode}/${lemb.estado})`);
    assert(Array.isArray(lemb.destinatarios) && lemb.destinatarios.includes('fernando'), 'T5: Master (fernando) not appended to destinatários');
    ok('lembrete persisted (estado=agendado, Master auto-notified)');
    await page.reload({ waitUntil: 'load' });
    await seesText(PRJ_NAME);
    await page.getByRole('tab', { name: /Lembretes/ }).click(); // reload resets to the atividades tab
    await seesText(LEMB_TEXT);
    ok('lembrete survives a full reload');

    // ---- T6: contract lifecycle S15→S18 persists every transition -------------------
    console.log('T6: contrato lifecycle (Minuta -> ... -> Arquivado) + direct archive');
    const pickContract = async (code) => {
      await page.getByPlaceholder('Procurar cliente ou código…').fill(code);
      await page.locator('aside button', { hasText: code }).first().click();
      await seesText(code);
    };
    const ctr = async (code) => (await list('contratos')).find((r) => r.code === code);
    await goto('/contratos');
    await seesText('Contratos · ciclo de vida');
    await pickContract(CTR1);
    await page.getByRole('button', { name: 'Enviar para revisão' }).click();
    await until('contratos', (rs) => rs.find((r) => r.code === CTR1 && r.estado === 'Em revisão'), 'T6 Em revisão persisted');
    ok('Enviar para revisão persisted (Minuta -> Em revisão)');
    await page.getByRole('button', { name: 'Aprovar e enviar para assinatura' }).click();
    await until('contratos', (rs) => rs.find((r) => r.code === CTR1 && r.estado === 'Em assinatura'), 'T6 Em assinatura persisted');
    ok('Aprovar persisted (Em revisão -> Em assinatura)');
    await page.getByRole('button', { name: 'Marcar como assinada' }).first().click();
    await until('contratos', (rs) => {
      const r = rs.find((x) => x.code === CTR1);
      return r && r.assinaturas[0].estado === 'assinado' && r.assinaturas[1].estado === 'pendente' ? r : null;
    }, 'T6 first signature persisted');
    ok('first signature persisted (Cliente assinado, BSM pendente)');
    await page.getByRole('button', { name: 'Marcar como assinada' }).first().click();
    await seesText('Concluir e arquivar');
    const signed = await ctr(CTR1);
    assert(signed.assinaturas.every((a) => a.estado === 'assinado'), 'T6: second signature not persisted');
    assert(signed.estado === 'Em assinatura', `T6: estado should stay Em assinatura until archive (got ${signed.estado})`);
    ok('both signatures persisted; estado correctly stays Em assinatura until archive');
    await page.getByRole('button', { name: 'Concluir e arquivar' }).click();
    const archived = await until('contratos', (rs) => rs.find((r) => r.code === CTR1 && r.estado === 'Arquivado'), 'T6 Arquivado persisted');
    assert(/^SharePoint · Ekoa AI · \/Clientes\//.test((archived.arquivo || {}).local || ''), `T6: arquivo.local wrong (${JSON.stringify(archived.arquivo)})`);
    ok('Concluir e arquivar persisted (Arquivado + SharePoint arquivo.local)');
    await page.reload({ waitUntil: 'load' });
    await seesText('Contratos · ciclo de vida');
    await pickContract(CTR1); // selection resets to the demo default on reload
    await seesText('Contrato assinado e arquivado');
    ok('archived state survives a full reload');
    await pickContract(CTR2);
    await page.getByRole('button', { name: 'Arquivar contrato' }).click();
    await until('contratos', (rs) => rs.find((r) => r.code === CTR2 && r.estado === 'Arquivado'), 'T6 direct archive persisted');
    ok('S18 direct "Arquivar contrato" path persisted (Assinado -> Arquivado)');

    // ---- T7: sub-client inline edit persists (rename/doc/rel/add/remove) ------------
    console.log('T7: ClienteDetail sub-client inline edit persistence');
    const SUB_NEW = `${P} Sub Renomeado`;
    await goto(`/clientes/seed?id=${encodeURIComponent(CLI_CODE)}`);
    await seesText(`${P} Titular`);
    await seesInputValue(`${P} Sub Um`);
    const card1 = page.locator('.card').filter({ hasText: `${CLI_CODE}.1` }).first();
    const card2 = page.locator('.card').filter({ hasText: `${CLI_CODE}.2` }).first();
    await card1.locator('input').nth(0).fill(SUB_NEW);
    await card1.locator('input').nth(0).blur(); // name commits on blur
    await until('clientes', (rs) => { const r = rs.find((x) => x.code === CLI_CODE); return r && r.subclients[0].name === SUB_NEW ? r : null; }, 'T7 rename persisted');
    ok('sub-client rename persisted on blur');
    await card2.locator('input').nth(1).fill('222222222');
    await card2.locator('input').nth(1).blur(); // doc commits on blur
    await until('clientes', (rs) => { const r = rs.find((x) => x.code === CLI_CODE); return r && r.subclients[1].doc === '222222222' ? r : null; }, 'T7 doc persisted');
    ok('sub-client doc persisted on blur');
    await card1.locator('select').selectOption('Filho(a)'); // relação persists immediately
    await until('clientes', (rs) => { const r = rs.find((x) => x.code === CLI_CODE); return r && r.subclients[0].rel === 'Filho(a)' ? r : null; }, 'T7 relação persisted');
    ok('sub-client relação persisted on change');
    await page.getByRole('button', { name: 'Adicionar sub-cliente' }).click();
    await until('clientes', (rs) => { const r = rs.find((x) => x.code === CLI_CODE); return r && r.subclients.length === 3 && r.subs === 3 ? r : null; }, 'T7 add persisted');
    await seesText(`${CLI_CODE}.3`); // sub codes ARE in innerText (mono span)
    ok('sub-client add persisted (subclients + subs recount)');
    await page.locator('.card').filter({ hasText: `${CLI_CODE}.3` }).first()
      .getByRole('button', { name: 'Remover sub-cliente' }).click();
    await until('clientes', (rs) => { const r = rs.find((x) => x.code === CLI_CODE); return r && r.subclients.length === 2 && r.subs === 2 ? r : null; }, 'T7 remove persisted');
    ok('sub-client remove persisted');
    await page.reload({ waitUntil: 'load' });
    await seesInputValue(SUB_NEW);
    const relAfter = await card1.locator('select').inputValue();
    const docAfter = await card2.locator('input').nth(1).inputValue();
    assert(relAfter === 'Filho(a)', `T7: relação did not survive reload (${relAfter})`);
    assert(docAfter === '222222222', `T7: doc did not survive reload (${docAfter})`);
    ok('all sub-client edits survive a full reload');

    // ---- T8: client portal — validity date + EN toggle (public surface) -------------
    console.log('T8: client portal validity date + i18n EN toggle');
    await goto(`/client?id=${encodeURIComponent(PROP_PORTAL)}`);
    await seesText(`${P} Cliente Portal`);
    const heroPT = await page.evaluate(() => document.body.innerText);
    assert(/válida até 2026-12-31/i.test(heroPT), 'T8: hero does not render the proposal `validity` date');
    ok('hero renders "válida até 2026-12-31" from the proposal validity field');
    // (BUG #3, open: rows carrying `validade` instead of `validity` render "válida até —".)
    await page.getByRole('button', { name: 'EN', exact: true }).click();
    await seesText('Block 1 — Service proposal');
    const en = await page.evaluate(() => document.body.innerText);
    assert(/Sign with Adobe Acrobat Sign/.test(en), 'T8: EN toggle did not translate the signing footer');
    ok('EN toggle translates the portal body (Block 1 heading + signing footer)');

    // ---- T9: role switcher reverts on reload + Relatórios CSV export ----------------
    console.log('T9: role switcher revert + CSV export download');
    await goto('/dashboard');
    await page.waitForFunction(() => /ver como/i.test(document.body.innerText), { timeout: 20000 });
    assert(await page.evaluate(() => /administração/i.test(document.body.innerText)), 'T9 precondition: master sidebar has no Administração group');
    await page.locator('button', { hasText: 'Ver como' }).first().click();
    await page.locator('button', { hasText: 'Estagiário' }).last().click();
    await page.waitForFunction(() => !/administração/i.test(document.body.innerText), { timeout: 10000 })
      .catch(() => fail('T9: switching to Estagiário did not drop the Administração group'));
    ok('role switcher swaps the persona client-side (Administração gone for Estagiário)');
    await page.reload({ waitUntil: 'load' });
    // whoami is async — the sessionStorage role renders transiently before the revert.
    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find((x) => /ver como/i.test(x.innerText));
      return b && /master/i.test(b.innerText);
    }, { timeout: 20000 }).catch(() => fail('T9: role did not revert to the real role on reload'));
    assert(await page.evaluate(() => /administração/i.test(document.body.innerText)), 'T9: Administração group did not return after revert');
    ok('reload reverts the demo role to the real logged-in role (session-only switcher)');
    await goto('/relatorios');
    await seesText('Relatórios');
    await page.waitForTimeout(1000);
    const dlPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: 'Exportar CSV' }).first().click();
    const dl = await dlPromise;
    const fname = dl.suggestedFilename();
    assert(/^relatorio-prospects-m.{1,2}s-\d{4}-\d{2}-\d{2}\.csv$/u.test(fname), `T9: unexpected CSV filename "${fname}"`);
    await dl.cancel();
    ok(`Exportar CSV fires a real download (${fname})`);

    assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
    console.log('\nE2E PASS: task completion (+dashboard delta), prospect stage advance (+funil +audit), A03 auto-assign, A05 proposal pre-fill + catalogue add, projeto add-activity (+render-loop guard), lembretes, contrato lifecycle S15→S18 (+direct archive), sub-client inline edits, portal validity/i18n, role-switcher revert + CSV export.');
  } finally {
    await browser.close();
    await cleanup();
  }
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
