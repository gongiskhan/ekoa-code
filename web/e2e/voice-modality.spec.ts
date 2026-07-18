import { test, expect, type Page } from '@playwright/test';

/**
 * Voice modality UI wiring (mega-run C4, BRIEF §5): the capture chain + mic affordance on
 * the unified chat page, against the LIVE boot-b stack (the api ships the stub voice
 * providers, so the WS upgrade + auth + relay are real; no vendor keys involved). A real
 * mic cannot run in headless CI, so getUserMedia is MOCKED to hand back a genuine silent
 * MediaStream - everything downstream (AudioContext at native rate, the pcm-downsample
 * AudioWorklet asset, the authenticated WS dial to /api/voice/stream) is the real chain.
 *
 * Proves (the C4 slice's committed floor - the full manual/talking turn journeys are C7):
 *   1. The mic button renders on the chat composer; a tap opens the capture chain and the
 *      voice bar shows the CAPTURING state (PT-PT) + level meter; a second tap stops it.
 *   2. The secure-context message path: an insecure context renders the mic disabled with
 *      the PT-PT explanation - a message, never a throw.
 *   3. The `ouvir` action appears in the sheet footer (the Part B extensible action list)
 *      and drives the real tts path: tapping flips it to "Parar" while the stub audio
 *      streams and it returns to "Ouvir" when playback drains.
 *   4. Mobile (390x844): while the voice bar is up the fixed FAB stack lifts clear of the
 *      bar's stop button (fix 6) - asserted by disjoint bounding boxes AND by actually
 *      tapping the stop button (an overlap would intercept the pointer) in BOTH manual
 *      capture and the hands-free talking loop.
 *
 * RUNNING: needs `node api/tests/journeys/boot-b.mjs up` (api :4111 + web :3000). Real UI
 * login, PT-PT strings, zero console errors.
 */

const API = 'http://localhost:4111';

const SHEET_BODY =
  'O prazo de contestação é de 30 dias, nos termos do Código de Processo Civil.';

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Console + non-asset 4xx tracking (regressions-dashboard pattern). */
function trackConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  const devAssetNoise = /\/_next\/|hot-update|favicon/;
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (/^Failed to load resource/.test(msg.text())) return;
    errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (r) => {
    if (r.status() < 400 || devAssetNoise.test(r.url())) return;
    // Known OPEN finding (docs/findings.md: login session double-create race).
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return;
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

/** Seed one session with one assistant reply (-> one derived sheet) via the API. */
async function seedSession(page: Page): Promise<string> {
  const loginRes = await page.request.post(`${API}/api/v1/auth/login`, {
    data: { username: 'admin', password: 'tmp12345' },
  });
  expect(loginRes.ok()).toBe(true);
  const { token } = (await loginRes.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };

  // Fresh slate: /chat auto-resumes the latest session; stale ones leave ambiguous cards.
  const listRes = await page.request.get(`${API}/api/v1/sessions`, { headers: auth });
  expect(listRes.ok()).toBe(true);
  const { items: existing } = (await listRes.json()) as { items: Array<{ id: string }> };
  for (const s of existing) {
    await page.request.delete(`${API}/api/v1/sessions/${s.id}`, { headers: auth });
  }

  const createRes = await page.request.post(`${API}/api/v1/sessions`, {
    headers: auth,
    data: { name: 'Voz C4' },
  });
  expect(createRes.status()).toBe(201);
  const { id: sessionId } = (await createRes.json()) as { id: string };
  const msgRes = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
    headers: auth,
    data: { role: 'assistant', content: SHEET_BODY, metadata: { isEssential: true, type: 'text' } },
  });
  expect(msgRes.status()).toBe(201);
  return sessionId;
}

/** Mock getUserMedia with a REAL (silent) MediaStream so the rest of the chain is live. */
async function mockMicrophone(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const fakeGetUserMedia = async () => {
      const ctx = new AudioContext();
      const destination = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.05; // quiet tone: real samples flow through the worklet
      osc.connect(gain);
      gain.connect(destination);
      osc.start();
      return destination.stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: fakeGetUserMedia },
      configurable: true,
    });
  });
}

test.describe('voice modality (C4)', () => {
  test('mic button on the composer opens the capture chain; tap-stop ends it', async ({
    page,
  }) => {
    const sessionId = await seedSession(page);
    await mockMicrophone(page);
    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    // 1. The mic affordance lives on the composer, enabled, with the PT-PT title.
    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    await expect(mic).toBeEnabled();
    await expect(mic).toHaveAttribute('title', /Ditar por voz/);
    await expect(page.getByTestId('voice-bar')).toHaveCount(0); // idle: no status bar

    // 2. Tap -> manual capture: worklet loads, the WS authenticates against the live
    //    relay, and the machine lands in CAPTURING (PT-PT status + level meter visible).
    await mic.click();
    const bar = page.getByTestId('voice-bar');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 15_000 });
    await expect(page.getByTestId('voice-level-meter')).toBeVisible();
    await expect(page.getByTestId('voice-send-now')).toBeVisible(); // the escape hatch
    await expect(mic).toHaveAttribute('data-voice-status', 'capturing');

    // 3. Tap-stop: honest teardown back to idle (bar gone, mic re-armed).
    await mic.click();
    await expect(page.getByTestId('voice-bar')).toHaveCount(0, { timeout: 10_000 });
    await expect(mic).toHaveAttribute('data-voice-status', 'idle');

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('insecure context renders the mic disabled with the PT-PT message', async ({ page }) => {
    const sessionId = await seedSession(page);
    const errors = trackConsoleErrors(page);
    // Force the secure-context gate CLOSED before any app code runs.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'isSecureContext', { get: () => false, configurable: true });
    });
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    await expect(mic).toBeDisabled();
    await expect(page.getByTestId('voice-mic-unavailable')).toHaveAttribute(
      'title',
      'O microfone requer uma ligação segura (HTTPS ou localhost).',
    );
    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('390x844: the FAB stack lifts clear of the voice stop button (capturing AND talking)', async ({
    page,
  }) => {
    const sessionId = await seedSession(page);
    await mockMicrophone(page);
    const errors = trackConsoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    const fabStack = page.getByTestId('mobile-fab-stack');
    await expect(fabStack).toBeVisible();
    const stop = page.getByTestId('voice-stop');

    /** Disjoint bounding boxes: the FAB stack must never cover the stop button. */
    const expectNoOverlap = async (label: string): Promise<void> => {
      const stopBox = await stop.boundingBox();
      const fabBox = await fabStack.boundingBox();
      expect(stopBox, `${label}: stop button has no box`).toBeTruthy();
      expect(fabBox, `${label}: FAB stack has no box`).toBeTruthy();
      const disjoint =
        stopBox!.x + stopBox!.width <= fabBox!.x ||
        fabBox!.x + fabBox!.width <= stopBox!.x ||
        stopBox!.y + stopBox!.height <= fabBox!.y ||
        fabBox!.y + fabBox!.height <= stopBox!.y;
      expect(
        disjoint,
        `${label}: stop ${JSON.stringify(stopBox)} overlaps FAB stack ${JSON.stringify(fabBox)}`,
      ).toBe(true);
    };

    // --- Manual capture: tap -> capturing; the FAB stack must sit clear of the bar.
    await mic.click();
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 15_000 });
    await page.waitForTimeout(350); // let the FAB bottom transition settle
    await expectNoOverlap('capturing');
    await page.screenshot({ path: 'test-results/voice-mobile-fab-capturing.png' });
    // The real tappability proof: an overlapping FAB would intercept this click.
    await stop.click();
    await expect(page.getByTestId('voice-bar')).toHaveCount(0, { timeout: 10_000 });

    // --- Talking loop: press-and-hold (>= 550 ms) -> listening; same clearance rules.
    const micBox = await mic.boundingBox();
    expect(micBox).toBeTruthy();
    await page.mouse.move(micBox!.x + micBox!.width / 2, micBox!.y + micBox!.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.getByTestId('voice-status')).toHaveText('A ouvir', { timeout: 30_000 });
    await page.waitForTimeout(350);
    await expectNoOverlap('talking');
    await page.screenshot({ path: 'test-results/voice-mobile-fab-talking.png' });
    await stop.click(); // exit the loop - again, only reachable if nothing covers it
    await expect(page.getByTestId('voice-bar')).toHaveCount(0, { timeout: 10_000 });

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('the ouvir action sits in the sheet footer and round-trips the tts path', async ({
    page,
  }) => {
    const sessionId = await seedSession(page);
    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    // The seeded reply derives one sheet; its footer carries the extensible actions row
    // WITH ouvir (the Part C delta on locked decision 10).
    const card = page.getByTestId('sheet-card');
    await expect(card).toHaveCount(1, { timeout: 30_000 });
    const ouvir = card.getByTestId('sheet-action-ouvir');
    await expect(ouvir).toBeVisible();
    await expect(ouvir).toContainText('Ouvir');
    await expect(ouvir).toBeEnabled();
    // Placement: inside the same footer actions row as editar/copiar/promover.
    await expect(card.getByTestId('sheet-action-copy')).toBeVisible();
    await expect(card.getByTestId('sheet-action-promote')).toBeVisible();

    // Tapping drives the REAL tts path: WS say -> stub provider streams WAV tone ->
    // playback starts ("Parar" while audible) and drains back to "Ouvir".
    await ouvir.click();
    await expect(ouvir).toContainText('Parar', { timeout: 15_000 });
    await expect(ouvir).toContainText('Ouvir', { timeout: 30_000 });

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});
