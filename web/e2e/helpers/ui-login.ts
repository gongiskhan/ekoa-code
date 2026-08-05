/**
 * Shared real-UI sign-in for the e2e suite.
 *
 * The seeded super-admin is created by `seedAdmin` (api/src/auth/service.ts)
 * with `passwordChangeRequired: true`, so a real UI sign-in is redirected to
 * /change-password before the dashboard. Specs used to land straight on /chat
 * only because the login page read that flag from a stale closure and skipped
 * the forced change; once that was fixed the redirect is honoured, which is the
 * correct product behaviour.
 *
 * Rather than make ~30 specs navigate a one-way state transition, this helper
 * normalises the admin BEFORE driving the UI: it clears the forced-change flag
 * over the API and restores the seeded password, so both the UI specs here and
 * the many specs that authenticate over the API with `tmp12345` see exactly the
 * state they have always seen. There is no API to clear the flag directly
 * (`UserPatch` carries only `role`/`active`, and the admin reset endpoint SETS
 * it), so it is cleared the only way the product allows - a real password
 * change - and then a second change puts the seeded password back.
 *
 * The forced-change path itself stays covered by change-password.spec.ts, which
 * exercises it deliberately instead of incidentally.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** The seeded password (api `seedAdmin`, driven by EKOA_ADMIN_PASSWORD in the harness). */
export const SEEDED_PASSWORD = 'tmp12345';

/**
 * Transient password used only to spend the forced change before restoring the
 * seeded one. Must satisfy the change-password policy (>=8 chars, upper, lower,
 * digit) and differ from the seeded password.
 */
const TRANSIENT_PASSWORD = 'EkoaE2E2026x';

function cortexBase(): string {
  if (process.env.EKOA_API_BASE) return process.env.EKOA_API_BASE;
  try {
    const port = readFileSync(resolve(__dirname, '..', '..', '..', 'backend.port'), 'utf-8').trim();
    if (port) return `http://127.0.0.1:${port}`;
  } catch {
    /* fall through */
  }
  return 'http://127.0.0.1:4111';
}

async function apiLogin(
  request: APIRequestContext,
  password: string,
): Promise<{ token: string; passwordChangeRequired: boolean } | null> {
  const res = await request.post(`${cortexBase()}/api/v1/auth/login`, {
    data: { username: 'admin', password },
    failOnStatusCode: false,
  });
  if (!res.ok()) return null;
  const body = (await res.json()) as { token: string; passwordChangeRequired?: boolean };
  return { token: body.token, passwordChangeRequired: Boolean(body.passwordChangeRequired) };
}

async function apiChangePassword(
  request: APIRequestContext,
  token: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await request.post(`${cortexBase()}/api/v1/auth/password`, {
    headers: { authorization: `Bearer ${token}` },
    data: { currentPassword, newPassword },
    failOnStatusCode: false,
  });
  expect(res.ok(), `change-password ${currentPassword} -> ${newPassword}: ${res.status()}`).toBe(true);
}

/**
 * Leave the seeded admin as `admin` / `tmp12345` with no forced change pending.
 * Idempotent: a no-op once the flag is already clear, so every later call is a
 * single cheap login.
 */
export async function clearForcedPasswordChange(request: APIRequestContext): Promise<void> {
  const seeded = await apiLogin(request, SEEDED_PASSWORD);

  if (seeded && !seeded.passwordChangeRequired) return;

  if (seeded) {
    // Spend the forced change, then put the seeded password back. Each change
    // bumps the token epoch and invalidates the token that authorised it, so
    // the second change authenticates with a freshly minted one.
    await apiChangePassword(request, seeded.token, SEEDED_PASSWORD, TRANSIENT_PASSWORD);
  }

  const transient = await apiLogin(request, TRANSIENT_PASSWORD);
  if (!transient) {
    // Seeded password worked and the flag is clear, or an unexpected state we
    // cannot repair here - let the UI sign-in below report it.
    return;
  }
  await apiChangePassword(request, transient.token, TRANSIENT_PASSWORD, SEEDED_PASSWORD);
}

/** Sign in through the real UI and land on the dashboard. */
export async function uiLogin(page: Page): Promise<void> {
  await clearForcedPasswordChange(page.request);
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill(SEEDED_PASSWORD);
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 90_000 });
}

/**
 * Settle a sign-in a spec submitted itself. Callers that drive the login form
 * directly should call `clearForcedPasswordChange(page.request)` before doing so.
 */
export async function settleAfterLogin(page: Page): Promise<void> {
  await page.waitForURL(/\/chat/, { timeout: 90_000 });
}
