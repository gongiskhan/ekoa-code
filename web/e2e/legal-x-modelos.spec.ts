import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * S4-modelos (NEW coverage on top of the byte-frozen legal-modelos.spec.ts).
 *
 * Acceptance items:
 *  1. SEARCH - the list filters by name/category/fonte, accent-insensitive.
 *  2. TAGS - distinct categories render as filter chips; selecting one narrows the list.
 *  3. PREVIEW - a read-only drawer shows corpo, fonte (cited) and licença.
 *  4. "USAR MODELO" DEEP-LINK contract (app-local, both sides asserted here as the
 *     SENDING side): the row + preview links carry the exact app-local URLs
 *       -> contratos: /apps/legal-contratos/gerar/<id>
 *       -> pecas:     /apps/legal-pecas/?modelo=<id>
 *     (the RECEIVING side is proven in legal-x-contratos / legal-x-pecas.)
 *  5. FONTE cited - each row shows a fonte badge.
 *
 * Own spine setup + teardown via window.__ekoa.shared; zero pageerrors asserted.
 */
// A rota raiz da app é a Biblioteca; a lista "Os meus modelos" (modelos-page,
// pesquisa + tags + preview + deep-link) vive em /modelos.
const BASE = legalAppUrl('legal-modelos', 'modelos');

test.describe.serial('Modelos: pesquisa + tags + preview + deep-link', () => {
  const suffix = Date.now().toString(36);
  // Uma categoria única deste teste, para o chip de tag ser determinístico.
  const categoria = `Cat ${suffix}`;
  const nomeA = `Acordo Parassocial ${suffix}`; // pesquisável por "parassocial"
  const nomeB = `Contrato Arrendamento ${suffix}`;

  const created: { modeloAId?: string; modeloBId?: string } = {};

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE);
    await expect(page.getByTestId('modelos-page')).toBeVisible({ timeout: 20_000 });
    const a = await page.evaluate((d) => (window as any).__ekoa.shared.create('modelos', d), {
      nome: nomeA, categoria, area: 'Societário', fonte: 'importado',
      fonteOriginal: 'Biblioteca de minutas (domínio público)', licenca: 'domínio público / uso livre',
      descricao: 'Acordo entre sócios.', corpo: 'ACORDO PARASSOCIAL\nCláusula única: {{cliente_nome}}.',
      variaveis: [{ chave: 'cliente_nome', rotulo: 'Nome', origem: 'cliente.nome', obrigatoria: false }],
    });
    const b = await page.evaluate((d) => (window as any).__ekoa.shared.create('modelos', d), {
      nome: nomeB, categoria: `Outra ${suffix}`, area: 'Imobiliário', fonte: 'escritorio',
      licenca: 'uso interno', descricao: 'Arrendamento urbano.', corpo: 'CONTRATO DE ARRENDAMENTO\nObjecto.',
      variaveis: [],
    });
    created.modeloAId = a.id;
    created.modeloBId = b.id;
    await page.close();
  });

  test('pesquisa filtra sem acentos e a lista mostra a fonte citada', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('modelos-page')).toBeVisible({ timeout: 20_000 });

    // Ambos presentes de início.
    await expect(page.getByTestId(`modelo-row-${created.modeloAId}`)).toBeVisible();
    await expect(page.getByTestId(`modelo-row-${created.modeloBId}`)).toBeVisible();

    // Cada linha mostra a fonte citada (badge).
    await expect(page.getByTestId(`modelo-fonte-${created.modeloAId}`)).toBeVisible();
    await expect(page.getByTestId(`modelo-fonte-${created.modeloBId}`)).toBeVisible();

    // Pesquisa por "parassocial" (o A tem-no no nome) - insensível a acentos/caixa.
    await page.getByTestId('modelos-pesquisa').fill('PARASSOCIAL');
    await expect(page.getByTestId(`modelo-row-${created.modeloAId}`)).toBeVisible();
    await expect(page.getByTestId(`modelo-row-${created.modeloBId}`)).toHaveCount(0);

    // Limpa a pesquisa: o B volta a aparecer.
    await page.getByTestId('modelos-pesquisa').fill('');
    await expect(page.getByTestId(`modelo-row-${created.modeloBId}`)).toBeVisible();

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('as tags (categorias) filtram a lista', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('modelos-page')).toBeVisible({ timeout: 20_000 });

    // A categoria única deste teste é um chip de tag.
    const chip = page.getByTestId(`modelos-tag-${categoria}`);
    await expect(chip).toBeVisible();
    await chip.click();
    // Só o A (dessa categoria) fica na lista; o B (outra categoria) sai.
    await expect(page.getByTestId(`modelo-row-${created.modeloAId}`)).toBeVisible();
    await expect(page.getByTestId(`modelo-row-${created.modeloBId}`)).toHaveCount(0);

    // "Todas" repõe a lista completa.
    await page.getByTestId('modelos-tag-todas').click();
    await expect(page.getByTestId(`modelo-row-${created.modeloBId}`)).toBeVisible();

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('pré-visualização mostra corpo, fonte e licença; deep-links são app-local corretos', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('modelos-page')).toBeVisible({ timeout: 20_000 });

    // Deep-links NA LINHA: os hrefs seguem o contrato app-local exato.
    await expect(page.getByTestId(`modelo-usar-${created.modeloAId}`))
      .toHaveAttribute('href', `/apps/legal-contratos/gerar/${created.modeloAId}`);
    await expect(page.getByTestId(`modelo-usar-pecas-${created.modeloAId}`))
      .toHaveAttribute('href', `/apps/legal-pecas/?modelo=${created.modeloAId}`);

    // PREVIEW: abre o drawer só-leitura.
    await page.getByTestId(`modelo-preview-${created.modeloAId}`).click();
    await expect(page.getByTestId('modelo-preview-drawer')).toBeVisible();
    await expect(page.getByTestId('modelo-preview-corpo')).toContainText('ACORDO PARASSOCIAL');
    // Fonte citada + licença visíveis no preview.
    await expect(page.getByTestId('modelo-preview-fonte')).toBeVisible();
    await expect(page.getByTestId('modelo-preview-licenca')).toContainText('domínio público');
    // A variável {{cliente_nome}} aparece como chip.
    await expect(page.getByTestId('modelo-preview-var-0')).toBeVisible();

    // Deep-links DENTRO do preview também respeitam o contrato app-local.
    await expect(page.getByTestId('modelo-preview-usar'))
      .toHaveAttribute('href', `/apps/legal-contratos/gerar/${created.modeloAId}`);
    await expect(page.getByTestId('modelo-preview-usar-pecas'))
      .toHaveAttribute('href', `/apps/legal-pecas/?modelo=${created.modeloAId}`);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto(BASE).catch(() => {});
    for (const id of [created.modeloAId, created.modeloBId]) {
      if (id) await page.evaluate((i) => (window as any).__ekoa.shared.delete('modelos', i), id).catch(() => {});
    }
    await page.close();
  });
});
