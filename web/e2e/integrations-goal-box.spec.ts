import { test, expect, type Page } from '@playwright/test';
import { uiLogin } from './helpers/ui-login';

/**
 * integrations-goal-box — the free-text door (cornerstone K5, D-CORNERSTONE-DOORS).
 *
 * "Minhas Integrações" carries a goal box: describe what to do on an outside site, and the
 * platform plans the step sequence and (mint-on-plan, K1) turns it into a per-site integration.
 * This spec pins the AFFORDANCE deterministically - presence, placement above the grid/empty
 * state, the disabled/enabled submit transition, and zero console errors. The full plan->mint->
 * detail-page flow needs a live model egress and belongs to the acceptance run, not this lane.
 *
 * Drives the real dev servers (admin / tmp12345, no stubs).
 */

async function gotoMinhas(page: Page) {
  await page.goto('/integrations?tab=minhas');
  await expect(page.getByTestId('my-integrations-section')).toBeVisible({ timeout: 15_000 });
}

test.describe('integrations — the free-text goal box', () => {
  test('renders in Minhas above the content, and the submit arms only with a goal', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await uiLogin(page);
    await gotoMinhas(page);

    const box = page.getByTestId('automate-goal-box');
    await expect(box).toBeVisible();
    await expect(box).toContainText('Automatizar um site');

    // The box sits ABOVE the grid / empty state inside the tabpanel (the first affordance).
    const section = page.getByTestId('my-integrations-section');
    const first = section.locator('[data-testid="automate-goal-box"], [data-testid="my-integrations-empty"]').first();
    await expect(first).toHaveAttribute('data-testid', 'automate-goal-box');

    // Empty goal -> submit disabled; typing arms it; clearing disarms it again.
    const submit = page.getByTestId('automate-goal-submit');
    await expect(submit).toBeDisabled();
    await page.getByTestId('automate-goal-input').fill('listar as notificações pendentes no portal');
    await expect(submit).toBeEnabled();
    await page.getByTestId('automate-goal-input').fill('');
    await expect(submit).toBeDisabled();

    expect(consoleErrors).toEqual([]);
  });
});
