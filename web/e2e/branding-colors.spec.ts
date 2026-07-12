import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Branding colors: no fabricated defaults (live defect 2026-07-12).
 *
 * The branding page hardcoded #0d9488 (teal-600) / #1e293b (slate-800) — the OLD platform
 * defaults — as display fallbacks whenever org.branding lacked primaryColor/accentColor. A
 * brand research that honestly found no usable color (mariliasantoscabral.webnode.pt: navy
 * lives only in the hero JPEG) therefore READ as "research picked teal", and pressing
 * Guardar persisted the fake pair onto the org.
 *
 * This spec drives the real dev stack and locks the fix: unset colors render as an explicit
 * "Não definida" empty state, never a plausible default; Guardar with unset colors persists
 * nothing; the exact hexes #0d9488/#1e293b never appear; the dashboard stays free of
 * meaningful console errors and of non-asset HTTP 404s (tracked by URL per docs/testing.md —
 * next-dev asset noise logs URL-less "Failed to load resource" entries).
 */

const DESKTOP = { width: 1280, height: 800 };

function apiBase(): string {
  try {
    const port = readFileSync(resolve(__dirname, '..', '..', 'backend.port'), 'utf-8').trim();
    if (port) return `http://127.0.0.1:${port}`;
  } catch {
    /* fall through */
  }
  return 'http://127.0.0.1:4111';
}

/** Order-independence: clear org.branding through the public API (PATCH /org replaces the
 *  branding object wholesale), so each test starts from the unbranded seeded-org state. */
async function resetOrgBranding() {
  const ctx = await pwRequest.newContext({ baseURL: apiBase() });
  const login = await ctx.post('/api/v1/auth/login', { data: { username: 'admin', password: 'tmp12345' } });
  const { token } = (await login.json()) as { token: string };
  const res = await ctx.patch('/api/v1/org', { data: { branding: {} }, headers: { authorization: `Bearer ${token}` } });
  if (!res.ok()) throw new Error(`branding reset failed: ${res.status()}`);
  await ctx.dispose();
}

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
    const text = msg.text();
    // URL-less next-dev asset noise; real HTTP failures are tracked by URL below.
    if (text.includes('Failed to load resource')) return;
    if (msg.type() === 'error') errors.push(text);
  });
  return errors;
}

/** Track non-asset 404s by URL (the actionable half of the console's resource noise). */
function trackHttp404s(page: Page): string[] {
  const urls: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && !r.url().includes('/_next/') && !r.url().includes('favicon')) urls.push(r.url());
  });
  return urls;
}

function assertClean(errors: string[], notFounds: string[]) {
  const meaningful = errors.filter(
    (e) => !e.includes('favicon') && !e.includes('Download the React DevTools'),
  );
  expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  expect(notFounds, `HTTP 404s: ${notFounds.join(' | ')}`).toHaveLength(0);
}

async function openBrandingTab(page: Page) {
  await page.goto('/settings/branding');
  await expect(page.getByTestId('settings-branding-page')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('tab', { name: 'Marca' }).click();
  // The two hex inputs (primary + accent) are the only font-mono inputs on the tab.
  await expect(page.locator('input.font-mono')).toHaveCount(2, { timeout: 10_000 });
}

test.describe('branding colors: explicit not-set state, no fabricated defaults', () => {
  test.beforeEach(async () => {
    await resetOrgBranding();
  });

  test('unset org colors render as "Não definida" and Guardar persists no color', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const notFounds = trackHttp404s(page);
    await login(page);
    await page.setViewportSize(DESKTOP);
    await openBrandingTab(page);

    const colorInputs = page.locator('input.font-mono');
    for (const input of await colorInputs.all()) {
      // The exact defect pair must never surface as a value.
      await expect(input).not.toHaveValue('#0d9488');
      await expect(input).not.toHaveValue('#1e293b');
      // Unbranded org: both pickers show the explicit empty state.
      await expect(input).toHaveValue('');
      await expect(input).toHaveAttribute('placeholder', 'Não definida');
    }

    // Guardar with unset colors must not fabricate any: save, reload, still unset.
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Guardado').first()).toBeVisible({ timeout: 10_000 });

    await openBrandingTab(page);
    for (const input of await colorInputs.all()) {
      await expect(input).toHaveValue('');
    }

    assertClean(errors, notFounds);
  });

  test('a user-picked color round-trips through Guardar (the not-set state is editable, not read-only)', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const notFounds = trackHttp404s(page);
    await login(page);
    await page.setViewportSize(DESKTOP);
    await openBrandingTab(page);

    const primary = page.locator('input.font-mono').first();
    await primary.fill('#2a3547'); // the law-firm navy from the defect report
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText('Guardado').first()).toBeVisible({ timeout: 10_000 });

    await openBrandingTab(page);
    await expect(page.locator('input.font-mono').first()).toHaveValue('#2a3547');
    // The accent stays honestly unset - saving one color must not fabricate the other.
    await expect(page.locator('input.font-mono').nth(1)).toHaveValue('');

    assertClean(errors, notFounds);
  });
});
