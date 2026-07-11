import { test, expect, type Page } from '@playwright/test';
import { BridgeStatusResponse, ChatRunCreateRequest, ChatRunEvent, ChatRun, ChatRunCreateResponse } from '@ekoa/shared';

/**
 * Reference attach (run 20260711-111952 s5; FC-400, FC-401 connected state, FC-411; D1/D2/D3) —
 * deterministic, with an in-spec stub of the daemon's loopback browser surface.
 *
 * Owner directive: connected = trusted, the user PICKS a file/folder in an in-app browser — no
 * typed path, no typed grantRef. Connected presence (schema-validated stub) + a stubbed
 * /browse + /grants loopback surface: the Reference action opens the file browser, the user
 * navigates and picks a file, the FIRST grant shows the FC-411 consent dialog with its verbatim
 * body, the pending token renders as a composer chip, and on SEND the pick is minted into a
 * session grant (POST /grants) whose {grantRef,label} rides the run request — asserted by
 * validating the intercepted request against the shared ChatRunCreateRequest schema. Real UI
 * login, zero console errors.
 */

const RUN_ID = 'run-reference-e2e';
const CONNECTED = { paired: true, live: true, pairingId: 'pair-e2e', lastSeenAt: '2026-07-11T06:00:00.000Z' };
const BRIDGE_ORIGIN = 'http://127.0.0.1:8791';
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

test.describe('reference attach (FC-400/FC-401/FC-411; D1/D2/D3)', () => {
  test('pick a file in the in-app browser, consent, and the send mints a session grant', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const meaningfulErrors = () =>
      errors.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));

    expect(BridgeStatusResponse.safeParse(CONNECTED).success).toBe(true);
    for (const e of SSE_EVENTS) expect(ChatRunEvent.safeParse(e).success).toBe(true);
    expect(ChatRunCreateResponse.safeParse({ runId: RUN_ID }).success).toBe(true);
    expect(ChatRun.safeParse({ id: RUN_ID, status: 'running' }).success).toBe(true);

    await page.route('**/api/v1/bridge/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CONNECTED) }),
    );

    // Stub the daemon's loopback browser surface: /browse lists a folder with one file; POST
    // /grants mints a session grant for the picked path (its parent, honestly) bound to the
    // session id the app passes.
    let grantBody: { path?: string; session?: string; label?: string } | null = null;
    await page.route(`${BRIDGE_ORIGIN}/browse**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          path: '/Users/adv/Documentos',
          entries: [
            { name: 'Arquivo', kind: 'dir' },
            { name: 'contrato.pdf', kind: 'file', size: 32100 },
          ],
          truncated: false,
        }),
      }),
    );
    await page.route(`${BRIDGE_ORIGIN}/grants`, (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      grantBody = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({
          grantRef: 'g-e2e-contratos',
          path: '/Users/adv/Documentos',
          session: grantBody?.session ?? '',
          label: 'contrato.pdf',
          requested: 'file',
        }),
      });
    });

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

    // Connected state opens the in-app file browser (no typed input anywhere).
    await page.getByTestId('reference-state-connected').click();
    const browser = page.getByTestId('file-browser');
    await expect(browser).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('file-browser-path')).toHaveText('/Users/adv/Documentos');

    // Pick the file: its parent is what gets granted (stated), label is the file name.
    await page.getByTestId('file-browser-pick-file-contrato.pdf').click();

    // FC-411 first-grant consent dialog, verbatim body with the picked label filled in.
    const dialogBody = page.getByTestId('first-grant-body');
    await expect(dialogBody).toBeVisible();
    await expect(dialogBody).toHaveText(
      'Esta autorização permite ao agente ler contrato.pdf durante esta sessão. Pode revogar a qualquer momento em Definições → Privacidade e ponte local.',
    );
    await page.getByTestId('first-grant-confirm').click();

    // The pending token renders as a composer chip (labelled by the file name).
    await expect(page.getByTestId('reference-token-chips')).toContainText('contrato.pdf');

    // Send: the pick is minted into a session grant (POST /grants) bound to the chat session,
    // and the run request carries the resulting {grantRef,label} — validated against the schema.
    const composer = page.locator('textarea').first();
    await composer.fill('resume o contrato referenciado');
    await composer.press('Enter');
    await expect(page.getByText('Li o contrato referenciado.').first()).toBeVisible({ timeout: 30_000 });

    expect(grantBody, 'grant mint request captured at send').not.toBeNull();
    expect(grantBody!.path).toBe('/Users/adv/Documentos/contrato.pdf');
    expect(typeof grantBody!.session).toBe('string');
    expect((grantBody!.session ?? '').length).toBeGreaterThan(0);

    expect(createBody, 'create-run request captured').not.toBeNull();
    const parsed = ChatRunCreateRequest.safeParse(createBody);
    expect(parsed.success, 'request validates against the shared schema').toBe(true);
    if (parsed.success) {
      expect(parsed.data.references).toEqual([{ grantRef: 'g-e2e-contratos', label: 'contrato.pdf' }]);
    }

    // Tokens attach to ONE message: the chip is gone after send.
    await expect(page.getByTestId('reference-token-chips')).not.toBeVisible();

    const meaningful = meaningfulErrors();
    expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  });
});
