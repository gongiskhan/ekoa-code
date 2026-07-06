import { test, expect, type Page, type APIRequestContext, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guided onboarding - entry flow, deterministic and LLM-free (ONB-4).
 *
 * Proves the ONB-3 surface end-to-end WITHOUT ever waiting on an agent reply:
 *   - the empty chat state surfaces the onboarding affordance (card);
 *   - clicking it find-or-creates the single persistent onboarding session and
 *     lands on /chat/{id} with ZERO query params (the "no task in the URL" rule);
 *   - a fresh onboarding session renders the welcome bubble + quick-reply chips;
 *   - re-entry reuses the SAME session (one persistent onboarding session/user);
 *   - a quick-reply chip stages the user's message through the normal send path.
 *
 * State is controlled via the backend action API (login → list/delete onboarding
 * sessions) so the spec is robust to the pre-existing dev onboarding session and
 * passes on repeated runs. The backend port is the single source of truth in
 * ../../backend.port (mirrors playwright.config.ts reading ../app.port). The live
 * conversation (interview → proposal → build) is covered by the integration-gated
 * driver cortex/tests/e2e/onboarding.e2e.mjs, not here.
 */

function backendPort(): string {
  try {
    return readFileSync(resolve(__dirname, '..', '..', 'backend.port'), 'utf-8').trim();
  } catch {
    return '4111';
  }
}
// 127.0.0.1 (not localhost): cortex binds IPv4 (0.0.0.0), and the Playwright
// request client can resolve `localhost` to IPv6 ::1, which is refused.
const BE = `http://127.0.0.1:${backendPort()}`;

// Copy anchors. Card title is locale-sourced (ekoa/locales/pt.ts `onboarding`).
// The welcome's SEND chips are vertical-sourced (useVerticalProfile ->
// lib/verticals/legal.ts onboardingChips: both contain "advogado"); the freeform
// chip stays locale-only ("...palavras minhas"). Kept as loose regexes covering
// both the legal and generic ("conta própria") chip sets so the structural
// assertions survive copy tweaks and match whichever vertical is active.
const CARD_ANCHOR = /Novo por aqui\?|Retomar a orienta/i; // fresh OR resume card title
const CHIP_ANCHOR = /advogad|conta própria|palavras minhas/i; // the 3 welcome chips (2 send + freeform)
const FIRST_CHIP = 'Sou advogado(a) num escritório'; // legal vertical's first send chip

// -------------------------------------------------------------------------
// Backend action API helpers (absolute BE url; independent of the UI session).
// -------------------------------------------------------------------------
async function action<T = unknown>(
  request: APIRequestContext,
  app: string,
  intent: string,
  params: Record<string, unknown>,
  token?: string,
): Promise<T> {
  // One retry: the dev cortex can blink during a concurrent restart. Login
  // (bcrypt + license check) runs ~4s and slows under load, so use a generous
  // per-call timeout - the config's 10s actionTimeout is too tight here.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await request.post(`${BE}/api/v1/action`, {
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        data: { app, intent, params, request_id: Math.random().toString(36).slice(2) },
        timeout: 60_000,
      });
      const body = await res.json();
      return (body?.data ?? body) as T;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  throw lastErr;
}

async function apiLogin(request: APIRequestContext): Promise<string> {
  const data = await action<{ token?: string }>(request, 'ekoa.auth', 'login', {
    username: 'admin',
    password: 'tmp12345',
  });
  const token = data?.token;
  expect(token, 'backend login returned a JWT').toBeTruthy();
  return token as string;
}

type Sess = { id: string; type?: string; messageCount?: number };

async function deleteOnboardingSessions(request: APIRequestContext, token: string): Promise<void> {
  const sessions = (await action<Sess[]>(request, 'ekoa.sessions', 'list', {}, token)) || [];
  for (const s of sessions.filter((x) => x.type === 'onboarding')) {
    await action(request, 'ekoa.sessions', 'delete', { sessionId: s.id }, token);
  }
}

// -------------------------------------------------------------------------
// UI helpers.
// -------------------------------------------------------------------------
async function uiLogin(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/chat/, { timeout: 20_000 });
}

const onboardingCard = (page: Page) => page.getByRole('button').filter({ hasText: CARD_ANCHOR });
const welcomeChips = (page: Page) => page.getByRole('button').filter({ hasText: CHIP_ANCHOR });

/** The session id in /chat/{id}, or '' when on the bare /chat route. */
function sessionIdFromUrl(page: Page): string {
  const m = /\/chat\/([^/?#]+)/.exec(page.url());
  return m ? m[1] : '';
}

let token: string;

test.beforeEach(async ({ page, request }) => {
  token = await apiLogin(request);
  // Clean slate: remove any onboarding sessions (incl. the dev one) so the
  // entry flow starts from a known state on every run.
  await deleteOnboardingSessions(request, token);
  await uiLogin(page);
});

test.afterEach(async ({ request }) => {
  await deleteOnboardingSessions(request, token).catch(() => {});
});

test('empty chat surfaces the onboarding card and enters a param-free session with welcome + chips', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/chat');

  // (a) the affordance is present on the empty state (fresh OR resume variant).
  const card = onboardingCard(page).first();
  await expect(card).toBeVisible({ timeout: 20_000 });

  // (b) clicking find-or-creates the onboarding session and navigates with no
  // query params - the "no task in the URL" rule.
  await card.click();
  await page.waitForURL(/\/chat\/[^/?#]+$/, { timeout: 20_000 });
  const sid = sessionIdFromUrl(page);
  expect(sid, 'landed on a real session id').not.toBe('');
  expect(page.url(), 'no query params in the onboarding URL').not.toContain('?');

  // (c) a fresh onboarding session renders the welcome bubble + exactly 3 chips.
  await expect(page.getByText('Olá!', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(welcomeChips(page)).toHaveCount(3);

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('re-entry reuses the single persistent onboarding session (same id)', async ({ page }) => {
  await page.goto('/chat');
  const card = onboardingCard(page).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await page.waitForURL(/\/chat\/[^/?#]+$/, { timeout: 20_000 });
  const sid1 = sessionIdFromUrl(page);
  expect(sid1).not.toBe('');
  // Ensure the session is fully active + persisted before we leave.
  await expect(welcomeChips(page).first()).toBeVisible({ timeout: 20_000 });

  // A fresh full-page entry to /chat. The app either auto-resumes the same
  // onboarding session (welcome) or re-shows the card; either way the identity
  // that results must be sid1 (one persistent onboarding session per user).
  await page.goto('/chat');
  await Promise.race([
    welcomeChips(page).first().waitFor({ timeout: 20_000 }).catch(() => {}),
    onboardingCard(page).first().waitFor({ timeout: 20_000 }).catch(() => {}),
  ]);
  if ((await onboardingCard(page).count()) > 0 && sessionIdFromUrl(page) !== sid1) {
    await onboardingCard(page).first().click();
    await page.waitForURL(/\/chat\/[^/?#]+$/, { timeout: 20_000 });
  }
  await expect
    .poll(() => sessionIdFromUrl(page), { timeout: 20_000, message: 're-entry lands on the same onboarding session' })
    .toBe(sid1);
});

test('a quick-reply chip stages the user message through the normal send path (no LLM)', async ({ page }) => {
  // Stub the agent request so nothing depends on a live model call: the user
  // message is added locally before the request fires, so the staging is
  // observable without any SSE reply.
  await page.route('**/api/v1/request', (route: Route) => {
    let traceId = 'stub-trace';
    try { traceId = JSON.parse(route.request().postData() || '{}').trace_id || traceId; } catch { /* ignore */ }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ trace_id: traceId, status: 'accepted' }),
    });
  });

  await page.goto('/chat');
  const card = onboardingCard(page).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.click();
  await page.waitForURL(/\/chat\/[^/?#]+$/, { timeout: 20_000 });

  // Click a non-freeform chip → it sends through handleSendMessage.
  const chip = page.getByRole('button', { name: FIRST_CHIP });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await chip.click();

  // The chip text now appears as a user message bubble (the welcome unmounts
  // once the conversation has a message, so this text can only be the bubble).
  await expect(page.locator('.bg-neutral-900', { hasText: FIRST_CHIP })).toBeVisible({ timeout: 20_000 });
  // URL stays param-free through the send.
  expect(page.url()).not.toContain('?');
});
