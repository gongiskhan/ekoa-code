/* eslint-disable @typescript-eslint/no-explicit-any -- reaches into the app's injected window.__ekoa bridge (untyped) and drives dynamic shared-collection JSON */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { legalAppUrl } from './helpers/legal';

/**
 * legal-modelos - the Biblioteca de Modelos app. A static, code-shipped library
 * of minutas authored from OFFICIAL-source structure (DRE/IRN/DGAEP/Segurança
 * Social) - each item records `fonte` + `licenca` (the §3.2.2 regulatory rule:
 * only official sources, provenance always recorded, never a proprietary source
 * like the Ordem dos Advogados or PortalForense). Importing an item writes a row
 * into the shared `modelos` collection (fonte 'importado', versao 1), which the
 * sibling legal-contratos app then lists and can generate documents from - the
 * promote path this suite proves end to end.
 *
 * The suite creates only rows it imports and deletes exactly those in cleanup;
 * it NEVER touches the two spine-seeded modelos (owned by the Núcleo seed).
 */
const BASE = legalAppUrl('legal-modelos');
const SHOTS = resolve(__dirname, '..', '..', '.playwright-cli', 'legal-modelos');
mkdirSync(SHOTS, { recursive: true });

// The first biblioteca item (Procuração forense simples) is the one we import.
const PROCURACAO_CARD = 'bib-card-bib-procuracao-forense';
const PROCURACAO_IMPORT = 'bib-importar-bib-procuracao-forense';

test.describe.serial('Modelos: biblioteca oficial + importação versionada + promoção a Contratos', () => {
  const token = Date.now().toString(36);
  const taggedNome = `Procuração forense simples ${token}`;
  const created: { modeloId?: string } = {};

  test('§3.2.2 - a biblioteca mostra 6+ minutas, cada uma com fonte E licença, sem fontes proibidas', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('biblioteca-page')).toBeVisible({ timeout: 20_000 });

    // Cada card da biblioteca com a sua fonte + licença (spans dedicados).
    const items = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="bib-card-"]'));
      return cards.map((c) => {
        const fonteEl = c.querySelector('[data-testid^="bib-fonte-"]');
        const licencaEl = c.querySelector('[data-testid^="bib-licenca-"]');
        return {
          id: c.getAttribute('data-testid'),
          fonte: fonteEl ? (fonteEl.textContent || '').trim() : '',
          licenca: licencaEl ? (licencaEl.textContent || '').trim() : '',
        };
      });
    });

    expect(items.length, 'pelo menos 6 minutas na biblioteca').toBeGreaterThanOrEqual(6);
    for (const it of items) {
      expect(it.fonte, `fonte não-vazia (${it.id})`).not.toBe('');
      expect(it.licenca, `licença não-vazia (${it.id})`).not.toBe('');
      // Nenhuma fonte pode referenciar uma fonte proprietária proibida.
      expect(it.fonte, `fonte oficial, não proprietária (${it.id})`).not.toMatch(/Ordem dos Advogados|PortalForense/i);
    }

    // Reforço: o texto inteiro da página não referencia as fontes proibidas.
    const body = (await page.locator('body').innerText()).toLowerCase();
    expect(body).not.toContain('ordem dos advogados');
    expect(body).not.toContain('portalforense');

    // A pesquisa (âncora modelos-pesquisa) filtra por diacríticos/insensível a maiúsculas.
    await page.getByTestId('biblioteca-pesquisa').fill('arrendamento');
    await expect(page.getByTestId('bib-card-bib-arrendamento-habitacional')).toBeVisible();
    await expect(page.getByTestId(PROCURACAO_CARD)).toHaveCount(0);
    await page.getByTestId('biblioteca-pesquisa').fill('');

    await page.screenshot({ path: `${SHOTS}/biblioteca.png`, fullPage: true });
    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('importar a procuração -> linha em /modelos (fonte importado, licença, versão 1) com os campos corretos', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(BASE);
    await expect(page.getByTestId('biblioteca-page')).toBeVisible({ timeout: 20_000 });

    // Diff de ids antes/depois para identificar EXACTAMENTE a linha criada (robusto
    // a corridas anteriores: o nome pode ganhar sufixo " (2)" via nomeUnico).
    const before: string[] = await page.evaluate(() =>
      (window as any).__ekoa.shared.list('modelos').then((l: any[]) => l.map((m) => m.id)));

    await page.getByTestId(PROCURACAO_IMPORT).click();
    await expect(page.getByTestId('biblioteca-sucesso')).toBeVisible({ timeout: 15_000 });
    // O painel de sucesso oferece as duas acções (promoção a Contratos + ver modelos).
    await expect(page.getByTestId('sucesso-contratos')).toBeVisible();
    await expect(page.getByTestId('sucesso-modelos')).toBeVisible();

    const after: string[] = await page.evaluate(() =>
      (window as any).__ekoa.shared.list('modelos').then((l: any[]) => l.map((m) => m.id)));
    const novos = after.filter((id) => !before.includes(id));
    expect(novos.length, 'exactamente uma linha de modelo criada pela importação').toBe(1);
    created.modeloId = novos[0];

    // Campos persistidos (via a API partilhada, a mesma que o Contratos consome).
    const row = await page.evaluate(
      (id) => (window as any).__ekoa.shared.get('modelos', id),
      created.modeloId,
    );
    expect(row.fonte).toBe('importado');
    expect(row.categoria).toBe('Procurações');
    expect(row.area).toBe('Procurações');
    expect(typeof row.licenca).toBe('string');
    expect(row.licenca.length).toBeGreaterThan(0);
    expect(row.fonteOriginal, 'guarda a fonte oficial de origem').toMatch(/IRN/);
    expect(row.fonteOriginal).not.toMatch(/Ordem dos Advogados|PortalForense/i);
    expect(row.versao).toBe(1);
    expect(Array.isArray(row.variaveis) && row.variaveis.length).toBeGreaterThan(0);

    // Navega para /modelos e confirma a linha com o badge Importado, licença e v1.
    await page.getByTestId('sucesso-modelos').click();
    await expect(page.getByTestId('modelos-page')).toBeVisible({ timeout: 15_000 });
    const rowSel = page.getByTestId(`modelo-row-${created.modeloId}`);
    await expect(rowSel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`modelo-fonte-${created.modeloId}`)).toHaveText('Importado');
    await expect(page.getByTestId(`modelo-versao-${created.modeloId}`)).toHaveText('v1');
    await expect(rowSel).toContainText('domínio público');

    await page.screenshot({ path: `${SHOTS}/modelos.png`, fullPage: true });
    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('editar o modelo importado marca-o com o token e sobe a versão para 2', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect(created.modeloId, 'a importação criou um modelo').toBeTruthy();

    await page.goto(`${BASE}modelos`);
    await expect(page.getByTestId('modelos-page')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId(`modelo-editar-${created.modeloId}`).click();
    await expect(page.getByTestId('modelo-edit-drawer')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('modelo-edit-nome').fill(taggedNome);
    await page.getByTestId('modelo-edit-guardar').click();

    // Gravar fecha a gaveta e a linha passa a v2 com o nome etiquetado.
    await expect(page.getByTestId('modelo-edit-drawer')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByTestId(`modelo-versao-${created.modeloId}`)).toHaveText('v2', { timeout: 10_000 });
    await expect(page.getByTestId(`modelo-row-${created.modeloId}`)).toContainText(taggedNome);

    const row = await page.evaluate(
      (id) => (window as any).__ekoa.shared.get('modelos', id),
      created.modeloId,
    );
    expect(row.versao).toBe(2);
    expect(row.nome).toBe(taggedNome);

    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('o modelo importado aparece na galeria do legal-contratos (prova a promoção)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect(created.modeloId, 'a importação criou um modelo').toBeTruthy();

    await page.goto(legalAppUrl('legal-contratos'));
    await expect(page.getByTestId('galeria-page')).toBeVisible({ timeout: 20_000 });

    // O Contratos lista as linhas de `modelos` automaticamente; o nome etiquetado
    // (único) tem de renderizar lá - prova de que a mesma linha é consumível.
    await page.getByTestId('galeria-pesquisa').fill(token);
    await expect(page.getByTestId(`modelo-card-${created.modeloId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(taggedNome, { exact: true })).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/contratos-promocao.png`, fullPage: true });
    expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test.afterAll(async ({ browser }) => {
    // Limpa APENAS a linha importada por este teste - nunca as duas semeadas.
    if (!created.modeloId) return;
    const page = await browser.newPage();
    try {
      await page.goto(BASE).catch(() => {});
      await page.evaluate((id) => (window as any).__ekoa.shared.delete('modelos', id), created.modeloId).catch(() => {});
    } finally {
      await page.close();
    }
  });
});
