import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * Deterministic automation live run (ch13 §13.6 coverage-gap row "Automations live run through the
 * UI"). Committed at G8 with the automation engine; ledger band4_gap_plan → G9.
 *
 * The automation uses navigate/wait steps ONLY - no vision dependency, zero model calls - so the
 * run is fully deterministic: the engine must progress it to a terminal state, never a spinner
 * forever, with zero console errors (QA block, CLAUDE.md).
 *
 * REWRITTEN AT S8 (2026-08-22): THE UI LEG IS DROPPED, THE API LEGS ARE NOT. The viewer this case
 * read progression from was `/automations/[id]`, which is now a redirect - there is no run viewer
 * to assert against, and the integration detail page's run history is keyed by ACTION, which an
 * automation created directly through `/api/v1/automations` has none of. What the case was FOR
 * survives whole and is what it still asserts: the engine drives a browserless wait plan from
 * `running` to a SETTLED status, over the real API, on a real login. The public automations API is
 * untouched by S8, so this is the leg that had to keep working, and it is the leg that does.
 *
 * A LOGIN IS STILL REQUIRED, not vestigial: the bearer these calls carry is read out of the
 * browser's own storage after a real UI login, so the case exercises the same admission a person
 * gets rather than a token minted beside the product.
 */

const API = process.env.EKOA_API_BASE || 'http://127.0.0.1:4111';

async function login(page: Page) {
  await uiLogin(page);
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
  const token = await page.evaluate(() => localStorage.getItem('ekoa_token') ?? localStorage.getItem('token') ?? sessionStorage.getItem('token'));
  const res = await page.request.fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { data: JSON.stringify(body) } : {}),
  });
  return (await res.json()) as Record<string, unknown>;
}

test('automação determinística: passos wait progridem até ao estado terminal', async ({ page }) => {
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

  // Terminal state: the run settles (a browserless wait plan may land `awaiting_daemon` if the
  // engine decides it needs a browser; either way it must reach a SETTLED, non-running status -
  // the deterministic contract is "no spinner forever").
  await expect
    .poll(async () => (await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`)).status as string, {
      timeout: 30_000,
    })
    .not.toBe('running');

  // REVIEW ROUND F25. The first rewrite probed the run record for the step DESCRIPTIONS, which the
  // wire never carries: `toWireStep` projects a record down to
  // {stepId, index, status, tier, durationMs, error, screenshotUrl} (shared `RunStepRecord`), and an
  // executed wait record has no description on it either. That assertion could not pass in ANY
  // outcome - a deterministically red spec, which is worse than the weak one it replaced. This pins
  // what the wire actually carries, and it is still the progression the retired viewer showed: BOTH
  // steps present, by index, each having reached a terminal state rather than sitting pending.
  const settled = await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`);
  expect(String(settled.status)).toMatch(/^(completed|failed|awaiting_daemon|needs_credentials|paused_for_user|awaiting_consent|cancelled)$/);

  const steps = (settled.steps ?? []) as Array<{ index?: number; status?: string }>;
  expect(steps.length, `run carried ${steps.length} step record(s): ${JSON.stringify(steps)}`).toBeGreaterThanOrEqual(2);
  // Indices rather than a substring: a run that finalized after step 1 - the off-by-one this case
  // exists to catch - carries record 0 and not record 1.
  expect(steps.map((s) => s.index)).toEqual(expect.arrayContaining([0, 1]));
  for (const record of steps.slice(0, 2)) {
    expect(record.status, `step ${record.index} never left pending: ${JSON.stringify(record)}`).not.toBe('pending');
  }

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
