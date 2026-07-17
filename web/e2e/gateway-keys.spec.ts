import { test, expect, type Page } from '@playwright/test';

/**
 * Per-user gateway API keys page (S4b, run 20260717-071930-d1244839) - REAL end-to-end, no
 * protocol stubs: real UI login, mint a key through the page (the secret shows EXACTLY once,
 * with the client env config), reload proves the secret is gone while the row remains, revoke
 * flips the status badge through the real API. Zero console errors.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 90_000 });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    errors.push(msg.text());
  });
  return errors;
}

test('mint shows the secret once, reload hides it, revoke flips the badge', async ({ page }) => {
  const consoleErrors = trackConsoleErrors(page);
  await login(page);

  await page.goto('/settings/api-keys');
  await expect(page.getByTestId('settings-api-keys-page')).toBeVisible({ timeout: 30_000 });

  const label = `spec-key-${Date.now().toString(36)}`;
  await page.getByTestId('gateway-key-label-input').fill(label);
  await page.getByTestId('gateway-key-mint').click();

  // Show-once panel: the full secret + the client config snippet.
  const showOnce = page.getByTestId('gateway-key-show-once');
  await expect(showOnce).toBeVisible({ timeout: 30_000 });
  const secret = (await page.getByTestId('gateway-key-secret').textContent())?.trim() ?? '';
  expect(secret.startsWith('ekoa_gk_')).toBe(true);
  await expect(page.getByTestId('gateway-key-config')).toContainText('ANTHROPIC_BASE_URL=');
  await expect(page.getByTestId('gateway-key-config')).toContainText(`ANTHROPIC_AUTH_TOKEN=${secret}`);
  await expect(page.getByTestId('gateway-key-show-once-warning')).toBeVisible();

  // The list row exists with the tail hint (never the full secret).
  await expect(page.getByTestId('gateway-key-list')).toContainText(label);
  await expect(page.getByTestId('gateway-key-list')).toContainText(`ekoa_gk_...${secret.slice(-4)}`);

  // Reload: the secret is GONE (show-once), the row remains.
  await page.reload();
  await expect(page.getByTestId('settings-api-keys-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('gateway-key-show-once')).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
  const row = page.locator('tr', { hasText: label });
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('gateway-key-status-active')).toBeVisible();

  // Revoke through the platform confirm dialog; the badge flips.
  await row.getByTestId('gateway-key-revoke').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /revogar|revoke/i }).click();
  await expect(row.getByTestId('gateway-key-status-revoked')).toBeVisible({ timeout: 15_000 });

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
});
