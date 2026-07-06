import { test, expect, type Page } from '@playwright/test';

/**
 * PA slice — the Pipedream card on the "Integrações da Plataforma" tab. It is
 * ONE modest card among the platform integrations: COLLAPSED by default (a
 * teaser naming a few famous apps + the Pipedream network), it expands
 * full-width to reveal the searchable app catalog AND the network config
 * (master toggle + project keys). Drives the real dev servers (admin /
 * tmp12345, no stubs). Asserts the collapsed/expanded framing and that the
 * master toggle persists across a reload (super-admin writes land in the global
 * settings singleton). Ports are never hardcoded — baseURL comes from the
 * Playwright config, which reads ../app.port.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

test.describe('integrations — Pipedream card (PA)', () => {
  test('card is a collapsed teaser; expands to catalog + network config', async ({ page }) => {
    await login(page);
    await page.goto('/integrations');
    await expect(page.getByTestId('integrations-page')).toBeVisible({ timeout: 15_000 });

    const section = page.getByTestId('pipedream-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Collapsed: a modest card. Pipedream is named quietly in the teaser; the
    // catalog and the network config machinery are NOT rendered yet.
    await expect(section).toContainText('rede Pipedream');
    await expect(section.getByTestId('pipedream-expand')).toBeVisible();
    await expect(section.getByTestId('app-network-title')).toHaveCount(0);
    await expect(section.getByTestId('app-network-search')).toHaveCount(0);
    await expect(section.getByTestId('pipedream-toggle')).toHaveCount(0);

    // Expand: the thousands of apps become a titled, searchable catalog of
    // tiles, and the network config (toggle) is now reachable.
    await section.getByTestId('pipedream-expand').click();
    await expect(section.getByTestId('app-network-title')).toBeVisible({ timeout: 10_000 });
    await expect(section.getByTestId('app-network-search')).toBeVisible();
    expect(await section.getByTestId('app-network-tile').count()).toBeGreaterThan(10);
    await expect(section.getByTestId('pipedream-toggle')).toBeVisible();
  });

  test('master toggle flips and persists across reload', async ({ page }) => {
    await login(page);
    await page.goto('/integrations');
    await expect(page.getByTestId('pipedream-section')).toBeVisible({ timeout: 15_000 });

    // Expand the card to reach the toggle.
    await page.getByTestId('pipedream-expand').click();
    const toggle = page.getByTestId('pipedream-toggle');
    await expect(toggle).toBeVisible({ timeout: 10_000 });

    const before = await toggle.getAttribute('aria-checked');
    const target = before === 'true' ? 'false' : 'true';

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', target, { timeout: 10_000 });

    // Persisted server-side → survives a full reload (re-expand after reload).
    await page.reload();
    await expect(page.getByTestId('pipedream-section')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('pipedream-expand').click();
    await expect(page.getByTestId('pipedream-toggle')).toHaveAttribute('aria-checked', target, { timeout: 10_000 });

    // Restore the original state so the run is idempotent.
    await page.getByTestId('pipedream-toggle').click();
    await expect(page.getByTestId('pipedream-toggle')).toHaveAttribute('aria-checked', before ?? 'true', {
      timeout: 10_000,
    });
  });
});
