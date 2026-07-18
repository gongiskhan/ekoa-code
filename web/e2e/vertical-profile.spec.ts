import { test, expect, type Page } from '@playwright/test';
import { cortexBase } from './helpers/legal';

/**
 * S8 vertical-profile: the legal skin over the generic core.
 *
 * Self-contained via the SETTINGS path - beforeAll flips
 * `settings.general.vertical = 'legal'` through the real
 * `PATCH /api/v1/settings` (admin is super-admin, so the write is authorized;
 * it persists on the org settings), which the frontend settings store then
 * hydrates. No env var / dev-server restart is required for the authenticated
 * surfaces. The pre-auth /login page, which never fetches settings, is
 * exercised via the localStorage mirror (`ekoa_vertical`) that the settings
 * store writes for exactly this purpose.
 *
 * Requires the dev servers (Session Start Rule). Real login (admin / tmp12345),
 * no stubs. The legal-* starting points asserted here are seeded in the running
 * backend by the earlier legal slices.
 */

async function loginUi(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Fail on real page crashes; dev-mode instrumentation noise is ignored. */
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    if (/cannot have a negative time stamp/.test(err.message)) return;
    errors.push(err.message);
  });
  return errors;
}

test.beforeAll(async ({ request }) => {
  const loginRes = await request.post(`${cortexBase()}/api/v1/auth/login`, {
    data: { username: 'admin', password: 'tmp12345' },
    timeout: 20_000,
  });
  expect(loginRes.ok(), `login should succeed (status ${loginRes.status()})`).toBe(true);
  const { token } = (await loginRes.json()) as { token: string };
  expect(token).toBeTruthy();

  // `general.vertical` is not a typed PlatformSettingsPatch field; it rides the
  // schema's top-level passthrough. The server shallow-merges at the top level,
  // replacing org.settings.general wholesale - fine for the e2e database.
  const upd = await request.patch(`${cortexBase()}/api/v1/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { general: { vertical: 'legal' } },
    timeout: 20_000,
  });
  expect(upd.ok(), 'settings update should succeed').toBe(true);
  // The merged settings object comes back directly (no success/data envelope).
  const settings = (await upd.json()) as { general?: { vertical?: string } };
  expect(settings.general?.vertical).toBe('legal');
});

test('chat empty state shows the legal example prompts (prazos processuais + Citius)', async ({ page }) => {
  const errors = watchPageErrors(page);
  await loginUi(page);
  await page.goto('/chat');

  // The legal skin activates once the settings store hydrates (vertical=legal),
  // replacing the generic prompts. Both spec-mandated prompts must be present.
  await expect(
    page.getByText(/Que prazos processuais vencem esta semana/i).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(/notificações do Citius/i).first(),
  ).toBeVisible({ timeout: 20_000 });

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('login shows the legal tagline', async ({ page }) => {
  // /login never fetches settings; the settings store's localStorage mirror is
  // how the choice reaches this pre-auth surface. Seed it directly.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ekoa_vertical', 'legal');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/login');

  await expect(
    page.getByText('Ekoa · O espaço de trabalho com IA para escritórios de advogados'),
  ).toBeVisible({ timeout: 15_000 });
});

test('artifacts Pontos de Partida floats the Jurídico cards ahead of generic ones', async ({ page }) => {
  const errors = watchPageErrors(page);
  await loginUi(page);
  await page.goto('/artifacts');

  const strip = page.getByTestId('starting-points-strip');
  await expect(strip).toBeVisible({ timeout: 20_000 });

  // Stable partition: legal-* starting points sort first. The very first card's
  // title must therefore be a "Jurídico ·" one.
  const firstCard = strip.locator('[data-testid^="starting-point-card-"]').first();
  await expect(firstCard).toBeVisible({ timeout: 15_000 });
  await expect(firstCard.locator('h3').first()).toContainText('Jurídico');

  expect(errors, `page errors: ${errors.join(' | ')}`).toHaveLength(0);
});
