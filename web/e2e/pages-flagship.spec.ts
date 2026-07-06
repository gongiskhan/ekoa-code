import { test, expect } from '@playwright/test';

/**
 * S6 pages-flagship: the /artifacts page migrated to the design system
 * (PageShell + PageHeader + SearchInput + Card idiom + starting-points strip)
 * and the /chat surfaces after the restyle-only pass (composer + sessions
 * intact). Real login (admin / tmp12345) against the live dev servers.
 */

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

// Only fail on genuine JS errors — ignore favicon and best-effort resource
// loads (artifact screenshots can 404 in a fresh data dir).
function collectConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const t = msg.text();
    if (t.includes('favicon') || t.includes('Failed to load resource')) return;
    errors.push(t);
  });
  return errors;
}

test.describe('pages-flagship (S6)', () => {
  test('/artifacts renders the migrated header, search, starting-points strip and cards', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await login(page);

    await page.goto('/artifacts');

    // PageHeader: Lora display title owns the page identity.
    const title = page.locator('h1.font-display').first();
    await expect(title).toBeVisible({ timeout: 15_000 });
    await expect(title).toHaveText(/Artefactos/i);

    // PageShell wrapper testid.
    await expect(page.getByTestId('artifacts-page')).toBeVisible();

    // SearchInput (shared field primitive).
    await expect(page.getByPlaceholder(/pesquisar/i)).toBeVisible();

    // Starting Points strip + at least one curated card.
    await expect(page.getByTestId('starting-points-strip')).toBeVisible();
    await expect(page.locator('[data-testid^="starting-point-card-"]').first()).toBeVisible();

    // Owned artifact cards render (each has an "Eliminar artefacto" control).
    await expect(page.getByRole('button', { name: 'Eliminar artefacto' }).first()).toBeVisible();

    expect(
      consoleErrors,
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });

  test('/artifacts renders at 375px (mobile)', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    await page.goto('/artifacts');

    await expect(page.locator('h1.font-display').first()).toHaveText(/Artefactos/i, { timeout: 15_000 });
    await expect(page.getByPlaceholder(/pesquisar/i)).toBeVisible();

    expect(
      consoleErrors,
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });

  test('/chat still renders composer and sessions after the restyle', async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await login(page); // lands on /chat

    // Composer textarea is present and focusable.
    const composer = page.locator('textarea').first();
    await expect(composer).toBeVisible({ timeout: 15_000 });

    // Sessions rail is present on desktop — its collapse/expand toggle always
    // renders ("Recolher Sessões" / "Expandir Sessões").
    await expect(page.locator('button[title$="Sessões"]').first()).toBeVisible();

    expect(
      consoleErrors,
      `console errors: ${consoleErrors.join(' | ')}`,
    ).toHaveLength(0);
  });
});
