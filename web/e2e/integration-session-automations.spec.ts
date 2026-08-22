import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * integration-session-automations — the browser-session connect flow and the
 * integration-provisioned step sequences, driven end-to-end on the CITIUS card:
 *
 *   (a) the SessionConnectPanel renders on the CITIUS card in the Plataforma
 *       tab — either the "open login window" button (capture available, local
 *       dev) or the "connect from your local Ekoa" guidance (production). The
 *       spec NEVER clicks connect: that opens a real headed window against the
 *       Portal dos Mandatários.
 *   (b) expanding the card's actions block shows one "Passos" tag per
 *       automation-bound action; "Preparar passos" provisions the 4 CITIUS
 *       sequences (idempotent - on re-runs the button is gone and the rows
 *       already carry names + "Ver passos" links into the integration detail).
 *   (c) that link lands on `/integrations/citius` with the action it names
 *       already open, and its steps render READ-ONLY.
 *   (d) session-status sanity via the UI: the captured=false path renders
 *       (no "Sessão ativa desde" row) since no session is captured here.
 *
 * REWRITTEN AT S8 (2026-08-22), and the second case changed SUBJECT rather than selectors. It used
 * to assert that `/automations` listed the four materialised rows with a "managed by" chip and that
 * opening one gave an EDITABLE step list. Both halves are gone by design: the list is a redirect,
 * the editor no longer exists, and the steps are deliberately read-only wherever they are shown now
 * - the definition and the automation each keep their own save gate, and the detail page shows and
 * links but never writes a step. So the case follows the affordance this slice re-pointed, and
 * asserts the property that replaced editability. Nothing it used to cover is silently dropped: the
 * provisioning half stays in case 1, and the read-only steps view is what case 2 now pins.
 *
 * Drives the real dev servers (admin / tmp12345, no stubs). baseURL comes from
 * the Playwright config (../app.port). Re-runnable: provisioning is idempotent
 * (deterministic ids citius-<template>-<owner>) and nothing here is deleted.
 */

const INTEGRATION = 'citius';
const NOTIFICACOES = 'consultar_notificacoes';

async function login(page: Page) {
  await uiLogin(page);
}

function citiusCard(page: Page) {
  return page
    .getByTestId('platform-integrations-section')
    .locator('div.rounded-xl')
    .filter({ hasText: 'CITIUS / eTribunal' })
    .first();
}

test.describe('integration session automations — CITIUS', () => {
  test('session panel renders (not captured) and provisioning materializes the 4 step sequences', async ({ page }) => {
    await login(page);
    await page.goto('/integrations?tab=plataforma');
    await expect(page.getByTestId('platform-integrations-section')).toBeVisible({ timeout: 15_000 });

    const card = citiusCard(page);
    await expect(card).toBeVisible({ timeout: 15_000 });

    // (a) The session panel mounts (skill.sessionConnect surfaced by
    // list-skills) and settles out of the "checking" state.
    const panel = card.getByTestId('session-connect-panel-citius');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('A verificar a sessão...')).toHaveCount(0, { timeout: 15_000 });

    // One of the two not-captured states renders: the connect button (local
    // dev, capture available) or the guidance + retry (capture unavailable).
    // Never click connect — it opens a real window to the external portal.
    const connectBtn = panel.getByRole('button', { name: 'Abrir janela de início de sessão' });
    const retryBtn = panel.getByRole('button', { name: 'Tentar novamente' });
    await expect(connectBtn.or(retryBtn).first()).toBeVisible({ timeout: 15_000 });

    // (d) captured=false path: no active-session row.
    await expect(panel.getByText(/Sessão ativa desde/)).toHaveCount(0);

    // (b) Expand the actions block: the 4 automation-bound actions carry the
    // "Passos" tag (consulta_publica_distribuicao has none).
    await card.getByRole('button', { name: 'Mostrar mais' }).click();
    for (const actionName of [
      'consultar_notificacoes',
      'consultar_processo',
      'fetch_documentos_processo',
      'submeter_peca',
      'consulta_publica_distribuicao',
    ]) {
      await expect(card.getByText(actionName)).toBeVisible({ timeout: 10_000 });
    }
    await expect(card.getByText('Passos', { exact: true })).toHaveCount(4);

    // Provision if this environment has not yet (idempotent on re-runs).
    const createBtn = card.getByRole('button', { name: 'Preparar passos' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
    }

    // Provisioned state: the 4 rows show the sequence name plus the "Ver passos"
    // link into the integration detail page, deep-linked to that action.
    const stepLinks = card.locator(`a[href^="/integrations/${INTEGRATION}?action="]`);
    await expect(stepLinks).toHaveCount(4, { timeout: 20_000 });
    for (const link of await stepLinks.all()) {
      await expect(link).toHaveText('Ver passos');
    }
    await expect(card.getByText('Passos por preparar')).toHaveCount(0);
    await expect(card.getByText('consultar notificações')).toBeVisible();

    // S8: the affordance no longer points at a page that does not exist.
    await expect(card.locator('a[href^="/automations/"]')).toHaveCount(0);
  });

  test('the steps link lands on the integration detail page with that action open and its steps read-only', async ({ page }) => {
    await login(page);
    await page.goto('/integrations?tab=plataforma');
    await expect(page.getByTestId('platform-integrations-section')).toBeVisible({ timeout: 15_000 });

    const card = citiusCard(page);
    await card.getByRole('button', { name: 'Mostrar mais' }).click();

    // Follow the real anchor for the notificações action rather than typing the URL: what must not
    // regress is that the affordance on the list reaches the steps, not that the route exists.
    const link = card.locator(`a[href="/integrations/${INTEGRATION}?action=${NOTIFICACOES}"]`).first();
    await expect(link).toBeVisible({ timeout: 20_000 });
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/integrations/${INTEGRATION}\\?action=${NOTIFICACOES}$`));
    await expect(page.getByTestId('integration-detail-page')).toBeVisible({ timeout: 30_000 });

    // (c) The named action is open on arrival and its bound sequence's steps are rendered.
    const toggle = page.getByTestId(`integration-action-toggle-${NOTIFICACOES}`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 15_000 });
    const steps = page.locator('[data-testid^="integration-steps-"]').first();
    await expect(steps).toBeVisible({ timeout: 20_000 });

    // READ-ONLY is the property that replaced editability, so it is asserted rather than assumed:
    // none of the editor's affordances exist on this surface.
    await expect(page.getByRole('button', { name: 'Arrastar passo' })).toHaveCount(0);
    await expect(page.getByLabel('Descrição do passo')).toHaveCount(0);
    await expect(page.getByTestId('automation-editor-page')).toHaveCount(0);
  });
});
