import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * Knowledge UI after the agent-first redesign, THEN WS8a's visibility fix on top of it:
 *  - the "Pergunte à base" tab/box (`kn-tab-perguntar`, `kn-query`) and the old Fornecido
 *    browse-search (`kn-browse-search`) stay gone - those specific affordances were removed
 *    and never came back.
 *  - an "agents use this first (before the web)" banner explains the model.
 *  - the page still BROWSES + MANAGES the base: add a doc via Documentos, see it in the
 *    Fornecido browse.
 *  - WS8a (2026-08-08) SUPERSEDES the "no human search box" half of the original design: a
 *    262k-document reserved `_shared` legal corpus (Jurisprudência/Legislação/Legislação
 *    laboral) is unions-searched by every org already, and paging through it by hand does not
 *    scale - so a NEW search box (`kn-search`/`kn-search-input`, backed by the existing
 *    POST /api/v1/knowledge/search) was added. It is a DIFFERENT affordance from the removed
 *    ones above (different testids, always visible, not tab-gated), so this spec's original
 *    absence assertions stay true; the new box's own coverage lives in
 *    `knowledge-shared-scope.spec.ts`. Backend search correctness is proven by the cortex
 *    suite (knowledge-ripgrep / knowledge-accents) and by `api/tests/contract/knowledge.test.ts`.
 */
async function login(page: Page) {
  await uiLogin(page);
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

  // The OLD ask-tab and browse-search affordances stay gone - never resurrected.
  await expect(page.getByTestId('kn-tab-perguntar')).toHaveCount(0);
  await expect(page.getByTestId('kn-query')).toHaveCount(0);
  await expect(page.getByTestId('kn-browse-search')).toHaveCount(0);

  // WS8a: a DIFFERENT, always-visible search box now exists (see knowledge-shared-scope.spec.ts).
  await expect(page.getByTestId('kn-search-input')).toBeVisible();

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
