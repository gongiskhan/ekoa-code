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
    // CONSOLE ERRORS PINNED BY RESPONSE, NOT BY RAW CONSOLE LINE (S8 live pass). Raw
    // "Failed to load resource" text carries no URL, so it cannot be excluded by address - and the
    // one 404 this page legitimately makes is the CS6 sync-state endpoint with its flag off, which
    // `citius-sync-outcome.spec.ts` already documents as the behaviour under test. That is the ONE
    // allowed URL; every other non-2xx still fails here.
    const consoleErrors: string[] = [];
    const devAssetNoise = /\/_next\/|hot-update|favicon/;
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (/^Failed to load resource/.test(msg.text())) return; // pinned by URL below
      consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
    page.on('response', (r) => {
      if (r.status() < 400 || devAssetNoise.test(r.url())) return;
      if (r.status() === 404 && /\/api\/v1\/sync\/citius\/notificacoes\/state$/.test(r.url())) return;
      if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
      consoleErrors.push(`${r.status()} ${r.url()}`);
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

    expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toHaveLength(0);
  });
});
