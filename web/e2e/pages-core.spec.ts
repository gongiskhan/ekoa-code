import { test, expect, type Page } from '@playwright/test';

/**
 * S4 pages-core: the automations / knowledge / usage / settings-platform
 * surfaces are migrated to the S1 design system — each wrapped in
 * PageShell + PageHeader (Lora h1), primitives only, PT-PT copy. This
 * spec drives the real dev servers (admin / tmp12345, no stubs) and
 * asserts each page renders its Lora PageHeader h1, throws no console
 * errors, and holds up at both desktop and 375px (mobile) widths.
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 375, height: 812 };

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

function assertNoConsoleErrors(errors: string[]) {
  const meaningful = errors.filter(
    (e) => !e.includes('favicon') && !e.includes('Download the React DevTools'),
  );
  expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
}

test.describe('pages-core (S4)', () => {
  test('automations list renders a PageHeader h1 with no console errors', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.goto('/automations');
    await expect(page.getByTestId('automations-page')).toBeVisible({ timeout: 15_000 });
    // The Lora page title lives in the PageHeader h1.
    await expect(page.locator('h1').first()).toHaveText(/Automa/i, { timeout: 15_000 });

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
    await expect(page.locator('h1').first()).toHaveText(/Usage/i);

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
