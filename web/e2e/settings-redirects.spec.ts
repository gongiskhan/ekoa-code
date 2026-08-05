import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * The three legacy admin routes, after the settings tab-group move.
 *
 * `/users`, `/orgs` and `/pedidos` are no longer pages — they are redirects into
 * `/settings/{users,offices,pedidos}`. They were kept as redirects rather than deleted for two
 * reasons that both outlive the move: they are linked from outside the app (mail, bookmarks), and
 * two committed specs in this estate still navigate to `/users` directly.
 *
 * WHY THIS EXISTS AS A COMMITTED SPEC. The move left the old paths working by accident of Next's
 * router, and nothing asserted it. A later "tidy up the dead routes" change would delete three
 * four-line files, pass every gate in this repo, and break every bookmark anyone holds — silently,
 * because the failure is a 404 on a route no test visits. That is exactly the class the Drill Book
 * found for `/pedidos`; this pins all three deterministically rather than leaving two of them to a
 * vision pass that may or may not run.
 *
 * The assertion is the landing URL, not the page body: what must not regress is that the old
 * address still takes a user to the right place. The bodies are covered by the component suites.
 */
// Real-UI login, per the estate's standing rule (no protocol stubs). Local to the file, as every
// other spec here keeps it — there is no shared auth fixture by design.
async function login(page: Page) {
  await uiLogin(page);
}

const REDIRECTS: Array<{ from: string; to: string; label: string }> = [
  { from: '/users', to: '/settings/users', label: 'Utilizadores' },
  { from: '/orgs', to: '/settings/offices', label: 'Escritórios' },
  { from: '/pedidos', to: '/settings/pedidos', label: 'Pedidos' },
];

test.describe('legacy admin routes redirect into the settings tab group', () => {
  for (const { from, to, label } of REDIRECTS) {
    test(`${from} lands on ${to} (${label})`, async ({ page }) => {
      await login(page);
      await page.goto(from, { waitUntil: 'domcontentloaded' });
      // The default 5s is not enough and the reason is the harness, not the product: the estate
      // runs against `next dev`, which compiles a route on FIRST hit. The very first spec to touch
      // one of these paths pays that cost, so a tight assertion here fails on a cold server and
      // passes on a warm one — which is how a green suite starts lying. The rest of this estate
      // uses the same wide waits for the same reason.
      await expect(page).toHaveURL(new RegExp(`${to}$`), { timeout: 60_000 });
    });
  }

  test('the redirect does not leave the old path in history as a trap', async ({ page }) => {
    // Going back from the destination must not bounce through the redirect and return the user to
    // where they already are — `redirect()` in a server component replaces rather than pushes, and
    // a change to a client-side `router.push` would break this without breaking the tests above.
    await login(page);
    await page.goto('/knowledge', { waitUntil: 'domcontentloaded' });
    await page.goto('/users', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/settings\/users$/, { timeout: 60_000 });
    await page.goBack();
    await expect(page).toHaveURL(/\/knowledge$/, { timeout: 60_000 });
  });
});
