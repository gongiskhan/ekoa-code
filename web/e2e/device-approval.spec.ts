import { test, expect, type Page } from '@playwright/test';
import { DeviceStartResponse, DevicePollResponse } from '@ekoa/shared';

/**
 * Device approval page (run s3; D5) — REAL end-to-end, no protocol stubs: the spec
 * starts a genuine device flow against the live API (the same call the ekoa-bridge
 * CLI's `pair` makes), approves it through the real UI at /settings/devices, and
 * then polls until the flow reports approved with a minted token. The deny path and
 * the invalid-code path are exercised the same way. Real UI login, zero console errors.
 */

const API = process.env.EKOA_API_URL ?? 'http://localhost:4111';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

function trackConsoleErrors(page: Page, opts: { allow?: (text: string, url: string) => boolean } = {}): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = msg.location()?.url ?? '';
    if (opts.allow?.(msg.text(), url)) return;
    errors.push(msg.text());
  });
  return errors;
}

async function startDeviceFlow(page: Page): Promise<{ deviceCode: string; userCode: string }> {
  const res = await page.request.post(`${API}/api/v1/auth/device`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as unknown;
  const parsed = DeviceStartResponse.safeParse(body);
  expect(parsed.success, 'device start answers the shared schema').toBe(true);
  if (!parsed.success) throw new Error('unreachable');
  return { deviceCode: parsed.data.deviceCode, userCode: parsed.data.userCode };
}

async function pollDevice(page: Page, deviceCode: string): Promise<DevicePollResponse> {
  const res = await page.request.post(`${API}/api/v1/auth/device/poll`, { data: { deviceCode } });
  const body = (await res.json()) as unknown;
  const parsed = DevicePollResponse.safeParse(body);
  expect(parsed.success, 'device poll answers the shared schema').toBe(true);
  if (!parsed.success) throw new Error('unreachable');
  return parsed.data;
}

test.describe('device approval (/settings/devices)', () => {
  test('approve: a real device flow started via the API is approved through the UI and mints a token', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    const { deviceCode, userCode } = await startDeviceFlow(page);

    await page.goto('/settings/devices');
    await expect(page.getByTestId('settings-devices-page')).toBeVisible();

    // Paste raw lowercase without the hyphen — the input normalizes to XXXX-XXXX.
    await page.getByTestId('device-code-input').fill(userCode.toLowerCase().replace('-', ''));
    await expect(page.getByTestId('device-code-input')).toHaveValue(userCode);

    await page.getByTestId('device-approve').click();
    await expect(page.getByTestId('device-outcome-approved')).toBeVisible();

    const poll = await pollDevice(page, deviceCode);
    expect(poll.status).toBe('approved');
    if (poll.status === 'approved') {
      expect(poll.token.length).toBeGreaterThan(10);
    }

    expect(errors, `zero console errors, got: ${errors.join(' | ')}`).toEqual([]);
  });

  test('deny: the device flow reports denied and no token is minted', async ({ page }) => {
    const errors = trackConsoleErrors(page);
    await login(page);

    const { deviceCode, userCode } = await startDeviceFlow(page);

    await page.goto('/settings/devices');
    await page.getByTestId('device-code-input').fill(userCode);
    await page.getByTestId('device-deny').click();
    await expect(page.getByTestId('device-outcome-denied')).toBeVisible();

    const poll = await pollDevice(page, deviceCode);
    expect(poll.status).toBe('denied');

    expect(errors, `zero console errors, got: ${errors.join(' | ')}`).toEqual([]);
  });

  test('an invalid code shows the honest error and approves nothing', async ({ page }) => {
    // The invalid code legitimately answers 404 (the honest NOT_FOUND envelope); Chrome
    // logs every 4xx resource load as a console error. Allow exactly that one.
    const errors = trackConsoleErrors(page, {
      allow: (text, url) => text.includes('404') && url.includes('/api/v1/auth/device/approve'),
    });
    await login(page);

    await page.goto('/settings/devices');
    await page.getByTestId('device-code-input').fill('XXXX-XXXX');
    await page.getByTestId('device-approve').click();
    await expect(page.getByTestId('device-outcome-error')).toBeVisible();
    await expect(page.getByText('Código de dispositivo inválido ou expirado.')).toBeVisible();

    expect(errors, `zero console errors, got: ${errors.join(' | ')}`).toEqual([]);
  });
});
