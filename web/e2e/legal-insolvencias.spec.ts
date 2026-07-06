import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * A-INSOLV - insolvência do lado do credor, vivida: registo ligado a um
 * crédito próprio do teste, prazo de reclamação de 30 DIAS CONTÍNUOS SEM
 * suspensão nas férias judiciais (o golden do regime CIRE vivido na UI:
 * despacho 2026-07-10 -> limite 2026-08-10, atravessando as férias de verão),
 * reclamação gerada, verificação/graduação e rateio na conta corrente.
 */

const APP = legalAppUrl('legal-insolvencias');

test('insolvência: registo -> prazo CIRE golden -> reclamação -> graduação -> rateio', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Crédito próprio (rerunnável).
  const stamp = Date.now();
  const descricao = `Fatura INSOLV-${stamp}`;
  const base = APP.split('/apps/')[0];
  const criada = await page.request.post(`${base}/api/app-shared/cobrancas`, {
    headers: { 'X-Ekoa-App-Id': 'legal-insolvencias', 'Content-Type': 'application/json' },
    data: { descricao, valor: 7500, dataVencimento: '2025-11-01', estado: 'pendente' },
  });
  expect(criada.ok()).toBe(true);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('insolv-nova')).toBeVisible({ timeout: 20_000 });

  const select = page.getByTestId('insolv-credito');
  await expect(select.locator('option', { hasText: descricao })).toHaveCount(1, { timeout: 10_000 });
  await select.selectOption({ label: await select.locator('option', { hasText: descricao }).innerText() });

  // GOLDEN vivido: despacho 2026-07-10 -> 30 dias contínuos -> 2026-08-10
  // (domingo 9 transfere para segunda 10; as férias de 16 Jul-31 Ago NÃO param a contagem).
  await page.getByTestId('insolv-despacho').fill('2026-07-10');
  await page.getByTestId('insolv-registar').click();
  await expect(page.getByTestId('insolv-detalhe')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('insolv-prazo')).toContainText('10/08/2026');

  // Reclamação de créditos gerada com montante/natureza/prazo.
  await page.getByTestId('rec-natureza').selectOption('comum');
  await page.getByTestId('rec-garantias').fill('sem garantias');
  await page.getByTestId('rec-gerar').click();
  const rec = page.getByTestId('rec-texto');
  await expect(rec).toBeVisible({ timeout: 10_000 });
  await expect(rec).toContainText('CIRE art. 128.º');
  await expect(rec).toContainText('7500');

  // Verificação -> graduação -> rateio na conta corrente.
  await page.getByTestId('insolv-verificacao').click();
  await expect(page.getByTestId('insolv-estado')).toContainText(/verificação/i, { timeout: 10_000 });
  await page.getByTestId('insolv-graduar').click();
  await expect(page.getByTestId('insolv-estado')).toContainText(/Graduada/i, { timeout: 10_000 });
  await page.getByTestId('rateio-valor').fill('1200');
  await page.getByTestId('rateio-lancar').click();

  const cc = (await (await page.request.get(`${base}/api/app-shared/conta_corrente`, { headers: { 'X-Ekoa-App-Id': 'legal-insolvencias' } })).json()).data as Array<{ descricao?: string; valor?: number }>;
  expect(cc.some((r) => /Rateio - insolvência/i.test(String(r.descricao)) && r.valor === 1200)).toBe(true);

  // A cobrança de origem ficou marcada para escalada (devedorInsolvente).
  const cob = (await (await page.request.get(`${base}/api/app-shared/cobrancas`, { headers: { 'X-Ekoa-App-Id': 'legal-insolvencias' } })).json()).data as Array<{ descricao?: string; devedorInsolvente?: boolean }>;
  expect(cob.some((c) => c.descricao === descricao && c.devedorInsolvente === true)).toBe(true);

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
