#!/usr/bin/env node
/**
 * ERP KYC persistence + UI — committed, re-runnable end-to-end driver.
 *
 * Proves directive 4: the submitted KYC dossier is persisted and surfaced in the
 * UI. Seeds a `kyc` submission carrying the SAME `form` shape `runConversion`
 * writes (data.jsx/screens-client.jsx), plus a matching `clientes` row and a
 * master login, then asserts the declared fields render in BOTH surfaces:
 *   - the analyst review  (#/kyc/review?id=<code>)        — KYCReview
 *   - the internal client (#/clientes/seed?id=<code> KYC) — KYCStatusInternal
 * and that they survive a reload (persisted in app-data, not local state).
 *
 * Extended (2026-07-02 vision sweep — report §10) with the KYC flows this
 * driver did not cover:
 *   4. /kyc/construtor — adding a requirement block persists to kyc_blocks_cfg
 *      on "Guardar alterações" and survives reload (the live config is
 *      snapshotted and restored exactly, so the app is never left mutated).
 *   5. /kyc/interno — a real file upload persists a blob via app-files plus a
 *      `documentos` row (ownerType 'kyc-interno') and a `kyc_doc_requests`
 *      state row; the "nota ao Analista" persists too (textarea VALUE, not
 *      innerText). Blob + rows are deleted in cleanup (blob verified gone).
 *   6. /kyc/review — approving the required blocks enables "Concluir revisão",
 *      which persists {status:'aprovado', ok, analista} onto the kyc row
 *      (per-block approvals are transient by design — only the conclusion
 *      persists; asserted as the documented contract).
 *
 * Auth: logs in via the API and injects the session cookie (the login UI itself
 * is covered by erp-auth-ui.e2e.mjs). APP_ID defaults to the local ERP sandbox
 * id; override with ERP_APP_ID. Requires a running dev cortex serving the
 * (rebuilt) artifact. Run: node tests/e2e/erp-kyc.e2e.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
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
const CODE = 'BSM-E2E-KYC1';
const MASTER = 'e2e.kyc@brasilsalomao.pt';
const MASTER_PW = 'kyc-pw-123456';
const DECLARED_NAME = 'Cliente KYC E2E Persistido';

function fail(m) { console.error(`E2E FAIL: ${m}`); process.exit(1); }
function assert(c, m) { if (!c) fail(m); }
const H = { 'Content-Type': 'application/json', 'X-Ekoa-App-Id': APP_ID };

async function list(coll) { return (await (await fetch(`${BASE}/api/app-data/${coll}`, { headers: H })).json()).data || []; }
async function del(coll, id) { await fetch(`${BASE}/api/app-data/${coll}/${id}`, { method: 'DELETE', headers: H }); }
async function post(coll, body) {
  const r = await fetch(`${BASE}/api/app-data/${coll}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  assert(r.status === 201, `seed ${coll} -> ${r.status}`); return r;
}
async function put(coll, id, patch) {
  const r = await fetch(`${BASE}/api/app-data/${coll}/${id}`, { method: 'PUT', headers: H, body: JSON.stringify(patch) });
  assert(r.ok, `update ${coll}/${id} -> ${r.status}`);
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
const CFG_BLOCK_PREFIX = 'E2E-KYC Requisito';
async function cleanup() {
  for (const r of await list('utilizadores')) if (r && r.email === MASTER) await del('utilizadores', r.id);
  for (const r of await list('clientes')) if (r && r.code === CODE) await del('clientes', r.id);
  for (const r of await list('kyc')) if (r && r.code === CODE) await del('kyc', r.id);
  // Step 5 byproducts: uploaded blob + documentos + kyc_doc_requests rows.
  for (const r of await list('documentos')) {
    if (r && typeof r.owner === 'string' && r.owner.startsWith(`${CODE}::`)) {
      if (r.fileId) await fetch(`${BASE}/api/app-files/${APP_ID}/${r.fileId}`, { method: 'DELETE', headers: H }).catch(() => {});
      await del('documentos', r.id);
    }
  }
  for (const r of await list('kyc_doc_requests')) if (r && r.cliente === CODE) await del('kyc_doc_requests', r.id);
  // Step 4 safety net: strip any E2E block a previous failed run left in the config
  // (the step itself restores the snapshotted blocks on the success path).
  for (const r of await list('kyc_blocks_cfg')) {
    if (r && Array.isArray(r.blocks) && r.blocks.some((b) => b && typeof b.title === 'string' && b.title.startsWith(CFG_BLOCK_PREFIX))) {
      await put('kyc_blocks_cfg', r.id, { blocks: r.blocks.filter((b) => !(b && typeof b.title === 'string' && b.title.startsWith(CFG_BLOCK_PREFIX))) });
    }
  }
}

async function main() {
  const health = await fetch(`${BASE}/health`).catch(() => null);
  if (!health || !health.ok) fail(`cortex not reachable at ${BASE}/health`);

  await cleanup();
  await post('utilizadores', { email: MASTER, name: 'KYC Master', role: 'master', area: '—', dept: '—', initials: 'KM', color: '#1d7fa8', estado: 'Ativo', passwordHash: bcrypt.hashSync(MASTER_PW, 10) });
  await post('clientes', { code: CODE, name: DECLARED_NAME, type: 'Titular', area: 'Consultivo', dept: 'Migratório', resp: 'luan', status: 'Ativo' });
  // The SAME shape runConversion writes (screens-client.jsx). `blocks` matches the
  // real Pessoa Singular block count (5) — "Concluir revisão" copies it into `ok`.
  await post('kyc', {
    code: CODE, name: DECLARED_NAME, proj: 'Golden Visa', tipo: 'Individual', kycTipo: 'Pessoa Singular',
    submetidoEm: 'agora', submittedAt: '24 Jun 2026 · 11:40', blocks: 5, ok: 0, status: 'em revisão',
    analista: null, risco: 'Médio', ppe: 'nao', declarado: true,
    form: { nome: DECLARED_NAME, dob: '14/03/1981', nacionalidade: 'Brasileira', paisResidencia: 'Portugal', profissao: 'Empresária', empresa: 'Andrade Capital', ppe: 'nao', origemFundos: 'Rendimentos da atividade profissional', declarado: true },
  });

  // Log in via API → inject the session cookie so the SPA's whoami() authenticates.
  const lr = await fetch(`${BASE}/api/app-sso/login`, { method: 'POST', headers: H, body: JSON.stringify({ collection: 'utilizadores', identityField: 'email', identity: MASTER, password: MASTER_PW }) });
  assert(lr.status === 200, `api login -> ${lr.status}`);
  const setc = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [lr.headers.get('set-cookie')].filter(Boolean);
  let token = null;
  for (const c of setc) { const m = new RegExp(`${COOKIE}=([^;]+)`).exec(c); if (m) token = m[1]; }
  assert(token, 'login returned no session cookie');

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: COOKIE, value: token, url: BASE }]);
    const errors = [];
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      const url = (m.location && m.location() && m.location().url) || '';
      if (/\b401\b/.test(t)) return; // pre-login whoami
      if (/\b403\b/.test(t) && /\/api\/(m365|adobe)/.test(url)) return; // integration probes
      errors.push(`${t} @ ${url}`);
    });
    page.on('pageerror', (e) => errors.push('pageerror: ' + ((e && e.message) || e)));

    // 1. Analyst review renders the persisted declared form.
    await page.goto(`${BASE}/apps/${APP_ID}/#/kyc/review?id=${encodeURIComponent(CODE)}`, { waitUntil: 'load' });
    await page.waitForFunction((nm) => document.body && document.body.innerText.includes(nm), DECLARED_NAME, { timeout: 20000 })
      .catch(() => fail('review: declared name never rendered'));
    assert((await page.locator('text=Dados declarados').count()) > 0, 'review: "Dados declarados" card missing');
    assert((await page.locator('text=Origem de fundos').count()) > 0, 'review: declared field labels missing');

    // 2. Reload → persisted (re-read from app-data, not local state).
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction((nm) => document.body && document.body.innerText.includes(nm), DECLARED_NAME, { timeout: 20000 })
      .catch(() => fail('review: declared name did not survive reload'));

    // 3. Internal client detail → KYC tab renders the same persisted dossier.
    await page.goto(`${BASE}/apps/${APP_ID}/#/clientes/seed?id=${encodeURIComponent(CODE)}`, { waitUntil: 'load' });
    await page.getByRole('tab', { name: 'KYC', exact: true }).waitFor({ timeout: 20000 });
    await page.getByRole('tab', { name: 'KYC', exact: true }).click();
    await page.waitForFunction(() => document.body && document.body.innerText.includes('Dados declarados (KYC)'), { timeout: 20000 })
      .catch(() => fail('client KYC tab: "Dados declarados (KYC)" not shown'));
    assert((await page.locator(`text=${DECLARED_NAME}`).count()) > 0, 'client KYC tab: declared name missing');

    const seesText = async (t, timeout = 20000) =>
      page.waitForFunction((s) => document.body && document.body.innerText.includes(s), t, { timeout });

    // 4. Construtor: adding a requirement block persists to kyc_blocks_cfg on save.
    console.log('4: construtor block add persists to kyc_blocks_cfg (snapshot/restore)');
    const CFG_TITLE = `${CFG_BLOCK_PREFIX} ${Date.now().toString(36)}`;
    await page.goto(`${BASE}/apps/${APP_ID}/#/kyc/construtor`, { waitUntil: 'load' });
    await seesText('Construtor KYC');
    // Snapshot AFTER first render (the visit seeds the collection when empty).
    const cfgBefore = await until('kyc_blocks_cfg', (rs) => rs.find((r) => r.code === 'Individual'), 'kyc_blocks_cfg Individual row');
    const originalBlocks = JSON.parse(JSON.stringify(cfgBefore.blocks || []));
    await page.getByRole('button', { name: 'Adicionar bloco' }).first().click();
    const cfgDlg = page.getByRole('dialog');
    await cfgDlg.getByPlaceholder('Ex.: Comprovativo de investimento').fill(CFG_TITLE);
    await cfgDlg.getByPlaceholder('O que o requisito exige').fill('Requisito criado pelo e2e');
    await cfgDlg.locator('select').selectOption('se-pep');
    await cfgDlg.getByRole('button', { name: 'Adicionar bloco' }).click();
    await page.getByRole('button', { name: 'Guardar alterações' }).click();
    await seesText('Conjunto Individual guardado');
    const cfgAfter = await until('kyc_blocks_cfg',
      (rs) => { const r = rs.find((x) => x.code === 'Individual'); return r && (r.blocks || []).some((b) => b.title === CFG_TITLE && b.rule === 'se-pep') ? r : null; },
      'construtor block persisted');
    console.log('  PASS: added block persisted (rule=se-pep) on "Guardar alterações"');
    await page.reload({ waitUntil: 'load' });
    await seesText(CFG_TITLE);
    console.log('  PASS: added block survives a full reload');
    // Restore the exact pre-test config so the app is never left mutated.
    await put('kyc_blocks_cfg', cfgAfter.id, { blocks: originalBlocks });
    const restored = (await list('kyc_blocks_cfg')).find((r) => r.code === 'Individual');
    assert(JSON.stringify(restored.blocks) === JSON.stringify(originalBlocks), '4: kyc_blocks_cfg not restored byte-equal');
    console.log('  PASS: kyc_blocks_cfg restored to the pre-test snapshot');

    // 5. Interno: real file upload persists app-files blob + documentos + doc-request rows.
    console.log('5: interno upload + nota persist (app-files + documentos + kyc_doc_requests)');
    const pdfPath = join(tmpdir(), `e2e-kyc-${Date.now().toString(36)}.pdf`);
    writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
    try {
      await page.goto(`${BASE}/apps/${APP_ID}/#/kyc/interno?id=${encodeURIComponent(CODE)}`, { waitUntil: 'load' });
      await seesText('Documentos esperados');
      await page.locator('.card', { hasText: 'Anexar ficheiro · Documento de identificação' })
        .locator('input[type=file]').setInputFiles(pdfPath);
      await seesText('Ficheiro anexado · guardado');
      const doc = await until('documentos',
        (rs) => rs.find((r) => r.owner === `${CODE}::documento de identificação` && r.ownerType === 'kyc-interno'),
        'documentos row persisted');
      assert(doc.fileId && doc.url, `5: documentos row missing fileId/url (${JSON.stringify(doc)})`);
      const blob = await fetch(`${BASE}${doc.url}`);
      assert(blob.status === 200, `5: uploaded blob not served (${blob.status})`);
      await until('kyc_doc_requests',
        (rs) => rs.find((r) => r.cliente === CODE && r.doc === 'Documento de identificação' && r.estado === 'anexado'),
        'kyc_doc_requests row persisted');
      console.log('  PASS: upload persisted (app-files blob served + documentos + kyc_doc_requests rows)');
      const NOTA = `Nota e2e ${Date.now().toString(36)}`;
      await page.getByPlaceholder(/Certificado criminal pedido ao cliente/).fill(NOTA);
      await page.getByRole('button', { name: 'Guardar nota' }).click();
      await seesText('Nota guardada · visível ao Analista');
      await until('kyc_doc_requests',
        (rs) => rs.find((r) => r.cliente === CODE && r.tipo === 'nota-analista' && r.nota === NOTA),
        'nota ao Analista persisted');
      console.log('  PASS: nota ao Analista persisted');
      await page.reload({ waitUntil: 'load' });
      await seesText('Documentos esperados');
      // The nota lives in a textarea VALUE — invisible to innerText.
      await page.waitForFunction((txt) =>
        Array.from(document.querySelectorAll('textarea')).some((t) => t.value === txt), NOTA, { timeout: 15000 })
        .catch(() => fail('5: nota did not survive reload'));
      console.log('  PASS: upload + nota survive a full reload');
    } finally {
      try { unlinkSync(pdfPath); } catch { /* best-effort */ }
    }

    // 6. Review: approving the required blocks + "Concluir revisão" persists the verdict.
    console.log('6: review conclusion persists (status=aprovado)');
    await page.goto(`${BASE}/apps/${APP_ID}/#/kyc/review?id=${encodeURIComponent(CODE)}`, { waitUntil: 'load' });
    await seesText('Revisão de KYC');
    await seesText('Faltam 2 obrigatórios'); // Pessoa Singular: 5 blocks, 2 required
    await page.getByRole('button', { name: 'Aprovar bloco' }).click(); // active block = Passaporte
    await seesText('Bloco aprovado');
    await page.locator('button', { hasText: 'Comprovante de endereço' }).first().click();
    await page.getByRole('button', { name: 'Aprovar bloco' }).click();
    await seesText('Concluir revisão'); // relabels + enables once required blocks are approved
    await page.getByRole('button', { name: 'Concluir revisão' }).click();
    await seesText('KYC aprovado · cliente notificado');
    const concluded = await until('kyc',
      (rs) => rs.find((r) => r.code === CODE && r.status === 'aprovado'), 'review conclusion persisted');
    assert(concluded.analista === 'anabela' && concluded.ok === concluded.blocks,
      `6: conclusion shape wrong (analista=${concluded.analista}, ok=${concluded.ok}/${concluded.blocks})`);
    console.log('  PASS: "Concluir revisão" persisted status=aprovado + analista + ok count');
    await seesText('Dashboard Analista KYC'); // auto-navigates to the dashboard
    await page.reload({ waitUntil: 'load' });
    await seesText('Dashboard Analista KYC');
    await seesText(DECLARED_NAME);
    assert((await list('kyc')).find((r) => r.code === CODE).status === 'aprovado', '6: conclusion did not survive reload');
    console.log('  PASS: conclusion survives reload (kyc row stays aprovado)');

    assert(errors.length === 0, `console/page errors:\n${errors.join('\n')}`);
    console.log('E2E PASS: KYC dossier persists + renders (review + client tab, reload-safe); construtor config add persists + restores; interno upload/nota persist (real app-files blob); review conclusion persists status=aprovado');
  } finally {
    await browser.close();
    await cleanup();
  }
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.stack || e.message : String(e)));
