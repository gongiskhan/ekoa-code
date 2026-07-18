import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-x-insolvencias - S2 deadline layer of the credor-side Insolvencias app.
 *
 * Covers, end-to-end through the served app (cortex at /apps/legal-insolvencias/):
 *  1. The 30-dias-CONTINUOS counting (CIRE art. 128.º n.º 1 + art. 9.º n.º 1) is
 *     visibly distinct from the CPC uteis counting: the registration card shows
 *     both termini side by side (golden: despacho 2026-07-10 -> CIRE 2026-08-10
 *     vs hypothetical CPC 2026-10-08), with the citations, and the detail page
 *     carries the contagem badge + the CPC contrast note.
 *  2. The spine prazo is written with tipoContagem 'corridos' and the art. 128.º
 *     citation in regraAplicada.
 *  3. Credor checklist: persisted on the insolvencia row, survives a reload.
 *  4. Deep-links to the cobranca (Cobrancas app) and to Injuncoes.
 *
 * Deterministic + self-cleaning: the cobranca is created via the spine API with
 * a per-run stamp (frozen-spec idiom) and everything derived (prazos,
 * reclamacoes, conta_corrente, insolvencia, cobranca) is removed in afterEach.
 */
const APP = legalAppUrl('legal-insolvencias');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'x-insolvencias');
mkdirSync(SHOTS, { recursive: true });

type Row = Record<string, unknown>;
interface SharedApi {
  list(collection: string): Promise<Row[]>;
  create(collection: string, data: Row): Promise<Row>;
  delete(collection: string, id: string): Promise<boolean>;
}
type SharedWindow = { __ekoa?: { shared?: SharedApi } };

const ctx: { insolvenciaId: string; cobrancaDescricao: string } = { insolvenciaId: '', cobrancaDescricao: '' };

async function waitForSpine(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as SharedWindow).__ekoa?.shared),
    undefined,
    { timeout: 20_000 },
  );
}

test.afterEach(async ({ page }) => {
  if (!ctx.insolvenciaId && !ctx.cobrancaDescricao) return;
  try {
    await page.evaluate(async ({ insId, cobDesc }) => {
      const s = (window as unknown as SharedWindow).__ekoa?.shared;
      if (!s) return;
      const safeList = async (col: string) => { try { return (await s.list(col)) || []; } catch { return []; } };
      const safeDel = async (col: string, id: unknown) => { try { await s.delete(col, String(id)); } catch { /* ignore */ } };
      if (insId) {
        for (const col of ['reclamacoes_creditos', 'prazos', 'conta_corrente']) {
          for (const r of await safeList(col)) {
            if (String(r.insolvenciaId || '') === insId) await safeDel(col, r.id);
          }
        }
        await safeDel('insolvencias', insId);
      }
      if (cobDesc) {
        for (const c of await safeList('cobrancas')) {
          if (c.descricao === cobDesc) await safeDel('cobrancas', c.id);
        }
      }
    }, { insId: ctx.insolvenciaId, cobDesc: ctx.cobrancaDescricao });
  } catch { /* page may be gone - ignore */ }
  ctx.insolvenciaId = '';
  ctx.cobrancaDescricao = '';
});

test('Insolvencias: contagem continua (CIRE art. 128.º) visivelmente distinta do CPC, checklist persistida e deep-links', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const stamp = Date.now();
  const descricao = `Fatura XINSOLV-${stamp}`;
  ctx.cobrancaDescricao = descricao;

  // Cobranca propria via spine API (frozen-spec idiom - rerunnable).
  const base = APP.split('/apps/')[0];
  const criada = await page.request.post(`${base}/api/app-shared/cobrancas`, {
    headers: { 'X-Ekoa-App-Id': 'legal-insolvencias', 'Content-Type': 'application/json' },
    data: { descricao, valor: 3210, dataVencimento: '2025-11-01', estado: 'pendente' },
  });
  expect(criada.ok()).toBe(true);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await waitForSpine(page);
  await expect(page.getByTestId('insolv-nova')).toBeVisible({ timeout: 20_000 });

  const select = page.getByTestId('insolv-credito');
  await expect(select.locator('option', { hasText: descricao })).toHaveCount(1, { timeout: 10_000 });
  await select.selectOption({ label: await select.locator('option', { hasText: descricao }).innerText() });

  // GOLDEN comparativo, before anything is written: despacho 2026-07-10 ->
  // CIRE 30 dias continuos = 2026-08-10 (Sunday 9 transfers to Monday 10;
  // ferias 16 Jul-31 Ago do NOT pause it) vs hypothetical CPC 30 dias uteis
  // (with ferias suspension) = 2026-10-08. The gap IS the point.
  await page.getByTestId('insolv-despacho').fill('2026-07-10');
  const contagem = page.getByTestId('insolv-contagem');
  await expect(contagem).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('insolv-cire-limite')).toHaveText('2026-08-10');
  await expect(page.getByTestId('insolv-cpc-limite')).toHaveText('2026-10-08');
  const citacao = page.getByTestId('insolv-cire-citacao');
  await expect(citacao).toContainText('CIRE art. 128.º n.º 1');
  await expect(citacao).toContainText('CIRE art. 9.º n.º 1');
  await expect(citacao).toContainText('CC art. 279.º al. e)');
  await page.screenshot({ path: `${SHOTS}/comparativo.png`, fullPage: true });

  await page.getByTestId('insolv-registar').click();
  await expect(page.getByTestId('insolv-detalhe')).toBeVisible({ timeout: 15_000 });
  const insId = page.url().match(/\/insolvencia\/([^/?#]+)/)?.[1] as string;
  expect(insId, 'insolvencia id in URL').toBeTruthy();
  ctx.insolvenciaId = insId;

  // Detail header: pinned date + the contagem badge + the CPC contrast note.
  await expect(page.getByTestId('insolv-prazo')).toContainText('10/08/2026');
  await expect(page.getByTestId('insolv-contagem-badge')).toContainText('CIRE art. 128.º');
  const contraste = page.getByTestId('insolv-cpc-contraste');
  await expect(contraste).toContainText('08/10/2026');
  await expect(contraste).toContainText('NÃO se aplica');

  // Spine truth: the radar prazo carries the corridos contagem + citation.
  const prazoSpine = await page.evaluate(async (id) => {
    const s = (window as unknown as SharedWindow).__ekoa!.shared!;
    const pz = (await s.list('prazos')).find((p) => String(p.insolvenciaId || '') === id) as Row | undefined;
    return pz
      ? { dataLimite: pz.dataLimite, tipoContagem: pz.tipoContagem, regra: String(pz.regraAplicada || '') }
      : null;
  }, insId);
  expect(prazoSpine, 'prazo written to the spine').not.toBeNull();
  expect(prazoSpine?.dataLimite).toBe('2026-08-10');
  expect(prazoSpine?.tipoContagem).toBe('corridos');
  expect(prazoSpine?.regra).toContain('CIRE art. 128.º n.º 1');

  // Credor checklist: starts empty, progresses, and survives a hard reload.
  await expect(page.getByTestId('insolv-checklist-progresso')).toHaveText('0 de 6');
  await page.getByTestId('insolv-check-titulo').check();
  await expect(page.getByTestId('insolv-checklist-progresso')).toHaveText('1 de 6', { timeout: 10_000 });
  await page.getByTestId('insolv-check-calculo').check();
  await expect(page.getByTestId('insolv-checklist-progresso')).toHaveText('2 de 6', { timeout: 10_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('insolv-detalhe')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('insolv-checklist-progresso')).toHaveText('2 de 6', { timeout: 15_000 });
  await expect(page.getByTestId('insolv-check-titulo')).toBeChecked();
  await expect(page.getByTestId('insolv-check-calculo')).toBeChecked();

  // Deep-links into the rest of the spine.
  const linkCobranca = page.getByTestId('insolv-link-cobranca');
  await expect(linkCobranca).toBeVisible();
  expect(await linkCobranca.getAttribute('href')).toMatch(/\/apps\/legal-cobrancas\/cobranca\/.+/);
  const linkInjuncoes = page.getByTestId('insolv-link-injuncoes');
  await expect(linkInjuncoes).toBeVisible();
  expect(await linkInjuncoes.getAttribute('href')).toContain('/apps/legal-injuncoes/');

  await page.screenshot({ path: `${SHOTS}/detalhe.png`, fullPage: true });
  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
