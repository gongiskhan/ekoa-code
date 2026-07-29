import { test, expect, type Page } from '@playwright/test';

/**
 * S5 pages-manage: the integrations / memory / users / settings-branding
 * surfaces are migrated to the S1 design system — each wrapped in
 * PageShell + PageHeader (Lora h1), ui primitives only, PT-PT copy, local
 * toasts/spinners/dialogs killed. This spec drives the real dev servers
 * (admin / tmp12345, no stubs) and asserts each page renders its Lora
 * PageHeader h1, keeps its core functionality (integrations filter, memory
 * tier tabs, users Table), throws no console errors, and holds up at both
 * desktop and 375px (mobile) widths.
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

test.describe('pages-manage (S5)', () => {
  test('integrations renders a PT PageHeader with a functional filter', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/integrations');
    await expect(page.getByTestId('integrations-page')).toBeVisible({ timeout: 15_000 });
    // The Lora page title lives in the PageHeader h1 (PT-PT, never English).
    await expect(page.locator('h1').first()).toHaveText(/Integraç/i, { timeout: 15_000 });

    // Filter pills are the Tabs `pills` primitive (role=tab) — but so are the PAGE-level tabs now,
    // so a bare `getByRole('tab')` spans both sets and `.nth(1)` lands on whichever the DOM orders
    // second. That navigated AWAY from the Plataforma panel, taking the search box (which only
    // renders there) with it. Scope to the panel so the query means what it says.
    const platform = page.getByTestId('platform-integrations-section');
    await expect(platform).toBeVisible({ timeout: 15_000 });

    const filterPills = platform.getByRole('tab');
    await expect(filterPills.first()).toBeVisible();
    await expect(platform.getByRole('tab', { name: /Todas/i })).toBeVisible();
    await filterPills.nth(1).click();
    await expect(page.getByTestId('integrations-page')).toBeVisible();

    // Localized search placeholder (no hardcoded English).
    await expect(platform.getByPlaceholder(/Pesquisar integraç/i)).toBeVisible();

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('integrations-page')).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('memory renders tier tabs at desktop and 375px', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/memory');
    await expect(page.getByTestId('memory-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('h1').first()).toHaveText(/Memória/i, { timeout: 15_000 });

    // Tier tabs are the Tabs primitive (overview / core / guardrails / …).
    const tabs = page.getByRole('tab');
    await expect(tabs.first()).toBeVisible();
    expect(await tabs.count()).toBeGreaterThan(1);

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('memory-page')).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('users renders the Table primitive with the super-admin admin row', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/users');
    await expect(page.getByTestId('users-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible();

    // The users list is the Table primitive; the seeded super-admin `admin`
    // user must still render as a row.
    await expect(page.getByTestId('users-table')).toBeVisible();
    await expect(page.getByTestId('user-row-admin')).toBeVisible({ timeout: 15_000 });

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('users-page')).toBeVisible();

    assertNoConsoleErrors(errors);
  });

  test('settings/branding renders at desktop and 375px', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    await page.setViewportSize(DESKTOP);
    await page.goto('/settings/branding');
    await expect(page.getByTestId('settings-branding-page')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('h1').first()).toBeVisible();

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId('settings-branding-page')).toBeVisible();

    assertNoConsoleErrors(errors);
  });
});
