import { test, expect } from '@playwright/test';

/**
 * S2 shell-nav: the restyled sidebar + header must drop the header's
 * page-identity duplication, show a clean language label, and drive
 * navigation from the single NAV_ITEMS source.
 *
 * Real login (admin / tmp12345) against the live dev servers, no stubs.
 */

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

test.describe('shell-nav (S2)', () => {
  test('header drops page-identity duplication and shows a PT language label', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await login(page);

    // Navigate to integrations; the PAGE shows its title, the HEADER must not.
    await page.goto('/integrations');
    await expect(page.locator('h1').first()).toHaveText(/Integraç/, { timeout: 15_000 });

    const header = page.locator('header').first();
    // The old header duplicated the page name ("Integrations"/"Integrações").
    await expect(header).not.toContainText(/Integra/i);

    // Language toggle shows the clean 'PT' label (never 'PT-BR').
    await expect(header.getByText('PT', { exact: true })).toBeVisible();
    await expect(header).not.toContainText('PT-BR');

    expect(
      consoleErrors.filter((e) => !e.includes('favicon')),
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });

  test('sidebar renders the nav items and navigating via the sidebar works', async ({ page }) => {
    await login(page);

    // The single-source nav renders as links in the sidebar.
    const sidebarChat = page.locator('a[href="/chat"]').first();
    await expect(sidebarChat).toBeVisible();

    // Click the integrations nav item -> lands on /integrations.
    await page.locator('a[href="/integrations"]').first().click();
    await page.waitForURL(/\/integrations/, { timeout: 15_000 });
    await expect(page.locator('h1').first()).toHaveText(/Integraç/, { timeout: 15_000 });

    // And back to memory via its nav item.
    await page.locator('a[href="/memory"]').first().click();
    await page.waitForURL(/\/memory/, { timeout: 15_000 });
  });
});
