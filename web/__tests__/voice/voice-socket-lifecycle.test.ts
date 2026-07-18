/**
 * C4 lifecycle regression tests (codex review): the STT/TTS socket edge cases that leak or
 * misbehave under a deliberate close or a barge-in that races the socket opening. Zero mocks
 * beyond a hand-rolled fake WebSocket (no vendor, no real network).
 */
import { describe, it, expect, vi } from 'vitest';
import { createSttSocket, type WebSocketLike } from '../../lib/voice/stt-socket';
import { createTtsSocket } from '../../lib/voice/tts-socket';

const WS_OPEN = 1;

/** A controllable fake: the test decides WHEN open resolves and delivers frames by hand. */
function makeFakeSocket() {
  const sent: (string | ArrayBuffer)[] = [];
  const sock: WebSocketLike = {
    binaryType: 'arraybuffer',
    readyState: 0,
    send: (d) => sent.push(d),
    close: () => {
      sock.readyState = 3;
      sock.onclose?.(undefined as never);
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  return {
    sock,
    sent,
    open: () => {
      sock.readyState = WS_OPEN;
      sock.onopen?.(undefined as never);
    },
    deliver: (data: unknown) => sock.onmessage?.({ data } as never),
  };
}

describe('stt-socket: late frames after a deliberate close', () => {
  it('drops a queued error frame arriving after close() - no spurious error (codex C4)', async () => {
    const f = makeFakeSocket();
    const onMessage = vi.fn();
    const stt = createSttSocket({
      baseUrl: 'http://x',
      token: 't',
      sampleRate: 16000,
      utteranceEndMs: 2000,
      createWebSocket: () => f.sock,
      onMessage,
      onClose: () => {},
    });
    const opened = stt.open();
    f.open();
    await opened;
    stt.close(); // deliberate close
    f.deliver(JSON.stringify({ type: 'error', code: 'VOICE_PROVIDER_ERROR', message: 'x' }));
    expect(onMessage).not.toHaveBeenCalled();
  });
});

describe('tts-socket: barge-in while the socket is still opening', () => {
  it('a clear() before open resolves cancels the queued say - no stale say sent (codex C4)', async () => {
    const f = makeFakeSocket();
    const tts = createTtsSocket({
      baseUrl: 'http://x',
      getToken: () => 't',
      createWebSocket: () => f.sock,
      onMessage: () => {},
      onAudio: () => {},
    });
    const sayP = tts.say('ola', 'pt-PT'); // begins awaiting the open
    tts.clear(); // barge-in arrives BEFORE the socket opens
    f.open();
    await sayP;
    // Only the clear (if any) may be on the wire - never the stale say.
    const says = f.sent.filter((m) => typeof m === 'string' && m.includes('"say"'));
    expect(says).toHaveLength(0);
  });

  it('a normal say (no clear) IS sent once open resolves', async () => {
    const f = makeFakeSocket();
    const tts = createTtsSocket({
      baseUrl: 'http://x',
      getToken: () => 't',
      createWebSocket: () => f.sock,
      onMessage: () => {},
      onAudio: () => {},
    });
    const sayP = tts.say('ola', 'pt-PT');
    f.open();
    await sayP;
    const says = f.sent.filter((m) => typeof m === 'string' && m.includes('"say"'));
    expect(says).toHaveLength(1);
  });
});
