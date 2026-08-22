import { test, expect } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * S3 coherence-locale: PT-PT is the product language, EN stays available,
 * and previously-hardcoded surfaces (integrations, settings/platform) are i18n.
 *
 * REWRITTEN AT S8 (2026-08-22). The i18n flip was demonstrated on `/automations`, which is now a
 * redirect. The vehicle moves to `/integrations` - the surface that replaced it, and the one this
 * spec's own subject (a page whose copy was hardcoded English before it was localised) now points
 * at. The assertion shape is unchanged: PT by default, EN after one toggle with NO Portuguese
 * heading surviving, PT restored for the specs that follow.
 *
 * Real login (admin / tmp12345) against the live dev servers, no stubs.
 */

async function login(page: import('@playwright/test').Page) {
  await uiLogin(page);
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

  test('integrations renders PT by default and flips to EN via the header toggle', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await login(page);

    // settings/platform is localized (previously hardcoded English).
    await page.goto('/settings/platform');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    expect(await page.getByText('Platform Settings', { exact: true }).count()).toBe(0);

    await page.goto('/integrations');

    // Default language is Portuguese: the page title is "Integrações".
    await expect(
      page.getByRole('heading', { name: /Integraç/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Flip to English.
    await langToggle(page).click();

    // Now English: "Integrations"; no Portuguese heading survives the flip.
    await expect(
      page.getByRole('heading', { name: /^Integrations/ }).first(),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Integraç/i })).toHaveCount(0);

    // Restore PT for subsequent specs.
    await langToggle(page).click();
    await expect(
      page.getByRole('heading', { name: /Integraç/i }).first(),
    ).toBeVisible({ timeout: 15_000 });

    expect(
      consoleErrors.filter((e) => !e.includes('favicon')),
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });
});
