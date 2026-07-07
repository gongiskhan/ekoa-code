import { describe, it, expect, vi } from 'vitest';
import { StreamSession } from '../../src/streaming/session.js';

/**
 * Remote-display test 4/4 (spec §13.3): input relay up, gated on run state. Mouse/keyboard is
 * dispatched to CDP ONLY while the run reports `paused_for_user` and the session is open;
 * ping/pong bypasses the gate; coordinates clamp to the viewport. Ported verbatim from
 * cortex/tests/streaming/state-gate.test.ts.
 */
class FakeWebSocket {
  sent: string[] = [];
  send(payload: string, cb?: (err?: Error) => void) {
    this.sent.push(payload);
    if (cb) setImmediate(() => cb());
  }
  on(_evt: string, _fn: any) { return this; }
  close() {}
}

class FakeCdp {
  calls: Array<{ method: string; params: any }> = [];
  send = vi.fn(async (method: string, params: any) => {
    this.calls.push({ method, params });
    return undefined;
  });
  detach = vi.fn(async () => {});
  on() { return this; }
}

function buildSession(isPaused: () => 'paused_for_user' | 'other', logs?: Array<[string, Record<string, unknown>]>) {
  const session = new StreamSession({
    traceId: 't1',
    page: {} as any,
    ownerUserId: 'u1',
    isPaused,
    onLog: logs ? (event, fields) => logs.push([event, fields]) : undefined,
  });
  const cdp = new FakeCdp();
  session._setCdp(cdp as any);
  session._setViewport({ width: 1280, height: 800 });
  const ws = new FakeWebSocket();
  session.attachSocket(ws as any);
  return { session, cdp, ws };
}

const mouseDown = JSON.stringify({
  type: 'mouse',
  action: 'down',
  x: 100,
  y: 200,
  button: 'left',
});

const keyDown = JSON.stringify({
  type: 'key',
  action: 'down',
  key: 'a',
  code: 'KeyA',
});

describe('streaming session — state gating', () => {
  it('dispatches mouse input when run is paused_for_user', async () => {
    const { session, cdp } = buildSession(() => 'paused_for_user');
    await session._injectClientMessage(mouseDown);
    const dispatched = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]?.params.type).toBe('mousePressed');
  });

  it('drops mouse input when run is not paused', async () => {
    const logs: Array<[string, Record<string, unknown>]> = [];
    const { session, cdp } = buildSession(() => 'other', logs);
    await session._injectClientMessage(mouseDown);
    const dispatched = cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    expect(dispatched.length).toBe(0);
    expect(logs.find(([e]) => e === 'streaming.auth_failure')?.[1]?.reason).toBe('state-not-paused');
  });

  it('drops keyboard input when run is not paused', async () => {
    const { session, cdp } = buildSession(() => 'other');
    await session._injectClientMessage(keyDown);
    const dispatched = cdp.calls.filter((c) => c.method === 'Input.dispatchKeyEvent');
    expect(dispatched.length).toBe(0);
  });

  it('handles ping with pong without state check', async () => {
    const { session, ws } = buildSession(() => 'other');
    await session._injectClientMessage(JSON.stringify({ type: 'ping', t: 42 }));
    const pongs = ws.sent.filter((s) => s.includes('"type":"pong"'));
    expect(pongs.length).toBe(1);
    expect(pongs[0]).toContain('"t":42');
  });

  it('ignores malformed JSON without throwing', async () => {
    const { session, cdp } = buildSession(() => 'paused_for_user');
    await session._injectClientMessage('not-json{');
    expect(cdp.calls.length).toBe(0);
  });

  it('clamps coordinates to the viewport on dispatch', async () => {
    const { session, cdp } = buildSession(() => 'paused_for_user');
    await session._injectClientMessage(JSON.stringify({
      type: 'mouse', action: 'move', x: 99999, y: -50,
    }));
    const dispatched = cdp.calls.find((c) => c.method === 'Input.dispatchMouseEvent');
    expect(dispatched?.params.x).toBe(1280);
    expect(dispatched?.params.y).toBe(0);
  });

  it('once close() runs, further input is rejected even if isPaused returns paused_for_user', async () => {
    const { session, cdp } = buildSession(() => 'paused_for_user');
    await session.close('test');
    await session._injectClientMessage(mouseDown);
    expect(cdp.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length).toBe(0);
  });

  it('drops input past the backpressure cap instead of piling unbounded pending CDP work (Codex G8)', async () => {
    const logs: Array<[string, Record<string, unknown>]> = [];
    const { session, cdp } = buildSession(() => 'paused_for_user', logs);
    // Make each dispatch hang so the queue fills: the CDP send never resolves during the burst.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    cdp.send = vi.fn(async (method: string, params: any) => {
      cdp.calls.push({ method, params });
      await gate; // hold every dispatch open
    }) as any;
    // Fire far more than the cap (32) without awaiting — they queue onto the serialized chain.
    const bursts = Array.from({ length: 80 }, () => session._injectClientMessage(mouseDown));
    // The first dispatch is in-flight (awaiting gate); the queue holds up to the cap; the rest drop.
    await new Promise((r) => setTimeout(r, 20));
    const dropped = logs.filter(([e, f]) => e === 'streaming.input_dropped' && f.reason === 'backpressure');
    expect(dropped.length).toBeGreaterThan(0);
    // At most cap+1 dispatches ever reached CDP (one in-flight + queue), never all 80.
    expect(cdp.calls.length).toBeLessThanOrEqual(33);
    release();
    await Promise.allSettled(bursts);
  });
});
