import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * A-RCBE - o lado declarativo do beneficiário efetivo, vivido: carteira com a
 * entidade Fonseca (BOs partilhados com o KYC), calendário com a confirmação
 * anual, declaração pré-preenchida, submissão assistida (4 passos com
 * proveniência ASSERIDA) e comprovativo que fecha a obrigação + lança a avença.
 * Precisa da espinha Fonseca instalada (o harness das demos instala-a; este
 * spec instala-a se faltar, via o cartão do Núcleo).
 */

const APP = legalAppUrl('legal-rcbe');

test('RCBE completo: entidade -> declaração -> submissão assistida -> comprovativo + avença', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Garantir a espinha Fonseca (a entidade demo vem de lá).
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('demo-spine-card')).toBeVisible({ timeout: 20_000 });
  const estado = await page.getByTestId('demo-estado').innerText();
  if (/Não instalado/i.test(estado)) {
    await page.getByTestId('demo-instalar').click();
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 90_000 });
  }

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('rcbe-lista')).toBeVisible({ timeout: 20_000 });

  // A entidade demo (Vinhos do Douro) com 2 BOs partilhados.
  const linha = page.getByTestId('rcbe-row').filter({ hasText: 'Vinhos do Douro' }).first();
  await expect(linha).toBeVisible();
  await expect(linha).toContainText(/2 beneficiário/);
  await linha.locator('a').click();
  await expect(page.getByTestId('rcbe-detalhe')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('rcbe-bo-row')).toHaveCount(2);

  // Calendário mostra obrigação pendente/em atraso.
  await expect(page.getByTestId('rcbe-calendario')).toContainText(/atraso|Pendente|Prevista/i);

  // Declaração pré-preenchida com os BOs e a base legal.
  await page.getByTestId('rcbe-preparar').click();
  const dec = page.getByTestId('rcbe-declaracao');
  await expect(dec).toBeVisible();
  await expect(dec).toContainText('Vinhos do Douro');
  await expect(dec).toContainText(/89\/2017/);
  await expect(dec).toContainText(/Sarmento Vale/);

  // Submissão assistida: 4 passos -> arquivar fecha a obrigação.
  for (let i = 0; i < 4; i += 1) await page.getByTestId(`portal-passo-${i}`).check();
  await expect(page.getByTestId('rcbe-arquivar')).toBeEnabled();
  await page.getByTestId('rcbe-arquivar').click();
  await expect(page.getByTestId('rcbe-obrigacao').filter({ hasText: 'Cumprida' }).first()).toBeVisible({ timeout: 15_000 });

  // Proveniência por passo (§3.2.5) + avença lançada - pela API real.
  const base = APP.split('/apps/')[0];
  const ev = (await (await page.request.get(`${base}/api/app-shared/registo_eventos`, { headers: { 'X-Ekoa-App-Id': 'legal-rcbe' } })).json()).data as Array<{ app?: string; acao?: string }>;
  for (const p of ['portal:passo-1', 'portal:passo-2', 'portal:passo-3', 'portal:passo-4']) {
    expect(ev.some((e) => e.app === 'legal-rcbe' && e.acao === p), `evento ${p}`).toBe(true);
  }
  const lanc = (await (await page.request.get(`${base}/api/app-shared/lancamentos`, { headers: { 'X-Ekoa-App-Id': 'legal-rcbe' } })).json()).data as Array<{ descricao?: string }>;
  expect(lanc.some((l) => /Avença RCBE/i.test(String(l.descricao)))).toBe(true);

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
