import { test, expect, type Page } from '@playwright/test';

/**
 * integration-session-automations — the browser-session connect flow and the
 * integration-provisioned automations, driven end-to-end on the CITIUS card:
 *
 *   (a) the SessionConnectPanel renders on the CITIUS card in the Plataforma
 *       tab — either the "open login window" button (capture available, local
 *       dev) or the "connect from your local Ekoa" guidance (production). The
 *       spec NEVER clicks connect: that opens a real headed window against the
 *       Portal dos Mandatários.
 *   (b) expanding the card's actions block shows one "Automação" tag per
 *       automation-bound action; "Criar automações" provisions the 4 CITIUS
 *       automations (idempotent — on re-runs the button is gone and the rows
 *       already carry names + "Refinar passos" links to /automations/<id>).
 *   (c) /automations lists the 4 materialized automations with the
 *       "Gerida pela integração citius" chip; opening one shows the managed
 *       banner + backlink while the step cards stay fully editable.
 *   (d) session-status sanity via the UI: the captured=false path renders
 *       (no "Sessão ativa desde" row) since no session is captured here.
 *
 * Drives the real dev servers (admin / tmp12345, no stubs). baseURL comes from
 * the Playwright config (../app.port). Re-runnable: provisioning is idempotent
 * (deterministic ids citius-<template>-<owner>) and nothing here is deleted.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

function citiusCard(page: Page) {
  return page
    .getByTestId('platform-integrations-section')
    .locator('div.rounded-xl')
    .filter({ hasText: 'CITIUS / eTribunal' })
    .first();
}

test.describe('integration session automations — CITIUS', () => {
  test('session panel renders (not captured) and provisioning materializes the 4 automations', async ({ page }) => {
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
    // "Automação" tag (consulta_publica_distribuicao has none).
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
    await expect(card.getByText('Automação', { exact: true })).toHaveCount(4);

    // Provision if this environment has not yet (idempotent on re-runs).
    const createBtn = card.getByRole('button', { name: 'Criar automações' });
    if (await createBtn.isVisible().catch(() => false)) {
      await createBtn.click();
    }

    // Provisioned state: the 4 rows show the automation name plus the
    // "Refinar passos" link to the materialized automation.
    const refineLinks = card.locator('a[href^="/automations/citius-"]');
    await expect(refineLinks).toHaveCount(4, { timeout: 20_000 });
    for (const link of await refineLinks.all()) {
      await expect(link).toHaveText('Refinar passos');
    }
    await expect(card.getByText('Automação por criar')).toHaveCount(0);
    await expect(card.getByText('consultar notificações')).toBeVisible();
  });

  test('automations list shows the managed chip; editor shows banner + backlink with editable steps', async ({ page }) => {
    await login(page);
    await page.goto('/automations');
    await expect(page.getByTestId('automations-page')).toBeVisible({ timeout: 15_000 });

    // (c) The 4 CITIUS automations exist, each with the managed chip.
    const citiusChips = page
      .getByTestId('automation-managed-chip')
      .filter({ hasText: 'Gerida pela integração citius' });
    await expect(citiusChips).toHaveCount(4, { timeout: 15_000 });

    for (const name of [
      'consultar notificações',
      'consultar processo',
      'documentos de um processo',
      'submeter peça',
    ]) {
      await expect(
        page.locator('div.cursor-pointer').filter({ hasText: name }).first(),
      ).toBeVisible();
    }

    // Open the notificações automation: managed banner + backlink render, and
    // the step cards stay editable (drag handles + click-to-edit description).
    await page
      .locator('div.cursor-pointer')
      .filter({ hasText: 'consultar notificações' })
      .first()
      .click();
    await expect(page.getByTestId('automation-editor-page')).toBeVisible({ timeout: 15_000 });

    const banner = page.getByTestId('automation-managed-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('citius');
    await expect(banner.getByRole('link', { name: 'Abrir integrações' })).toHaveAttribute(
      'href',
      '/integrations?tab=plataforma',
    );

    // Step cards render with editing affordances; open the first description
    // editor and cancel with Escape (no data is mutated).
    const dragHandles = page.getByRole('button', { name: 'Arrastar passo' });
    await expect(dragHandles.first()).toBeVisible({ timeout: 15_000 });
    expect(await dragHandles.count()).toBeGreaterThanOrEqual(5);

    const description = page.getByLabel('Descrição do passo').first();
    await description.click();
    const editorField = page.locator('textarea[aria-label="Descrição do passo"]').first();
    await expect(editorField).toBeVisible();
    await editorField.press('Escape');
    await expect(editorField).toHaveCount(0);
  });
});
