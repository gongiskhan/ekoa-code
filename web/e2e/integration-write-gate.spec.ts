import { test, expect, type Page } from '@playwright/test';

/**
 * integration-write-gate — the `mutates: true` execution gate on the integrations page (slice C2).
 *
 * RUN_SPEC criterion 6 says a write requires human confirmation before it runs. That is enforced in
 * the api (`executeUserIntegrationAction`), and this spec is the other half of the sentence: the
 * place a human actually gives the confirmation, driven through the real dashboard against the real
 * api — no stubs.
 *
 * Driven on the SLACK card, which ships exactly the two shapes this gate distinguishes:
 *   `send_message`  (`mutates: true`)  -> gated, must be authorised, and the dialog must SAY what
 *                                        it is authorising (integration, action, destination)
 *   `list_channels` (`mutates: false`) -> ungated, and must NOT gain a prompt (Rule 7 additive)
 *
 * The full round trip is asserted, not just the happy click: needs-approval -> dialog states the
 * subject -> approve always -> the chip flips and offers a revoke -> revoke -> back to
 * needs-approval. A dialog that could be dismissed with no persisted effect would pass a
 * click-only test and fail this one, because the state after the reload is read back off the api.
 *
 * Re-runnable: the spec ends by revoking whatever it granted, so a second run starts from the same
 * needs-approval state. Nothing is executed against Slack — approving does not call the
 * integration, it only records the answer.
 */

const CARD_TEXT = 'Slack';
const WRITE_ACTION = 'send_message';
const READ_ACTION = 'list_channels';
/** What the shipped package actually calls — the dialog must say this, not a friendly paraphrase. */
const WRITE_TARGET = 'POST https://slack.com/api/chat.postMessage';

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
    if (text.includes('Failed to load resource')) return; // URL-less next-dev asset noise
    if (msg.type() === 'error') errors.push(text);
  });
  return errors;
}

function trackHttp404s(page: Page): string[] {
  const urls: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404 && !r.url().includes('/_next/') && !r.url().includes('favicon')) urls.push(r.url());
  });
  return urls;
}

function assertClean(errors: string[], notFounds: string[]) {
  const meaningful = errors.filter((e) => !e.includes('favicon') && !e.includes('Download the React DevTools'));
  expect(meaningful, `console errors: ${meaningful.join(' | ')}`).toHaveLength(0);
  expect(notFounds, `HTTP 404s: ${notFounds.join(' | ')}`).toHaveLength(0);
}

function slackCard(page: Page) {
  return page
    .getByTestId('platform-integrations-section')
    .locator('div.rounded-xl')
    .filter({ hasText: CARD_TEXT })
    .first();
}

/** Open the integrations page and expand the Slack card's actions block. */
async function openSlackActions(page: Page) {
  await page.goto('/integrations?tab=plataforma');
  await expect(page.getByTestId('platform-integrations-section')).toBeVisible({ timeout: 15_000 });
  const card = slackCard(page);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'Mostrar mais' }).click();
  await expect(card.getByText(WRITE_ACTION)).toBeVisible({ timeout: 10_000 });
  return card;
}

test.describe('integration write gate — a mutating action needs the owner to say yes', () => {
  test('needs-approval -> the dialog states what will run -> approved -> revoked', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    const notFounds = trackHttp404s(page);
    await login(page);
    const card = await openSlackActions(page);

    const writeState = card.getByTestId(`action-approval-state-${WRITE_ACTION}`);
    const authorise = card.getByTestId(`action-approval-authorise-${WRITE_ACTION}`);

    // If a previous run left an approval standing, clear it so this run starts from the gate.
    if ((await card.getByTestId(`action-approval-revoke-${WRITE_ACTION}`).count()) > 0) {
      await card.getByTestId(`action-approval-revoke-${WRITE_ACTION}`).click();
    }

    // (1) The write is gated, and says so.
    await expect(writeState).toHaveText('Precisa de autorização', { timeout: 10_000 });
    await expect(authorise).toBeVisible();

    // (2) RULE 7: the non-mutating action gains NOTHING. No chip, no prompt, no control.
    await expect(card.getByTestId(`action-approval-state-${READ_ACTION}`)).toHaveCount(0);
    await expect(card.getByTestId(`action-approval-authorise-${READ_ACTION}`)).toHaveCount(0);

    // (3) The dialog names the three facts a human needs to answer. A confirm dialog that does not
    // say what it is confirming is not consent, so each is asserted by content, not by presence.
    await authorise.click();
    const dialog = page.getByTestId('action-consent-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('action-consent-integration')).toHaveText(CARD_TEXT);
    await expect(dialog.getByTestId('action-consent-action')).toContainText(WRITE_ACTION);
    await expect(dialog.getByTestId('action-consent-target')).toHaveText(WRITE_TARGET);
    // The standing consequence is stated BEFORE the buttons, not discovered afterwards.
    await expect(dialog).toContainText('90 dias');

    // (4) Cancelling records nothing.
    await dialog.getByTestId('action-consent-cancel').click();
    await expect(dialog).toHaveCount(0);
    await expect(writeState).toHaveText('Precisa de autorização');

    // (5) Approving always flips the state and offers the way back.
    await authorise.click();
    await page.getByTestId('action-consent-always').click();
    await expect(page.getByTestId('action-consent-dialog')).toHaveCount(0, { timeout: 10_000 });
    await expect(writeState).toHaveText('Autorizada', { timeout: 10_000 });
    await expect(card.getByTestId(`action-approval-revoke-${WRITE_ACTION}`)).toBeVisible();

    // (6) …and it is PERSISTED, not local UI state: reload and read it back off the api.
    const reopened = await openSlackActions(page);
    await expect(reopened.getByTestId(`action-approval-state-${WRITE_ACTION}`)).toHaveText('Autorizada', { timeout: 10_000 });

    // (7) Revoke returns the action to the gate — a 90-day standing permission with no way back
    // would not be a permission a user could meaningfully give.
    await reopened.getByTestId(`action-approval-revoke-${WRITE_ACTION}`).click();
    await expect(reopened.getByTestId(`action-approval-state-${WRITE_ACTION}`)).toHaveText('Precisa de autorização', { timeout: 10_000 });

    assertClean(errors, notFounds);
  });
});
