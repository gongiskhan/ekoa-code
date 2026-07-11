import { test, expect, type Page } from '@playwright/test';

/**
 * Dashboard regression net for the post-rc-1 crash fixes (2026-07). Each test drives the
 * real UI with a real login and asserts ZERO console errors on the page it exercises —
 * the crashes this spec pins were all `TypeError`s that only surfaced in the browser:
 *
 *  - /users + /usage: `fmtTokens(undefined).toLocaleString` — admin usage rows arrived
 *    without tokensBase/tokensRemaining/percentage (adminListUsage omitted them).
 *  - /integrations: `sessionEntry.actions.some` and `sessionConnect.available` — the
 *    session-status endpoint answered without `actions`/`sessionConnect`, crashing the
 *    card (and the whole page, via the error boundary) after the first status poll.
 *
 * No protocol stubs: the pages talk to the live api (e2e:server), so these also pin the
 * enriched AdminUsageRow / SessionCaptureStatus response shapes end-to-end.
 *
 * Console errors are tracked from just before the target-page navigation (not during
 * login/landing): this spec owns the target pages; /chat cleanliness is chat-thinking's.
 */

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
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  return errors;
}

test.describe('dashboard regressions (post-rc-1 fixes)', () => {
  test('/usage renders per-user gauge rows (used / remaining / %) without crashing', async ({ page }) => {
    await login(page);

    const errors = trackConsoleErrors(page);
    await page.goto('/usage');
    // One row per user (the admin itself at minimum), each with a data-username hook.
    const rows = page.locator('tr[data-username]');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    // The "used" cell renders a formatted count — never an empty crash placeholder.
    await expect(rows.first().locator('[data-column="used"]')).not.toHaveText('');

    expect(errors, `console errors on /usage:\n${errors.join('\n')}`).toEqual([]);
  });

  test('/users renders the token-usage badge column without crashing', async ({ page }) => {
    await login(page);

    const errors = trackConsoleErrors(page);
    await page.goto('/users');
    const rows = page.locator('[data-testid^="user-row-"]');
    await expect(rows.first()).toBeVisible({ timeout: 30_000 });
    // The super-admin token column renders the "X / Y (Z%)" badge for every row.
    await expect(rows.first().getByText(/\/.*\(\d+%\)/).first()).toBeVisible({ timeout: 15_000 });

    expect(errors, `console errors on /users:\n${errors.join('\n')}`).toEqual([]);
  });

  test('/integrations: session-status cards survive the status poll and expanding renders action rows', async ({ page }) => {
    await login(page);

    const errors = trackConsoleErrors(page);
    // The SessionConnectPanel polls GET /:key/session on MOUNT (browser_session cards),
    // so the response we pin arrives during page load — register the wait first.
    const statusResponse = page.waitForResponse(
      (r) => r.url().includes('/integrations/citius/session') && r.request().method() === 'GET',
      { timeout: 60_000 },
    );
    await page.goto('/integrations');

    const status = await statusResponse;
    expect(status.ok()).toBe(true);
    const body = (await status.json()) as { actions?: unknown[]; sessionConnect?: { available?: boolean } };
    expect(Array.isArray(body.actions), 'session status carries an actions array').toBe(true);
    expect(typeof body.sessionConnect?.available, 'session status carries sessionConnect').toBe('boolean');

    // CITIUS carries automation-bound actions — the exact card the deref crash killed.
    const citiusCard = page
      .locator('div.bg-white', { has: page.getByRole('heading', { name: /CITIUS/i }) })
      .first();
    await expect(citiusCard).toBeVisible({ timeout: 30_000 });

    // Expand and assert the action rows render (an automation-bound action is visible).
    await citiusCard.getByRole('button', { name: /mostrar mais/i }).click();
    await expect(citiusCard.getByText('consultar_notificacoes')).toBeVisible();

    expect(errors, `console errors on /integrations:\n${errors.join('\n')}`).toEqual([]);
  });
});
