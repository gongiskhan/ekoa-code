import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket as ServerWebSocket } from 'ws';
import { BridgeSocket, type BridgeSocketState } from '../../src/transport/index.js';
import type { BridgeFrame } from '../../src/wire/index.js';

/** Fast backoff for tests: ms-scale so reconnect scenarios complete quickly. */
const TEST_BACKOFF = { initialMs: 30, maxMs: 120, stabilityMs: 50, pongTimeoutMs: 200, heartbeatMs: 250 };

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function until(cond: () => boolean, timeoutMs = 3_000, step = 10): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('condition not reached in time');
    await wait(step);
  }
}

describe('BridgeSocket', () => {
  let server: Server;
  let wss: WebSocketServer;
  let port: number;
  let serverSockets: ServerWebSocket[];
  let serverReceived: unknown[][];
  let seenAuth: (string | undefined)[];
  let upgradePaths: string[];
  let socket: BridgeSocket | undefined;

  beforeEach(async () => {
    serverSockets = [];
    serverReceived = [];
    seenAuth = [];
    upgradePaths = [];
    server = createServer();
    wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req: IncomingMessage, sock, head) => {
      seenAuth.push(req.headers.authorization);
      upgradePaths.push(req.url ?? '');
      wss.handleUpgrade(req, sock, head, (ws) => {
        // Attach the collector at accept time: frames flushed on the client's 'open' would be
        // missed by any listener attached later in a test body.
        const box: unknown[] = [];
        ws.on('message', (d) => box.push(JSON.parse(d.toString())));
        serverReceived.push(box);
        serverSockets.push(ws);
      });
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    socket?.close();
    for (const ws of serverSockets) {
      try { ws.terminate(); } catch { /* gone */ }
    }
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  });

  function makeSocket(over: Partial<ConstructorParameters<typeof BridgeSocket>[0]> = {}): {
    sock: BridgeSocket;
    frames: BridgeFrame[];
    states: BridgeSocketState[];
    tokenCalls: () => number;
  } {
    const frames: BridgeFrame[] = [];
    const states: BridgeSocketState[] = [];
    let tokens = 0;
    const sock = new BridgeSocket({
      wsBase: `http://127.0.0.1:${port}`,
      pairingId: 'p-test',
      getToken: async () => {
        tokens += 1;
        return `tok-${tokens}`;
      },
      onFrame: (f) => frames.push(f),
      onStateChange: (s) => states.push(s),
      backoff: TEST_BACKOFF,
      ...over,
    });
    socket = sock;
    return { sock, frames, states, tokenCalls: () => tokens };
  }

  it('dials with the bearer header on the pairing path and reaches open', async () => {
    const { sock } = makeSocket();
    await sock.connect();
    await until(() => sock.currentState() === 'open');
    expect(seenAuth[0]).toBe('Bearer tok-1');
    expect(upgradePaths[0]).toBe('/api/v1/bridge/connect/p-test');
  });

  it('answers BridgeFrame-level ping with pong and delivers valid frames only', async () => {
    const { sock, frames } = makeSocket();
    await sock.connect();
    await until(() => serverSockets.length === 1);

    serverSockets[0]!.send('not json at all');
    serverSockets[0]!.send(JSON.stringify({ type: 'wrong-shape', x: 1 }));
    serverSockets[0]!.send(JSON.stringify({ type: 'ping' }));
    serverSockets[0]!.send(JSON.stringify({ type: 'cancel', taskId: 't-1' }));

    await until(() => frames.length === 1 && serverReceived[0]!.length === 1);
    expect(frames[0]).toEqual({ type: 'cancel', taskId: 't-1' });
    expect(serverReceived[0]![0]).toEqual({ type: 'pong' });
  });

  it('reconnects after a server-side drop, minting a fresh token per dial', async () => {
    const { sock, tokenCalls } = makeSocket();
    await sock.connect();
    await until(() => serverSockets.length === 1);
    expect(tokenCalls()).toBe(1);

    serverSockets[0]!.terminate();
    await until(() => serverSockets.length === 2);
    await until(() => sock.currentState() === 'open');
    expect(tokenCalls()).toBe(2);
    expect(seenAuth[1]).toBe('Bearer tok-2');
  });

  it("close(1000,'revoked') is TERMINAL: state revoked, no redial in the observation window", async () => {
    const { sock } = makeSocket();
    await sock.connect();
    await until(() => serverSockets.length === 1);

    serverSockets[0]!.close(1000, 'revoked');
    await until(() => sock.currentState() === 'revoked');

    const dialsBefore = seenAuth.length;
    await wait(TEST_BACKOFF.maxMs * 3); // several backoff periods
    expect(seenAuth.length).toBe(dialsBefore);
    expect(sock.currentState()).toBe('revoked');
  });

  it("close(1000,'replaced') reconnects with normal backoff", async () => {
    const { sock } = makeSocket();
    await sock.connect();
    await until(() => serverSockets.length === 1);
    serverSockets[0]!.close(1000, 'replaced');
    await until(() => serverSockets.length === 2);
    await until(() => sock.currentState() === 'open');
  });

  it('a refused upgrade with reason pairing-revoked is terminal', async () => {
    server.removeAllListeners('upgrade');
    server.on('upgrade', (_req, sock2) => {
      const payload = JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x', details: { reason: 'pairing-revoked' } } });
      sock2.write(
        'HTTP/1.1 401 Unauthorized\r\n' +
          'Content-Type: application/json\r\n' +
          `Content-Length: ${Buffer.byteLength(payload)}\r\n` +
          'Connection: close\r\n\r\n' +
          payload,
      );
      sock2.destroy();
    });
    const { sock } = makeSocket();
    await sock.connect();
    await until(() => sock.currentState() === 'revoked');
    const dials = seenAuth.length;
    await wait(TEST_BACKOFF.maxMs * 3);
    expect(seenAuth.length).toBe(dials);
  });

  it('a refused upgrade with a NON-revoked reason keeps reconnecting', async () => {
    let refusals = 0;
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req: IncomingMessage, sock2, head) => {
      seenAuth.push(req.headers.authorization);
      if (refusals < 2) {
        refusals += 1;
        const payload = JSON.stringify({ error: { code: 'INTERNAL', message: 'transient' } });
        sock2.write(`HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(payload)}\r\nConnection: close\r\n\r\n${payload}`);
        sock2.destroy();
        return;
      }
      wss.handleUpgrade(req, sock2, head, (ws) => serverSockets.push(ws));
    });
    const { sock } = makeSocket();
    await sock.connect();
    await until(() => sock.currentState() === 'open', 5_000);
    expect(seenAuth.length).toBeGreaterThanOrEqual(3);
  });

  it('queues frames while reconnecting (bounded drop-oldest) and flushes on open', async () => {
    const { sock } = makeSocket();
    await sock.connect();
    await until(() => serverSockets.length === 1);

    serverSockets[0]!.terminate();
    await until(() => sock.currentState() === 'reconnecting');

    for (let i = 0; i < 105; i += 1) {
      sock.send({ type: 'denial', taskId: `t-${i}`, reason: 'r', principle: 'S2' });
    }

    await until(() => serverSockets.length === 2);
    await until(() => serverReceived[1]!.length === 100, 5_000);
    // Drop-oldest: the first 5 were discarded; the queue kept t-5..t-104.
    expect((serverReceived[1]![0] as { taskId: string }).taskId).toBe('t-5');
    expect((serverReceived[1]![99] as { taskId: string }).taskId).toBe('t-104');
  });
});
