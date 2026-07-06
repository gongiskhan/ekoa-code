import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * R-E1 - a espinha de demonstração Fonseca & Associados, vivida como um
 * utilizador: instalar no Núcleo -> a faixa transversal aparece em TODAS as
 * apps (Layout partilhado) -> remover -> a faixa desaparece e os registos
 * reais sobrevivem (remoção atómica, §3.2.4).
 *
 * Serial: o estado demo é partilhado pela conta; os três passos são UMA
 * história, não testes independentes.
 */

const NUCLEO = legalAppUrl('legal-nucleo');
const PRAZOS = legalAppUrl('legal-prazos');

test.describe.serial('demo spine: instalar -> faixa transversal -> remover atómico', () => {
  const pageErrors: string[] = [];

  test.beforeEach(({ page }) => {
    page.on('pageerror', (err) => pageErrors.push(String(err)));
  });

  test.afterEach(() => {
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toHaveLength(0);
    pageErrors.length = 0;
  });

  test('instalar cria o conjunto e liga a faixa no Núcleo e noutra app', async ({ page }) => {
    await page.goto(NUCLEO, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-spine-card')).toBeVisible();

    // Registo REAL criado antes da instalação - tem de sobreviver à remoção.
    await page.goto(legalAppUrl('legal-nucleo', 'clientes'), { waitUntil: 'domcontentloaded' });
    await page.getByTestId('novo-cliente').click();
    await page.locator('#cliente-nome').fill('Cliente Real Sobrevivente, Lda.');
    await page.locator('#cliente-nif').fill('500999888');
    await page.getByTestId('guardar-cliente').click();
    await expect(page.getByText('Cliente Real Sobrevivente, Lda.').first()).toBeVisible();

    await page.goto(NUCLEO, { waitUntil: 'domcontentloaded' });
    const estadoAntes = await page.getByTestId('demo-estado').innerText();
    if (/Instalado(?!\s*Não)/i.test(estadoAntes) && !/Não instalado/i.test(estadoAntes)) {
      // Estado sujo de execução anterior - remover primeiro para viver o fluxo
      // completo. A remoção varre ~24 colecções sequencialmente e o cartão só
      // recarrega quando termina - esperar pela própria app, NUNCA navegar a
      // meio (mataria o removerDemo em curso).
      await page.getByTestId('demo-remover').click();
      await page.getByTestId('demo-remover-confirmar').click();
      await expect(page.getByTestId('demo-banner')).toHaveCount(0, { timeout: 90_000 });
      await page.goto(NUCLEO, { waitUntil: 'domcontentloaded' });
    }

    await page.getByTestId('demo-instalar').click();
    // A instalação recarrega a página; a faixa aparece.
    await expect(page.getByTestId('demo-banner')).toBeVisible({ timeout: 30000 });
    await expect(page.getByTestId('demo-banner')).toContainText('Fonseca');

    // Faixa transversal: também está noutra app da suite (Layout partilhado).
    await page.goto(PRAZOS, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-banner')).toBeVisible();

    // Os dados demo são visíveis (o devedor da história encadeada existe).
    await page.goto(legalAppUrl('legal-nucleo', 'clientes'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Construções Tejo, S.A.')).toBeVisible();
  });

  test('remover apaga exclusivamente os registos demo; o real sobrevive; a faixa desliga', async ({ page }) => {
    await page.goto(NUCLEO, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('demo-remover').click();
    await page.getByTestId('demo-remover-confirmar').click();
    // A remoção é sequencial sobre ~24 colecções e a app recarrega no fim -
    // esperar pela conclusão (faixa desligada), nunca navegar a meio.
    await expect(page.getByTestId('demo-banner')).toHaveCount(0, { timeout: 90_000 });

    await page.goto(NUCLEO, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('demo-banner')).toHaveCount(0);

    await page.goto(legalAppUrl('legal-nucleo', 'clientes'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Cliente Real Sobrevivente, Lda.').first()).toBeVisible();
    await expect(page.getByText('Construções Tejo, S.A.')).toHaveCount(0);

    // HIGIENE: o cliente "sobrevivente" é um artefacto DESTE teste - apagar
    // todas as ocorrências (incl. fugas de execuções antigas), senão cada
    // execução acumula uma linha real na espinha e polui os selects das apps
    // (foi exactamente assim que o wizard de Contratos ficou com 8 opções
    // idênticas). Corre depois das asserções: a sobrevivência já está provada.
    const base = NUCLEO.split('/apps/')[0];
    const H = { 'X-Ekoa-App-Id': 'legal-nucleo' };
    const rows = (await (await page.request.get(`${base}/api/app-shared/clientes`, { headers: H })).json())
      .data as Array<{ id: string; nome?: string }>;
    for (const r of rows.filter((c) => c.nome === 'Cliente Real Sobrevivente, Lda.')) {
      await page.request.delete(`${base}/api/app-shared/clientes/${r.id}`, { headers: H });
    }
  });
});
