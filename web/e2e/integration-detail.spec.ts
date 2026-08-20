import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * integration-detail - `/integrations/[key]`, slice S2, driven the way a person reaches it.
 *
 * WHAT THIS SPEC IS FOR, and why the vitest suites next to it do not replace it. The store and the
 * page are covered hermetically (`web/__tests__/integration-detail-store.test.ts` and
 * `web/__tests__/components/integration-detail-page.test.tsx`) with the typed client mocked - which
 * proves the RENDERING RULES and proves nothing about the three things only a live boot can answer:
 * that the list card's anchor actually routes here, that the four reads this page fires reach real
 * endpoints that answer (a 404 on `GET /integrations/:key/evidence` renders as an error row and
 * every unit case would still be green), and that the dashboard stays free of console errors while
 * it does. The commit that landed S2 said no spec was written; this is that spec.
 *
 * THE PACKAGE. `slack` is a SHIPPED baseline package - it resolves for every user with no
 * connection and no seeding, and it carries both action shapes this page renders differently: a
 * read (`list_channels`) and a `mutates` write (`send_message`), so the consent chip and the
 * withheld run-now control are both exercised on real server answers rather than on a fixture's
 * idea of them. Same package `integration-achieve.spec.ts` uses, for the same reason.
 *
 * HERMETIC AND LLM-FREE. Every path below is a READ. Nothing here clicks run-now: executing a
 * Slack action would need a credential and would reach an outside system, and what this spec is
 * for is the page, not the executor - which has its own contract suite. Re-runnable by
 * construction: it writes nothing.
 */

const INTEGRATION = 'slack';
const READ_ACTION = 'list_channels';
const WRITE_ACTION = 'send_message';

async function login(page: Page) {
  await uiLogin(page);
}

/** Console errors are a first-class assertion on this estate; the URL-less next-dev asset noise is
 *  the one documented exclusion (see `integration-achieve.spec.ts`). */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() !== 'error') return;
    if (text.includes('Failed to load resource')) return;
    errors.push(text);
  });
  return errors;
}

test.describe('the integration detail page', () => {
  test('the list card routes here, the actions render, and a steps view opens', async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    await login(page);

    // --- FROM THE LIST, THROUGH THE REAL ANCHOR ------------------------------------------------
    await page.goto('/integrations?tab=plataforma');
    await expect(page.getByTestId('platform-integrations-section')).toBeVisible({ timeout: 30_000 });
    const open = page.getByTestId(`integration-open-detail-${INTEGRATION}`);
    await expect(open).toBeVisible({ timeout: 15_000 });
    // A real anchor: it carries the href it navigates to, rather than a click handler on a div.
    await expect(open).toHaveAttribute('href', `/integrations/${INTEGRATION}`);
    await open.click();

    // --- THE PAGE ------------------------------------------------------------------------------
    await expect(page).toHaveURL(new RegExp(`/integrations/${INTEGRATION}$`));
    await expect(page.getByTestId('integration-detail-page')).toBeVisible({ timeout: 30_000 });
    // The capability read answered: a real header, and NOT the not-found or failed-to-load state.
    await expect(page.getByTestId('integration-detail-connected')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('integration-detail-load-error')).toHaveCount(0);
    await expect(page.getByText('Integração não encontrada')).toHaveCount(0);

    // --- THE ACTIONS LIST, both shapes ---------------------------------------------------------
    const readRow = page.getByTestId(`integration-action-${READ_ACTION}`);
    const writeRow = page.getByTestId(`integration-action-${WRITE_ACTION}`);
    await expect(readRow).toBeVisible({ timeout: 15_000 });
    await expect(writeRow).toBeVisible();
    // The consent chip comes off the SERVER's own capability row; the read and the write must not
    // read the same, or the page is not reporting the write gate at all.
    await expect(readRow.getByTestId(`integration-action-consent-${READ_ACTION}`)).toContainText('Apenas leitura');
    await expect(writeRow.getByTestId(`integration-action-consent-${WRITE_ACTION}`)).toContainText('Escrita');

    // --- ONE ACTION, OPENED --------------------------------------------------------------------
    const toggle = readRow.getByTestId(`integration-action-toggle-${READ_ACTION}`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // The steps view of an api-call action is its declared request template, off the definition.
    await expect(readRow.getByText('O que faz')).toBeVisible({ timeout: 15_000 });
    await expect(readRow.getByText('Pedido', { exact: true })).toBeVisible();
    await expect(readRow.getByText(/slack\.com/).first()).toBeVisible();

    // --- AND EVERY FETCHING SECTION SETTLES ----------------------------------------------------
    // The point of this assertion is that these reads REACHED something. An endpoint answering 404
    // would render the error row; one never answering would leave the spinner copy on screen, and
    // both are invisible to a suite with a mocked client.
    const evidence = readRow.getByTestId(`integration-action-evidence-${READ_ACTION}`);
    await expect(evidence).toBeVisible();
    await expect(evidence).not.toContainText('A carregar a última execução', { timeout: 20_000 });
    await expect(evidence.getByTestId('integration-detail-section-error')).toHaveCount(0);

    const schedules = readRow.getByTestId(`integration-action-schedules-${READ_ACTION}`);
    await expect(schedules).toBeVisible();
    await expect(schedules.getByTestId('integration-detail-section-error')).toHaveCount(0);

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('?action= lands on the action it names', async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    await login(page);

    await page.goto(`/integrations/${INTEGRATION}?action=${WRITE_ACTION}`);
    await expect(page.getByTestId('integration-detail-page')).toBeVisible({ timeout: 30_000 });

    // The linked action is open on arrival, and it is the only one that is - which is what makes a
    // schedule row's link, and the run-now failure toast's action, land somewhere useful.
    await expect(page.getByTestId(`integration-action-toggle-${WRITE_ACTION}`))
      .toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
    await expect(page.getByTestId(`integration-action-toggle-${READ_ACTION}`))
      .toHaveAttribute('aria-expanded', 'false');

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
