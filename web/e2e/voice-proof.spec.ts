import { test, expect, type Page } from '@playwright/test';

/**
 * Voice proof (mega-run C7, BRIEF §5 validation): the full manual + talking turn journeys on
 * the unified chat page against the LIVE credentialed boot-b stack (api/tests/journeys/boot-b.mjs)
 * - the SAME live-model posture as part-b-proof.spec.ts (band5_live_proof). ONLY the voice
 * VENDORS are stubbed (Deepgram/Google keys are absent - C6 landed `blocked`, RUN_LOG GATE
 * 2026-07-17T19:09:55Z); the agent itself is the real credentialed model, so every reply here
 * is a genuine live turn.
 *
 * Two test-only injection seams make this provable in headless CI without a real mic, a real
 * Silero VAD detection on synthetic audio, or a real multi-minute wait:
 *
 *   1. MARKER-FRAME STT: getUserMedia is mocked with a REAL (silent) MediaStream (the C4
 *      voice-modality.spec.ts pattern) so the whole capture chain runs for real - worklet,
 *      AudioContext, the authenticated WS upgrade. A `window.WebSocket` override (installed via
 *      addInitScript, BEFORE any app code runs) intercepts binary sends on `/api/voice/stream`:
 *      an ARMED send is replaced with a marker frame (`EKOA-STT:<key>`, the stub STT's own
 *      protocol - api/src/voice/stub-providers.ts), everything else is silently dropped (never
 *      forwarded) - which also means a session that never arms a marker produces genuinely ZERO
 *      server traffic, exactly what test (d) needs.
 *   2. DETERMINISTIC VAD: `window.__voiceE2eTestVadFactory` substitutes the real Silero VAD at
 *      the SAME injection point the driver already expects for tests (VoiceDriverDeps.startVad -
 *      session-driver.ts's own unit tests use fakes here); the test fires speech-start/-end
 *      directly instead of trying to fool a real speech-detection model with synthetic audio.
 *      `window.__voiceE2eTestDriverConfig` optionally shortens busyAfterMs so a standby entry
 *      is provable without waiting out a real model's occasionally-fast first token.
 *
 * Both seams are declared in components/voice/use-voice-session.ts, gated behind an optional
 * `window` global a production page load never sets.
 *
 * COVERAGE (do not duplicate): the reducer's own state-machine correctness (manual/talking
 * transitions, the adaptive grace window, the confirmation gate, standby/pending-note, barge-in
 * gating) is already unit-tested with ZERO mocks in web/__tests__/voice/voice-machine.test.ts
 * (C3) and the driver's effect execution in voice/session-driver.test.ts (C4, injected fakes).
 * This spec proves the INTEGRATION - a real browser, a real WS round-trip through the relay to
 * the stub providers, a real chat run, real rendering - not the machine's internal logic again.
 *
 * RUNNING: needs `node api/tests/journeys/boot-b.mjs up` (claudeAuth.ok=true asserted up front).
 * Tests (a)-(c) burn real model tokens (up to 4 live turns): run deliberately
 * (`npx playwright test web/e2e/voice-proof.spec.ts`), never in the per-PR lane - same posture
 * as part-b-proof.spec.ts. Test (d) additionally needs boot-b started with
 * `VOICE_INACTIVITY_TIMEOUT_MS` set short AND this run given `EKOA_VOICE_SHORT_INACTIVITY_MS`
 * set to the SAME value (e.g. `VOICE_INACTIVITY_TIMEOUT_MS=6000 node api/tests/journeys/boot-b.mjs up`
 * then `EKOA_VOICE_SHORT_INACTIVITY_MS=6000 npx playwright test web/e2e/voice-proof.spec.ts`) -
 * it skips cleanly against a normally-configured (10-minute) boot-b, matching the project's
 * "LLM-dependent specs skip cleanly" convention for environment-gated tests. Real UI login,
 * PT-PT strings, zero console errors on the chat surface.
 */

const API = 'http://localhost:4111';
const TURN_TIMEOUT = 120_000;

declare global {
  interface Window {
    __voiceTestArmMarker?: (key: string) => void;
    __voiceTestVad?: { fireSpeechStart(): void; fireSpeechEnd(): void };
  }
}

async function login(page: Page) {
  await page.goto('/login');
  await page.locator('input[type="text"], input:not([type])').first().fill('admin');
  await page.locator('input[type="password"]').first().fill('tmp12345');
  await page.getByRole('button', { name: /entrar|iniciar/i }).first().click();
  await page.waitForURL(/\/chat/, { timeout: 60_000 });
}

/** Console + non-asset 4xx tracking (the regressions-dashboard pattern, every spec here). */
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
    if (r.status() === 404 && /\/api\/v1\/sessions\/[0-9a-f-]{36}$/.test(r.url())) return; // known OPEN finding
    errors.push(`${r.status()} ${r.url()}`);
  });
  return errors;
}

/** One session with ONE seeded assistant reply (-> sheet #1), matching C4's pattern: the
 *  unified page only mounts ChatPanel (and the mic button) once a conversation has content
 *  (Part B locked decision 2 - the blank state is a separate full-width composer). Also
 *  deletes any stale sessions first ('/chat' auto-resumes the latest one). */
async function seedSession(page: Page, name: string): Promise<string> {
  const loginRes = await page.request.post(`${API}/api/v1/auth/login`, {
    data: { username: 'admin', password: 'tmp12345' },
  });
  expect(loginRes.ok()).toBe(true);
  const { token } = (await loginRes.json()) as { token: string };
  const auth = { authorization: `Bearer ${token}` };

  const listRes = await page.request.get(`${API}/api/v1/sessions`, { headers: auth });
  expect(listRes.ok()).toBe(true);
  const { items: existing } = (await listRes.json()) as { items: Array<{ id: string }> };
  for (const s of existing) {
    await page.request.delete(`${API}/api/v1/sessions/${s.id}`, { headers: auth });
  }

  const createRes = await page.request.post(`${API}/api/v1/sessions`, {
    headers: auth,
    data: { name },
  });
  expect(createRes.status()).toBe(201);
  const { id: sessionId } = (await createRes.json()) as { id: string };
  const msgRes = await page.request.post(`${API}/api/v1/sessions/${sessionId}/messages`, {
    headers: auth,
    data: {
      role: 'assistant',
      content: 'Em que posso ajudar hoje?',
      metadata: { isEssential: true, type: 'text' },
    },
  });
  expect(msgRes.status()).toBe(201);
  return sessionId;
}

/** Install the two test-only seams described in the file header. MUST run before any app
 *  script (addInitScript), so this is always called before `login`/`goto`. */
async function installVoiceTestHooks(
  page: Page,
  driverConfig?: { busyAfterMs?: number; inactivityTickMs?: number },
): Promise<void> {
  await page.addInitScript((cfg) => {
    // 1. Mocked mic: a REAL (silent) MediaStream so the worklet/AudioContext/WS chain is live
    //    (voice-modality.spec.ts's mockMicrophone pattern, C4).
    const fakeGetUserMedia = async () => {
      const ctx = new AudioContext();
      const destination = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(destination);
      osc.start();
      return destination.stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: fakeGetUserMedia },
      configurable: true,
    });

    // 2. Marker-frame injection over the REAL STT WebSocket (see file header). Every binary
    //    send on /api/voice/stream is either replaced by an armed marker or dropped; TTS's
    //    socket (/api/voice/tts-stream) and every string (JSON control) send pass through
    //    untouched.
    const NativeWebSocket = window.WebSocket;
    let armed: string | null = null;
    class TestWebSocket extends NativeWebSocket {
      private readonly isStt: boolean;
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.isStt = /\/api\/voice\/stream(\?|$)/.test(String(url));
      }
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
        if (this.isStt && (data instanceof ArrayBuffer || ArrayBuffer.isView(data))) {
          if (armed !== null) {
            const key = armed;
            armed = null;
            const bytes = new TextEncoder().encode(`EKOA-STT:${key}`);
            super.send(bytes.buffer);
          }
          return; // unarmed real audio: dropped, never forwarded
        }
        super.send(data);
      }
    }
    Object.defineProperty(window, 'WebSocket', {
      value: TestWebSocket,
      configurable: true,
      writable: true,
    });
    window.__voiceTestArmMarker = (key: string) => {
      armed = key;
    };

    // 3. Deterministic VAD substitute at the driver's own injection point.
    window.__voiceE2eTestVadFactory = async (hooks) => {
      let speaking = false;
      window.__voiceTestVad = {
        fireSpeechStart: () => {
          speaking = true;
          hooks.onSpeechStart();
        },
        fireSpeechEnd: () => {
          speaking = false;
          hooks.onSpeechEnd();
        },
      };
      return {
        get speaking() {
          return speaking;
        },
        destroy: () => {
          window.__voiceTestVad = undefined;
        },
      };
    };

    // 4. Optional shortened driver timers.
    if (cfg) window.__voiceE2eTestDriverConfig = cfg;
  }, driverConfig ?? null);
}

async function armMarker(page: Page, key: string): Promise<void> {
  await page.evaluate((k) => window.__voiceTestArmMarker?.(k), key);
}

/** session-driver.ts's openSttStream() awaits capture.start() + stt.open() BEFORE calling
 *  startVad() (worklet load + the WS handshake) - the test-only factory (and the
 *  window.__voiceTestVad control object it stashes) is only wired up once that finishes, so
 *  a fire immediately after the UI shows "listening" can race ahead of it. Poll for the
 *  control object first. */
async function fireVadSpeechStart(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__voiceTestVad, { timeout: 10_000 });
  await page.evaluate(() => window.__voiceTestVad?.fireSpeechStart());
}

/** Press-and-hold (>=550 ms) arms the hands-free talking loop (C4's gesture). */
async function startTalkingLoop(page: Page): Promise<void> {
  const mic = page.getByTestId('voice-mic-button');
  const box = await mic.boundingBox();
  expect(box, 'mic button has a box').toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
}

test.describe('voice proof (C7)', () => {
  test('MANUAL mode: tap mic, speak (scripted), tap send now - the transcript becomes a chat message, the reply renders as a summary card + sheet, and ouvir reads it back', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const health = await page.request.get(`${API}/health`);
    expect(health.ok(), 'boot-b stack reachable on :4111').toBe(true);
    expect(
      ((await health.json()) as { claudeAuth?: { ok?: boolean } }).claudeAuth?.ok,
      'claudeAuth.ok=true - run `node api/tests/journeys/boot-b.mjs up`',
    ).toBe(true);

    await installVoiceTestHooks(page);
    const sessionId = await seedSession(page, 'Voz C7 manual');
    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    await mic.click(); // manual tap: capturing
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 15_000 });

    await armMarker(page, 'prazo');
    await expect(page.getByTestId('voice-interim')).toHaveText('Qual é o prazo do processo?', {
      timeout: 15_000,
    });

    // "tap send" = the on-screen send-now escape hatch (BRIEF §5: never make the user wait
    // for a timer) - explicit send, matching the MANUAL row of the modes table.
    await page.getByTestId('voice-send-now').click();

    await expect(page.getByText('Qual é o prazo do processo?').first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('summary-card')).toHaveCount(2, { timeout: TURN_TIMEOUT });
    await expect(page.getByTestId('sheet-card')).toHaveCount(2, { timeout: 30_000 });

    // Honest teardown: manual mode never reads aloud on its own, so once the run settles
    // (agentDone, no TTS queue to drain) the session returns to idle by itself.
    await expect(page.getByTestId('voice-bar')).toHaveCount(0, { timeout: 15_000 });

    // ouvir (Part B extensible footer action, C4/C5) reads the NEW reply back through the
    // real relay -> stub TTS round trip.
    const newCard = page.getByTestId('sheet-card').nth(1);
    const ouvir = newCard.getByTestId('sheet-action-ouvir');
    await expect(ouvir).toBeVisible();
    await ouvir.click();
    await expect(ouvir).toContainText('Parar', { timeout: 15_000 });
    await expect(ouvir).toContainText('Ouvir', { timeout: 30_000 });

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('TALKING mode: a scripted utterance auto-sends on silence endpointing and is read aloud, then a barge-in clears playback and captures', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await installVoiceTestHooks(page);
    const sessionId = await seedSession(page, 'Voz C7 talking');
    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    await startTalkingLoop(page);
    await expect(page.getByTestId('voice-status')).toHaveText('A ouvir', { timeout: 15_000 }); // listening

    // VAD-confirmed speech candidate -> capturing (the ~300 ms confirmation gate, real timer).
    await fireVadSpeechStart(page);
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 5_000 });

    await armMarker(page, 'prazo');
    await expect(page.getByTestId('voice-interim')).toHaveText('Qual é o prazo do processo?', {
      timeout: 15_000,
    });

    // Silence endpointing: the stub's utterance_end arms the adaptive grace window
    // ("?"-ended -> eot=1 -> the 1.5 s floor) - NO manual send, the machine auto-sends.
    await expect(page.getByTestId('voice-status')).toHaveText('A enviar', { timeout: 8_000 });

    // The reply streams; talking mode reads it aloud (status progresses through
    // awaiting -> speaking as tts_first_audio marks). waitForFunction (raf-polled, ~16ms) -
    // not expect().toHaveText()'s backed-off polling - because a real turn's silent
    // "thinking" stretch can run well past a minute (live model latency) and the stub's
    // playback of a single sentence is comparably brief; a coarser poll can miss the window.
    await page.waitForFunction(
      () => document.querySelector('[data-testid="voice-status"]')?.getAttribute('data-voice-status') === 'speaking',
      { timeout: TURN_TIMEOUT, polling: 'raf' },
    );

    // Barge-in: a second scripted utterance during TTS clears playback and captures. Fired
    // immediately off the speaking detection above (same reasoning: the window is brief).
    await fireVadSpeechStart(page);
    await page.waitForTimeout(400); // past the confirmation gate
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 5_000 }); // TTS cleared, capturing resumed
    await armMarker(page, 'ola');
    await expect(page.getByTestId('voice-interim')).toHaveText('Olá, bom dia.', { timeout: 15_000 });

    // Clean exit BEFORE the barge-in capture's own grace window could auto-send it (the
    // interruption's mechanics are already proven above - a second real turn is not needed).
    await page.getByTestId('voice-stop').click();
    await expect(page.getByTestId('voice-bar')).toHaveCount(0, { timeout: 10_000 });

    // The INTERRUPTED reply is still a completed agent turn server-side (barge-in only reset
    // the LOCAL voice machine) - wait it out so nothing is left abandoned at teardown.
    await expect(page.getByTestId('summary-card')).toHaveCount(2, { timeout: TURN_TIMEOUT });

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('STANDBY: during a longer agent turn a barge-in captures a pending note that is QUEUED (never appended mid-run - deviation memo c-voice-deviations.md §v) and flushes FIFO as the next turn once the run settles', async ({
    page,
  }) => {
    test.setTimeout(480_000); // up to 2 live turns + a possible event-loop-stall delay
    // A short busyAfterMs makes ANY real turn's pre-first-token gap exceed the threshold,
    // reliably entering standby without a genuine multi-minute wait ("(stubbed) longer agent
    // turn": only the standby-ENTRY threshold is shortened - the agent call itself is the
    // real credentialed model, per this file's header).
    await installVoiceTestHooks(page, { busyAfterMs: 200 });
    const sessionId = await seedSession(page, 'Voz C7 standby');
    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    await startTalkingLoop(page);
    await expect(page.getByTestId('voice-status')).toHaveText('A ouvir', { timeout: 15_000 });

    await fireVadSpeechStart(page);
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 5_000 });
    await armMarker(page, 'prazo');
    await expect(page.getByTestId('voice-interim')).toHaveText('Qual é o prazo do processo?', {
      timeout: 15_000,
    });

    // Auto-send -> standby, well before the real reply's first token (shortened threshold).
    await expect(page.getByTestId('voice-status')).toHaveText('Em espera', { timeout: 8_000 });

    // Barge-in during standby: confirmed speech becomes a PENDING NOTE, not a new auto-send.
    await fireVadSpeechStart(page);
    await page.waitForTimeout(400);
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 5_000 });
    await armMarker(page, 'ola');
    // NOT asserted here: `voice-interim` showing the note's text. A note-capture's
    // utterance_end fires immediately after its final transcript (no grace window - BRIEF §5:
    // "utterance end completes it immediately") and that SAME reduce transition resets
    // `interim` to '' as part of re-arming standby (voice-machine.ts onUtteranceEnd's
    // noteCapture branch spreads FRESH_CAPTURE) - too transient a UI window to assert on
    // reliably (confirmed: the stub's transcript + utterance_end frames arrive ~10ms apart).
    // The stable, meaningful signal is the OUTCOME below: the pending note lands in the
    // queued-messages list. Generous timeout (known finding `knowledge-tool-sync-io-stall`,
    // docs/findings.md): the FIRST turn's real agent work (tool calls) can block the api event
    // loop for multi-second stretches, delaying the stub STT's response to this UNRELATED
    // voice WS's marker frame - observed 9-18s here, in an otherwise-idle stack.
    await expect(page.getByTestId('voice-status')).toHaveText('Em espera', { timeout: 120_000 });
    const queued = page.getByTestId('queued-message');
    await expect(queued).toHaveCount(1, { timeout: 10_000 });
    await expect(queued.first()).toContainText('Olá, bom dia.');

    // NOT appended mid-run: the running turn settles on its OWN content while the note still
    // sits in the queue (only the seeded reply + this ONE new reply exist so far).
    await expect(page.getByTestId('summary-card')).toHaveCount(2, { timeout: TURN_TIMEOUT });

    // FIFO flush AS THE NEXT TURN once the run settles: the queue drains and a THIRD summary
    // card appears - the queued behavior, not the BRIEF's literal "appended" wording.
    await expect(queued).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('summary-card')).toHaveCount(3, { timeout: TURN_TIMEOUT });

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });

  test('10-minute inactivity timeout: an idle voice session times out honestly (VOICE_INACTIVITY_TIMEOUT_MS shortened - never a real 10-minute wait)', async ({
    page,
  }) => {
    test.skip(
      !process.env.EKOA_VOICE_SHORT_INACTIVITY_MS,
      'Requires boot-b booted with VOICE_INACTIVITY_TIMEOUT_MS set short (e.g. 6000) AND this ' +
        'run given EKOA_VOICE_SHORT_INACTIVITY_MS set to the SAME value - see the file header. ' +
        'Skips cleanly against a normally-configured (10-minute) boot-b (LLM-dependent-spec ' +
        'skip convention).',
    );
    const shortMs = Number(process.env.EKOA_VOICE_SHORT_INACTIVITY_MS);
    test.setTimeout(shortMs + 60_000);

    await installVoiceTestHooks(page);
    const sessionId = await seedSession(page, 'Voz C7 inactivity');
    const errors = trackConsoleErrors(page);
    await login(page);
    await page.goto(`/chat/${sessionId}`);

    const mic = page.getByTestId('voice-mic-button');
    await expect(mic).toBeVisible({ timeout: 30_000 });
    // Manual capture, no marker ever armed: the WS override drops every real frame, so the
    // relay genuinely receives zero bytes after the upgrade - the idle path the server's
    // inactivity timer is built for (armInactivityTimer, api/src/voice/index.ts).
    await mic.click();
    await expect(page.getByTestId('voice-status')).toHaveText('A captar', { timeout: 15_000 });

    // The server's shortened inactivity timer fires: VOICE_TIMEOUT -> the client surfaces it
    // honestly (PT-PT error) rather than hanging silently.
    await expect(page.getByTestId('voice-error')).toBeVisible({ timeout: shortMs + 20_000 });
    await expect(page.getByTestId('voice-error')).toHaveText('Erro no serviço de voz. Tente novamente.');

    expect(errors, `console errors: ${errors.join('\n')}`).toEqual([]);
  });
});
