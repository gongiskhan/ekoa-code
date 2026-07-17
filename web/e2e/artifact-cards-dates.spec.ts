import { test, expect, type Page } from '@playwright/test';

/**
 * S0-smoke (run 20260717-202309) - closes finding `artifact-cards-invalid-date`:
 * seeded/featured artifacts carry no ISO timestamps, and every card on
 * /artifacts rendered the literal "Invalid Date". The fix hides the date row
 * when a timestamp is absent or unparseable (page.tsx isValidDateString).
 *
 * Real UI login, live api (e2e:server), no stubs. The featured section is
 * seeded at boot, so the page always has cards to assert against.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

test('artifacts page never renders "Invalid Date" on cards or detail', async ({ page }) => {
  await login(page);

  await page.goto('/artifacts');
  // Featured cards are seeded at boot; wait for the grid to populate.
  await expect(page.getByText('Jurídico', { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  });

  const invalidCount = await page.getByText('Invalid Date', { exact: false }).count();
  expect(invalidCount, 'no card may render the literal "Invalid Date"').toBe(0);

  // Open a featured card's detail view (first card) and re-assert there.
  const firstCard = page.locator('[class*="cursor-pointer"]').first();
  if (await firstCard.isVisible().catch(() => false)) {
    await firstCard.click();
    await page.waitForTimeout(500);
    const invalidDetail = await page.getByText('Invalid Date', { exact: false }).count();
    expect(invalidDetail, 'detail view may not render "Invalid Date"').toBe(0);
  }
});
