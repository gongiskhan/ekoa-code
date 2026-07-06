import { test, expect } from '@playwright/test';

/**
 * S3 coherence-locale: PT-PT is the product language, EN stays available,
 * and previously-hardcoded surfaces (automations, settings/platform) are i18n.
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

// The header language toggle's aria-label is itself localized, so match both.
const langToggle = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /Mudar idioma|Change language/ }).first();

test.describe('coherence-locale (S3)', () => {
  test('login uses PT-PT copy, not PT-BR', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText('Nome de utilizador')).toBeVisible();
    await expect(page.getByText('Palavra-passe').first()).toBeVisible();
    for (const brForm of ['Nome de usuario', 'Senha', 'Digite']) {
      expect(
        await page.getByText(brForm, { exact: false }).count(),
        `PT-BR form "${brForm}" must not appear on /login`,
      ).toBe(0);
    }
  });

  test('automations renders PT by default and flips to EN via the header toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await login(page);

    // settings/platform is localized (previously hardcoded English).
    await page.goto('/settings/platform');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.getByText('Platform Settings', { exact: true }).count()).toBe(0);

    await page.goto('/automations');

    // Default language is Portuguese: the list title ("Automatizações") or the
    // empty-state heading ("Ainda não há automatizações") — both match /Automatiza/.
    await expect(
      page.getByRole('heading', { name: /Automatiza/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Flip to English.
    await langToggle(page).click();

    // Now English: "Automations" / "No automations yet"; the PT heading is gone.
    await expect(
      page.getByRole('heading', { name: /Automations|No automations yet/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Automatiza/i })).toHaveCount(0);

    // Restore PT for subsequent specs.
    await langToggle(page).click();
    await expect(
      page.getByRole('heading', { name: /Automatiza/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    expect(
      consoleErrors.filter((e) => !e.includes('favicon')),
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });
});
