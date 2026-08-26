import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import {
  openCeremonyStream,
  pushCeremonyFrame,
  closeCeremonyStream,
  getCeremonyStreamSession,
  __resetCeremonyStreamsForTest,
  _extractRequestIdForTest,
  _parseTokenForTest,
  CEREMONY_WS_PATH_PREFIX,
  type CeremonyInput,
} from '../../src/streaming/ceremony-stream.js';

/**
 * The Cortex half of the attended-ceremony live view (D-CEREMONY-STREAM): frames from the bridge go
 * DOWN a viewer socket, the human's input goes UP and out to the bridge as `ceremony.input`. These
 * assert the relay, the owner scoping, the lifecycle, and - load-bearing - that a keystroke or a
 * frame is NEVER logged.
 */

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key';
  process.env.JWT_SECRET = 'test-secret';
  __resetConfigForTests();
  loadConfig();
});

interface Sent {
  raw: string;
  parsed: Record<string, unknown>;
}

/** A WebSocket stand-in: records sends, lets the test fire inbound messages and the close event. */
class MockWs {
  static OPEN = 1;
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  sent: Sent[] = [];
  private handlers: Record<string, (arg?: unknown) => void> = {};
  send(raw: string): void {
    this.sent.push({ raw, parsed: JSON.parse(raw) });
  }
  close(): void {
    this.handlers.close?.();
  }
  on(event: string, handler: (arg?: unknown) => void): void {
    this.handlers[event] = handler;
  }
  fireMessage(msg: unknown): void {
    this.handlers.message?.(JSON.stringify(msg));
  }
  fireClose(): void {
    this.handlers.close?.();
  }
}

function makeHooks() {
  const inputs: CeremonyInput[] = [];
  const viewer: boolean[] = [];
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  return {
    inputs,
    viewer,
    logs,
    hooks: {
      sendInput: (e: CeremonyInput) => inputs.push(e),
      onViewerChange: (on: boolean) => viewer.push(on),
      log: (event: string, fields: Record<string, unknown>) => logs.push({ event, fields }),
    },
  };
}

beforeEach(() => {
  __resetCeremonyStreamsForTest();
});

describe('openCeremonyStream mints the viewer triple', () => {
  it('returns a token, the requestId-scoped wsUrl and the viewport', () => {
    const { hooks } = makeHooks();
    const out = openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    expect(out.token).toBeTruthy();
    expect(out.wsUrl).toBe(`${CEREMONY_WS_PATH_PREFIX}req-1`);
    expect(out.viewport).toEqual({ width: 1280, height: 800 });
    expect(getCeremonyStreamSession('req-1')).toBeDefined();
  });
});

describe('frames relay down, input relays up, and NEITHER is ever logged', () => {
  it('forwards a pushed frame to the attached viewer as a `frame` message', () => {
    const { hooks, viewer } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    expect(viewer).toEqual([true]); // attaching a viewer starts the bridge screencast

    pushCeremonyFrame('req-1', 5, 'QUJD');
    const frame = ws.sent.find((s) => s.parsed.type === 'frame');
    expect(frame?.parsed).toEqual({ type: 'frame', seq: 5, jpegBase64: 'QUJD' });
  });

  it('drops a frame when the viewer socket is backpressured', () => {
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    ws.bufferedAmount = 2_000_000; // over the 1MB cap
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    pushCeremonyFrame('req-1', 1, 'QUJD');
    expect(ws.sent.find((s) => s.parsed.type === 'frame')).toBeUndefined();
  });

  it('relays a mouse and a key input to the bridge hook', () => {
    const { hooks, inputs } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);

    ws.fireMessage({ type: 'mouse', x: 10, y: 20, action: 'down', button: 'left' });
    ws.fireMessage({ type: 'key', code: 'KeyP', key: 'p', action: 'down' });
    // frame_ack / ping are not relayed (the bridge caps its own rate).
    ws.fireMessage({ type: 'frame_ack', seq: 3 });

    expect(inputs).toHaveLength(2);
    expect(inputs[0]).toMatchObject({ type: 'mouse', action: 'down', button: 'left' });
    expect(inputs[1]).toMatchObject({ type: 'key', key: 'p', action: 'down' });
  });

  it('NEVER logs a frame or an input payload - a keystroke may be a password character', () => {
    const { hooks, logs } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    pushCeremonyFrame('req-1', 1, 'SECRET-JPEG-DATA');
    ws.fireMessage({ type: 'key', code: 'KeyS', key: 's', action: 'down' });
    ws.fireMessage({ type: 'key', code: 'KeyecretChar', key: 'x-secret-char', action: 'down' });

    const dump = JSON.stringify(logs);
    expect(dump).not.toContain('SECRET-JPEG-DATA');
    expect(dump).not.toContain('x-secret-char');
    expect(dump).not.toContain('jpegBase64');
    // Only requestId-keyed lifecycle events are logged.
    for (const { fields } of logs) {
      expect(Object.keys(fields).every((k) => k === 'requestId' || k === 'reason')).toBe(true);
    }
  });

  it('a message that fails the client schema is dropped, never relayed or logged', () => {
    const { hooks, inputs, logs } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    ws.fireMessage({ type: 'bogus', secret: 'x-secret-char' });
    expect(inputs).toEqual([]);
    expect(JSON.stringify(logs)).not.toContain('x-secret-char');
  });
});

describe('ownership + lifecycle', () => {
  it('records the owner so the upgrade gate can scope the socket', () => {
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    expect(getCeremonyStreamSession('req-1')!.ownerUserId).toBe('alice');
  });

  it('a second viewer takes over: the displaced socket is closed 4000', () => {
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const first = new MockWs();
    const closeSpy = vi.spyOn(first, 'close');
    getCeremonyStreamSession('req-1')!.attachSocket(first as never);
    const second = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(second as never);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('a dropped viewer socket tells the bridge to stop the screencast', () => {
    const { hooks, viewer } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    ws.fireClose();
    expect(viewer).toEqual([true, false]);
  });

  it('closeCeremonyStream tears down and unregisters', () => {
    const { hooks, viewer } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    closeCeremonyStream('req-1');
    expect(getCeremonyStreamSession('req-1')).toBeUndefined();
    expect(viewer.at(-1)).toBe(false);
  });
});

describe('upgrade URL helpers', () => {
  it('extracts a requestId and rejects a path-traversal id', () => {
    expect(_extractRequestIdForTest(`${CEREMONY_WS_PATH_PREFIX}req-1?token=x`)).toBe('req-1');
    expect(_extractRequestIdForTest(`${CEREMONY_WS_PATH_PREFIX}a/b`)).toBeNull();
    expect(_extractRequestIdForTest('/other/req-1')).toBeNull();
  });
  it('parses the token query param', () => {
    expect(_parseTokenForTest(`${CEREMONY_WS_PATH_PREFIX}req-1?token=abc`)).toBe('abc');
    expect(_parseTokenForTest(`${CEREMONY_WS_PATH_PREFIX}req-1`)).toBeUndefined();
  });
});
