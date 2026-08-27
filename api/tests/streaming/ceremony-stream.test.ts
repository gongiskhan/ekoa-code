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
  CEREMONY_STREAM_MAX_MS,
  type CeremonyInput,
} from '../../src/streaming/ceremony-stream.js';
import { tokenTtlSeconds } from '../../src/streaming/auth.js';

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
    const out = openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    expect(out.token).toBeTruthy();
    expect(out.wsUrl).toBe(`${CEREMONY_WS_PATH_PREFIX}req-1`);
    expect(out.viewport).toEqual({ width: 1280, height: 800 });
    expect(getCeremonyStreamSession('req-1')).toBeDefined();
  });
});

describe('frames relay down, input relays up, and NEITHER is ever logged', () => {
  it('forwards a pushed frame to the attached viewer as a `frame` message', () => {
    const { hooks, viewer } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    expect(viewer).toEqual([true]); // attaching a viewer starts the bridge screencast

    pushCeremonyFrame('req-1', 'pair-1', 5, 'QUJD');
    const frame = ws.sent.find((s) => s.parsed.type === 'frame');
    expect(frame?.parsed).toEqual({ type: 'frame', seq: 5, jpegBase64: 'QUJD' });
  });

  it('emits a `viewport` message when the daemon reports a CSS viewport, and only re-emits on change', () => {
    // The frame carries the window's CSS-pixel viewport (D-CEREMONY-STREAM-LIVE-FIXES): the dashboard
    // maps clicks into THIS space, not the frame's own pixels (2x on HiDPI, different again for a
    // screenshot-fallback frame). It is sent once and only re-sent when the viewport actually changes,
    // so a static ceremony does not spam viewport messages.
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    const viewports = (): Array<Record<string, unknown>> =>
      ws.sent.filter((s) => s.parsed.type === 'viewport').map((s) => s.parsed);
    // attachSocket sends a placeholder viewport (the default 1280x800) before any frame arrives.
    const baseline = viewports().length;

    pushCeremonyFrame('req-1', 'pair-1', 1, 'QUJD', 1440, 782);
    expect(viewports()).toHaveLength(baseline + 1);
    expect(viewports().at(-1)).toEqual({ type: 'viewport', width: 1440, height: 782 });

    // Same viewport on the next frame: no repeat.
    pushCeremonyFrame('req-1', 'pair-1', 2, 'QUJD', 1440, 782);
    expect(viewports()).toHaveLength(baseline + 1);

    // A genuine change (window resized) re-emits.
    pushCeremonyFrame('req-1', 'pair-1', 3, 'QUJD', 1024, 640);
    expect(viewports()).toHaveLength(baseline + 2);
    expect(viewports().at(-1)).toEqual({ type: 'viewport', width: 1024, height: 640 });
  });

  it('DROPS a frame delivered by a pairing that is not the one holding the ceremony', () => {
    // Cross-tenant frame injection (adversarial review, 2026-08-26): a compromised daemon on another
    // pairing that learned this requestId must not paint this owner's dashboard. The frame path is
    // bound to the delivering pairing, exactly as the input path is.
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    pushCeremonyFrame('req-1', 'pair-ATTACKER', 9, 'attacker-image');
    expect(ws.sent.find((s) => s.parsed.type === 'frame')).toBeUndefined();
    // ...but the legitimate pairing still paints.
    pushCeremonyFrame('req-1', 'pair-1', 9, 'QUJD');
    expect(ws.sent.find((s) => s.parsed.type === 'frame')?.parsed).toMatchObject({ seq: 9 });
  });

  it('drops a frame when the viewer socket is backpressured', () => {
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    ws.bufferedAmount = 2_000_000; // over the 1MB cap
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    pushCeremonyFrame('req-1', 'pair-1', 1, 'QUJD');
    expect(ws.sent.find((s) => s.parsed.type === 'frame')).toBeUndefined();
  });

  it('relays a mouse and a key input to the bridge hook', () => {
    const { hooks, inputs } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
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
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    pushCeremonyFrame('req-1', 'pair-1', 1, 'SECRET-JPEG-DATA');
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
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
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
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    expect(getCeremonyStreamSession('req-1')!.ownerUserId).toBe('alice');
  });

  it('a second viewer takes over: the displaced socket is closed 4000', () => {
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const first = new MockWs();
    const closeSpy = vi.spyOn(first, 'close');
    getCeremonyStreamSession('req-1')!.attachSocket(first as never);
    const second = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(second as never);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('a dropped viewer socket tells the bridge to stop the screencast', () => {
    const { hooks, viewer } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    ws.fireClose();
    expect(viewer).toEqual([true, false]);
  });

  it('closeCeremonyStream tears down and unregisters', () => {
    const { hooks, viewer } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);
    closeCeremonyStream('req-1');
    expect(getCeremonyStreamSession('req-1')).toBeUndefined();
    expect(viewer.at(-1)).toBe(false);
  });

  it('REFUSES to close a stream when the requiring pairing is not the one that owns it (L4 cross-tenant DoS)', () => {
    // A refuse-push arrives at the session.push handler from ANOTHER pairing BEFORE acceptSessionPush
    // proves the pairing; its catch-side teardown must not be able to close this owner's live stream by
    // naming their requestId. closeCeremonyStream drops a requirePairingId mismatch, mirroring the
    // pairing binding pushCeremonyFrame already has (adversarial re-audit, 2026-08-26).
    const { hooks } = makeHooks();
    openCeremonyStream({ requestId: 'req-1', ownerUserId: 'alice', pairingId: 'pair-1', hooks });
    const ws = new MockWs();
    getCeremonyStreamSession('req-1')!.attachSocket(ws as never);

    closeCeremonyStream('req-1', { requirePairingId: 'pair-ATTACKER' });
    expect(getCeremonyStreamSession('req-1')).toBeDefined(); // untouched

    closeCeremonyStream('req-1', { requirePairingId: 'pair-1' }); // the owning pairing
    expect(getCeremonyStreamSession('req-1')).toBeUndefined();
  });
});

describe('the self-close backstop is a FIXED lifetime, never derived from the viewer-token TTL (L4)', () => {
  it('self-closes at CEREMONY_STREAM_MAX_MS, not at the old (tokenTtlSeconds + 30) point', () => {
    vi.useFakeTimers();
    try {
      const { hooks } = makeHooks();
      openCeremonyStream({ requestId: 'req-ttl', ownerUserId: 'alice', pairingId: 'pair-1', hooks });

      // Just before the fixed max lifetime the stream is STILL registered. This is the load-bearing
      // assertion: the backstop used to be armed at `(tokenTtlSeconds() + 30) * 1000` (630s at the
      // default 600s token TTL), so at this point the stream would already have been torn down - and
      // lowering EKOA_STREAMING_TOKEN_TTL_SECONDS made that gap arbitrarily worse, cutting a live
      // login short. Pinned to CEREMONY_STREAM_MAX_MS, it survives here.
      vi.advanceTimersByTime(CEREMONY_STREAM_MAX_MS - 1000);
      expect(getCeremonyStreamSession('req-ttl')).toBeDefined();

      // At the fixed lifetime it self-closes and unregisters, so the registry entry never leaks.
      vi.advanceTimersByTime(1001);
      expect(getCeremonyStreamSession('req-ttl')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the backstop const is a fixed 11 minutes, past the ceremony window and above the token TTL', () => {
    expect(CEREMONY_STREAM_MAX_MS).toBe(11 * 60_000);
    // Independent of - and dominating - the viewer-token TTL knob, so no value of
    // EKOA_STREAMING_TOKEN_TTL_SECONDS can shorten it below the daemon's ceremony window.
    expect(CEREMONY_STREAM_MAX_MS).toBeGreaterThan((tokenTtlSeconds() + 30) * 1000);
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
