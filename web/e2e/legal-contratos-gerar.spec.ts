import { test, expect, type Page } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * Regressão do wizard "Gerar" de legal-contratos - o caso reportado: "não é
 * possível escolher o cliente". Duas causas reais cobertas:
 *
 * 1) POLUIÇÃO da espinha: specs e demonstrações que não limpavam atrás de si
 *    enchiam o select de clientes com lixo repetido (8x "Cliente Real
 *    Sobrevivente", 5x "Cliente E2E ...") - opções indistinguíveis, quase
 *    todas sem processos, tornavam a escolha impossível na prática. Os specs
 *    passaram a limpar; este spec assegura que ele próprio não deixa rasto e
 *    que o select funciona de ponta a ponta.
 *
 * 2) LISTA ESTAGNADA: um cliente registado no Núcleo noutro separador nunca
 *    aparecia sem recarregar a página. O wizard agora relê clientes/processos
 *    quando a janela recupera o foco.
 */

const APP = legalAppUrl('legal-contratos');
const BASE = APP.split('/apps/')[0];
const H = { 'X-Ekoa-App-Id': 'legal-contratos' };

async function sharedCreate(page: Page, collection: string, data: unknown): Promise<any> {
  return page.evaluate(
    ([c, d]) => (window as any).__ekoa.shared.create(c, d),
    [collection, data] as const,
  );
}

test('gerar: escolher cliente funciona; cliente novo aparece ao voltar o foco', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const criados: Array<{ col: string; id: string }> = [];

  // Modelo canónico resolvido pelo nome (o id muda entre instalações).
  const modelos = (await (await page.request.get(`${BASE}/api/app-shared/modelos`, { headers: H })).json())
    .data as Array<{ id: string; nome?: string }>;
  const modelo = modelos.find((m) => m.nome === 'Procuração forense simples') ?? modelos[0];
  expect(modelo, 'existe pelo menos um modelo').toBeTruthy();

  try {
    await page.goto(`${APP}gerar/${modelo.id}`, { waitUntil: 'domcontentloaded' });
    const sel = page.getByTestId('gerar-cliente');
    await expect(sel).toBeVisible({ timeout: 20_000 });

    // A lista carrega (o placeholder honesto de carregamento dá lugar à lista).
    await expect(sel.locator('option').first()).not.toHaveText('A carregar clientes…', { timeout: 15_000 });
    const antes = await sel.locator('option').allInnerTexts();
    expect(antes.length, 'há clientes para escolher').toBeGreaterThan(1);
    // O lixo dos specs antigos não volta (a poluição era o bug reportado).
    expect(antes.filter((o) => /^Cliente E2E \d+$/.test(o))).toHaveLength(0);

    // Cliente + processo novos criados "noutro separador" (via espinha) ...
    const cli = await sharedCreate(page, 'clientes', { nome: 'Cliente Foco Regressao, Lda.', nif: '509999111' });
    criados.push({ col: 'clientes', id: cli.id });
    const proc = await sharedCreate(page, 'processos', {
      clienteId: cli.id, numeroProcesso: '7777/26.0T8REG', tribunal: 'Juízo Local Cível de Regressão', estado: 'ativo',
    });
    criados.push({ col: 'processos', id: proc.id });

    // ... e o wizard mostra-os quando a janela recupera o foco, sem reload.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const opt = sel.locator('option', { hasText: 'Cliente Foco Regressao, Lda.' });
    await expect(opt).toHaveCount(1, { timeout: 10_000 });

    // ESCOLHER o cliente funciona: o valor fixa-se, os processos povoam-se,
    // e o Continuar leva ao passo 2.
    await sel.selectOption({ label: 'Cliente Foco Regressao, Lda.' });
    await expect(sel).toHaveValue(cli.id);
    const procSel = page.getByTestId('gerar-processo');
    await expect(procSel).toBeEnabled();
    await procSel.selectOption({ label: '7777/26.0T8REG' });
    await page.getByTestId('gerar-continuar').click();
    await expect(page.getByTestId('gerar-passo2')).toBeVisible({ timeout: 10_000 });
  } finally {
    // HIGIENE: este spec não deixa rasto na espinha (processos antes de clientes).
    for (const { col, id } of criados.reverse()) {
      await page.request.delete(`${BASE}/api/app-shared/${col}/${id}`, { headers: H });
    }
  }

  expect(errors, `pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
});
