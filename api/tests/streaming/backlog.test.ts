import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StreamSession } from '../../src/streaming/session.js';
import type { ScreencastFrame } from '../../src/streaming/cdp.js';

/**
 * Remote-display test 2/4 (spec §13.3): frame relay down — backlog backpressure and the
 * privacy invariant that frame bytes are never logged. Ported verbatim from
 * cortex/tests/streaming/backlog.test.ts (fake CDP/WS doubles; no real browser).
 */
class FakeWebSocket {
  sent: string[] = [];
  send(payload: string, cb?: (err?: Error) => void) {
    this.sent.push(payload);
    if (cb) setImmediate(() => cb());
  }
  on(_evt: string, _fn: any) { return this; }
  close(_code?: number, _reason?: string) {}
}

class FakeCdp {
  acks: number[] = [];
  send = vi.fn(async (method: string, params: any) => {
    if (method === 'Page.screencastFrameAck') {
      this.acks.push(params.sessionId);
    }
    return undefined;
  });
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
  const cdp = new FakeCdp();
  session._setCdp(cdp as any);
  session._setViewport({ width: 1280, height: 800 });
  return { session, cdp };
}

function frame(sessionId: number): ScreencastFrame {
  return { data: 'AAAA', sessionId, metadata: {} };
}

describe('streaming session — backlog backpressure', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('drops frames when in-flight backlog reaches the limit', async () => {
    const { session, cdp } = buildSession();
    const ws = new FakeWebSocket();
    session.attachSocket(ws as any);

    // Default limit is 3. Hold the in-flight count at the limit and confirm
    // new frames are dropped client-side but still ACKed to CDP.
    session._setBacklog(3);
    await session._deliverFrame(frame(101));
    await session._deliverFrame(frame(102));

    // No frame messages forwarded; only the initial viewport on attach.
    const frameSends = ws.sent.filter((s) => s.includes('"type":"frame"'));
    expect(frameSends.length).toBe(0);
    // CDP ack still happened so screencast doesn't stall.
    expect(cdp.acks).toEqual([101, 102]);
  });

  it('forwards frames when backlog is below the limit', async () => {
    const { session, cdp } = buildSession();
    const ws = new FakeWebSocket();
    session.attachSocket(ws as any);

    session._setBacklog(0);
    await session._deliverFrame(frame(201));
    await session._deliverFrame(frame(202));

    const frameSends = ws.sent.filter((s) => s.includes('"type":"frame"'));
    expect(frameSends.length).toBe(2);
    expect(cdp.acks).toEqual([201, 202]);
  });

  it('still ACKs to CDP even when there is no client socket attached', async () => {
    const { session, cdp } = buildSession();
    // No attachSocket call — forwarding path drops to ACK-only.
    await session._deliverFrame(frame(301));
    expect(cdp.acks).toEqual([301]);
  });

  it('does not log frame contents in any telemetry path', async () => {
    const logs: Array<[string, Record<string, unknown>]> = [];
    const session = new StreamSession({
      traceId: 't1',
      page: {} as any,
      ownerUserId: 'u1',
      isPaused: () => 'paused_for_user',
      onLog: (event, fields) => logs.push([event, fields]),
    });
    session._setCdp(new FakeCdp() as any);
    session._setViewport({ width: 1280, height: 800 });
    const ws = new FakeWebSocket();
    session.attachSocket(ws as any);
    await session._deliverFrame(frame(401));
    await session.close('test');
    for (const [, fields] of logs) {
      const json = JSON.stringify(fields);
      expect(json).not.toContain('jpegBase64');
      expect(json).not.toContain('AAAA');
    }
  });
});
