import { test, expect, type Page } from '@playwright/test';
import { NotificationEvent, IntegrationBuilderChatResponse } from '@ekoa/shared';

/**
 * Integration-builder journey (ch03 §3.8.14, backend landed 2026-07-11): the chat handoff
 * opens the builder panel, one builder turn yields a generated package, saving lands it in
 * the REAL definitions registry (runtime tier) and it appears on /integrations.
 *
 * Deterministic (no live model): exactly TWO schema-validated stubs — the notifications SSE
 * event that opens the panel (integration_build_intent) and the model-backed builder chat
 * POST. Everything downstream (PUT /package validation, the runtime write, the definitions
 * refresh, the /integrations read) hits the LIVE api. Stable key `e2e-proof-weather` so
 * reruns overwrite the same runtime package instead of accreting.
 */

const BUILDER_KEY = 'e2e-proof-weather';

// sessionId '' (schema-valid) makes the page handler fall back to the LIVE active session —
// a fabricated id would land the panel/messages on a session that is not on screen.
const INTENT_EVENT = { type: 'integration_build_intent', sessionId: '', hint: 'weather' } as const;

const GENERATED_CONFIG = {
  integrationKey: BUILDER_KEY,
  displayName: 'E2E Proof Weather',
  description: 'Integração de meteorologia usada pela prova e2e do builder.',
  authType: 'api_key',
  provider: 'custom',
  category: 'data',
  configSchema: [
    { key: 'api_key', label: 'API Key', type: 'password', required: true, secret: true, helpText: 'Chave da API do serviço.' },
  ],
  actions: [
    {
      actionName: 'get_current_weather',
      description: 'Obtém a meteorologia atual de uma cidade.',
      mutates: false,
      argsSchema: { city: 'string' },
      httpConfig: {
        method: 'GET',
        baseUrl: 'https://api.example-weather.test',
        path: '/current',
        queryParams: { q: '{{city}}', appid: '{{api_key}}' },
      },
    },
  ],
  credentialGuide: 'Crie uma conta no serviço e copie a API key do painel de developer.',
};

const CHAT_STUB = {
  builderSessionId: 'builder-sess-e2e',
  generatedPackage: {
    skillMd: `---\nname: ${BUILDER_KEY}\ndescription: Meteorologia atual por cidade\n---\n\n# E2E Proof Weather\n\n## get_current_weather\nObtém a meteorologia atual de uma cidade pelo nome.`,
    config: GENERATED_CONFIG,
  },
  validationErrors: [],
};

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Same precise tracking as regressions-dashboard: real console errors + non-asset 4xx by URL. */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    // Known OPEN finding (docs/findings.md: login session double-create race): the /chat
    // landing intermittently GETs a just-created session id that 404s. Scoped exclusion —
    // remove when the finding closes.
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

test.describe('integration builder', () => {
  test('intent opens the panel; a builder turn generates a package; save lands it in the live registry', async ({ page }) => {
    // Both stubs are schema-validated in-spec (the QA rule: no protocol stubs except
    // schema-validated ones).
    expect(NotificationEvent.safeParse(INTENT_EVENT).success, 'intent stub validates').toBe(true);
    expect(IntegrationBuilderChatResponse.safeParse(CHAT_STUB).success, 'chat stub validates').toBe(true);

    // The api is CROSS-ORIGIN from the dashboard (:3000 → :4111) and Playwright-fulfilled
    // responses still pass the browser's CORS checks — every stub must carry ACAO (and the
    // chat POST needs its preflight answered) or the client fails silently.
    const CORS_HEADERS = {
      'access-control-allow-origin': 'http://localhost:3000',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    };

    // Stub 1 — the notifications SSE: EVERY connection carries the intent event (the page's
    // handler may subscribe after the first connect; EventSource reconnects deliver it once
    // the listener is attached — re-delivery is idempotent for the panel state).
    await page.route('**/api/v1/notifications/events**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: CORS_HEADERS,
        body: `event: integration_build_intent\ndata: ${JSON.stringify(INTENT_EVENT)}\n\n`,
      });
    });

    // Stub 2 — the model-backed builder chat turn (+ its CORS preflight).
    await page.route('**/api/v1/integration-builder/chat', async (route) => {
      if (route.request().method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: CORS_HEADERS });
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: CORS_HEADERS,
        body: JSON.stringify(CHAT_STUB),
      });
    });

    const errors = trackConsoleErrors(page);
    await login(page);

    // The intent switches the side panel to the builder.
    await expect(page.getByText(/Integration Builder/i).first()).toBeVisible({ timeout: 30_000 });

    // One builder turn: describe the integration; the (stubbed) reply carries the package.
    const input = page.getByPlaceholder(/Describe the integration/i);
    await input.fill('Integração de meteorologia com API key, ação para meteorologia atual por cidade.');
    await input.press('Enter');
    await expect(page.getByText(/ready to save/i)).toBeVisible({ timeout: 15_000 });

    // Save & continue → LIVE PUT /package (validation + runtime write + registry refresh).
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes('/integration-builder/package') && r.request().method() === 'PUT',
      { timeout: 30_000 },
    );
    await page.getByRole('button', { name: /save & continue/i }).click();
    const saved = await saveResponse;
    expect(saved.ok()).toBe(true);
    const savedBody = (await saved.json()) as { integrationKey?: string; saved?: boolean };
    expect(savedBody.integrationKey).toBe(BUILDER_KEY);
    expect(savedBody.saved).toBe(true);

    // The saved integration is now a REAL definition: it renders on /integrations.
    await page.goto('/integrations');
    await expect(
      page.getByRole('heading', { name: /E2E Proof Weather/i }).first(),
    ).toBeVisible({ timeout: 30_000 });

    // Ignore benign SSE-reconnect noise from the stubbed notifications stream; anything else fails.
    const real = errors.filter((e) => !/event.?source|notifications\/events|network error/i.test(e));
    expect(real, `console errors:\n${real.join('\n')}`).toEqual([]);
  });
});
