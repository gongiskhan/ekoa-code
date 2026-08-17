import { test, expect, type Frame, type Page } from '@playwright/test';
import { cortexBase } from './helpers/legal';

/**
 * Framed sign-in (2026-08-15). The OIDC start leg lives on the /api surface
 * (X-Frame-Options: DENY + frame-ancestors 'none') and the provider's login page
 * refuses framing too, so the old `signIn()` — a plain location.assign — turned
 * every preview iframe that reached Microsoft sign-in into a "refused to
 * connect" panel. The injected runtime is now frame-aware:
 *
 *   (1) FRAMED app: `__ekoa.signIn()` opens the start URL in a NEW top-level
 *       named window and the frame stays on the app document;
 *   (2) TOP-LEVEL app: `signIn()` keeps navigating in place (byte-compat path).
 *
 * The host page is the dashboard origin (an allowlisted frame ancestor for
 * /apps); the app is the featured Núcleo, served by the api. The click is a
 * real user gesture for FIDELITY with production (where activation gates
 * popups); note Playwright's Chromium runs with --disable-popup-blocking, so
 * this harness cannot distinguish activation-carrying from activation-less
 * calls, and the popup-BLOCKED branch is untestable here (pinned instead by
 * the served-app contract strings). Assertions stick to the SSO handshake; app
 * console noise is out of scope here (the dashboard pages' zero-console rule
 * is enforced by the ui-foundation/shell specs).
 *
 * SSO-configured stacks: with MICROSOFT_SSO_* set the start leg 302s straight
 * to the provider and the intermediate URL never commits, so every navigation
 * assertion accepts start-URL-or-provider-authority.
 */
const SSO_LEG = /\/api\/app-sso\/microsoft\/start|login\.microsoftonline\.com/;

// EKOA_API_BASE first (matches ui-login.ts) so the spec can run against a
// scratch api without rewriting backend.port; the estate lane leaves it unset.
const API = (process.env.EKOA_API_BASE ?? cortexBase()).replace(/\/+$/, '');
const APP_URL = `${API}/apps/legal-nucleo/`;

async function appFrame(page: Page): Promise<Frame> {
  await expect
    .poll(() => page.frames().some((f) => f.url().startsWith(APP_URL)), { timeout: 30_000 })
    .toBe(true);
  const frame = page.frames().find((f) => f.url().startsWith(APP_URL))!;
  await frame.waitForFunction(() => typeof (window as unknown as { __ekoa?: { signIn?: unknown } }).__ekoa?.signIn === 'function', undefined, { timeout: 30_000 });
  return frame;
}

/** A real button inside the app that calls the injected signIn — a click on it
 *  carries the user activation window.open needs in production. */
async function armSignInButton(frame: Frame): Promise<void> {
  await frame.evaluate(() => {
    const b = document.createElement('button');
    b.id = '__e2e-sso';
    b.textContent = 'sso';
    b.style.cssText = 'position:fixed;top:4px;left:4px;z-index:2147483647';
    b.addEventListener('click', () => (window as unknown as { __ekoa: { signIn: (p?: string) => void } }).__ekoa.signIn('/'));
    document.body.appendChild(b);
  });
}

test('framed signIn() opens SSO in a new top-level window and never navigates the frame', async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on('pageerror', (e) => pageErrors.push(e));

  // Any document on the dashboard origin can host the frame (frame-ancestors
  // checks the origin); /login is the lightest real page.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.style.cssText = 'position:fixed;inset:0;width:900px;height:600px;z-index:2147483647;background:#fff';
    document.body.appendChild(f);
  }, APP_URL);

  const frame = await appFrame(page);
  await armSignInButton(frame);

  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15_000 }),
    frame.locator('#__e2e-sso').click(),
  ]);
  await popup.waitForLoadState('domcontentloaded');

  // The popup is the SSO leg, top-level: the start URL when unconfigured (503
  // error page, same URL) or the provider authority after the configured 302.
  expect(popup.url()).toMatch(SSO_LEG);
  if (popup.url().includes('/api/app-sso/microsoft/start')) {
    expect(popup.url()).toContain('appId=legal-nucleo');
  }

  // The frame NEVER left the app document — the old behavior navigated it into
  // the X-Frame-Options: DENY surface and rendered "refused to connect".
  expect(frame.url().startsWith(APP_URL)).toBe(true);
  await popup.close();
  expect(pageErrors).toEqual([]);
});

test('cancelling the popup settles the flow: the frame reloads so an app cannot hang in a pending state', async ({ page }) => {
  // The defect this pins was measured on the real customer ERP: its button does
  // setMsLoading(true) on click and nothing clears it, so once the frame stopped
  // navigating away a cancelled sign-in left the button disabled and spinning
  // forever. Nothing app-side can fix that for already-built bundles - the runtime
  // has to end the flow.
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.style.cssText = 'position:fixed;inset:0;width:900px;height:600px;z-index:2147483647;background:#fff';
    document.body.appendChild(f);
  }, APP_URL);

  const frame = await appFrame(page);
  await armSignInButton(frame);
  const [popup] = await Promise.all([
    page.waitForEvent('popup', { timeout: 15_000 }),
    frame.locator('#__e2e-sso').click(),
  ]);
  await popup.close();

  // The watcher settles ~2 ticks (4s) after the popup closes, then reloads.
  await page.waitForEvent('framenavigated', {
    predicate: (f) => f.url().startsWith(APP_URL),
    timeout: 30_000,
  });
  const after = page.frames().find((f) => f.url().startsWith(APP_URL));
  expect(after, 'the app frame is still the app after the settle reload').toBeTruthy();
});

test('top-level signIn() still navigates in place (byte-compat fallback)', async ({ page }) => {
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof (window as unknown as { __ekoa?: { signIn?: unknown } }).__ekoa?.signIn === 'function', undefined, { timeout: 30_000 });
  await armSignInButton(page.mainFrame());
  await Promise.all([
    page.waitForURL(SSO_LEG, { timeout: 15_000 }),
    page.locator('#__e2e-sso').click(),
  ]);
  expect(page.url()).toMatch(SSO_LEG);
});
