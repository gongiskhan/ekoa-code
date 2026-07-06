import { test, expect } from '@playwright/test';
import { legalAppUrl } from './helpers/legal';

/**
 * F1-foundation (F2: escala 28) - the app launcher at 28-app scale.
 *
 * The shared Layout no longer lists every other app flat in the sidebar: it
 * shows the SIBLINGS of the current app's group plus a "Todas as aplicações"
 * button opening a grouped, searchable panel (all 28 registered apps, with
 * the current one marked). Search is diacritics-insensitive; Escape closes
 * and focus returns to the button.
 */

const NUCLEO = legalAppUrl('legal-nucleo');

// The full canonical registry (mirrors APP_ORDER in Layout.jsx).
const ALL_KEYS = [
  'nucleo', 'kanban', 'agenda', 'tempos', 'recursos',
  'prazos', 'citius', 'dossie', 'pecas', 'pesquisa', 'apoio',
  'honorarios', 'financas', 'cobrancas',
  'contratos', 'modelos', 'forms', 'correio',
  'portal', 'conflitos', 'kyc',
  // F2: os sete apps da fase 2 registam-se antes de serem construídos - o
  // lançador afirma presença; a navegação valida-se quando cada app fizer build.
  'calculos', 'assinatura', 'injuncoes', 'transcricao', 'rcbe', 'insolvencias', 'jurimetria',
];

// Núcleo's group (gestao) siblings shown directly in the sidebar.
const NUCLEO_SIBLINGS = ['kanban', 'agenda', 'tempos', 'recursos'];

test.describe('legal launcher: grouped, searchable, 28 apps', () => {
  const pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0;
    page.on('pageerror', (err) => pageErrors.push(String(err)));
    await page.goto(NUCLEO, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('nav-inicio')).toBeVisible();
  });

  test.afterEach(() => {
    expect(pageErrors, `pageerrors: ${pageErrors.join(' | ')}`).toHaveLength(0);
  });

  test('sidebar shows group siblings + "Todas as aplicações"; panel lists all 28 grouped', async ({ page }) => {
    for (const key of NUCLEO_SIBLINGS) {
      await expect(page.getByTestId(`launcher-side-${key}`)).toBeVisible();
    }
    // Apps outside the current group are NOT in the sidebar (only in the panel).
    await expect(page.getByTestId('launcher-side-prazos')).toHaveCount(0);

    await page.getByTestId('launcher-all').click();
    const panel = page.getByTestId('launcher-panel');
    await expect(panel).toBeVisible();

    for (const key of ALL_KEYS) {
      await expect(panel.getByTestId(`launcher-${key}`)).toBeVisible();
    }
    // The current app is marked (a non-navigating button), and the five group labels render.
    await expect(panel.getByTestId('launcher-nucleo')).toHaveClass(/is-current/);
    await expect(panel.getByTestId('launcher-nucleo')).toHaveAttribute('aria-current', 'page');
    for (const label of ['Gestão', 'Processual', 'Financeiro', 'Documentos', 'Clientes e Conformidade']) {
      await expect(panel.getByRole('group', { name: label })).toBeVisible();
    }
  });

  test('search filters diacritics-insensitively and empty state renders', async ({ page }) => {
    await page.getByTestId('launcher-all').click();
    const panel = page.getByTestId('launcher-panel');
    const search = page.getByTestId('launcher-search');
    await expect(search).toBeFocused();

    // "honorarios" (sem acento) encontra "Honorários".
    await search.fill('honorarios');
    await expect(panel.getByTestId('launcher-honorarios')).toBeVisible();
    await expect(panel.getByTestId('launcher-kyc')).toHaveCount(0);

    await search.fill('xyz-inexistente');
    await expect(page.getByTestId('launcher-empty')).toBeVisible();

    await search.fill('');
    await expect(panel.getByTestId('launcher-kyc')).toBeVisible();
  });

  test('Escape closes the panel and restores focus; tiles deep-link via /apps/', async ({ page }) => {
    await page.getByTestId('launcher-all').click();
    await expect(page.getByTestId('launcher-panel')).toBeVisible();

    const href = await page.getByTestId('launcher-panel').getByTestId('launcher-prazos').getAttribute('href');
    expect(href).toBe('/apps/legal-prazos/');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('launcher-panel')).toHaveCount(0);
    await expect(page.getByTestId('launcher-all')).toBeFocused();
  });
});
