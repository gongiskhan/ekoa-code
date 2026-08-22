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
 * SPLIT AT THE S8 LIVE PASS (2026-08-22): what can be proven on any boot is one case, and what
 * cannot is a second case, blocked with its reason. See the second test's header - the short version
 * is that both wait steps executing needs a paired machine, because an undeclared origin is
 * bridge-only, and the API deliberately refuses the per-step declaration that would change it.
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

/** Author the two-wait plan and start a run. Returns the run id. */
async function startDeterministicRun(page: Page): Promise<string> {
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

  const started = await apiJson(page, 'POST', `/api/v1/automations/${automationId}/runs`, {});
  const runId = started.runId as string;
  expect(runId).toBeTruthy();
  return runId;
}

test('automação determinística: a API aceita o plano e o motor leva a execução a um estado terminal', async ({ page }) => {
  const errors = watchConsole(page);
  await login(page);

  const runId = await startDeterministicRun(page);

  // NO SPINNER FOREVER. This is the half that holds on ANY boot, daemonless included, and it is a
  // real property: the wire-authorable plan is accepted, a run is created, and the engine drives it
  // off `running` rather than parking it.
  await expect
    .poll(async () => (await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`)).status as string, {
      timeout: 30_000,
    })
    .not.toBe('running');

  const settled = await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`);
  expect(String(settled.status)).toMatch(/^(completed|failed|awaiting_daemon|needs_credentials|paused_for_user|awaiting_consent|cancelled)$/);

  // AND THE ENGINE REALLY RAN, rather than finalising an empty trace: at least the first step has a
  // record and it is not pending. A `failed` status is an ACCEPTED outcome here and the reason is
  // named rather than shrugged at - on a daemonless boot step 0 fails on P4's
  // undeclared-origins-are-bridge-only posture. What that failure costs is asserted, not tolerated,
  // by the blocked case below; this case deliberately does not claim the steps SUCCEEDED.
  const steps = (settled.steps ?? []) as Array<{ index?: number; status?: string }>;
  expect(steps.length, `run carried no step records at all: ${JSON.stringify(settled)}`).toBeGreaterThanOrEqual(1);
  expect(steps[0]?.index).toBe(0);
  expect(steps[0]?.status, `step 0 never left pending: ${JSON.stringify(steps[0])}`).not.toBe('pending');

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});

/**
 * THE HALF THAT CANNOT PASS ON A DAEMONLESS MACHINE, kept whole and blocked rather than weakened.
 *
 * BOTH wait steps executing is what this spec was for, and on this estate it cannot happen: the
 * engine resolves every step's locality through `egressRequirementFor`, and an UNDECLARED origin is
 * bridge-only (P4) - so with no machine paired, step 0 halts with "no machine is paired to your
 * account, and this step runs only on one" and step 1 never gets a record.
 *
 * THE OBVIOUS FIX IS NOT AVAILABLE, and that is the finding rather than an excuse. A per-step
 * `declaration` would make a wait step cloud-safe, but `POST /api/v1/automations` deliberately does
 * NOT carry one: `mapWireStepToEngine` builds a step from `{stepId, description, tool}` alone, and
 * `automation/service.ts` states why - a Cofre-referencing declaration is a NEW POWER on a
 * `user-or-key` surface, not a new spelling of an existing one, and widening the mapper would hand
 * every gateway-key holder that authoring power. Declaring it in this spec's payload would need an
 * auth-class change, which a spec fix must not make.
 *
 * So the claim stays, explicitly blocked, and the ledger registration says so. Unblocking it means
 * either a paired machine on the runner or a posture decision about undeclared origins - the OPEN
 * finding names it - and NOT an assertion that tolerates a failed step silently.
 */
test.skip('automação determinística: AMBOS os passos executam (bloqueado: undeclared-origins-are-bridge-only)', async ({ page }) => {
  await login(page);
  const runId = await startDeterministicRun(page);

  await expect
    .poll(async () => (await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`)).status as string, {
      timeout: 30_000,
    })
    .not.toBe('running');

  const settled = await apiJson(page, 'GET', `/api/v1/automations/runs/${runId}`);
  expect(String(settled.status)).toBe('completed');

  const steps = (settled.steps ?? []) as Array<{ index?: number; status?: string }>;
  expect(steps.map((s) => s.index)).toEqual(expect.arrayContaining([0, 1]));
  for (const record of steps.slice(0, 2)) {
    expect(record.status, `step ${record.index} did not complete: ${JSON.stringify(record)}`).toBe('completed');
  }
});
