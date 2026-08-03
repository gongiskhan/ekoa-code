import { test, expect, request as pwRequest, type APIRequestContext, type Page } from '@playwright/test';

/**
 * integration-achieve — `achieve` (EXECUTE-OR-AUTHOR) end to end, slice D3.
 *
 * WHAT THIS SPEC IS. `achieve` is a PUBLIC capability an outside client calls with a per-user
 * gateway key; it has no dashboard surface of its own, and the human half of it (approving a write,
 * promoting an authored action) is the one thing that must NOT be reachable with that key. So the
 * spec drives BOTH sides for real: the browser is the human — real UI login, a real key minted on
 * the real /settings/api-keys page, the real write-gate dialog on the real integrations page — and
 * an ordinary HTTP client carrying that key is the agent.
 *
 * WHY IT IS HERMETIC AND LLM-FREE. Every assertion below is on a path that REFUSES before any model
 * call or any outbound request:
 *   - the write gate answers before a credential is loaded, let alone a request sent;
 *   - `achieve` on a SHIPPED package refuses to author (`baseline_package`) before drafting;
 *   - and the promotion route is refused at ADMISSION.
 * So this spec never calls a model, never reaches Slack, and never needs a credential armed. The
 * author arm's happy path is covered deterministically in
 * `api/tests/contract/integrations-achieve.test.ts`, where the model turn is faked at the seam.
 *
 * RE-RUNNABLE. It revokes the approval it grants and revokes the key it mints, so a second run
 * starts from the same state.
 */

const API = process.env.EKOA_API_BASE ?? 'http://127.0.0.1:4111';
/** A shipped package with both shapes: `send_message` (mutates) and `list_channels` (a read). */
const INTEGRATION = 'slack';
const WRITE_ACTION = 'send_message';
const READ_ACTION = 'list_channels';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 90_000 });
}

function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() !== 'error') return;
    if (text.includes('Failed to load resource')) return; // URL-less next-dev asset noise
    errors.push(text);
  });
  return errors;
}

/** Mint a REAL gateway key through the REAL page — the same ceremony an outside client's owner
 *  performs. The secret shows exactly once, which is why it is read here and not later. */
async function mintKeyThroughTheUi(page: Page, label: string): Promise<string> {
  await page.goto('/settings/api-keys');
  await expect(page.getByTestId('settings-api-keys-page')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('gateway-key-label-input').fill(label);
  await page.getByTestId('gateway-key-mint').click();
  await expect(page.getByTestId('gateway-key-show-once')).toBeVisible({ timeout: 30_000 });
  const secret = (await page.getByTestId('gateway-key-secret').textContent())?.trim() ?? '';
  expect(secret.startsWith('ekoa_gk_')).toBe(true);
  return secret;
}

async function revokeKeyThroughTheUi(page: Page, label: string): Promise<void> {
  await page.goto('/settings/api-keys');
  await expect(page.getByTestId('settings-api-keys-page')).toBeVisible({ timeout: 30_000 });
  const row = page.locator('tr', { hasText: label });
  if ((await row.count()) === 0) return;
  await row.getByTestId('gateway-key-revoke').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /revogar|revoke/i }).click();
  await expect(row.getByTestId('gateway-key-status-revoked')).toBeVisible({ timeout: 15_000 });
}

function agentClient(secret: string): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: API,
    extraHTTPHeaders: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', 'x-client': 'e2e-achieve' },
  });
}

/** The integrations page's write-gate controls, reached the way a human reaches them (slice C2). */
async function openSlackActions(page: Page) {
  await page.goto('/integrations?tab=plataforma');
  await expect(page.getByTestId('platform-integrations-section')).toBeVisible({ timeout: 30_000 });
  const card = page
    .getByTestId('platform-integrations-section')
    .locator('div.rounded-xl')
    .filter({ hasText: 'Slack' })
    .first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Mostrar mais' }).click();
  await expect(card.getByText(WRITE_ACTION)).toBeVisible({ timeout: 15_000 });
  return card;
}

test.describe('achieve — an agent states a goal, and a human still decides', () => {
  test('the gate, the self-approval refusal, and the author arm, all through the real wire', async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    const label = `achieve-spec-${Date.now().toString(36)}`;
    await login(page);
    const secret = await mintKeyThroughTheUi(page, label);
    const agent = await agentClient(secret);

    try {
      // ---------------------------------------------------------------------------------------
      // 1. THE WRITE GATE. The agent asks for something that maps onto a `mutates` action.
      // ---------------------------------------------------------------------------------------
      const gated = await agent.post(`/api/v1/integrations/${INTEGRATION}/achieve`, {
        data: { goal: 'send message', args: { channel: '#geral', text: 'olá' } },
      });
      expect(gated.status()).toBe(403);
      const gatedBody = (await gated.json()) as {
        error: { code: string; details?: { code?: string; consentRequest?: { actionName: string; target: string } } };
      };
      expect(gatedBody.error.code).toBe('FORBIDDEN');
      // The refusal carries the descriptor a human must be shown — the agent has something to hand
      // its user rather than a bare 403.
      expect(gatedBody.error.details?.code).toBe('awaiting_consent');
      expect(gatedBody.error.details?.consentRequest?.actionName).toBe(WRITE_ACTION);
      expect(gatedBody.error.details?.consentRequest?.target).toContain('slack.com');

      // ---------------------------------------------------------------------------------------
      // 2. THE KEY CANNOT ANSWER ITS OWN PROMPT. Both doors: C2's approval, and D3's promotion.
      // ---------------------------------------------------------------------------------------
      const shape = gatedBody.error.details?.consentRequest ? await shapeFor(agent) : '';
      const selfApprove = await agent.post(`/api/v1/integrations/${INTEGRATION}/actions/${WRITE_ACTION}/approval`, {
        data: { decision: 'always', shape },
      });
      expect(selfApprove.status()).toBe(401);
      const selfTrust = await agent.post(`/api/v1/integrations/${INTEGRATION}/actions/${WRITE_ACTION}/trust`, {
        data: { shape },
      });
      expect(selfTrust.status()).toBe(401);

      // …and the refusal is unchanged after both attempts.
      const stillGated = await agent.post(`/api/v1/integrations/${INTEGRATION}/achieve`, { data: { goal: 'send message' } });
      expect(stillGated.status()).toBe(403);

      // ---------------------------------------------------------------------------------------
      // 3. THE AUTHOR ARM. A goal no action satisfies routes to authoring — and authoring on a
      //    SHIPPED package is refused before any model call, because a tenant forks a platform
      //    integration under a key of its own rather than shadowing it (A3's rule, not a second
      //    policy invented here).
      // ---------------------------------------------------------------------------------------
      const authored = await agent.post(`/api/v1/integrations/${INTEGRATION}/achieve`, {
        data: { goal: 'arquivar conversas antigas do espaco de trabalho' },
      });
      expect(authored.status()).toBe(200);
      const authoredBody = (await authored.json()) as { outcome: string; code?: string; message?: string };
      expect(authoredBody.outcome).toBe('refused');
      expect(authoredBody.code).toBe('baseline_package');
      expect(authoredBody.message).toBeTruthy();

      // ---------------------------------------------------------------------------------------
      // 4. THE HUMAN DECIDES, on the real page, and the SAME key's goal gets past the gate.
      // ---------------------------------------------------------------------------------------
      const card = await openSlackActions(page);
      const writeState = card.getByTestId(`action-approval-state-${WRITE_ACTION}`);
      await expect(writeState).toBeVisible({ timeout: 15_000 });
      await card.getByTestId(`action-approval-authorise-${WRITE_ACTION}`).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      // The dialog states what it is authorising, not a friendly paraphrase.
      await expect(dialog).toContainText(WRITE_ACTION);
      await expect(dialog).toContainText('slack.com');
      await dialog.getByTestId('action-consent-always').click();
      await expect(card.getByTestId(`action-approval-revoke-${WRITE_ACTION}`)).toBeVisible({ timeout: 15_000 });

      const passed = await agent.post(`/api/v1/integrations/${INTEGRATION}/achieve`, {
        data: { goal: 'send message', args: { channel: '#geral', text: 'olá' } },
      });
      // 200 with an EXECUTED outcome: the call got past the gate. It then fails on the integration
      // not being connected — which is the point. Slack is never contacted, and the only thing that
      // changed between this call and the identical one in step 1 is that a human said yes.
      expect(passed.status()).toBe(200);
      const passedBody = (await passed.json()) as { outcome: string; actionName: string; result: { success: boolean; code?: string } };
      expect(passedBody.outcome).toBe('executed');
      expect(passedBody.actionName).toBe(WRITE_ACTION);
      expect(passedBody.result.code).not.toBe('awaiting_consent');
      expect(passedBody.result.code).toBe('not_connected');

      // ---------------------------------------------------------------------------------------
      // 5. A READ NEEDS NO PROMPT (Rule 7: an existing `mutates:false` action gains nothing).
      // ---------------------------------------------------------------------------------------
      const read = await agent.post(`/api/v1/integrations/${INTEGRATION}/achieve`, { data: { goal: 'list channels' } });
      expect(read.status()).toBe(200);
      const readBody = (await read.json()) as { outcome: string; actionName: string; result: { code?: string } };
      expect(readBody.outcome).toBe('executed');
      expect(readBody.actionName).toBe(READ_ACTION);
      expect(readBody.result.code).toBe('not_connected');

      // ---------------------------------------------------------------------------------------
      // 6. REVOKE, and the gate is back. Leaves the estate as it was found.
      // ---------------------------------------------------------------------------------------
      await card.getByTestId(`action-approval-revoke-${WRITE_ACTION}`).click();
      await expect(card.getByTestId(`action-approval-authorise-${WRITE_ACTION}`)).toBeVisible({ timeout: 15_000 });
      const gatedAgain = await agent.post(`/api/v1/integrations/${INTEGRATION}/achieve`, { data: { goal: 'send message' } });
      expect(gatedAgain.status()).toBe(403);
    } finally {
      await agent.dispose();
      await revokeKeyThroughTheUi(page, label);
    }

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});

/** The approval fingerprint, read off the capability view the agent is entitled to — so the
 *  self-approval attempt above uses a REAL shape and is refused at ADMISSION rather than for
 *  carrying a wrong token. A 401 for the wrong reason would prove nothing. */
async function shapeFor(agent: APIRequestContext): Promise<string> {
  const res = await agent.get(`/api/v1/integrations/${INTEGRATION}`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { actions: Array<{ actionName: string; shape: string }> };
  return body.actions.find((a) => a.actionName === WRITE_ACTION)?.shape ?? '';
}
