import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * S4 pages-core: the integrations / knowledge / usage / settings-platform
 * surfaces are migrated to the S1 design system — each wrapped in
 * PageShell + PageHeader (Lora h1), primitives only, PT-PT copy. This
 * spec drives the real dev servers (admin / tmp12345, no stubs) and
 * asserts each page renders its Lora PageHeader h1, throws no console
 * errors, and holds up at both desktop and 375px (mobile) widths.
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

async function login(page: Page) {
  await uiLogin(page);
}

/**
 * CONSOLE ERRORS PINNED BY RESPONSE, NOT BY RAW CONSOLE LINE (S8 live pass). A raw
 * "Failed to load resource" line carries no URL, so a page making one legitimate 404 could only be
 * accommodated by ignoring the whole class. `/integrations` makes exactly one: the CS6 sync-state
 * endpoint with its flag off, which `citius-sync-outcome.spec.ts` documents as the behaviour under
 * test. Scoped to that single URL, so every other non-2xx still fails here.
 */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return; // pinned by URL below
    if (msg.text().includes('Download the React DevTools')) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    if (r.status() === 404 && /\/api\/v1\/sync\/citius\/notificacoes\/state$/.test(r.url())) return;
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

function assertNoConsoleErrors(errors: string[]) {
  expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
}

test.describe('pages-core (S4)', () => {
  // REWRITTEN AT S8 (2026-08-22): this case asserted the design system on `/automations`, a page
  // that is now a redirect. The subject moves to `/integrations`, which is what replaced it and is
  // the one page of this spec's four that was NOT already covered here.
  test('integrations list renders a PageHeader h1 with no console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.goto('/integrations');
    await expect(page.getByTestId('integrations-page')).toBeVisible({ timeout: 15_000 });
    // The Lora page title lives in the PageHeader h1.
    await expect(page.locator('h1').first()).toHaveText(/Integraç/i, { timeout: 15_000 });

    assertNoConsoleErrors(errors);
  });

  test('knowledge renders at desktop and 375px', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/knowledge');
    await expect(page.getByTestId('knowledge-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible();

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('knowledge-page')).toBeVisible();
    await expect(page.getByTestId('kn-agents-banner')).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('usage renders (super-admin) at desktop and 375px', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/usage');
    await expect(page.getByTestId('usage-page')).toBeVisible({ timeout: 15_000 });
    // PT-PT, like every other assertion in this file (and this spec's own header): the page title
    // is "Utilização". `/Usage/i` was an English leftover that never matched the shipped UI.
    await expect(page.locator('h1').first()).toHaveText(/Utiliza/i);

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('usage-page')).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('settings/platform renders localized headings at desktop and 375px', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/settings/platform');
    await expect(page.getByTestId('settings-platform-page')).toBeVisible({ timeout: 15_000 });
    // PT-PT section headings (never English) — the general/chat/advanced sections.
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Geral' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Avançado' })).toBeVisible();

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('settings-platform-page')).toBeVisible();

    assertNoConsoleErrors(errors);
  });
});
