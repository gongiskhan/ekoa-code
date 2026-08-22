import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

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
  await uiLogin(page);
}

/**
 * Error tracking with a precise 404 net: the bare "Failed to load resource" console line
 * carries no URL, and next-dev intermittently 404s its own _next assets on first compile —
 * so 4xx/5xx are tracked from `response` events BY URL (dev-server asset noise excluded,
 * every API/page 404 still fails), while all OTHER console errors (TypeErrors, React
 * crashes) keep the strict zero bar.
 */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return; // pinned precisely below
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    // Known OPEN finding (docs/findings.md: login session double-create race): the /chat
    // landing intermittently GETs a just-created session id that 404s. Scoped exclusion —
    // remove when the finding closes.
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    // BY DESIGN, not a defect: api/src/routes/sync.ts answers 404 for a flag-disabled
    // Citius rail specifically so the panel can tell "not for this deployment" apart
    // from a failure and render nothing (contract in web/lib/sync/citius-sync.ts).
    // /integrations probes it on every visit, so the handled 404 is the expected answer.
    if (r.status() === 404 && /\/api\/v1\/sync\/citius\/notificacoes\/state$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
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

  test('/knowledge renders collections and uploads without crashing (UploadDoc id mapping)', async ({ page }) => {
    await login(page);

    const errors = trackConsoleErrors(page);
    await page.goto('/knowledge');
    // The page's data loads (collections/uploads lists answer 200 and render).
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000); // let the uploads/collections fetches settle

    expect(errors, `console errors on /knowledge:\n${errors.join('\n')}`).toEqual([]);
  });

  test('/artifacts preview overlay: the cross-origin app iframe actually renders (embed allowlist)', async ({ page }) => {
    await login(page);

    const errors = trackConsoleErrors(page);
    await page.goto('/artifacts');
    // Open a running (featured) artifact's detail — the preview affordance lives there.
    const card = page.getByRole('heading', { name: /Portfólio Agência/i }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    // WS3 click semantics (2026-08-08): clicking the card opens the preview overlay DIRECTLY -
    // there is no intermediate detail pane and no separate preview button on this path anymore
    // ("Ver detalhes" moved to the item menu). The old flow here (card -> detail -> button) fails
    // on a missing element rather than on the framing behaviour this spec exists to protect.
    await card.click();

    // The overlay's iframe points at the api's /apps/* plane — cross-origin from the
    // dashboard. Pre-fix the api answered frame-ancestors 'self' + XFO SAMEORIGIN and the
    // browser refused the frame; now /apps/* allowlists the dashboard origin.
    // The overlay iframe's title is `Preview of <name>` (artifact-preview-overlay.tsx:157 — an
    // English tooltip string, noted as a PT-PT copy gap). Match both spellings so a future
    // localisation of that title does not silently break the framing spec again.
    const frame = page.frameLocator('iframe[title*="Preview"], iframe[title*="visualiza"]');
    await expect(frame.locator('body')).not.toBeEmpty({ timeout: 30_000 });

    expect(errors, `console errors on /artifacts preview:\n${errors.join('\n')}`).toEqual([]);
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

    // CITIUS carries step-backed actions - the exact card the deref crash killed.
    const citiusCard = page
      .locator('div.bg-white', { has: page.getByRole('heading', { name: /CITIUS/i }) })
      .first();
    await expect(citiusCard).toBeVisible({ timeout: 30_000 });

    // Expand and assert the action rows render (a step-backed action is visible).
    await citiusCard.getByRole('button', { name: /mostrar mais/i }).click();
    await expect(citiusCard.getByText('consultar_notificacoes')).toBeVisible();

    // S8 RE-ANCHOR: the row's own affordance moved from `/automations/<id>` to the integration
    // detail. The action NAME above is what the deref regression is about and is unchanged; this
    // line is the part of the row S8 touched, and pinning it here is what stops a later tidy-up
    // from restoring a link into a route that no longer renders a page.
    await expect(citiusCard.locator('a[href^="/automations/"]')).toHaveCount(0);

    expect(errors, `console errors on /integrations:\n${errors.join('\n')}`).toEqual([]);
  });

  test('/<unknown route> renders the 404 heading in the shared Space Grotesk page-title font', async ({ page }) => {
    // Dogfood finding: the not-found page's h1 was styled off the shared PageHeader
    // (font-display -> Space Grotesk), the only user-visible page off the design system.
    await login(page);

    const target = '/this-page-does-not-exist-xyz';
    const errors = trackConsoleErrors(page);
    await page.goto(target);
    const heading = page.locator('h1').first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
    const fontFamily = await heading.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(fontFamily, `h1 font-family: ${fontFamily}`).toMatch(/Space Grotesk/i);

    // The navigation's OWN 404 (an unknown route legitimately answers 404) is
    // the one expected, intentional entry here - every other response error
    // still fails the test.
    const unexpected = errors.filter((e) => !e.endsWith(target));
    expect(unexpected, `console errors on the 404 page:\n${unexpected.join('\n')}`).toEqual([]);
  });
});
