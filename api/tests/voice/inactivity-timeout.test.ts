import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { VOICE_STT_WS_PATH } from '@ekoa/shared';
import {
  initVoiceTestEnv,
  resetVoiceTestState,
  startVoiceServer,
  stopVoiceServer,
  seedUserToken,
  sleep,
  VoiceClient,
  type VoiceTestServer,
} from './helpers.js';

/**
 * The inactivity timeout (mega-run C1, BRIEF §5: 10 minutes in production) through its config
 * knob VOICE_INACTIVITY_TIMEOUT_MS: an idle socket gets the PT-PT timeout error and a clean
 * close, with voice.session.timeout logged; any client message RESETS the timer.
 */

const KNOB_MS = 250;

let t: VoiceTestServer;

beforeAll(() => initVoiceTestEnv());
beforeEach(async () => {
  resetVoiceTestState(); // resets the memoized voice config so the knob below is read fresh
  process.env.VOICE_INACTIVITY_TIMEOUT_MS = String(KNOB_MS);
  t = await startVoiceServer();
});
afterEach(async () => {
  delete process.env.VOICE_INACTIVITY_TIMEOUT_MS;
  await stopVoiceServer(t);
});

function sttUrl(token: string): string {
  return `ws://127.0.0.1:${t.port}${VOICE_STT_WS_PATH}?token=${encodeURIComponent(token)}`;
}

describe('voice inactivity timeout', () => {
  it('closes an idle session with the PT-PT timeout error and a structured log', async () => {
    const token = seedUserToken('u-idle-1', 'org-idle-1', 'ana');
    const c = new VoiceClient(sttUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    // Send nothing: the knob fires well within the wait ceiling.
    const err = await c.waitForJson((m) => m.type === 'error', 3000);
    expect(err.code).toBe('VOICE_TIMEOUT');
    expect(err.message).toBe('Sessão de voz terminada por inatividade.');
    await c.waitClosed(3000);

    const timeoutLog = t.logs.find(([e]) => e === 'voice.session.timeout');
    expect(timeoutLog?.[1]).toMatchObject({ orgId: 'org-idle-1', userId: 'u-idle-1', timeoutMs: KNOB_MS });
  });

  it('client activity resets the timer', async () => {
    const token = seedUserToken('u-idle-2', 'org-idle-2', 'rui');
    const c = new VoiceClient(sttUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    // Keep sending audio at a cadence well inside the knob, for LONGER than the knob: the
    // session must survive (each frame re-arms the timer).
    for (let i = 0; i < 5; i++) {
      c.client.send(Buffer.alloc(640));
      await sleep(100);
    }
    expect(c.closed).toBe(false);
    expect(t.logs.some(([e]) => e === 'voice.session.timeout')).toBe(false);

    // Then go silent: the timeout fires from the LAST activity.
    await c.waitClosed(3000);
    expect(t.logs.some(([e]) => e === 'voice.session.timeout')).toBe(true);
  });
});
