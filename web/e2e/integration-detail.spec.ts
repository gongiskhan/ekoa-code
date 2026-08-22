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
 * HERMETIC AND LLM-FREE. Nothing here clicks run-now: executing a Slack action would need a
 * credential and would reach an outside system, and what this spec is for is the page, not the
 * executor - which has its own contract suite.
 *
 * ── THE ONE WRITE, AND HOW IT STAYS RE-RUNNABLE (slice S3) ────────────────────────────────────
 *
 * The third test writes a NOTE, which is the only thing this page lets a person write. It is still
 * LLM-free and still reaches no outside system - the note goes to this platform's own store - and
 * it is re-runnable because it ERASES what it wrote through the page's own remove control, and
 * asserts the erasure landed. The note text carries a run-unique marker so a leftover from an
 * interrupted run can never make a later run pass on somebody else's row.
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

  test('a note can be written, is read back, and can be erased again', async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    await login(page);

    // Run-unique, so an interrupted earlier run cannot make this one pass on its leftover row.
    const note = `nota e2e ${Date.now()}`;

    await page.goto(`/integrations/${INTEGRATION}?action=${READ_ACTION}`);
    await expect(page.getByTestId('integration-detail-page')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`integration-action-toggle-${READ_ACTION}`))
      .toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });

    // The notes section is there for an api-call action too: it has no plan to point into, so the
    // ACTION-level box is the whole affordance.
    const notes = page.getByTestId(`integration-action-notes-${READ_ACTION}`);
    await expect(notes).toBeVisible({ timeout: 15_000 });
    // The read REACHED something: a failed one renders the error row and disables the editor, and
    // every unit case would still be green.
    await expect(notes.getByTestId('integration-detail-section-error')).toHaveCount(0);

    // --- WRITE --------------------------------------------------------------------------------
    const edit = notes.getByTestId(`integration-note-edit-${READ_ACTION}`);
    await expect(edit).toBeEnabled({ timeout: 15_000 });
    await edit.click();
    await notes.getByTestId(`integration-note-input-${READ_ACTION}`).fill(note);
    await notes.getByTestId(`integration-note-save-${READ_ACTION}`).click();

    // The text on screen is what the SERVER answered, not what was typed into the box.
    await expect(notes.getByTestId(`integration-note-text-${READ_ACTION}`)).toHaveText(note, { timeout: 15_000 });
    await expect(notes.getByTestId(`integration-note-error-${READ_ACTION}`)).toHaveCount(0);

    // --- IT SURVIVES A RELOAD, which is what proves the write was PERSISTED rather than local ---
    await page.reload();
    await expect(page.getByTestId(`integration-action-toggle-${READ_ACTION}`))
      .toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
    await expect(page.getByTestId(`integration-action-notes-${READ_ACTION}`)
      .getByTestId(`integration-note-text-${READ_ACTION}`)).toHaveText(note, { timeout: 15_000 });

    // --- ERASE, so the estate is left exactly as it was found ---------------------------------
    const after = page.getByTestId(`integration-action-notes-${READ_ACTION}`);
    await after.getByTestId(`integration-note-remove-${READ_ACTION}`).click();
    await expect(after.getByTestId(`integration-note-text-${READ_ACTION}`)).toHaveCount(0, { timeout: 15_000 });

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });

  test('a note about a step that is not in the plan renders as stranded, and can be erased', async ({ page }) => {
    const consoleErrors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/integrations/${INTEGRATION}?action=${READ_ACTION}`);
    await expect(page.getByTestId('integration-detail-page')).toBeVisible({ timeout: 30_000 });

    // THE ORPHAN IS MINTED THROUGH THE API, because the UI deliberately offers no control that
    // creates one: a step note is only offered for a step the CURRENT plan carries. `list_channels`
    // is an api-call action with no plan at all, so any `stepRef` note on it is stranded by
    // construction - which is the exact state the review found unrenderable and unerasable.
    //
    // The token is the app's own, read from where `lib/api/token.ts` puts it, so this writes as the
    // very user the page is rendering for. Nothing here bypasses the product's auth.
    const token = await page.evaluate(() => window.localStorage.getItem('ekoa_token'));
    expect(token, 'the e2e must write as the logged-in user').toBeTruthy();
    const stepRef = `passo-fantasma-${Date.now()}`;
    const apiBase = process.env.EKOA_API_BASE ?? 'http://127.0.0.1:4111';
    const written = await page.request.put(
      `${apiBase}/api/v1/integrations/${INTEGRATION}/actions/${READ_ACTION}/feedback`,
      { headers: { authorization: `Bearer ${token}` }, data: { stepRef, note: 'nota orfa e2e' } },
    );
    expect(written.status(), await written.text()).toBe(200);

    // …and now the PAGE must show it. Before the review round it rendered nowhere.
    await page.reload();
    await expect(page.getByTestId(`integration-action-toggle-${READ_ACTION}`))
      .toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
    const orphan = page.getByTestId(`integration-note-${READ_ACTION}-${stepRef}`);
    await expect(orphan).toBeVisible({ timeout: 15_000 });
    await expect(orphan).toHaveAttribute('data-orphaned', 'true');
    await expect(orphan.getByTestId(`integration-note-text-${READ_ACTION}-${stepRef}`))
      .toHaveText('nota orfa e2e');

    // ERASE IT THROUGH THE PAGE'S OWN CONTROL - the compensating control the findings ledger
    // claimed and did not have. This also leaves the estate as found, so the spec stays re-runnable.
    await orphan.getByTestId(`integration-note-remove-${READ_ACTION}-${stepRef}`).click();
    await expect(page.getByTestId(`integration-note-${READ_ACTION}-${stepRef}`))
      .toHaveCount(0, { timeout: 15_000 });

    expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  });
});
