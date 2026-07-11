import { test, expect, type Page } from '@playwright/test';
import { BridgeStatusResponse } from '@ekoa/shared';

/**
 * Bridge presence wiring (run s2; FC-401 states, FC-405) — deterministic, daemon-free.
 *
 * `use-bridge-presence` polls GET /api/v1/bridge/status (registry truth, D1) and the four
 * consumers light up with no change to their own code. This spec drives the settings
 * privacy surface through the three states with a schema-validated stub of the status
 * endpoint (the QA rule: no protocol stubs except schema-validated ones) and asserts the
 * FC-405 badge renders each state's PT-PT label. Real UI login, zero console errors.
 */

const STATES = {
  notInstalled: { paired: false, live: false },
  offline: { paired: true, live: false, pairingId: 'pair-e2e' },
  connected: { paired: true, live: true, pairingId: 'pair-e2e', lastSeenAt: '2026-07-11T06:00:00.000Z' },
} as const;

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
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Once presence reads 'connected' (this spec's stub), the s4 grants/ledger sections
    // fetch the daemon loopback surface — absent here by design, so the resulting
    // connection-refused/404 resource errors are EXPECTED stimuli of the honest
    // unavailable states, not defects.
    if (text.includes('ERR_CONNECTION_REFUSED') || text.includes('Failed to fetch') || text.includes('status of 404')) return;
    errors.push(text);
  });
  return errors;
}

test.describe('bridge presence (FC-401/FC-405)', () => {
  test('the three registry states render honestly in the privacy surface', async ({ page }) => {
    const errors = trackConsoleErrors(page);

    for (const s of Object.values(STATES)) {
      expect(BridgeStatusResponse.safeParse(s).success, 'stub validates against the shared schema').toBe(true);
    }

    let state: keyof typeof STATES = 'notInstalled';
    await page.route('**/api/v1/bridge/status', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(STATES[state]) }),
    );

    await login(page);
    await page.goto('/settings/privacy');

    const section = page.getByTestId('privacy-bridge-status');
    await expect(section).toBeVisible();
    await expect(section.getByText('Ponte não emparelhada')).toBeVisible();

    // FC-405 install/download section (owner directive 2026-07-11): non-technical double-click
    // installers per OS, plus a collapsible advanced terminal fallback. Renders regardless of
    // bridge state.
    const install = page.getByTestId('privacy-bridge-install');
    await expect(install).toBeVisible();
    await expect(install.getByTestId('bridge-os-toggle')).toBeVisible();
    // Mac installer (select explicitly so the assertion is UA-independent).
    await install.getByTestId('bridge-os-mac').click();
    const macDl = install.getByTestId('bridge-download-mac');
    await expect(macDl).toBeVisible();
    await expect(macDl).toHaveAttribute('href', /Instalar-Ponte-Ekoa-Mac\.zip$/);
    // Windows installer.
    await install.getByTestId('bridge-os-windows').click();
    const winDl = install.getByTestId('bridge-download-win');
    await expect(winDl).toBeVisible();
    await expect(winDl).toHaveAttribute('href', /Windows\.bat$/);
    await expect(install.getByTestId('bridge-install-steps').locator('li')).toHaveCount(4);
    // Advanced (terminal) fallback still offered, inside a collapsed <details>.
    await install.getByTestId('bridge-advanced').locator('summary').click();
    await expect(install.getByTestId('bridge-install-command')).toContainText('curl -fsSL');
    await expect(install.getByTestId('bridge-download')).toHaveAttribute('href', /ekoa-bridge.*\.tgz$/);

    // Paired but offline — the poll picks the change up without a reload. The budget is
    // deliberately > 2 poll cycles (12 s each): the flip can land just after a poll fired.
    state = 'offline';
    await expect(section.getByText('Ponte offline', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(section.getByText('A ponte está emparelhada mas não responde neste momento.')).toBeVisible();

    // Connected.
    state = 'connected';
    await expect(section.getByText('Ponte ligada', { exact: true })).toBeVisible({ timeout: 30_000 });

    expect(errors, `zero console errors, got: ${errors.join(' | ')}`).toEqual([]);
  });
});
