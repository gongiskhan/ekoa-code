import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { VOICE_TTS_WS_PATH, VoiceTtsServerMessage } from '@ekoa/shared';
import { activeVoiceSessions } from '../../src/voice/session.js';
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
 * WS /api/voice/tts-stream against the stub TTS provider (mega-run C1): {say} streams a valid
 * WAV header + tone frames then audio_end; a mid-stream {clear} (the barge-in path) aborts the
 * synthesis - cleared confirms and NOTHING follows it for that turn; tts_first_audio latency is
 * logged per turn; ttsChars/turns accumulate on the attributed session record.
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

function ttsUrl(token: string): string {
  return `ws://127.0.0.1:${t.port}${VOICE_TTS_WS_PATH}?token=${encodeURIComponent(token)}`;
}

describe('WS /api/voice/tts-stream (stub TTS)', () => {
  it('synthesizes a turn to completion: WAV header first, audio_end last, latency logged', async () => {
    const token = seedUserToken('u-tts-1', 'org-tts-1', 'ana');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    c.client.send(JSON.stringify({ type: 'say', text: 'Olá, está tudo bem?', lang: 'pt-PT', turnId: 't-full' }));
    const speaking = await c.waitForJson((m) => m.type === 'speaking');
    expect(speaking).toMatchObject({ turnId: 't-full', lang: 'pt-PT', ttsProvider: 'stub' });
    await c.waitForJson((m) => m.type === 'audio_end' && m.turnId === 't-full');

    const frames = c.binaryFrames();
    expect(frames.length).toBeGreaterThan(1);
    // Valid WAV container: RIFF/WAVE magic on the first frame (iOS Safari is strict).
    expect(frames[0]!.toString('ascii', 0, 4)).toBe('RIFF');
    expect(frames[0]!.toString('ascii', 8, 12)).toBe('WAVE');

    for (const msg of c.jsonMessages()) {
      expect(VoiceTtsServerMessage.safeParse(msg).success, JSON.stringify(msg)).toBe(true);
    }

    // The configured pt-PT provider (google) is not registered in v1 - the stub answers and
    // the fallback is logged, never silent.
    const fallback = t.logs.find(([e]) => e === 'voice.provider_fallback');
    expect(fallback?.[1]).toMatchObject({ kind: 'tts', resolved: 'stub' });

    const latency = t.logs.filter(([e]) => e === 'voice.latency').map(([, f]) => f);
    expect(latency.length).toBe(1);
    expect(latency[0]).toMatchObject({ kind: 'tts_turn', turnId: 't-full', orgId: 'org-tts-1', userId: 'u-tts-1' });
    expect(typeof latency[0]!.tts_first_audio).toBe('number');
    expect(latency[0]!.ms_to_first_audio as number).toBeGreaterThanOrEqual(0);

    c.terminate();
    await c.waitClosed();
  });

  it('{clear} mid-stream aborts synthesis: cleared confirms, no audio after it, no audio_end', async () => {
    const token = seedUserToken('u-tts-2', 'org-tts-2', 'rui');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    // Long text => many tone chunks => the clear lands mid-stream deterministically.
    const longText = 'Esta é uma resposta bastante longa que o assistente iria ler em voz alta. '.repeat(6);
    c.client.send(JSON.stringify({ type: 'say', text: longText, lang: 'pt-PT', turnId: 't-long' }));
    await c.waitForJson((m) => m.type === 'speaking' && m.turnId === 't-long');
    // Wait for the stream to actually be flowing before barging in.
    const deadline = Date.now() + 3000;
    while (c.binaryFrames().length < 2 && Date.now() < deadline) await sleep(5);
    expect(c.binaryFrames().length).toBeGreaterThanOrEqual(2);

    c.client.send(JSON.stringify({ type: 'clear' }));
    await c.waitForJson((m) => m.type === 'cleared' && m.turnId === 't-long');

    // Nothing for the cleared turn follows the confirmation: audio stops, no audio_end.
    const clearedAt = c.messages.findIndex((m) => (m.json as any)?.type === 'cleared');
    await sleep(200);
    const after = c.messages.slice(clearedAt + 1);
    expect(after.filter((m) => m.binary !== undefined).length).toBe(0);
    expect(c.jsonMessages().some((m: any) => m.type === 'audio_end')).toBe(false);

    // The record still carries the attribution + counters for the aborted turn (billed work).
    const record = activeVoiceSessions()[0];
    expect(record).toMatchObject({ kind: 'tts', orgId: 'org-tts-2', userId: 'u-tts-2', username: 'rui', provider: 'stub' });
    expect(record?.ttsChars).toBe(longText.length);
    expect(record?.turns).toBe(1);

    c.terminate();
    await c.waitClosed();
  });

  it('a new {say} supersedes the in-flight turn (cleared) and a bare {clear} is idempotent', async () => {
    const token = seedUserToken('u-tts-3', 'org-tts-3', 'sofia');
    const c = new VoiceClient(ttsUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');

    // clear with nothing playing still confirms (client barge-in state machine may fire it).
    c.client.send(JSON.stringify({ type: 'clear' }));
    const idempotent = await c.waitForJson((m) => m.type === 'cleared');
    expect(idempotent.turnId).toBeUndefined();

    const longText = 'Uma primeira resposta longa para ser interrompida a meio da leitura. '.repeat(6);
    c.client.send(JSON.stringify({ type: 'say', text: longText, lang: 'pt-PT', turnId: 't-a' }));
    await c.waitForJson((m) => m.type === 'speaking' && m.turnId === 't-a');
    c.client.send(JSON.stringify({ type: 'say', text: 'Segunda.', lang: 'en', turnId: 't-b' }));
    await c.waitForJson((m) => m.type === 'cleared' && m.turnId === 't-a');
    const speakingB = await c.waitForJson((m) => m.type === 'speaking' && m.turnId === 't-b');
    expect(speakingB.lang).toBe('en');
    await c.waitForJson((m) => m.type === 'audio_end' && m.turnId === 't-b');
    // Only the superseding turn completes.
    const audioEnds = c.jsonMessages().filter((m: any) => m.type === 'audio_end') as any[];
    expect(audioEnds.map((m) => m.turnId)).toEqual(['t-b']);

    c.terminate();
    await c.waitClosed();
  });
});
