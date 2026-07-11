import { test, expect, type Page } from '@playwright/test';
import { ChatRunEvent, ChatRun, ChatRunCreateResponse } from '@ekoa/shared';

/**
 * Trust chip (run s5; FC-402/FC-403) — deterministic, LLM-free, daemon-free.
 *
 * A chat turn whose delegation read local files streams ONE `local_activity` event; the
 * chip renders the mechanism halves (what was read + bytes-out, honest two-boundary copy)
 * while the masked-count clause and the FC-403 custody panel stay SHIP-GATED — rendered
 * through <GatedClaim> as the "Verificação em curso" placeholder, never asserted, while
 * CLAIMS_SHIP_GATED is true (§17.9 A7.4; §12.6 criterion 14). Every stubbed payload is
 * schema-validated against shared/. Real UI login, zero console errors.
 */

const RUN_ID = 'run-trust-chip-e2e';
const ANSWER = 'A cláusula 3.1 fixa o prazo de pagamento em 30 dias.';

const SSE_EVENTS = [
  { type: 'ready', runId: RUN_ID },
  { type: 'text_chunk', text: ANSWER },
  {
    type: 'local_activity',
    files: [{ path: '/clientes/acme/contrato.docx', range: 'secção 3.1' }],
    bytesOut: 3174,
    maskedCounts: { nomes: 14, NIF: 3 },
    correlationId: 'corr-e2e-1',
  },
  { type: 'complete', result: ANSWER, durationMs: 900 },
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

test.describe('trust chip (FC-402/FC-403)', () => {
  test('a local-file turn renders the chip: read summary + bytes ship; claims stay gated', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    for (const e of SSE_EVENTS) {
      expect(ChatRunEvent.safeParse(e).success, `stub event ${e.type} validates`).toBe(true);
    }
    const createResponse = { runId: RUN_ID };
    expect(ChatRunCreateResponse.safeParse(createResponse).success).toBe(true);
    const runView = { id: RUN_ID, status: 'running' };
    expect(ChatRun.safeParse(runView).success).toBe(true);

    await page.route('**/api/v1/chat/runs', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify(createResponse) })
        : route.fallback(),
    );
    await page.route(`**/api/v1/chat/runs/${RUN_ID}/events**`, (route) =>
      route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: sseBody(),
      }),
    );
    await page.route(`**/api/v1/chat/runs/${RUN_ID}`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(runView) }),
    );

    await login(page);

    const composer = page.locator('textarea').first();
    await composer.fill('qual é o prazo de pagamento no contrato?');
    await composer.press('Enter');

    await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 30_000 });

    // FC-402 — the chip renders on the turn: mechanism halves ship.
    const chip = page.getByTestId('trust-chip').first();
    await expect(chip).toBeVisible({ timeout: 10_000 });
    await expect(chip).toContainText('Leu contrato.docx (secção 3.1)');
    await expect(chip).toContainText('3,1 KB saíram desta máquina de forma transitória');

    // The masked-count CLAIM is ship-gated: the placeholder shows, the claim text does not.
    await expect(chip).toContainText('Verificação em curso');
    await expect(chip).not.toContainText('mascarados antes do fornecedor de IA');

    // FC-403 — the "i" custody panel opens, its ceiling text equally gated.
    await page.getByTestId('trust-chip-info').first().click();
    const panel = page.getByTestId('trust-chip-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('Verificação em curso');
    await expect(panel).not.toContainText('Os ficheiros nunca saem da sua máquina');

    const meaningful = errors.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));
    expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  });
});
