import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-recursos - S6 team-management layer of the Recursos Humanos app over
 * the SHARED spine (Código do Trabalho).
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-recursos/):
 *  1. Loads with zero page errors.
 *  2. Férias engine wired to the UI: a pessoa admitted in a PRIOR year falls
 *     under art. 238.º n.º 1 -> 22 working days (direito-valor). The deterministic
 *     engine goldens themselves live in api/tests/legal/ferias-engine.test.ts;
 *     this asserts the number actually reaches the screen.
 *  3. Alocação view: the Alocações page lists and offers a new-allocation form.
 *  4. Mapa de férias: the Ausências page exports a real PDF via the platform
 *     exportPdf bridge, named mapa-ferias-<YYYY-MM-DD>.pdf.
 *
 * Deterministic + self-cleaning: injected pessoas/ausências carry a per-run nonce
 * and are deleted in afterEach. No login (served app).
 */
const APP = legalAppUrl('legal-recursos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-recursos');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

type Ctx = { nonce: string; pessoaIds: string[] };
const ctx: Ctx = { nonce: '', pessoaIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 20_000 });
}

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async ({ pessoaIds, nonce }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const cols = ['ausencias', 'alocacoes', 'pessoas'];
      const tagged = (v: unknown) => typeof v === 'string' && nonce !== '' && v.includes(nonce);
      const fk = (v: unknown) => typeof v === 'string' && pessoaIds.includes(v);
      for (const col of cols) {
        let rows: Row[] = [];
        try { rows = await s.list(col); } catch { rows = []; }
        for (const r of rows) {
          if (fk(r.pessoaId) || fk(r.id) || tagged(r.nome) || tagged(r.notas)) {
            try { await s.delete(col, String(r.id)); } catch { /* ignore */ }
          }
        }
      }
    }, ctx);
  } catch { /* page may be gone */ }
  ctx.pessoaIds = [];
});

test('Recursos: carrega sem erros de pagina', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'pessoas-page');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Recursos: o direito a ferias sai do motor (art. 238.º -> 22 dias uteis)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XR1-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'pessoas-page');
  await waitForSpine(page);

  // A pessoa admitted in a PRIOR year -> art. 238.º n.º 1 -> 22 dias úteis,
  // independent of the current year the app reads from the clock.
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const p = await s.create('pessoas', {
      nome: `Pessoa RH ${n}`, papel: 'advogado', dataAdmissao: '2019-03-01', cpas: true,
    });
    return { p: String(p.id) };
  }, nonce);
  ctx.pessoaIds = [injected.p];

  await page.goto(legalAppUrl('legal-recursos', `pessoa/${injected.p}`), { waitUntil: 'domcontentloaded' });
  await ready(page, 'pessoa-detail');
  await ready(page, 'ferias-panel');

  await expect(page.getByTestId('direito-valor')).toHaveText('22', { timeout: 10_000 });
  await expect(page.getByTestId('ferias-regra')).toContainText('238');
  await expect(page.getByTestId('ferias-explicacao')).toContainText('22 dias úteis');

  await page.screenshot({ path: `${SHOTS}/ferias.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Recursos: a vista de alocacoes lista e oferece nova alocacao', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(legalAppUrl('legal-recursos', 'alocacoes'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'alocacoes-page');
  await expect(page.getByTestId('alocacoes-tabela')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('nova-alocacao')).toBeVisible();

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Recursos: o mapa de ferias exporta PDF real via exportPdf', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const nonce = `XR2-${Date.now()}`;
  ctx.nonce = nonce;

  await page.goto(legalAppUrl('legal-recursos', 'ausencias'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'ausencias-page');
  await waitForSpine(page);

  // At least one pessoa is needed for the map to render rows and the export
  // button to enable.
  const injected = await page.evaluate(async (n) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const p = await s.create('pessoas', { nome: `Pessoa MAPA ${n}`, papel: 'advogado', dataAdmissao: '2020-01-01' });
    return { p: String(p.id) };
  }, nonce);
  ctx.pessoaIds = [injected.p];

  await page.reload();
  await ready(page, 'ausencias-page');
  await expect(page.getByTestId('mapa-ferias')).toBeVisible({ timeout: 10_000 });

  const exportar = page.getByTestId('mapa-exportar-pdf');
  await expect(exportar).toBeEnabled({ timeout: 10_000 });

  // The export goes through the platform exportPdf bridge (server-side Chromium
  // render), so allow a generous timeout for the real PDF to come back.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    exportar.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^mapa-ferias-\d{4}-\d{2}-\d{2}\.pdf$/);

  await page.screenshot({ path: `${SHOTS}/mapa-pdf.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
