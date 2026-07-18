import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-calculos - S3-money layer of the Cálculos app (run
 * 20260717-202309-d797918a), on top of the byte-frozen legal-calculos spec.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-calculos/):
 *  1. The seeded 'confirmar' marker rows of `tabelas_taxas` are healed on app
 *     load, and a 2025-2026 juros comerciais cálculo spans FOUR troços each
 *     citing its real Aviso (1278/2025/2 DGTF; 16792/2025/2, 822/2026/2 and
 *     16623/2026/2, ETF) - the golden total is pinned by the unit suite
 *     (calculos-taxas-2026.test.ts); here the UI shows the same citations.
 *  2. Custas: the UC base for 2026 is CITED (art. 242.º da Lei n.º 73-A/2025)
 *     and the value 102,00 EUR is shown next to the UC count.
 *  3. Memória de cálculo: a saved cálculo exports a real PDF via the platform
 *     exportPdf bridge (server-side render - generous timeout).
 *
 * Deterministic + self-cleaning: the calculos rows created here are found by
 * their exact golden input and deleted in afterEach.
 */
const APP = legalAppUrl('legal-calculos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-calculos');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

const ctx: { calculoIds: string[] } = { calculoIds: [] };

async function ready(page: Page, testid: string) {
  await expect(page.getByTestId(testid)).toBeVisible({ timeout: 90_000 });
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (ids) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s || ids.length === 0) return;
      for (const id of ids) {
        try { await s.delete('calculos', id); } catch { /* ignore */ }
      }
    }, ctx.calculoIds);
  } catch { /* page may be gone - ignore */ }
  ctx.calculoIds = [];
});

/** Ids of `calculos` rows whose input matches this spec's golden juros input. */
async function idsDoGoldenJuros(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const rows = await s.list('calculos');
    return rows
      .filter((r) => {
        const input = (r.input || {}) as Row;
        return input.dataVencimento === '2025-01-01' && input.dataFim === '2026-07-17' && Number(input.capital) === 10000;
      })
      .map((r) => String(r.id));
  });
}

test('Calculos: heal das linhas-marcador + juros 2025-2026 em 4 trocos, cada um com o seu Aviso citado', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await ready(page, 'juros-page');

  // O arranque da página cura as linhas-marcador 'confirmar' semeadas (o
  // overlay placeholder de 2025-S2 sombreava a taxa verificada do canónico).
  await expect
    .poll(async () => page.evaluate(async () => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return -1;
      const rows = await s.list('tabelas_taxas');
      return rows.filter((r) => r.aviso === 'confirmar' || r.nota === 'confirmar').length;
    }), { timeout: 30_000 })
    .toBe(0);

  await page.getByTestId('juros-capital').fill('10000');
  await page.getByTestId('juros-vencimento').fill('2025-01-01');
  await page.getByTestId('juros-fim').fill('2026-07-17');
  await page.getByTestId('juros-tipo').selectOption('comercial');
  await page.getByTestId('calcular-juros').click();

  await expect(page.getByTestId('resultado')).toBeVisible({ timeout: 15_000 });
  // Golden do unit (calculos-taxas-2026.test.ts): 1 613,51 EUR de juros sobre
  // 10 000,00 (o separador de milhares do locale fica de fora do pin).
  await expect(page.getByTestId('resultado-total')).toContainText('613,51');
  await expect(page.getByTestId('troco-row')).toHaveCount(4);

  // NO uncited number: cada troço traz o seu Aviso real, incluindo os dois
  // semestres de 2026 (822/2026/2 e 16623/2026/2, ETF).
  const avisos = await page.getByTestId('troco-aviso').allInnerTexts();
  const juntos = avisos.join('\n');
  for (const aviso of ['1278/2025/2', '16792/2025/2', '822/2026/2', '16623/2026/2']) {
    expect(juntos, `Aviso ${aviso} citado num troço`).toContain(aviso);
  }
  await expect(page.getByTestId('memoria')).toContainText('16623/2026/2');

  await page.screenshot({ path: `${SHOTS}/juros-4-trocos.png`, fullPage: true });

  // Guardar produz a memória (limpa em afterEach pelo input golden exacto).
  await page.getByTestId('guardar-calculo').click();
  await expect.poll(async () => (await idsDoGoldenJuros(page)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  ctx.calculoIds = await idsDoGoldenJuros(page);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Calculos: a taxa de justica cita a base legal da UC de 2026 e a memoria exporta PDF real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(legalAppUrl('legal-calculos', 'custas'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'custas-page');

  await page.getByTestId('custas-valor').fill('30000');
  await page.getByTestId('custas-ano').fill('2026');
  await page.getByTestId('calcular-custas').click();

  await expect(page.getByTestId('custas-resultado')).toBeVisible({ timeout: 15_000 });
  // UC 2026 = 102,00 EUR, mantida pelo art. 242.º da Lei n.º 73-A/2025 (OE
  // 2026) - o valor E a fonte aparecem lado a lado no resultado.
  await expect(page.getByTestId('custas-resultado')).toContainText('102,00');
  await expect(page.getByTestId('custas-uc-base')).toContainText('Lei n.º 73-A/2025');

  await page.screenshot({ path: `${SHOTS}/custas-uc-2026.png`, fullPage: true });

  await page.getByTestId('guardar-custas').click();
  // Espera que a gravação assente ANTES de navegar (a navegação mataria o
  // pedido em curso) e regista a linha para limpeza - o título não leva nonce,
  // o filtro é o input exacto deste teste.
  const idsDaCustas = () => page.evaluate(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const rows = await s.list('calculos');
    return rows
      .filter((r) => {
        const input = (r.input || {}) as Row;
        return r.tipo === 'custas' && Number(input.valorAcao) === 30000 && Number(input.ano) === 2026;
      })
      .map((r) => String(r.id));
  });
  await expect.poll(async () => (await idsDaCustas()).length, { timeout: 15_000 }).toBeGreaterThan(0);
  ctx.calculoIds = await idsDaCustas();

  // A memória acabada de guardar fica no topo da lista (ordenada por data desc).
  await page.goto(legalAppUrl('legal-calculos', 'memorias'), { waitUntil: 'domcontentloaded' });
  await ready(page, 'memorias-page');
  const row = page.getByTestId('memoria-row').filter({ hasText: 'Taxa de justiça I-A' }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Exportação pela ponte exportPdf da plataforma (render Chromium no servidor).
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    row.getByTestId('exportar-memoria').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Taxa de justi.*\.pdf$/i);

  await page.screenshot({ path: `${SHOTS}/memoria-pdf.png`, fullPage: true });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
