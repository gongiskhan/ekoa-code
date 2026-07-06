import { test, expect, type Page } from '@playwright/test';

/**
 * Knowledge UI after the agent-first redesign:
 *  - there is NO human search box anywhere (the "Pergunte à base" tab/box and the
 *    Fornecido browse-search were removed) — the base is searched by Ekoa's agents
 *    via ripgrep (knowledge-first, cited-or-silent). Backend search correctness is
 *    proven by the cortex suite (knowledge-ripgrep / knowledge-accents).
 *  - an "agents use this first (before the web)" banner explains the model.
 *  - the page still BROWSES + MANAGES the base: add a doc via Documentos, see it
 *    in the Fornecido browse.
 */
async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/chat/, { timeout: 20_000 });
}

test('Knowledge UI: no search box, agents-first banner, browse + add via Documentos', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await page.goto('/knowledge');
  await expect(page.getByTestId('knowledge-page')).toBeVisible({ timeout: 20_000 });

  // The "agents use this base first, before the web" banner.
  await expect(page.getByTestId('kn-agents-banner')).toBeVisible();
  await expect(page.getByTestId('kn-agents-banner')).toContainText(/antes da web/i);

  // NO human search box anywhere — neither the old ask tab nor a browse search.
  await expect(page.getByTestId('kn-tab-perguntar')).toHaveCount(0);
  await expect(page.getByTestId('kn-query')).toHaveCount(0);
  await expect(page.getByTestId('kn-browse-search')).toHaveCount(0);

  // Add a sourced doc via the Documentos tab. unique TITLE+BODY per run (ingest is
  // content-addressed, so a fixed body would dedup to a prior run's doc).
  const nonce = Date.now();
  const titulo = `Doc de teste ${nonce}`;
  await page.getByTestId('kn-tab-documentos').click();
  await page.getByTestId('kn-collection').fill('jurisprudencia');
  await page.getByTestId('kn-titulo').fill(titulo);
  await page.getByTestId('kn-texto').fill(`Conteudo juridico de teste sobre prescricao. (ref ${nonce})`);
  await page.getByTestId('kn-fonte').fill('https://dgsi.pt/teste');
  await page.getByTestId('kn-guardar').click();
  await page.waitForTimeout(1500);

  // It shows up in the Fornecido browse (most-recent first).
  await page.getByTestId('kn-tab-fornecido').click();
  await expect(page.getByTestId('kn-doc').filter({ hasText: titulo })).toBeVisible({ timeout: 15_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
