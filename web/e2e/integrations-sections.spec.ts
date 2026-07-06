import { test, expect, type Page } from '@playwright/test';

/**
 * integrations-sections — the restructured integrations surface, now organised
 * as THREE top-level tabs below the page header:
 *   (a) "Integrações da Plataforma" (default) groups the Google/Microsoft OAuth
 *       cards, a COLLAPSED Pipedream card, and every versioned integration skill
 *       in one grid; the status-filter pills + search filter the skill cards.
 *   (b) "Minhas Integrações" holds user-created skills (empty by default) plus
 *       the create / import / export actions.
 *   (c) "Webhooks" lists + manages the workspace webhook triggers.
 *
 * The Pipedream card is collapsed by default and expands full-width to reveal
 * the app catalog + network config. Webhooks: create a webhook for WhatsApp
 * targeting the legal-nucleo artifact backend, confirm the callback URL row,
 * delete it.
 *
 * Drives the real dev servers (admin / tmp12345, no stubs). baseURL comes from
 * the Playwright config (../app.port).
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

async function gotoIntegrations(page: Page) {
  await page.goto('/integrations');
  await expect(page.getByTestId('integrations-page')).toBeVisible({ timeout: 15_000 });
}

test.describe('integrations — three tabs, Pipedream card, webhooks', () => {
  test('exactly three tabs; Plataforma groups platform + Pipedream + skills; other tabs render', async ({ page }) => {
    await login(page);
    await gotoIntegrations(page);

    // Exactly three top-level tabs, and they are the expected ones.
    const pageTabs = page.locator('[data-testid^="integrations-tab-"]');
    await expect(pageTabs).toHaveCount(3);
    await expect(page.getByTestId('integrations-tab-plataforma')).toContainText('Integrações da Plataforma');
    await expect(page.getByTestId('integrations-tab-minhas')).toContainText('Minhas Integrações');
    await expect(page.getByTestId('integrations-tab-webhooks')).toContainText('Webhooks');

    // Default tab is Plataforma.
    const platform = page.getByTestId('platform-integrations-section');
    await expect(platform).toBeVisible({ timeout: 15_000 });

    // The two OAuth platform cards live here.
    await expect(platform).toContainText('Google Workspace');
    await expect(platform).toContainText('Microsoft 365');

    // The Pipedream card sits in the same grid but COLLAPSED: only the teaser +
    // an "Explorar" button are shown; the catalog and the network config are
    // hidden until it is expanded.
    const pipedream = platform.getByTestId('pipedream-section');
    await expect(pipedream).toBeVisible();
    await expect(pipedream.getByTestId('pipedream-expand')).toBeVisible();
    await expect(pipedream.getByTestId('app-network-title')).toHaveCount(0);
    await expect(pipedream.getByTestId('pipedream-toggle')).toHaveCount(0);

    // Versioned integration skills render as cards in the Plataforma grid.
    await expect(platform).toContainText('Stripe');
    await expect(platform).toContainText('WhatsApp Business');
    await expect(platform).toContainText('Slack');

    // Switch to "Minhas Integrações": the platform grid unmounts, the user
    // section (empty by default) mounts.
    await page.getByTestId('integrations-tab-minhas').click();
    const mine = page.getByTestId('my-integrations-section');
    await expect(mine).toBeVisible({ timeout: 10_000 });
    await expect(mine).toContainText('As minhas integrações');
    await expect(page.getByTestId('my-integrations-empty')).toBeVisible();
    await expect(page.getByTestId('platform-integrations-section')).toHaveCount(0);

    // Switch to "Webhooks": the webhooks section mounts.
    await page.getByTestId('integrations-tab-webhooks').click();
    await expect(page.getByTestId('webhooks-section')).toBeVisible({ timeout: 10_000 });

    // The active tab is reflected in the URL (deep-link / refresh survives).
    await expect(page).toHaveURL(/[?&]tab=webhooks/);
  });

  test('Pipedream: expand the card, configure inline, then remove', async ({ page }) => {
    await login(page);
    await gotoIntegrations(page);

    const section = page.getByTestId('pipedream-section');
    await expect(section).toBeVisible({ timeout: 15_000 });

    // Expand the collapsed card to reach the network config.
    await section.getByTestId('pipedream-expand').click();
    await expect(section.getByTestId('pipedream-toggle')).toBeVisible({ timeout: 10_000 });

    // Ensure the master toggle is ON so the pending/config surface is reachable.
    const toggle = section.getByTestId('pipedream-toggle');
    if ((await toggle.getAttribute('aria-checked')) !== 'true') {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10_000 });
    }

    // If a config lingers from a prior run, remove it first to reach the pending state.
    if (await section.getByTestId('pipedream-config-summary').isVisible().catch(() => false)) {
      await section.getByTestId('pipedream-config-remove').click();
      await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
      await expect(section.getByTestId('pipedream-config-open')).toBeVisible({ timeout: 15_000 });
    }

    // Open the inline form and enter fake project keys.
    await section.getByTestId('pipedream-config-open').click();
    await expect(section.getByTestId('pipedream-config-form')).toBeVisible();
    await section.getByTestId('pipedream-client-id').fill('test-client-id');
    await section.getByTestId('pipedream-client-secret').fill('test-client-secret');
    await section.getByTestId('pipedream-project-id').fill('proj_test123');
    await section.getByTestId('pipedream-environment').selectOption('production');
    await section.getByTestId('pipedream-config-save').click();

    // Status flips to configured — the project summary appears.
    await expect(section.getByTestId('pipedream-config-summary')).toBeVisible({ timeout: 15_000 });

    // Remove the configuration (cleanup) — back to the pending "configure" state.
    await section.getByTestId('pipedream-config-remove').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
    await expect(section.getByTestId('pipedream-config-open')).toBeVisible({ timeout: 15_000 });
  });

  test('Webhooks tab: create for WhatsApp → legal-nucleo, shows callback URL, then delete', async ({ page }) => {
    await login(page);
    await gotoIntegrations(page);

    // Move to the Webhooks tab.
    await page.getByTestId('integrations-tab-webhooks').click();
    const section = page.getByTestId('webhooks-section');
    await expect(section).toBeVisible({ timeout: 15_000 });
    await expect(section).toContainText('Webhooks');

    const before = await section.getByTestId('webhook-row').count();

    // Open the create dialog and fill it.
    await section.getByTestId('webhook-create-btn').click();
    await expect(page.getByTestId('webhook-integration-select')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('webhook-integration-select').selectOption('whatsapp');
    await page.getByTestId('webhook-artifact-select').selectOption('legal-nucleo');
    await expect(page.getByTestId('webhook-entrypoint-input')).toHaveValue('onMessage');
    await page.getByTestId('webhook-submit').click();

    // A new row appears, showing the /hooks/<id> callback URL.
    await expect(section.getByTestId('webhook-row')).toHaveCount(before + 1, { timeout: 15_000 });
    const createdRow = section.getByTestId('webhook-row').last();
    await expect(createdRow.getByTestId('webhook-url')).toContainText('/hooks/');
    await expect(createdRow).toContainText('WhatsApp Business');

    // Delete it (cleanup) and confirm the count returns to baseline.
    await createdRow.getByTestId('webhook-delete').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(section.getByTestId('webhook-row')).toHaveCount(before, { timeout: 15_000 });
  });
});
