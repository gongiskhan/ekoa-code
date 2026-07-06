import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * S6-honorários - the Honorários fees module over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-honorarios/):
 *  1. Acordo-driven tarifa PREFILL in a lançamento, with the most-specific-wins
 *     rule: a processo-level acordo overrides the cliente-level one.
 *  2. A pré-fatura over the injected unbilled lançamentos - the shows-its-work
 *     breakdown at GOLDEN values (IVA 23% + IRS 25% on honorários, despesas as
 *     pass-through), "Emitir" marks the lançamentos faturado and writes a
 *     documentos row (origem 'honorarios') into the Dossiê, and the pré-fatura
 *     disclaimer stays visible. Never emits a certified invoice.
 *
 * Deterministic + self-cleaning: each test injects its own nonce-tagged spine
 * rows via window.__ekoa.shared and deletes everything referencing them in
 * afterEach, so it never depends on (or pollutes) the seeded data.
 */
const APP = legalAppUrl('legal-honorarios');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 's6');
mkdirSync(SHOTS, { recursive: true });

type Ctx = { nonce: string; clienteIds: string[]; processoIds: string[] };
const ctx: Ctx = { nonce: '', clienteIds: [], processoIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

test.afterEach(async ({ page }) => {
  // Best-effort teardown of every row that references the injected fixtures.
  try {
    await page.evaluate(async ({ clienteIds, processoIds, nonce }) => {
      const s = (window as any).__ekoa?.shared;
      if (!s) return;
      const cols = ['lancamentos', 'acordos', 'documentos', 'notificacoes', 'processos', 'clientes'];
      for (const col of cols) {
        let rows: any[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            (r.clienteId && clienteIds.includes(r.clienteId)) ||
            (r.processoId && processoIds.includes(r.processoId)) ||
            (r.id && (clienteIds.includes(r.id) || processoIds.includes(r.id))) ||
            (typeof r.nome === 'string' && r.nome.includes(nonce)) ||
            (typeof r.numeroProcesso === 'string' && r.numeroProcesso.includes(nonce)) ||
            (typeof r.corpo === 'string' && r.corpo.includes(nonce));
          if (hit) { try { await s.delete(col, r.id); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
  ctx.processoIds = [];
});

test('Honorários: tarifa prefill from acordo - processo-level overrides cliente-level', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `S6-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP);
  await ready(page, 'honorarios-dashboard');
  await page.screenshot({ path: `${SHOTS}/dashboard.png`, fullPage: true });

  // Inject a cliente with a cliente-level acordo (150/h) and two processos; the
  // second gets a processo-level acordo (200/h) that must win.
  const injected = await page.evaluate(async (n) => {
    const s = (window as any).__ekoa.shared;
    const cli = await s.create('clientes', { nome: `Cliente ${n}`, nif: '299999990', tipo: 'particular' });
    const p1 = await s.create('processos', { numeroProcesso: `P1-${n}`, clienteId: cli.id, estado: 'ativo' });
    const p2 = await s.create('processos', { numeroProcesso: `P2-${n}`, clienteId: cli.id, estado: 'ativo' });
    await s.create('acordos', { clienteId: cli.id, tipo: 'hora', tarifaHora: 150, notas: `acordo ${n}` });
    await s.create('acordos', { clienteId: cli.id, processoId: p2.id, tipo: 'hora', tarifaHora: 200, notas: `override ${n}` });
    return { cli: cli.id, p1: p1.id, p2: p2.id };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p1, injected.p2];

  // Fresh load so the app reads the just-injected processos + acordos.
  await page.goto(`${APP}lancamentos`);
  await ready(page, 'lancamentos-page');

  await page.getByTestId('novo-lancamento').click();

  // P1 → cliente-level acordo → tarifa prefilled 150 (modo hora is the default).
  await page.getByTestId('lanc-processo').selectOption(injected.p1);
  await expect(page.getByTestId('lanc-tarifa')).toHaveValue('150');

  // P2 → processo-level acordo wins → tarifa prefilled 200.
  await page.getByTestId('lanc-processo').selectOption(injected.p2);
  await expect(page.getByTestId('lanc-tarifa')).toHaveValue('200');

  // valor is computed live from horas × tarifa.
  await page.getByTestId('lanc-horas').fill('2');
  await expect(page.getByTestId('lanc-valor')).toHaveValue('400');

  await page.screenshot({ path: `${SHOTS}/lancamentos.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Honorários: pré-fatura golden breakdown → emitir marks faturado + writes documentos row', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `S6-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(`${APP}pre-faturas`);
  await ready(page, 'prefaturas-page');

  // Inject an EMPRESA cliente (retenção applies), a processo, and three unbilled
  // lançamentos: honorários 400 + 300, despesa 90. Golden math (all sub-1000, so
  // no locale thousands-separator ambiguity):
  //   honorários base 700 · IVA 23% = 161 · despesas 90 · retenção 25% = 175
  //   total = 700 + 161 + 90 = 951 · a receber = 861 − 175 + 90 = 776
  const injected = await page.evaluate(async (n) => {
    const s = (window as any).__ekoa.shared;
    const today = new Date().toISOString().slice(0, 10);
    const cli = await s.create('clientes', { nome: `Empresa ${n}`, nif: '510000028', tipo: 'empresa' });
    const p = await s.create('processos', { numeroProcesso: `PF-${n}`, clienteId: cli.id, estado: 'ativo' });
    await s.create('lancamentos', { processoId: p.id, clienteId: cli.id, tipo: 'honorario', modo: 'fixo', descricao: `Honorário A ${n}`, valor: 400, data: today, faturado: false });
    await s.create('lancamentos', { processoId: p.id, clienteId: cli.id, tipo: 'honorario', modo: 'fixo', descricao: `Honorário B ${n}`, valor: 300, data: today, faturado: false });
    await s.create('lancamentos', { processoId: p.id, clienteId: cli.id, tipo: 'despesa', modo: 'fixo', descricao: `Despesa ${n}`, valor: 90, data: today, faturado: false });
    return { cli: cli.id, p: p.id };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  await page.goto(`${APP}pre-faturas`);
  await ready(page, 'prefaturas-page');

  await page.getByTestId('pf-processo').selectOption(injected.p);
  await page.getByTestId('pf-calcular').click();
  await expect(page.getByTestId('pf-breakdown')).toBeVisible({ timeout: 15_000 });

  // Golden breakdown values.
  await expect(page.getByTestId('pf-linha-honorarios')).toContainText('700,00');
  await expect(page.getByTestId('pf-linha-iva')).toContainText('161,00');
  await expect(page.getByTestId('pf-linha-despesas')).toContainText('90,00');
  await expect(page.getByTestId('pf-linha-retencao')).toContainText('161,00'); // 23% (Lei 45-A/2024)
  await expect(page.getByTestId('pf-linha-total')).toContainText('951,00');
  await expect(page.getByTestId('pf-linha-areceber')).toContainText('790,00');

  // Disclaimer visible on the pré-fatura surface.
  await expect(page.getByTestId('hon-disclaimer').first()).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/prefatura-breakdown.png`, fullPage: true });

  // Emitir → confirm → lançamentos faturado + documentos row written.
  await page.getByTestId('pf-emitir').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Emitir', exact: true }).click();

  // The computed panel clears once the pré-fatura is emitted.
  await expect(page.getByTestId('pf-resultado')).toHaveCount(0, { timeout: 15_000 });

  const state = await page.evaluate(async (processoId) => {
    const s = (window as any).__ekoa.shared;
    const lancs = (await s.list('lancamentos')).filter((l: any) => l.processoId === processoId);
    const docs = (await s.list('documentos')).filter(
      (d: any) => d.origem === 'honorarios' && d.processoId === processoId,
    );
    return {
      total: lancs.length,
      allFaturado: lancs.length > 0 && lancs.every((l: any) => l.faturado === true),
      hasDoc: docs.length > 0,
      docTipo: docs[0]?.tipo || null,
      docHasTexto: typeof docs[0]?.texto === 'string' && docs[0].texto.length > 0,
    };
  }, injected.p);

  expect(state.total).toBe(3);
  expect(state.allFaturado, 'all injected lançamentos are now faturado').toBe(true);
  expect(state.hasDoc, 'a documentos row origem=honorarios was written').toBe(true);
  expect(state.docTipo).toBe('nota');
  expect(state.docHasTexto, 'the pré-fatura documento carries the rendered breakdown text').toBe(true);

  // Happy path: the recovery banner (partial-failure rollback) must NOT appear.
  await expect(page.getByTestId('pf-recovery')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Honorários: fractional-cent rounding golden case (base 33,33 → IVA 7,67 / retenção 8,33)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `S6-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(`${APP}pre-faturas`);
  await ready(page, 'prefaturas-page');

  // Single honorário of 33,33 for an EMPRESA cliente exercises cents-exact
  // rounding (23% → 7,6659 rounds to 7,67; 25% → 8,3325 rounds to 8,33). A naïve
  // float would drift, so these fixed values catch rounding regressions.
  const injected = await page.evaluate(async (n) => {
    const s = (window as any).__ekoa.shared;
    const today = new Date().toISOString().slice(0, 10);
    const cli = await s.create('clientes', { nome: `Empresa ${n}`, nif: '512334455', tipo: 'empresa' });
    const p = await s.create('processos', { numeroProcesso: `FC-${n}`, clienteId: cli.id, estado: 'ativo' });
    await s.create('lancamentos', { processoId: p.id, clienteId: cli.id, tipo: 'honorario', modo: 'fixo', descricao: `Honorário ${n}`, valor: 33.33, data: today, faturado: false });
    return { cli: cli.id, p: p.id };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  await page.goto(`${APP}pre-faturas`);
  await ready(page, 'prefaturas-page');

  await page.getByTestId('pf-processo').selectOption(injected.p);
  await page.getByTestId('pf-calcular').click();
  await expect(page.getByTestId('pf-breakdown')).toBeVisible({ timeout: 15_000 });

  await expect(page.getByTestId('pf-linha-honorarios')).toContainText('33,33');
  await expect(page.getByTestId('pf-linha-iva')).toContainText('7,67');
  await expect(page.getByTestId('pf-linha-retencao')).toContainText('7,67'); // 23% (Lei 45-A/2024)
  await expect(page.getByTestId('pf-linha-total')).toContainText('41,00');
  await expect(page.getByTestId('pf-linha-areceber')).toContainText('33,33');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
