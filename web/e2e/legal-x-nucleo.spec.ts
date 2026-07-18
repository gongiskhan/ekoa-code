import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-nucleo - the S1 productivity layer of the Nucleo over the SHARED spine.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-nucleo/):
 *  1. Ctrl+K quick-open: the palette opens on the shortcut, searches clientes and
 *     processos by nonce, deep-links into the processo detail, and Escape closes it.
 *  2. Processo detail aggregates the spine: the new "Lancamentos financeiros" card
 *     lists the processo's lancamentos with the Faturado / Pre-fatura badge and the
 *     por-faturar total, and the "Noutras aplicacoes" card deep-links to kanban and
 *     tempos carrying ?processo=<id>.
 *  3. Clientes CSV export: the exported file carries the UTF-8 BOM, the fixed
 *     header, CRLF line endings and RFC-4180 escaping (quotes doubled, comma-safe).
 *
 * Deterministic + self-cleaning: each test tags its rows with a per-run nonce and
 * deletes everything that references them in afterEach, so it never depends on
 * (or pollutes) the seeded spine.
 */
const APP = legalAppUrl('legal-nucleo');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-nucleo');
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

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

test.afterEach(async ({ page }) => {
  // Best-effort teardown of every row that references this run's fixtures - by
  // FK to the injected cliente/processo, by id, or by the nonce carried in a
  // nome/numero/titulo/descricao.
  try {
    await page.evaluate(async ({ clienteIds, processoIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['lancamentos', 'eventos', 'prazos', 'tarefas', 'processos', 'clientes'];
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
            tagged(r.nome) ||
            tagged(r.numeroProcesso) ||
            tagged(r.titulo) ||
            tagged(r.descricao);
          if (hit) { try { await s.delete(col, String(r.id)); } catch { /* ignore */ } }
        }
      }
    }, ctx);
  } catch { /* page may be gone - ignore */ }
  ctx.clienteIds = [];
  ctx.processoIds = [];
});

test('Nucleo: Ctrl+K abre a paleta, pesquisa clientes e processos e navega para o detalhe', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XN1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente QO ${n}`, nif: '299000001', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `QO-${n}`, clienteId: String(cli.id), estado: 'ativo' });
    return { cli: String(cli.id), p: String(p.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  // Fresh load so the palette's collections include the injected rows.
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('nav-inicio')).toBeVisible({ timeout: 20_000 });

  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('quick-open')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('quick-open-input')).toBeFocused();
  await expect(page.getByTestId('quick-open-hint')).toBeVisible();

  await page.getByTestId('quick-open-input').fill(nonce);

  // One cliente and one processo result, each typed via data-kind.
  await expect(page.getByTestId('quick-open-result')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('[data-testid="quick-open-result"][data-kind="cliente"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="quick-open-result"][data-kind="processo"]')).toHaveCount(1);

  await page.screenshot({ path: `${SHOTS}/quick-open.png`, fullPage: true });

  // Deep-link: choosing the processo result lands on its detail page.
  await page.locator('[data-testid="quick-open-result"][data-kind="processo"]').click();
  await expect(page.getByTestId('processo-detail')).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain(`/apps/legal-nucleo/processos/${injected.p}`);
  await expect(page.getByTestId('quick-open')).toHaveCount(0);

  // Reopen and close with Escape.
  await page.keyboard.press('Control+k');
  await expect(page.getByTestId('quick-open')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-open')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Nucleo: a pesquisa global do painel navega com setas e Enter (combobox acessivel)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XN4-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente GS ${n}`, nif: '299000002', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `GS-${n}`, clienteId: String(cli.id), estado: 'ativo' });
    return { cli: String(cli.id), p: String(p.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('global-search')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('global-search').click();
  await page.getByTestId('global-search').fill(nonce);

  // One cliente + one processo, and the FIRST option starts selected (index 0).
  await expect(page.getByTestId('global-search-result')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('[data-testid="global-search-result"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator('#global-search-opt-0')).toHaveAttribute('aria-selected', 'true');

  // ArrowDown moves the active option (input keeps focus; combobox pattern via
  // aria-activedescendant, never focus-stealing).
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#global-search-opt-1')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#global-search-opt-0')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('global-search')).toHaveAttribute('aria-activedescendant', 'global-search-opt-1');
  await expect(page.getByTestId('global-search')).toBeFocused();

  await page.screenshot({ path: `${SHOTS}/global-search-teclado.png`, fullPage: true });

  // Enter opens the active option - results order is clientes first, so index 1
  // is the processo.
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('processo-detail')).toBeVisible({ timeout: 20_000 });
  expect(page.url()).toContain(`/apps/legal-nucleo/processos/${injected.p}`);
  await expect(page.getByTestId('global-search-menu')).toHaveCount(0);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Nucleo: o detalhe do processo agrega lancamentos da espinha e liga ao kanban e aos tempos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XN2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  const injected = await page.evaluate(async ({ n, amanha }) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', { nome: `Cliente PD ${n}`, nif: '299000003', tipo: 'particular' });
    const p = await s.create('processos', { numeroProcesso: `PD-${n}`, clienteId: String(cli.id), estado: 'ativo', tribunal: 'Tribunal de Teste' });
    await s.create('eventos', { processoId: String(p.id), data: amanha, titulo: `Evento ${n}`, tipo: 'diligencia', descricao: 'Evento de teste' });
    await s.create('lancamentos', {
      processoId: String(p.id), clienteId: String(cli.id), tipo: 'honorario', modo: 'hora',
      descricao: `Faturado ${n}`, horas: 1, tarifaHora: 100, valor: 100, data: '2026-01-10', faturado: true,
    });
    await s.create('lancamentos', {
      processoId: String(p.id), clienteId: String(cli.id), tipo: 'honorario', modo: 'hora',
      descricao: `Aberto ${n}`, horas: 0.5, tarifaHora: 160, valor: 80, data: '2026-01-12', faturado: false,
    });
    return { cli: String(cli.id), p: String(p.id) };
  }, { n: nonce, amanha: todayPlus(1) });
  ctx.clienteIds = [injected.cli];
  ctx.processoIds = [injected.p];

  await page.goto(legalAppUrl('legal-nucleo', `processos/${injected.p}`), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('processo-detail')).toBeVisible({ timeout: 20_000 });

  // The spine's evento shows on the detail (aggregation beyond the lancamentos card).
  await expect(page.getByText(`Evento ${nonce}`)).toBeVisible({ timeout: 15_000 });

  // Lancamentos card: both rows, honest Faturado vs Pre-fatura badges, por-faturar total.
  await expect(page.getByTestId('processo-lancamentos')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('processo-lancamento')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.getByTestId('processo-lancamento').filter({ hasText: `Faturado ${nonce}` })).toContainText('Faturado');
  await expect(page.getByTestId('processo-lancamento').filter({ hasText: `Aberto ${nonce}` })).toContainText('Pré-fatura');
  await expect(page.getByTestId('processo-lancamentos-total')).toContainText('2 lançamentos');
  await expect(page.getByTestId('processo-lancamentos-total')).toContainText('por faturar');

  // Cross-app deep-links carry the processo id as ?processo= for kanban/tempos.
  await expect(page.getByTestId('processo-ligacoes')).toBeVisible();
  await expect(page.getByTestId('link-kanban')).toHaveAttribute('href', new RegExp(`/apps/legal-kanban/\\?processo=${injected.p}$`));
  await expect(page.getByTestId('link-tempos')).toHaveAttribute('href', new RegExp(`/apps/legal-tempos/\\?processo=${injected.p}$`));
  await expect(page.getByTestId('link-agenda')).toHaveAttribute('href', /\/apps\/legal-agenda\//);
  await expect(page.getByTestId('link-honorarios')).toHaveAttribute('href', /\/apps\/legal-honorarios\//);

  await page.screenshot({ path: `${SHOTS}/processo-detail.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Nucleo: exportar clientes CSV com BOM, cabecalho fixo, CRLF e aspas escapadas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XN3-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(legalAppUrl('legal-nucleo', 'clientes'), { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('clientes-page')).toBeVisible({ timeout: 20_000 });

  // A name with a comma AND quotes - the CSV escaping worst case.
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const cli = await s.create('clientes', {
      nome: `Cliente "CSV", ${n}`, nif: '299000002', tipo: 'particular', email: `csv-${n}@exemplo.pt`,
    });
    return { cli: String(cli.id) };
  }, nonce);
  ctx.clienteIds = [injected.cli];

  await page.goto(legalAppUrl('legal-nucleo', 'clientes'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('clientes-page')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(nonce).first()).toBeVisible({ timeout: 15_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.getByTestId('clientes-exportar-csv').click(),
  ]);
  expect(download.suggestedFilename()).toBe('clientes.csv');

  const csv = readFileSync((await download.path()) as string, 'utf-8');
  expect(csv.startsWith('\uFEFF'), 'CSV starts with the UTF-8 BOM').toBe(true);
  const lines = csv.slice(1).split('\r\n');
  expect(lines[0]).toBe('nome,tipo,nif,email,telefone,processos');
  // Quotes doubled, whole field quoted because of the comma.
  expect(csv).toContain(`"Cliente ""CSV"", ${nonce}"`);
  expect(csv).toContain(`csv-${nonce}@exemplo.pt`);
  expect(csv.endsWith('\r\n'), 'CSV ends with CRLF').toBe(true);

  await page.screenshot({ path: `${SHOTS}/clientes-csv.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
