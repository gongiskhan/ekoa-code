import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket as WsClient } from 'ws';
import { attachCanvasServer, CANVAS_WS_PATH_PREFIX } from '../../src/streaming/index.js';
import { signStreamToken } from '../../src/streaming/auth.js';
import { StreamSession } from '../../src/streaming/session.js';
import { registerSession, clearAllSessionsForTest } from '../../src/streaming/registry.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * attachCanvasServer upgrade handshake (ch03 §3.7). Exercises the adapted auth path end-to-end
 * over a real HTTP upgrade + ws client: a valid token whose subject matches the session owner
 * connects and receives the initial viewport frame; a token minted for a different user, a
 * garbage token, and a token for a trace with no live session are all rejected before the
 * socket opens (the self-contained ownership + liveness gate, module-map §2.6). CDP/page are
 * stubbed — no real browser.
 */
class FakeCdp {
  send = vi.fn(async () => undefined);
  detach = vi.fn(async () => {});
  on() { return this; }
}

let server: Server;
let logs: Array<[string, Record<string, unknown>]>;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'test-key';
  process.env.JWT_SECRET = 'test-secret';
  __resetConfigForTests();
  loadConfig();
});

afterEach(async () => {
  await clearAllSessionsForTest();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function authFailureReasons(): unknown[] {
  return logs.filter(([e]) => e === 'streaming.auth_failure').map(([, f]) => f.reason);
}

async function startServer(): Promise<number> {
  logs = [];
  server = createServer();
  attachCanvasServer(server, { log: (event, fields) => logs.push([event, fields]) });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return (server.address() as AddressInfo).port;
}

function seedSession(traceId: string, ownerUserId: string): void {
  const session = new StreamSession({
    traceId,
    page: {} as any,
    ownerUserId,
    isPaused: () => 'paused_for_user',
    onLog: () => {},
  });
  session._setCdp(new FakeCdp() as any);
  session._setViewport({ width: 1024, height: 768 });
  registerSession(traceId, session);
}

/** Resolve { opened, message } — opened:true with the first server message, or opened:false
 *  when the handshake is rejected (error / unexpected-response / no open within the timeout). */
function tryConnect(port: number, traceId: string, token: string): Promise<{ opened: boolean; message?: any }> {
  const url = `ws://127.0.0.1:${port}${CANVAS_WS_PATH_PREFIX}${traceId}?token=${encodeURIComponent(token)}`;
  return new Promise((resolve) => {
    const client = new WsClient(url);
    let settled = false;
    const done = (r: { opened: boolean; message?: any }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.terminate(); } catch { /* already closed */ }
      resolve(r);
    };
    const timer = setTimeout(() => done({ opened: false }), 4000);
    client.on('message', (data) => done({ opened: true, message: JSON.parse(data.toString()) }));
    client.on('error', () => done({ opened: false }));
    client.on('unexpected-response', () => done({ opened: false }));
  });
}

describe('attachCanvasServer — upgrade auth', () => {
  it('accepts a valid token whose subject owns the session and sends the viewport', async () => {
    const port = await startServer();
    seedSession('t1', 'u1');
    const token = signStreamToken({ userId: 'u1', traceId: 't1' });
    const result = await tryConnect(port, 't1', token);
    expect(result.opened).toBe(true);
    expect(result.message).toMatchObject({ type: 'viewport', width: 1024, height: 768 });
  });

  it('rejects a token minted for a different user (ownership mismatch)', async () => {
    const port = await startServer();
    seedSession('t1', 'u1');
    const attackerToken = signStreamToken({ userId: 'attacker', traceId: 't1' });
    const result = await tryConnect(port, 't1', attackerToken);
    expect(result.opened).toBe(false);
    expect(authFailureReasons()).toContain('ownership-mismatch');
  });

  it('rejects a garbage token', async () => {
    const port = await startServer();
    seedSession('t1', 'u1');
    const result = await tryConnect(port, 't1', 'not-a-jwt');
    expect(result.opened).toBe(false);
    expect(authFailureReasons()).toContain('jwt-invalid');
  });

  it('rejects a valid token when no live session exists for the trace', async () => {
    const port = await startServer();
    // No seedSession for t-none.
    const token = signStreamToken({ userId: 'u1', traceId: 't-none' });
    const result = await tryConnect(port, 't-none', token);
    expect(result.opened).toBe(false);
  });
});
