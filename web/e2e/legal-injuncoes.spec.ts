import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * A-INJ - injunção vivida de ponta a ponta sobre um crédito vencido:
 * elegibilidade citada, juros por troços + taxa de justiça via SERVIÇO de
 * cálculos, interpelação registada no correio, submissão BNI assistida com
 * proveniência (registo_eventos), estados até à fórmula executória, prazo de
 * oposição de 15 dias no radar e tarefa de execução aberta.
 */

const APP = legalAppUrl('legal-injuncoes');

test('injunção completa: crédito -> cálculos citados -> BNI assistido -> fórmula executória', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Crédito vencido PRÓPRIO do teste (rerunnável - cada execução cria o seu),
  // pela mesma API da espinha que as apps usam.
  const stamp = Date.now();
  const descricao = `Fatura E2E-${stamp} - fornecimento`;
  const base0 = legalAppUrl('legal-cobrancas').split('/apps/')[0];
  const criada = await page.request.post(`${base0}/api/app-shared/cobrancas`, {
    headers: { 'X-Ekoa-App-Id': 'legal-injuncoes', 'Content-Type': 'application/json' },
    data: { descricao, valor: 4200, dataVencimento: '2025-05-01', estado: 'pendente', metodo: 'transferencia' },
  });
  expect(criada.ok()).toBe(true);

  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('injuncao-nova')).toBeVisible({ timeout: 20_000 });

  // Escolher o crédito vencido - elegibilidade citada.
  const select = page.getByTestId('injuncao-cobranca');
  await expect(select.locator('option', { hasText: descricao })).toHaveCount(1, { timeout: 10_000 });
  await select.selectOption({ label: await select.locator('option', { hasText: descricao }).innerText() });
  const eleg = page.getByTestId('injuncao-elegibilidade');
  await expect(eleg).toBeVisible();
  await expect(eleg).toContainText(/62\/2013|269\/98/);

  await page.getByTestId('injuncao-criar').click();
  await expect(page.getByTestId('injuncao-detalhe')).toBeVisible({ timeout: 15_000 });

  // Juros por troços + taxa de justiça vêm do serviço (Avisos/RCP citados).
  await page.getByTestId('injuncao-calcular').click();
  await expect(page.getByTestId('injuncao-juros')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('injuncao-juros')).toContainText(/troço/i);
  await expect(page.getByTestId('injuncao-taxa')).toContainText(/UC/);
  await expect(page.getByTestId('injuncao-total')).toContainText(/220-A\/2008/);

  // Interpelação formal registada.
  await page.getByTestId('injuncao-interpelar').click();
  await expect(page.getByTestId('interpelacao-texto')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('interpelacao-texto')).toContainText(/interpelar/i);

  // BNI assistido: 4 passos com proveniência, depois submetida.
  for (let i = 0; i < 4; i += 1) {
    await page.getByTestId(`bni-passo-${i}`).check();
  }
  await expect(page.getByTestId('injuncao-submeter')).toBeEnabled();
  await page.getByTestId('injuncao-submeter').click();
  await expect(page.getByTestId('injuncao-estado')).toContainText(/Submetida/i, { timeout: 10_000 });

  await page.getByTestId('injuncao-notificada').click();
  await expect(page.getByTestId('injuncao-estado')).toContainText(/Notificada/i, { timeout: 10_000 });

  await page.getByTestId('injuncao-formula').click();
  await expect(page.getByTestId('injuncao-estado')).toContainText(/Fórmula executória/i, { timeout: 10_000 });
  await expect(page.getByTestId('injuncao-executoria')).toBeVisible();

  // O prazo de oposição (15 dias) entrou na colecção partilhada `prazos` -
  // Núcleo/legal-prazos são os donos da apresentação; aqui verifica-se a
  // linha pela API real da espinha (o mesmo contrato que as apps usam).
  const base = legalAppUrl('legal-prazos').split('/apps/')[0];
  const resp = await page.request.get(`${base}/api/app-shared/prazos`, {
    headers: { 'X-Ekoa-App-Id': 'legal-injuncoes' },
  });
  const prazos = (await resp.json()).data as Array<{ descricao?: string }>;
  expect(prazos.some((r) => /Oposição à injunção/i.test(String(r.descricao)))).toBe(true);

  // §3.2.5: o fluxo assistido emite um evento de proveniência POR PASSO.
  const evResp = await page.request.get(`${base}/api/app-shared/registo_eventos`, {
    headers: { 'X-Ekoa-App-Id': 'legal-injuncoes' },
  });
  const eventos = (await evResp.json()).data as Array<{ app?: string; acao?: string }>;
  for (const passo of ['bni:passo-1', 'bni:passo-2', 'bni:passo-3', 'bni:passo-4']) {
    expect(
      eventos.some((e) => e.app === 'legal-injuncoes' && e.acao === passo),
      `evento de proveniência ${passo}`,
    ).toBe(true);
  }

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
