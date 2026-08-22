import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * The three `/automations` addresses after S8 hid the surface, and the nav row that used to reach
 * them.
 *
 * WHAT S8 DID. Integrations became the single user-facing surface for work that touches outside
 * systems. The engine, `/api/v1/automations`, triggers and schedules all keep running underneath -
 * so this is a removal of PAGES, and the three addresses have to answer something deliberate rather
 * than a 404 nobody chose.
 *
 *   /automations        -> redirect to /integrations       (the list that replaced it)
 *   /automations/<id>   -> redirect to /integrations/<key> (the integration that owns those steps),
 *                          falling back to /integrations when the row has no provenance
 *   /automations/new    -> 410 Gone                        (nothing creates an automation any more)
 *
 * WHY THIS EXISTS AS A COMMITTED SPEC, on `settings-redirects.spec.ts`'s reasoning. Three routes
 * that answer correctly by accident are three routes a later tidy-up deletes while every gate in
 * this repo stays green, and the breakage is silent: a bookmark, a link in mail, a schedule detail
 * somebody saved. The distinction between the redirects and the 410 is the part most at risk -
 * they are three files with three different intents, and "make them all redirect to /integrations"
 * is the obvious wrong simplification.
 *
 * The assertion is the landing URL and the status code, not the page body: what must not regress is
 * where the old address takes a person. The bodies belong to the pages they land on.
 */
async function login(page: Page) {
  await uiLogin(page);
}

test.describe('the automations surface is hidden, and every old address answers deliberately', () => {
  test('/automations lands on /integrations', async ({ page }) => {
    await login(page);
    await page.goto('/automations', { waitUntil: 'domcontentloaded' });
    // The wide budget is the harness, not the product: the estate runs against `next dev`, which
    // compiles a route on FIRST hit, so a tight assertion passes warm and fails cold.
    await expect(page).toHaveURL(/\/integrations$/, { timeout: 60_000 });
  });

  test('/automations/<unknown id> lands on /integrations rather than on a dead end', async ({ page }) => {
    await login(page);
    // An id that resolves to nothing is the worst case for the client-side resolver: no automation
    // comes back, so there is no integration key, and the fallback is what must catch it.
    await page.goto('/automations/00000000-0000-0000-0000-000000000000', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/integrations$/, { timeout: 60_000 });
  });

  test('/automations/new is GONE, and says 410 rather than 404 or a redirect', async ({ page }) => {
    await login(page);
    // Asserted on the RESPONSE, not on what the browser renders: 410 is the whole point of this
    // route, and a page that rendered "this is gone" with a 200 would look identical on screen.
    const res = await page.request.get('/automations/new');
    expect(res.status()).toBe(410);
    expect(await res.text()).toContain('/integrations');
  });

  test('the SERVER redirect does not leave the old path in history as a trap', async ({ page }) => {
    // Going back from the destination must not bounce through the redirect and return the user to
    // where they already are. `redirect()` in a server component replaces rather than pushes.
    //
    // SCOPE, CORRECTED IN THE REVIEW ROUND (F29): this case covers the SERVER route only. The `[id]`
    // route's own replace-never-push discipline is pinned in the hermetic unit suite against a
    // mocked router - which proves `replace()` is called, not real history behaviour - and an
    // earlier version of this comment implied the live proof extended to it. It does not.
    await login(page);
    await page.goto('/knowledge', { waitUntil: 'domcontentloaded' });
    await page.goto('/automations', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/integrations$/, { timeout: 60_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/knowledge$/, { timeout: 60_000 });
  });

  test('the sidebar no longer offers a way in', async ({ page }) => {
    await login(page);
    await page.goto('/integrations', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('integrations-page')).toBeVisible({ timeout: 60_000 });
    // The row is gone from NAV_ITEMS, so no anchor anywhere in the shell points at it.
    await expect(page.locator('nav a[href="/automations"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Automatiza|Automations/i })).toHaveCount(0);
  });
});
