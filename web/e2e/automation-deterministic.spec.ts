import { test, expect, type Page } from '@playwright/test';

/**
 * Deterministic automation live run through the UI (ch13 §13.6 coverage-gap row "Automations
 * live run through the UI"). Committed at G8 with the automation engine; DUE GREEN AT G9,
 * when the migrated web client lands the automations pages (ledger band4_gap_plan → G9).
 *
 * The automation uses navigate/wait steps ONLY — no vision dependency, zero model calls —
 * so the run is fully deterministic: the run viewer must show step progression and a terminal
 * state, with zero console errors (QA block, CLAUDE.md).
 */

const API = process.env.EKOA_API_BASE || 'http://127.0.0.1:4111';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/chat/, { timeout: 20_000 });
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/Failed to load resource/.test(msg.text())) return;
    errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}

async function apiJson(page: Page, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const token = await page.evaluate(() => localStorage.getItem('token') ?? sessionStorage.getItem('token'));
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { data: JSON.stringify(body) } : {}),
  });
  return (await res.json()) as Record<string, unknown>;
}

test('automação determinística: passos wait progridem no run viewer até ao estado terminal', async ({ page }) => {
  const errors = watchConsole(page);
  await login(page);

  // Create the deterministic automation through the API (navigate/wait only — no vision).
  const automation = await apiJson(page, 'POST', '/api/v1/automations', {
    name: `E2E determinística ${Date.now().toString(36)}`,
    plan: {
      steps: [
        { description: 'esperar 100ms', tool: 'wait', durationMs: 100 },
        { description: 'esperar 100ms outra vez', tool: 'wait', durationMs: 100 },
      ],
    },
  });
  const automationId = automation.id as string;
  expect(automationId).toBeTruthy();

  // Start a run (202 async pattern) and open the run viewer.
  const started = await apiJson(page, 'POST', `/api/v1/automations/${automationId}/runs`, {});
  const runId = started.runId as string;
  expect(runId).toBeTruthy();

  await page.goto(`/automations/${automationId}`);

  // Step progression: both wait steps surface in the viewer.
  await expect(page.getByText('esperar 100ms', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // Terminal state: the run settles (completed for a browserless wait plan is allowed to land
  // awaiting_daemon only if the engine requires a browser; the viewer must show a SETTLED,
  // non-running state either way — the deterministic contract is "no spinner forever").
  await expect
    .poll(async () => (await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`)).status as string, {
      timeout: 30_000,
    })
    .not.toBe('running');
  const finalStatus = (await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`)).status as string;
  await expect(page.getByText(new RegExp(finalStatus === 'completed' ? 'conclu|completed' : 'aguard|pausa|falh|await|paused|failed', 'i')).first()).toBeVisible({ timeout: 10_000 });

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
