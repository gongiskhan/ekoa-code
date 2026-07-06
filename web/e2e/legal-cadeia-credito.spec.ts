import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * CADEIA 1 (R-E / §9.3a) - a história que nenhum concorrente demonstra, vivida
 * de ponta a ponta numa única execução: a fatura vencida da espinha Fonseca
 * viaja de COBRANÇAS (sequência esgotada) -> INJUNÇÃO (elegibilidade citada)
 * -> CÁLCULOS (juros por troços com Avisos + taxa de justiça, pelo serviço)
 * -> interpelação -> BNI assistido com proveniência -> fórmula executória ->
 * PRAZOS (oposição de 15 dias no radar). Tudo simulado - nenhum sistema
 * externo é tocado.
 */

const base = legalAppUrl('legal-nucleo').split('/apps/')[0];
const H = { 'X-Ekoa-App-Id': 'legal-injuncoes' };

test('cadeia: fatura vencida -> cobranças -> injunção -> cálculos -> prazos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // 0) Espinha Fonseca instalada (a fatura de 4.200 EUR vive lá).
  await page.goto(legalAppUrl('legal-nucleo'), { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('demo-spine-card')).toBeVisible({ timeout: 20_000 });
  if (/Não instalado/i.test(await page.getByTestId('demo-estado').innerText())) {
    await page.getByTestId('demo-instalar').click();
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 120_000 });
  }

  // Recomeço limpo da cadeia: injunções demo anteriores saem (só demo-marcadas).
  const injs = (await (await page.request.get(`${base}/api/app-shared/injuncoes`, { headers: H })).json()).data as Array<{ id: string; demo?: boolean }>;
  for (const i of injs.filter((x) => x.demo === true)) {
    await page.request.delete(`${base}/api/app-shared/injuncoes/${i.id}`, { headers: H });
  }

  // 1) COBRANÇAS: a vencida com a sequência de lembretes ESGOTADA (3 enviados).
  await page.goto(legalAppUrl('legal-cobrancas'), { waitUntil: 'domcontentloaded' });
  const linha = page.locator('[data-cobranca-descricao*="FT 2025/118"]').first();
  await expect(linha).toBeVisible({ timeout: 20_000 });
  await linha.click();
  await expect(page.getByTestId('cobranca-detalhe')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('lembrete-enviado')).toHaveCount(3); // esgotada

  // 2) INJUNÇÃO a partir do crédito, com elegibilidade CITADA (DL 62/2013).
  await page.goto(legalAppUrl('legal-injuncoes'), { waitUntil: 'domcontentloaded' });
  const select = page.getByTestId('injuncao-cobranca');
  const opt = select.locator('option', { hasText: 'FT 2025/118' });
  await expect(opt).toHaveCount(1, { timeout: 15_000 });
  await select.selectOption({ label: await opt.innerText() });
  await expect(page.getByTestId('injuncao-elegibilidade')).toContainText(/62\/2013/);
  await page.getByTestId('injuncao-criar').click();
  await expect(page.getByTestId('injuncao-detalhe')).toBeVisible({ timeout: 15_000 });

  // 3) CÁLCULOS pelo serviço: juros por troços (Avisos citados) + taxa (UC/RCP).
  await page.getByTestId('injuncao-calcular').click();
  await expect(page.getByTestId('injuncao-juros')).toContainText(/troço/i, { timeout: 15_000 });
  // Avisos reais citados quando publicados; semestres recentes mostram
  // honestamente 'confirmar' até o crawler/checkpoint os validar (P2-013).
  await expect(page.getByTestId('injuncao-juros')).toContainText(/Aviso|memória|confirmar/i);
  await expect(page.getByTestId('injuncao-taxa')).toContainText(/UC/);

  // 4) Interpelação registada + BNI assistido (proveniência por passo).
  await page.getByTestId('injuncao-interpelar').click();
  await expect(page.getByTestId('interpelacao-texto')).toBeVisible({ timeout: 10_000 });
  for (let i = 0; i < 4; i += 1) await page.getByTestId(`bni-passo-${i}`).check();
  await page.getByTestId('injuncao-submeter').click();
  await expect(page.getByTestId('injuncao-estado')).toContainText(/Submetida/i, { timeout: 10_000 });
  await page.getByTestId('injuncao-notificada').click();
  await expect(page.getByTestId('injuncao-estado')).toContainText(/Notificada/i, { timeout: 10_000 });

  // 5) FÓRMULA EXECUTÓRIA simulada -> tarefa de execução + prazo no radar.
  await page.getByTestId('injuncao-formula').click();
  await expect(page.getByTestId('injuncao-executoria')).toBeVisible({ timeout: 10_000 });

  // 6) PRAZOS: a oposição de 15 dias está na espinha, demo-marcada.
  const prazos = (await (await page.request.get(`${base}/api/app-shared/prazos`, { headers: H })).json()).data as Array<{ descricao?: string; demo?: boolean }>;
  const oposicao = prazos.filter((r) => /Oposição à injunção/i.test(String(r.descricao)) && /FT 2025\/118/.test(String(r.descricao)));
  expect(oposicao.length).toBeGreaterThan(0);
  expect(oposicao.every((r) => r.demo === true)).toBe(true); // remoção atómica cobre a cadeia

  // Proveniência de TODOS os passos assistidos (§3.2.5), demo-marcada.
  const ev = (await (await page.request.get(`${base}/api/app-shared/registo_eventos`, { headers: H })).json()).data as Array<{ acao?: string; demo?: boolean }>;
  for (const p of ['bni:passo-1', 'bni:passo-2', 'bni:passo-3', 'bni:passo-4']) {
    expect(ev.some((e) => e.acao === p && e.demo === true), `evento demo ${p}`).toBe(true);
  }

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
