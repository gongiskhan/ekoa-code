import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-apoio - S2 deadline layer of the Apoio Judiciario app.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-apoio/):
 *  1. Nomeacao: registering the decision notification generates the two SinOA
 *     balizas PLUS the Lei 34/2004 art. 33.º prazo (30 dias corridos for the
 *     patrono to file the action) - golden: notif 2026-09-07 -> 2026-10-07 -
 *     with the legal source shown on the panel and persisted (regraAplicada)
 *     so the prazos radar carries the citation.
 *  2. Escusa: the art. 34.º prazo (OA decides in 15 dias) - golden: notif
 *     2026-09-07 -> 2026-09-22 - and the pedido pack exports a real PDF via
 *     the platform exportPdf bridge with a deterministic filename.
 *
 * The frozen legal-apoio spec drives proteccao_juridica and asserts EXACTLY 2
 * origem-'apoio' prazos; these tests only use nomeacao/escusa (whose extras
 * append AFTER the SinOA pair) and clean up every prazo they generate, plus a
 * backstop delete of all origem-'apoio' prazos (same backstop the frozen spec
 * uses), so the frozen golden stays green.
 */
const APP = legalAppUrl('legal-apoio');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-apoio');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

const ctx: { pedidoIds: string[] } = { pedidoIds: [] };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

test.afterEach(async ({ page }) => {
  try {
    await page.evaluate(async (pedidoIds) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const safeDel = async (col: string, id: unknown) => { try { await s.delete(col, String(id)); } catch { /* ignore */ } };
      let pedidos: Row[] = [];
      try { pedidos = await s.list('apoio_judiciario'); } catch { pedidos = []; }
      for (const id of pedidoIds) {
        const row = pedidos.find((p) => String(p.id) === id);
        const gerados = row && Array.isArray(row.prazosGerados) ? (row.prazosGerados as string[]) : [];
        for (const pid of gerados) await safeDel('prazos', pid);
        await safeDel('apoio_judiciario', id);
      }
      // Backstop (same as the frozen legal-apoio spec): only this app writes
      // origem-'apoio' prazos; a lingering one would break the frozen golden.
      let prazos: Row[] = [];
      try { prazos = await s.list('prazos'); } catch { prazos = []; }
      for (const pz of prazos) {
        if (pz.origem === 'apoio') await safeDel('prazos', pz.id);
      }
    }, ctx.pedidoIds);
  } catch { /* page may be gone - ignore */ }
  ctx.pedidoIds = [];
});

test('Apoio: nomeacao gera as 2 balizas SinOA + o prazo do art. 33.º da Lei 34/2004, com fonte citada', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${APP}novo`, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('novo-pedido-page')).toBeVisible({ timeout: 20_000 });

  const primeiroCliente = page.getByTestId('apoio-cliente').locator('option').nth(1);
  await expect(primeiroCliente).toBeAttached({ timeout: 15_000 });
  await page.getByTestId('apoio-cliente').selectOption((await primeiroCliente.getAttribute('value')) ?? '');
  await page.getByTestId('apoio-tipo').selectOption('nomeacao');
  await page.getByTestId('apoio-data').fill('2026-09-01');
  await page.getByTestId('apoio-criar').click();

  await page.waitForURL(/\/pedido\//, { timeout: 20_000 });
  const pedidoId = page.url().match(/\/pedido\/([^/?#]+)/)?.[1] as string;
  expect(pedidoId, 'pedido id in URL').toBeTruthy();
  ctx.pedidoIds.push(pedidoId);
  await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 15_000 });

  // GOLDEN: notif 2026-09-07 -> SinOA pair first, then art. 33.º at index 2
  // (30 dias corridos -> 2026-10-07; the engine transfers weekend endings).
  await page.getByTestId('apoio-notif-data').fill('2026-09-07');
  await page.getByTestId('apoio-notif-registar').click();
  await expect(page.getByTestId('apoio-prazos')).toBeVisible({ timeout: 15_000 });

  await expect(page.getByTestId('apoio-prazo-desc-0')).toContainText('SinOA: registo do pedido');
  await expect(page.getByTestId('apoio-prazo-desc-1')).toContainText('SinOA: documentação');
  await expect(page.getByTestId('apoio-prazo-desc-2')).toContainText('Nomeação: propositura da ação');
  await expect(page.getByTestId('apoio-prazo-datalimite-2')).toHaveText('2026-10-07');
  await expect(page.getByTestId('apoio-prazo-fonte-2')).toContainText('Lei n.º 34/2004');
  await expect(page.getByTestId('apoio-prazo-fonte-2')).toContainText('art. 33.º');

  // Spine truth: 3 prazos persisted, the extra carrying the citation.
  const spine = await page.evaluate(async (id) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const pedido = (await s.list('apoio_judiciario')).find((p) => String(p.id) === id) as Row;
    const gerados = Array.isArray(pedido?.prazosGerados) ? (pedido.prazosGerados as string[]) : [];
    const prazos = (await s.list('prazos')).filter((p) => gerados.includes(String(p.id)));
    const extra = prazos.find((p) => String(p.descricao || '').startsWith('Nomeação'));
    return {
      gerados: gerados.length,
      persistidos: prazos.length,
      extraLimite: extra ? extra.dataLimite : null,
      extraRegra: extra ? String(extra.regraAplicada || '') : '',
      extraContagem: extra ? extra.tipoContagem : null,
    };
  }, pedidoId);
  expect(spine.gerados).toBe(3);
  expect(spine.persistidos).toBe(3);
  expect(spine.extraLimite).toBe('2026-10-07');
  expect(spine.extraRegra).toContain('art. 33.º');
  expect(spine.extraContagem).toBe('corridos');

  await page.screenshot({ path: `${SHOTS}/nomeacao.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Apoio: escusa gera o prazo do art. 34.º (15 dias) e o pack do pedido exporta PDF real', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);

  // Inject the pedido directly (the UI creation path is covered above).
  const pedidoId = await page.evaluate(async () => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const clientes = await s.list('clientes');
    const row = await s.create('apoio_judiciario', {
      clienteId: clientes.length > 0 ? String(clientes[0].id) : null,
      tipoPedido: 'escusa', estado: 'deferido',
      datas: { pedido: '2026-09-01' }, prazosGerados: [],
      honorarios: { fase: 'inicial', despesas: [] },
    });
    return String(row.id);
  });
  ctx.pedidoIds.push(pedidoId);

  await page.goto(`${APP}pedido/${pedidoId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('pedido-detail')).toBeVisible({ timeout: 20_000 });

  // GOLDEN: notif 2026-09-07 -> art. 34.º at index 2 (15 dias corridos ->
  // 22/09: the 15th day is Tue 2026-09-22, a working day - no transfer).
  await page.getByTestId('apoio-notif-data').fill('2026-09-07');
  await page.getByTestId('apoio-notif-registar').click();
  await expect(page.getByTestId('apoio-prazos')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('apoio-prazo-desc-2')).toContainText('Escusa: decisão da Ordem dos Advogados');
  await expect(page.getByTestId('apoio-prazo-datalimite-2')).toHaveText('2026-09-22');
  await expect(page.getByTestId('apoio-prazo-fonte-2')).toContainText('art. 34.º');

  // The pack goes through the platform exportPdf bridge (server-side Chromium
  // render) - allow a generous timeout for the real PDF to come back.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('apoio-pack-pdf').click(),
  ]);
  expect(download.suggestedFilename()).toBe(`pack-apoio-${pedidoId}.pdf`);

  await page.screenshot({ path: `${SHOTS}/escusa-pack.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
