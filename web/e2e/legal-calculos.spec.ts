import { test, expect, Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * SV-CALC - the Cálculos service app (`legal-calculos`) driven end-to-end through
 * the served app (cortex at /apps/…). The owner app computes CLIENT-SIDE with the
 * vendored engine, fetching the rate table (canonical + crawler overlay) from its
 * own backend route POST /api/legal/calculos (tipo:'tabela'); consumers use the
 * server compute path via calculos-cliente.
 *
 * Coverage:
 *  1. JUROS golden through the UI: €12.500 from 2023-04-01 to 2023-09-30 crosses
 *     2023-S1 (10,5% - Aviso 1261/2023) and 2023-S2 (12,0% - Aviso 20214/2023) ->
 *     two troços, each citing its Aviso, total 560,96 €; the memória is shown and
 *     saving it lands a row in Memórias.
 *  2. CUSTAS: a €30.000 action on Tabela I-A with UC 2026 = 102,00 -> 5 UC =
 *     510,00 €, escalão + RCP citation rendered, "a confirmar" flagged.
 *
 * Self-cleaning: snapshots the `calculos` spine ids before each test and deletes
 * only the rows created during the test, so the shared spine is never polluted.
 */
const APP = legalAppUrl('legal-calculos');

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as any).__ekoa && (window as any).__ekoa.shared),
    undefined,
    { timeout: 20_000 },
  );
}

async function calculoIds(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    try {
      const rows = await (window as any).__ekoa.shared.list('calculos');
      return (Array.isArray(rows) ? rows : []).map((r: any) => r.id).filter(Boolean);
    } catch { return []; }
  });
}

let preExisting: string[] = [];

test.afterEach(async ({ page }) => {
  try {
    const after = await calculoIds(page);
    const novos = after.filter((id) => !preExisting.includes(id));
    if (novos.length) {
      await page.evaluate(async (ids: string[]) => {
        for (const id of ids) {
          try { await (window as any).__ekoa.shared.delete('calculos', id); } catch { /* ignore */ }
        }
      }, novos);
    }
  } catch { /* page may be gone */ }
  preExisting = [];
});

test('Cálculos: juros de mora cruzam dois semestres, citam os Avisos e a memória guarda-se', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('juros-page')).toBeVisible({ timeout: 20_000 });
  await waitForSpine(page);
  preExisting = await calculoIds(page);

  // Golden cross-semester input (2023-S1 -> 2023-S2) - MESMO caso do golden
  // unitário (calculos.test.ts): 10.000 -> 261,78 + 299,18 = 560,96.
  await page.getByTestId('juros-capital').fill('10000,00');
  await page.getByTestId('juros-vencimento').fill('2023-04-01');
  await page.getByTestId('juros-fim').fill('2023-09-30');
  await page.getByTestId('juros-tipo').selectOption('comercial');
  await page.getByTestId('calcular-juros').click();

  // Two troços, each citing its DGTF Aviso; exact total from the golden engine.
  const trocos = page.getByTestId('troco-row');
  await expect(trocos).toHaveCount(2, { timeout: 10_000 });
  const tabela = page.getByTestId('trocos-tabela');
  await expect(tabela).toContainText('Aviso n.º 1261/2023, DGTF');
  await expect(tabela).toContainText('Aviso n.º 20214/2023, DGTF');
  await expect(tabela).toContainText('10.5%');
  await expect(tabela).toContainText('12%');
  await expect(page.getByTestId('resultado-total')).toContainText('560,96');

  // The memória cites the base legal and both Avisos.
  const memoria = page.getByTestId('memoria');
  await expect(memoria).toBeVisible();
  await expect(memoria).toContainText('Aviso n.º 1261/2023, DGTF');
  await expect(memoria).toContainText('Código Comercial');

  // Save and confirm it appears in Memórias.
  await page.getByTestId('guardar-calculo').click();
  await page.goto(`${APP}memorias`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('memorias-page')).toBeVisible({ timeout: 20_000 });
  await waitForSpine(page);
  const lista = page.getByTestId('memorias-lista');
  await expect(lista).toBeVisible({ timeout: 10_000 });
  await expect(lista.getByTestId('memoria-row').filter({ hasText: '10 000,00' }).first()).toBeVisible({ timeout: 10_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Cálculos: taxa de justiça de uma acção de €30.000 (Tabela I-A, UC 2026) dá 510,00 €', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${APP}custas`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('custas-page')).toBeVisible({ timeout: 20_000 });
  await waitForSpine(page);
  preExisting = await calculoIds(page);

  await page.getByTestId('custas-valor').fill('30000,00');
  await page.getByTestId('custas-tabela').selectOption('I-A');
  await page.getByTestId('custas-ano').fill('2026');
  await page.getByTestId('calcular-custas').click();

  await expect(page.getByTestId('custas-total')).toContainText('510,00', { timeout: 10_000 });
  const resultado = page.getByTestId('custas-resultado');
  await expect(resultado).toContainText('5 UC');
  // Escalão + RCP citation + "a confirmar" honesty flag.
  await expect(resultado).toContainText('Regulamento das Custas Processuais');
  await expect(page.getByTestId('custas-nota')).toContainText('a confirmar');

  // Save persists a custas memória.
  await page.getByTestId('guardar-custas').click();
  await page.goto(`${APP}memorias`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('memorias-page')).toBeVisible({ timeout: 20_000 });
  await waitForSpine(page);
  await expect(page.getByTestId('memorias-lista').getByTestId('memoria-row').filter({ hasText: 'Taxa de justiça' }).first()).toBeVisible({ timeout: 10_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
