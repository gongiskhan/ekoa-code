import { describe, it, expect, vi } from 'vitest';
import { StreamSession } from '../../src/streaming/session.js';

/**
 * Landmine 8 / spec §3.7 close-code contract, made explicit at the socket level: 1000 is a
 * normal teardown, 4000 is a socket-level takeover after which the client must NOT reconnect.
 * The ported registry test covers the session-level 'replaced' reason; this asserts the actual
 * WebSocket close codes on the wire, which the original four did not exercise directly.
 */
class FakeWebSocket {
  sent: string[] = [];
  closes: Array<{ code?: number; reason?: string }> = [];
  send(payload: string, cb?: (err?: Error) => void) {
    this.sent.push(payload);
    if (cb) setImmediate(() => cb());
  }
  on(_evt: string, _fn: any) { return this; }
  close(code?: number, reason?: string) { this.closes.push({ code, reason }); }
}

class FakeCdp {
  send = vi.fn(async () => undefined);
  detach = vi.fn(async () => {});
  on() { return this; }
}

function buildSession() {
  const session = new StreamSession({
    traceId: 't1',
    page: {} as any,
    ownerUserId: 'u1',
    isPaused: () => 'paused_for_user',
  });
  session._setCdp(new FakeCdp() as any);
  session._setViewport({ width: 1280, height: 800 });
  return session;
}

describe('streaming session — close-code contract (landmine 8)', () => {
  it('normal teardown closes the socket with 1000', async () => {
    const session = buildSession();
    const ws = new FakeWebSocket();
    session.attachSocket(ws as any);
    await session.close('done');
    expect(ws.closes).toEqual([{ code: 1000, reason: 'done' }]);
  });

  it('a socket-level takeover closes the displaced socket with 4000', () => {
    const session = buildSession();
    const first = new FakeWebSocket();
    const second = new FakeWebSocket();
    session.attachSocket(first as any);
    // Second client grabs the same live view: the first socket is taken over.
    session.attachSocket(second as any);
    expect(first.closes).toEqual([{ code: 4000, reason: 'replaced' }]);
    // The taking-over socket is NOT closed.
    expect(second.closes).toEqual([]);
  });

  it('does not send 4000 on a normal teardown (4000 is takeover-only)', async () => {
    const session = buildSession();
    const ws = new FakeWebSocket();
    session.attachSocket(ws as any);
    await session.close('done');
    expect(ws.closes.some((c) => c.code === 4000)).toBe(false);
  });
});
