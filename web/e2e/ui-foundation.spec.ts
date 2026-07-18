import { test, expect } from '@playwright/test';

/**
 * S1 ui-foundation smoke: the token override + primitive foundation must not
 * break the core auth flow, and the dead design layers must stay dead.
 *
 * Real login (admin / tmp12345) against the live dev servers, no stubs.
 */

test.describe('ui-foundation (S1)', () => {
  test('login page renders on the new foundation and auth works end-to-end', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/login');

    // <html lang> is the PT-PT market signal set by S1.
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-PT');

    // The login form is usable (skip checkbox/hidden inputs).
    const username = page.locator('input[type="text"], input:not([type])').first();
    const password = page.locator('input[type="password"]').first();
    await username.fill('admin');
    await password.fill('tmp12345');
    const submit = page.getByRole('button', { name: /entrar|iniciar/i }).first();
    await expect(submit).toBeEnabled();
    await submit.click();

    // Auth lands on chat with the app shell rendered (composer visible).
    await page.waitForURL(/\/chat/, { timeout: 60_000 });
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 15_000 });

    // No console errors during the whole flow.
    expect(
      consoleErrors.filter((e) => !e.includes('favicon')),
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });

  test('login (S7) renders the white document card with a Space Grotesk display headline', async ({ page }) => {
    await page.goto('/login');

    // The white document card carries the light UI on the petrol backdrop.
    const card = page.getByTestId('login-card');
    await expect(card).toBeVisible();

    // Header title is present (PT-PT copy) and uses the Space Grotesk display face.
    const heading = card.locator('h1').first();
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(/Iniciar sessão|Sign in/);
    const fontFamily = await heading.evaluate(
      (el) => getComputedStyle(el).fontFamily,
    );
    expect(fontFamily.toLowerCase()).toContain('space grotesk');
  });

  test('dead layers stay dead: no dark-mode class, no legacy semantic classes in the DOM', async ({ page }) => {
    const DEAD = ['btn-primary', 'dialog-overlay', 'filter-pill', 'stats-bar', 'card-hover', 'badge-teal'];

    const assertNoDeadClasses = async (where: string) => {
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      for (const cls of DEAD) {
        expect(
          await page.locator(`.${cls}`).count(),
          `.${cls} should not exist in the DOM on ${where}`,
        ).toBe(0);
      }
    };

    await page.goto('/login');
    await assertNoDeadClasses('/login');

    // The classes lived on authenticated pages (integrations had .btn-primary),
    // so the guarantee must be checked behind auth too.
    await page.locator('input[type="text"], input:not([type])').first().fill('admin');
    await page.locator('input[type="password"]').first().fill('tmp12345');
    await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
    await page.waitForURL(/\/chat/, { timeout: 60_000 });
    await assertNoDeadClasses('/chat');

    // networkidle never settles (the SSE stream stays open) — wait for content.
    await page.goto('/integrations');
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
    await assertNoDeadClasses('/integrations');
  });
});
