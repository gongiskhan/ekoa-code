import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { VOICE_STT_WS_PATH, VoiceSttServerMessage } from '@ekoa/shared';
import { activeVoiceSessions } from '../../src/voice/session.js';
import { STT_STUB_MARKER_PREFIX } from '../../src/voice/stub-providers.js';
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
 * WS /api/voice/stream against the stub STT provider (mega-run C1): a scripted marker frame
 * yields ready -> speech_started -> interim -> final -> utterance_end IN ORDER; every wire
 * message validates against the shared VoiceSttServerMessage union; the per-turn latency line
 * carries the audio_in_first/first_interim/utterance_end stages; the session record carries
 * org + user attribution while live and dies with the socket.
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

function sttUrl(token: string, extra = ''): string {
  return `ws://127.0.0.1:${t.port}${VOICE_STT_WS_PATH}?token=${encodeURIComponent(token)}${extra}`;
}

describe('WS /api/voice/stream (stub STT)', () => {
  it('replays a scripted turn: interim -> final -> utterance_end in order, schema-valid, latency logged, attributed', async () => {
    const token = seedUserToken('u-stt-1', 'org-stt-1', 'ana');
    const c = new VoiceClient(sttUrl(token, '&sample_rate=16000&utterance_end_ms=1200'));
    expect(await c.waitOpen()).toBe(true);

    const ready = await c.waitForJson((m) => m.type === 'ready');
    expect(ready.sampleRate).toBe(16000);
    expect(ready.utteranceEndMs).toBe(1200);
    expect(ready.sttProvider).toBe('stub');

    // Attribution present on the live session record (org + user on every provider call).
    const record = activeVoiceSessions().find((r) => r.sessionId === ready.sessionId);
    expect(record).toBeDefined();
    expect(record).toMatchObject({
      kind: 'stt',
      orgId: 'org-stt-1',
      userId: 'u-stt-1',
      username: 'ana',
      provider: 'stub',
    });
    const opened = t.logs.find(([e]) => e === 'voice.session.opened');
    expect(opened?.[1]).toMatchObject({ orgId: 'org-stt-1', userId: 'u-stt-1', kind: 'stt' });

    const marker = Buffer.from(`${STT_STUB_MARKER_PREFIX}ola`);
    c.client.send(marker);
    await c.waitForJson((m) => m.type === 'utterance_end');

    // Every wire message validates against the shared union.
    for (const msg of c.jsonMessages()) {
      expect(VoiceSttServerMessage.safeParse(msg).success, JSON.stringify(msg)).toBe(true);
    }

    // Strict order of the scripted turn.
    const types = c.jsonMessages().map((m: any) => m.type);
    expect(types).toEqual(['ready', 'speech_started', 'transcript', 'transcript', 'utterance_end']);
    const transcripts = c.jsonMessages().filter((m: any) => m.type === 'transcript') as any[];
    expect(transcripts[0]).toMatchObject({ text: 'Olá', isFinal: false, speechFinal: false });
    expect(transcripts[1]).toMatchObject({ text: 'Olá, bom dia.', isFinal: true, speechFinal: true });
    const utteranceEnd = c.jsonMessages().find((m: any) => m.type === 'utterance_end') as any;
    expect(utteranceEnd.transcript).toBe('Olá, bom dia.');

    // Per-stage latency JSON: one stt_turn line with all three stage timestamps + deltas.
    const latency = t.logs.filter(([e]) => e === 'voice.latency').map(([, f]) => f);
    expect(latency.length).toBe(1);
    expect(latency[0]).toMatchObject({ kind: 'stt_turn', orgId: 'org-stt-1', userId: 'u-stt-1', turn: 1 });
    expect(typeof latency[0]!.audio_in_first).toBe('number');
    expect(typeof latency[0]!.first_interim).toBe('number');
    expect(typeof latency[0]!.utterance_end).toBe('number');
    expect(latency[0]!.ms_to_first_interim as number).toBeGreaterThanOrEqual(0);
    expect(latency[0]!.ms_to_utterance_end as number).toBeGreaterThanOrEqual(0);

    // close_stream flushes the provider and the relay closes the socket; the record dies.
    c.client.send(JSON.stringify({ type: 'close_stream' }));
    await c.waitClosed();
    expect(activeVoiceSessions().length).toBe(0);
    const closed = t.logs.find(([e]) => e === 'voice.session.closed');
    expect(closed?.[1]).toMatchObject({ orgId: 'org-stt-1', userId: 'u-stt-1', turns: 1 });
    expect(closed?.[1].audioInBytes).toBe(marker.byteLength);
  });

  it('plain (non-marker) PCM frames are accepted, counted, and transcribe nothing', async () => {
    const token = seedUserToken('u-stt-2', 'org-stt-2', 'rui');
    const c = new VoiceClient(sttUrl(token));
    expect(await c.waitOpen()).toBe(true);
    const ready = await c.waitForJson((m) => m.type === 'ready');
    // Default utterance_end_ms comes from config when the query omits it.
    expect(ready.utteranceEndMs).toBe(5000);

    c.client.send(Buffer.alloc(640)); // 20 ms of silence at 16 kHz mono 16-bit
    c.client.send(Buffer.alloc(640));
    await new Promise((r) => setTimeout(r, 100));
    expect(c.jsonMessages().map((m: any) => m.type)).toEqual(['ready']);
    const record = activeVoiceSessions()[0];
    expect(record?.audioInBytes).toBe(1280);
    c.terminate();
    await c.waitClosed();
  });

  it('malformed control JSON gets a PT error message and the session survives', async () => {
    const token = seedUserToken('u-stt-3', 'org-stt-3', 'sofia');
    const c = new VoiceClient(sttUrl(token));
    expect(await c.waitOpen()).toBe(true);
    await c.waitForJson((m) => m.type === 'ready');
    c.client.send(JSON.stringify({ type: 'not-a-thing' }));
    const err = await c.waitForJson((m) => m.type === 'error');
    expect(err.code).toBe('VOICE_BAD_MESSAGE');
    expect(err.message).toBe('Mensagem de controlo inválida.');
    expect(c.closed).toBe(false);
    c.terminate();
    await c.waitClosed();
  });
});
