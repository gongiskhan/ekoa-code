import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-honorarios - S3-money layer of the Honorários app (run
 * 20260717-202309-d797918a), on top of the byte-frozen legal-honorarios spec.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-honorarios/):
 *  1. tempos -> honorarios data-shape contract: a `lancamentos` row written in
 *     the EXACT shape the Tempos app writes (buildLancamentoPayload +
 *     registoTempoId) is recognised - the Lançamentos list and the pré-fatura
 *     eligibility list both badge it as "Do Tempos". The contract is the row
 *     shape only; the Tempos app itself is not touched.
 *  2. Pré-fatura: calculating over those lançamentos renders the breakdown and
 *     exports a real PDF (pre-fatura *.pdf) via the platform exportPdf bridge -
 *     the PDF body carries the mandatory "não é fatura certificada" notice
 *     (asserted at unit/source level; here the export must actually happen).
 *
 * Deterministic + self-cleaning: rows carry a per-run nonce and are deleted in
 * afterEach; the pré-fatura is NOT emitted here (the frozen spec owns emission).
 */
const APP = legalAppUrl('legal-honorarios');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-honorarios');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; clienteIds: string[]; processoIds: string[] };
const ctx: Ctx = { nonce: '', clienteIds: [], processoIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 90_000 });
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ clienteIds, processoIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['lancamentos', 'documentos', 'notificacoes', 'processos', 'clientes'];
      const tagged = (v: unknown) => typeof v === 'string' && nonce !== '' && v.includes(nonce);
      const fk = (v: unknown, ids: string[]) => typeof v === 'string' && ids.includes(v);
      for (const col of cols) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          const hit =
            fk(r.clienteId, clienteIds) ||
            fk(r.processoId, processoIds) ||
            fk(r.id, clienteIds) ||
            fk(r.id, processoIds) ||
            tagged(r.descricao) ||
            tagged(r.nome) ||
            tagged(r.numeroProcesso);
          if (hit) { try { await s.delete(col, String(r.id)); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
  ctx.processoIds = [];
});

test('Honorarios: lancamentos no formato do Tempos ganham o selo "Do Tempos" e a pre-fatura exporta PDF real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XH1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'honorarios-dashboard');

  // Duas linhas no processo: uma no formato EXACTO que o Tempos escreve
  // (data-shape contract - com registoTempoId) e uma manual, para o contraste.
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const hoje = new Date().toISOString().slice(0, 10);
    const cli = await s.create('clientes', { nome: `Cliente H ${n}`, nif: '299000005', tipo: 'empresa' });
    const p = await s.create('processos', { numeroProcesso: `XH-${n}`, clienteId: String(cli.id), estado: 'ativo' });
    await s.create('lancamentos', {
      // Forma de buildLancamentoPayload (tempos-logic.js) + registoTempoId.
      processoId: String(p.id), clienteId: String(cli.id),
      tipo: 'honorario', modo: 'hora',
      descricao: `Tempo importado ${n}`, horas: 1.5, tarifaHora: 100, valor: 150,
      data: hoje, faturado: false, registoTempoId: `rt-${n}`,
    });
    await s.create('lancamentos', {
      processoId: String(p.id), clienteId: String(cli.id),
      tipo: 'despesa', modo: 'valor',
      descricao: `Despesa manual ${n}`, valor: 40, data: hoje, faturado: false,
    });
    return { cli: String(cli.id), p: String(p.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  // Lançamentos: a linha vinda do Tempos (registoTempoId) leva o selo; a manual não.
  await page.goto(legalAppUrl('legal-honorarios', 'lancamentos'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'lancamentos-page');
  const tabela = page.getByTestId('hon-lancamentos-tabela');
  await expect(tabela).toContainText(`Tempo importado ${nonce}`, { timeout: 15_000 });
  const linhaTempos = tabela.locator('tr').filter({ hasText: `Tempo importado ${nonce}` });
  await expect(linhaTempos.getByTestId('lanc-origem-tempos')).toBeVisible();
  const linhaManual = tabela.locator('tr').filter({ hasText: `Despesa manual ${nonce}` });
  await expect(linhaManual).toBeVisible();
  await expect(linhaManual.getByTestId('lanc-origem-tempos')).toHaveCount(0);

  await page.screenshot({ path: `${SHOTS}/lancamentos-selo.png`, fullPage: true });

  // Pré-fatura sobre o mesmo processo: a lista de elegíveis repete o selo.
  await page.goto(legalAppUrl('legal-honorarios', 'pre-faturas'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'prefaturas-page');
  await page.getByTestId('pf-processo').selectOption(injected.p);
  const elegiveis = page.getByTestId('pf-elegiveis');
  await expect(elegiveis).toContainText(`Tempo importado ${nonce}`, { timeout: 15_000 });
  await expect(
    elegiveis.locator('li').filter({ hasText: `Tempo importado ${nonce}` }).getByTestId('pf-origem-tempos'),
  ).toBeVisible();

  await page.getByTestId('pf-calcular').click();
  await expect(page.getByTestId('pf-resultado')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('pf-breakdown')).toContainText('150,00');

  // Exportação pela ponte exportPdf da plataforma (render Chromium no servidor).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    page.getByTestId('pf-imprimir').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^pre-fatura .*\.pdf$/i);

  await page.screenshot({ path: `${SHOTS}/pre-fatura-pdf.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
