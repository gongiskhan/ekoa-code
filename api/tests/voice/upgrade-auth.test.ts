import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { VOICE_STT_WS_PATH, VOICE_TTS_WS_PATH } from '@ekoa/shared';
import { signToken } from '../../src/auth/jwt.js';
import {
  initVoiceTestEnv,
  resetVoiceTestState,
  startVoiceServer,
  stopVoiceServer,
  seedUserToken,
  VoiceClient,
  type VoiceTestServer,
} from './helpers.js';

/**
 * Voice WS upgrade auth (mega-run C1, the streaming/ idiom + CONV-1 token-query): the session
 * JWT rides ?token= and goes through the ONE verify chokepoint (verifySseToken - signature,
 * revocation, activation). Missing/garbage tokens and unknown subjects (no activation entry)
 * are rejected BEFORE the socket opens, fail closed, with structured auth-failure logs; a
 * valid active user's token admits on both paths.
 */

let t: VoiceTestServer;

beforeAll(() => initVoiceTestEnv());
beforeEach(async () => {
  resetVoiceTestState();
  t = await startVoiceServer();
});
afterEach(async () => {
  await stopVoiceServer(t);
});

function url(path: string, token?: string): string {
  const q = token === undefined ? '' : `?token=${encodeURIComponent(token)}`;
  return `ws://127.0.0.1:${t.port}${path}${q}`;
}

function authFailureReasons(): unknown[] {
  return t.logs.filter(([e]) => e === 'voice.auth_failure').map(([, f]) => f.reason);
}

describe('voice WS upgrade auth', () => {
  for (const path of [VOICE_STT_WS_PATH, VOICE_TTS_WS_PATH]) {
    it(`${path}: rejects a missing token before the socket opens`, async () => {
      const c = new VoiceClient(url(path));
      expect(await c.waitOpen()).toBe(false);
      expect(authFailureReasons()).toContain('UNAUTHENTICATED');
    });

    it(`${path}: rejects a garbage token`, async () => {
      const c = new VoiceClient(url(path, 'not-a-jwt'));
      expect(await c.waitOpen()).toBe(false);
      expect(authFailureReasons()).toContain('UNAUTHENTICATED');
    });
  }

  it('rejects a validly-signed token for an unknown subject (no activation entry - fail closed)', async () => {
    // Real signature, but the user is NOT in the activation cache (deleted/stale subject).
    const { token } = signToken({ sub: 'ghost', role: 'user', scope: 'user', orgId: 'org-x', username: 'ghost' });
    const c = new VoiceClient(url(VOICE_STT_WS_PATH, token));
    expect(await c.waitOpen()).toBe(false);
    expect(authFailureReasons()).toContain('UNAUTHENTICATED');
  });

  it('admits a valid active user on both paths', async () => {
    const token = seedUserToken('u-auth-1', 'org-auth-1', 'ana');
    for (const path of [VOICE_STT_WS_PATH, VOICE_TTS_WS_PATH]) {
      const c = new VoiceClient(url(path, token));
      expect(await c.waitOpen(), path).toBe(true);
      const ready = await c.waitForJson((m) => m.type === 'ready');
      expect(typeof ready.sessionId).toBe('string');
      c.terminate();
      await c.waitClosed();
    }
    expect(authFailureReasons().length).toBe(0);
  });
});
