import { test, expect, type Page } from '@playwright/test';
import { BridgeStatusResponse, ChatRunCreateRequest, ChatRunEvent, ChatRun, ChatRunCreateResponse } from '@ekoa/shared';

/**
 * Reference attach (run s6; FC-400, FC-401 connected state, FC-411; D4) — deterministic.
 *
 * Connected presence (schema-validated stub), a daemon that predates the C4 picker (no
 * loopback server at all): the Reference action falls back to the typed-reference input
 * (the brief's pre-authorized fallback), the FIRST grant shows the FC-411 consent dialog
 * with its verbatim body, the confirmed token renders as a composer chip, and the sent
 * run carries `references` — asserted BY VALIDATING the intercepted request against the
 * shared ChatRunCreateRequest schema. Real UI login, zero console errors.
 */

const RUN_ID = 'run-reference-e2e';
const CONNECTED = { paired: true, live: true, pairingId: 'pair-e2e', lastSeenAt: '2026-07-11T06:00:00.000Z' };
const SSE_EVENTS = [
  { type: 'ready', runId: RUN_ID },
  { type: 'text_chunk', text: 'Li o contrato referenciado.' },
  { type: 'complete', result: 'Li o contrato referenciado.', durationMs: 500 },
] as const;

function sseBody(): string {
  return SSE_EVENTS.map((e, i) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\nid: ${i + 1}\n\n`).join('');
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
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('reference attach (FC-400/FC-411; D4)', () => {
  test('typed-fallback token flows through consent into the run request', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    // The pre-C4 daemon is deliberately ABSENT: the picker fetch's connection-refused is
    // this test's stimulus for the typed fallback, and Chrome logs it as a console error.
    const meaningfulErrors = () =>
      errors.filter(
        (e) => !e.includes('favicon') && !e.includes('Download the React DevTools') && !e.includes('ERR_CONNECTION_REFUSED'),
      );

    expect(BridgeStatusResponse.safeParse(CONNECTED).success).toBe(true);
    for (const e of SSE_EVENTS) expect(ChatRunEvent.safeParse(e).success).toBe(true);
    expect(ChatRunCreateResponse.safeParse({ runId: RUN_ID }).success).toBe(true);
    expect(ChatRun.safeParse({ id: RUN_ID, status: 'running' }).success).toBe(true);

    await page.route('**/api/v1/bridge/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONNECTED) }),
    );

    let createBody: unknown = null;
    await page.route('**/api/v1/chat/runs', (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      createBody = route.request().postDataJSON();
      return route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ runId: RUN_ID }) });
    });
    await page.route(`**/api/v1/chat/runs/${RUN_ID}/events**`, (route) =>
      route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, body: sseBody() }),
    );
    await page.route(`**/api/v1/chat/runs/${RUN_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: RUN_ID, status: 'running' }) }),
    );

    await login(page);

    // Open the attach menu: the FC-400 two-action affordance with its micro-copy.
    await page.getByRole('button', { name: /anexar/i }).first().click();
    const menu = page.getByTestId('composer-attach-menu');
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Enviar guarda uma cópia nos nossos servidores.');

    // Connected state: the picker is tried, the pre-C4 daemon is unreachable -> typed fallback.
    await page.getByTestId('reference-state-connected').click();
    const typed = page.getByTestId('typed-reference-ref');
    await expect(typed).toBeVisible({ timeout: 15_000 });
    await typed.fill('g-e2e-contratos');
    await page.getByTestId('typed-reference-label').fill('Contratos 2026');
    await page.getByTestId('typed-reference-confirm').click();

    // FC-411 first-grant consent dialog, verbatim body with the target filled in.
    const dialogBody = page.getByTestId('first-grant-body');
    await expect(dialogBody).toBeVisible();
    await expect(dialogBody).toHaveText(
      'Esta autorização permite ao agente ler Contratos 2026 durante esta sessão. Pode revogar a qualquer momento em Definições → Privacidade e ponte local.',
    );
    await page.getByTestId('first-grant-confirm').click();

    // The token renders as a composer chip.
    await expect(page.getByTestId('reference-token-g-e2e-contratos')).toBeVisible();
    await expect(page.getByTestId('reference-token-g-e2e-contratos')).toContainText('Contratos 2026');

    // Send: the run request carries the references and VALIDATES against the shared schema.
    const composer = page.locator('textarea').first();
    await composer.fill('resume o contrato referenciado');
    await composer.press('Enter');
    await expect(page.getByText('Li o contrato referenciado.').first()).toBeVisible({ timeout: 30_000 });

    expect(createBody, 'create-run request captured').not.toBeNull();
    const parsed = ChatRunCreateRequest.safeParse(createBody);
    expect(parsed.success, 'request validates against the shared schema').toBe(true);
    if (parsed.success) {
      expect(parsed.data.references).toEqual([{ grantRef: 'g-e2e-contratos', label: 'Contratos 2026' }]);
    }

    // Tokens attach to ONE message: the chip is gone after send.
    await expect(page.getByTestId('reference-token-chips')).not.toBeVisible();

    const meaningful = meaningfulErrors();
    expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  });
});
