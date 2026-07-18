import { test, expect, type Page } from '@playwright/test';

/**
 * OS Mode Run 1 - the six exit-gate scenarios (docs/os-mode/surface-contract.md).
 * The OS scenarios need a web build with NEXT_PUBLIC_OS_MODE=1; when the flag
 * is off the doorway is absent and those tests skip cleanly (the ledger's
 * skip-clean precedent for environment-gated specs). Classic-mode scenarios
 * (3-classic, 6) run regardless of the flag.
 */

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Zero console errors on dashboard/OS pages (asset noise filtered). */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource|favicon/.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function enterOsMode(page: Page): Promise<boolean> {
  const doorway = page.getByTestId('os-mode-doorway');
  if ((await doorway.count()) === 0) return false;
  await doorway.click();
  await page.waitForURL(/\/os/, { timeout: 30_000 });
  await expect(page.getByTestId('os-shell')).toBeVisible({ timeout: 30_000 });
  // Desktop seeding needs the artifact list.
  await expect(page.getByTestId('os-icon-surface-artifacts')).toBeVisible({ timeout: 30_000 });
  return true;
}

/** A desktop artifact icon that is not covered by an open window (right side). */
async function rightSideArtifactIcon(page: Page) {
  const layer = await page.getByTestId('os-window-layer').boundingBox();
  const icons = page.locator('[data-testid^=os-icon-artifact-]');
  const n = await icons.count();
  for (let i = 0; i < n; i++) {
    const bb = await icons.nth(i).boundingBox();
    if (bb && layer && bb.x > layer.x + layer.width * 0.55) return icons.nth(i);
  }
  return icons.last();
}

test.describe('OS mode - run 1 exit scenarios', () => {
  test('S1: artifact window + docked chat panel side by side; both resize', async ({ page }) => {
    const errors = watchConsole(page);
    await login(page);
    test.skip(!(await enterOsMode(page)), 'NEXT_PUBLIC_OS_MODE off in this build');

    // The docked chat panel is open by default (OS prefs).
    const chatDock = page.getByTestId('global-chat-dock');
    await expect(chatDock).toBeVisible();

    // Open an artifact into a window (desktop icon path; the chat dock's
    // "Abrir em janela" drives the same host.openSurface seam).
    const icon = await rightSideArtifactIcon(page);
    await icon.locator('button').first().click();
    const win = page.getByTestId('os-window-artifact-app');
    await expect(win).toBeVisible({ timeout: 20_000 });

    // Side by side: the window lives left of the docked panel.
    const winBox = (await win.boundingBox())!;
    const dockBox = (await chatDock.boundingBox())!;
    expect(winBox.x + winBox.width).toBeLessThanOrEqual(dockBox.x + 40);

    // Resize the window (corner handle).
    await win.locator('[data-resize-handle=se]').hover();
    await page.mouse.down();
    await page.mouse.move(winBox.x + winBox.width - 120, winBox.y + winBox.height - 90, { steps: 6 });
    await page.mouse.up();
    const winAfter = (await win.boundingBox())!;
    expect(winAfter.width).toBeLessThan(winBox.width - 60);

    // Resize the docked panel (left-edge handle).
    const handle = chatDock.locator('[role=separator]');
    const hb = (await handle.boundingBox())!;
    await page.mouse.move(hb.x + 1, hb.y + 200);
    await page.mouse.down();
    await page.mouse.move(hb.x - 80, hb.y + 200, { steps: 6 });
    await page.mouse.up();
    const dockAfter = (await chatDock.boundingBox())!;
    expect(dockAfter.width).toBeGreaterThan(dockBox.width + 40);

    expect(errors).toHaveLength(0);
  });

  test('S2: half/half edge snaps, divider rearrange, reload restores the workspace layout', async ({ page }) => {
    const errors = watchConsole(page);
    await login(page);
    test.skip(!(await enterOsMode(page)), 'NEXT_PUBLIC_OS_MODE off in this build');

    const layer = (await page.getByTestId('os-window-layer').boundingBox())!;
    const halfW = Math.round((layer.width - 6) / 2);

    // Window 1: the artifacts surface; snap LEFT -> takes exactly half.
    await page.getByTestId('os-icon-surface-artifacts').locator('button').first().click();
    const w1 = page.getByTestId('os-window-artifacts');
    await expect(w1).toBeVisible({ timeout: 20_000 });
    let tb = (await w1.locator('[data-window-titlebar]').boundingBox())!;
    await page.mouse.move(tb.x + 150, tb.y + 15);
    await page.mouse.down();
    await page.mouse.move(layer.x + 8, layer.y + 300, { steps: 10 });
    await expect(page.getByTestId('os-snap-preview')).toBeVisible();
    await page.mouse.up();
    await expect
      .poll(async () => (await w1.boundingBox())!.width, { timeout: 5_000 })
      .toBeLessThan(halfW + 5);

    // Window 2: an artifact app; snap RIGHT -> fills the empty half.
    const icon = await rightSideArtifactIcon(page);
    await icon.locator('button').first().click();
    const w2 = page.getByTestId('os-window-artifact-app');
    await expect(w2).toBeVisible({ timeout: 20_000 });
    tb = (await w2.locator('[data-window-titlebar]').boundingBox())!;
    await page.mouse.move(tb.x + 120, tb.y + 15);
    await page.mouse.down();
    await page.mouse.move(layer.x + layer.width - 8, layer.y + 300, { steps: 10 });
    await page.mouse.up();

    const b1 = (await w1.boundingBox())!;
    const b2 = (await w2.boundingBox())!;
    expect(Math.abs(b1.width - halfW)).toBeLessThan(6);
    expect(Math.abs(b2.width - halfW)).toBeLessThan(6);
    expect(b2.x).toBeGreaterThan(b1.x);

    // Rearrange: drag the divider so the left window takes ~70%.
    const divider = page.locator('[data-testid^=os-divider-]').first();
    await expect(divider).toBeVisible();
    const db = (await divider.boundingBox())!;
    await page.mouse.move(db.x + 2, db.y + 260);
    await page.mouse.down();
    await page.mouse.move(layer.x + layer.width * 0.7, db.y + 260, { steps: 8 });
    await page.mouse.up();
    const b1b = (await w1.boundingBox())!;
    expect(b1b.width).toBeGreaterThan(b1.width + 80);

    // Reload: the tiled layout is restored within the workspace.
    await page.reload();
    await expect(page.getByTestId('os-window-artifacts')).toBeVisible({ timeout: 30_000 });
    const r1 = (await page.getByTestId('os-window-artifacts').boundingBox())!;
    const r2 = (await page.getByTestId('os-window-artifact-app').boundingBox())!;
    expect(Math.abs(r1.width - b1b.width)).toBeLessThan(10);
    expect(r2.x).toBeGreaterThan(r1.x);

    expect(errors).toHaveLength(0);
  });

  test('S3: rename + duplicate via "..." in classic and right-click in OS - same menu, same persisted result', async ({ page }) => {
    const errors = watchConsole(page);
    await login(page);

    // CLASSIC: duplicate an artifact via the always-visible "..." menu.
    await page.goto('/artifacts');
    const firstCard = page
      .locator('div.group', { has: page.locator('[data-testid^=artifact-use-]') })
      .first();
    await expect(firstCard).toBeVisible({ timeout: 30_000 });
    const cardsBefore = await page.locator('[data-testid^=artifact-use-]').count();
    await firstCard.locator('[aria-label="Mais ações"]').click();
    await page.locator('[role=menuitem]', { hasText: 'Duplicar' }).click();
    await expect
      .poll(async () => page.locator('[data-testid^=artifact-use-]').count(), { timeout: 20_000 })
      .toBe(cardsBefore + 1);

    // Rename the copy (sorted first under "Recentes") through the same menu.
    const copyCard = page
      .locator('div.group', { has: page.locator('[data-testid^=artifact-use-]') })
      .first();
    await copyCard.locator('[aria-label="Mais ações"]').click();
    await page.locator('[role=menuitem]', { hasText: 'Mudar o nome' }).click();
    const input = page.locator('input:focus');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('Cenario3 Renomeado');
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.locator('h3', { hasText: 'Cenario3 Renomeado' }).first()).toBeVisible({
      timeout: 20_000,
    });

    // OS MODE: the SAME item menu via right-click on the desktop icon.
    if (await enterOsMode(page)) {
      const osIcon = page
        .locator('[data-testid^=os-icon-artifact-]', { hasText: 'Cenario3 Renomeado' })
        .first();
      await expect(osIcon).toBeVisible({ timeout: 20_000 });
      await osIcon.locator('button').first().click({ button: 'right' });
      await page.locator('[role=menuitem]', { hasText: 'Mudar o nome' }).click();
      const osInput = page.locator('input:focus');
      await expect(osInput).toBeVisible({ timeout: 10_000 });
      await osInput.fill('Cenario3 OS');
      await page.getByRole('button', { name: 'Guardar' }).click();
      await expect(
        page.locator('[data-testid^=os-icon-artifact-]', { hasText: 'Cenario3 OS' }).first(),
      ).toBeVisible({ timeout: 20_000 });

      // Cleanup through the same menu: delete the copy (destructive, confirmed).
      const renamedIcon = page
        .locator('[data-testid^=os-icon-artifact-]', { hasText: 'Cenario3 OS' })
        .first();
      await renamedIcon.locator('button').first().click({ button: 'right' });
      await page.locator('[role=menuitem]', { hasText: 'Eliminar' }).click();
      await page.getByRole('button', { name: 'Eliminar' }).last().click();
      await expect(
        page.locator('[data-testid^=os-icon-artifact-]', { hasText: 'Cenario3 OS' }),
      ).toHaveCount(0, { timeout: 20_000 });
    } else {
      // Flag off: clean up the copy through the classic delete dialog instead.
      const renamed = page
        .locator('div.group', { has: page.locator('h3', { hasText: 'Cenario3 Renomeado' }) })
        .first();
      await renamed.locator('[aria-label="Mais ações"]').click();
      await page.locator('[role=menuitem]', { hasText: 'Eliminar' }).click();
      await page.getByRole('button', { name: 'Eliminar' }).last().click();
    }

    expect(errors).toHaveLength(0);
  });

  test('S4: dock pin + second workspace - layouts are independent', async ({ page }) => {
    const errors = watchConsole(page);
    await login(page);
    test.skip(!(await enterOsMode(page)), 'NEXT_PUBLIC_OS_MODE off in this build');

    // Pin an artifact to the dock via its icon menu.
    const icon = await rightSideArtifactIcon(page);
    const dockPinsBefore = await page.locator('[data-testid^=os-dock-pin-]').count();
    await icon.locator('button').first().click({ button: 'right' });
    await page.locator('[role=menuitem]', { hasText: 'Afixar na Dock' }).click();
    await expect
      .poll(async () => page.locator('[data-testid^=os-dock-pin-]').count())
      .toBe(dockPinsBefore + 1);

    // Open a window in workspace 1.
    await page.getByTestId('os-icon-surface-artifacts').locator('button').first().click();
    await expect(page.getByTestId('os-window-artifacts')).toBeVisible({ timeout: 20_000 });

    // Create + switch to workspace 2: no windows, only the default pin.
    await page.getByRole('button', { name: 'Novo ecrã' }).click();
    await expect(page.getByTestId('os-window-artifacts')).toHaveCount(0);
    await expect
      .poll(async () => page.locator('[data-testid^=os-dock-pin-]').count())
      .toBe(1);

    // Switch back: workspace 1's layout and pins are intact.
    await page.locator('[data-testid^=os-workspace-]:not([data-testid=os-workspace-switcher])').first().click();
    await expect(page.getByTestId('os-window-artifacts')).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => page.locator('[data-testid^=os-dock-pin-]').count())
      .toBe(dockPinsBefore + 1);

    expect(errors).toHaveLength(0);
  });

  test('S5: narrow viewport degrades to full-screen surfaces; actions stay reachable via "..."', async ({ page }) => {
    const errors = watchConsole(page);
    await login(page);
    test.skip(!(await enterOsMode(page)), 'NEXT_PUBLIC_OS_MODE off in this build');

    await page.setViewportSize({ width: 480, height: 800 });

    // Desktop icons keep the always-visible "..." affordance; it opens the menu.
    const icon = page.locator('[data-testid^=os-icon-artifact-]').first();
    await icon.locator('[aria-label="Mais ações"]').click();
    await expect(page.locator('[role=menuitem]').first()).toBeVisible();
    await page.keyboard.press('Escape');

    // Opening a surface renders it FULL-SCREEN (no window chrome); the dock
    // below is the switcher.
    await page.getByTestId('os-icon-surface-artifacts').locator('button').first().click();
    await expect(page.getByTestId('os-fullscreen-artifacts')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid^=os-window-]')).toHaveCount(0);
    await expect(page.getByTestId('os-dock')).toBeVisible();

    expect(errors).toHaveLength(0);
  });

  test('S6: classic regression - chat and artifacts behave as before; the dock is the only addition', async ({ page }) => {
    const errors = watchConsole(page);
    await login(page);

    // /chat: NO global dock (the page IS the chat) and the composer renders.
    await expect(page.getByTestId('global-chat-dock')).toHaveCount(0);
    await expect(page.getByTestId('global-chat-dock-tab')).toHaveCount(0);
    await expect(page.locator('textarea').first()).toBeVisible({ timeout: 30_000 });

    // /artifacts: cards render; the collapsed dock tab is the only addition.
    await page.goto('/artifacts');
    await expect(
      page.locator('[data-testid^=artifact-use-]').first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('global-chat-dock-tab')).toBeVisible();

    // Expand + collapse the dock: a pure addition, nothing else shifts.
    await page.getByTestId('global-chat-dock-tab').click();
    await expect(page.getByTestId('global-chat-dock')).toBeVisible();
    await page.getByRole('button', { name: /Ocultar o painel/ }).click();
    await expect(page.getByTestId('global-chat-dock-tab')).toBeVisible();

    expect(errors).toHaveLength(0);
  });
});
