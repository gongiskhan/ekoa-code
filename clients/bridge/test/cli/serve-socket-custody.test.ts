import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket as ServerWebSocket } from 'ws';
import { BridgeSocket, type BridgeSocketState } from '../../src/transport/index.js';
import { socketStateHandler } from '../../src/cli/commands/serve.js';
import type { BridgeFrame } from '../../src/wire/index.js';

/**
 * SECURITY SUITE - the delivered session is dropped when the CHANNEL goes away, and this test
 * exercises the WIRING that drops it rather than the method it calls (S-inject, review round F2).
 *
 * WHY THIS FILE EXISTS AND `session-injection.test.ts` WAS NOT ENOUGH. That suite has a case named
 * "drops every held session when the socket goes away", and it calls `runtime.clearSessions()`
 * directly. It therefore pins the METHOD while leaving the only thing that CALLS the method - the
 * socket's state callback in `serve` - free to be deleted with the whole suite still green: a test
 * that cannot fail for the defect it is named after. Review found exactly that.
 *
 * So this drives a REAL `BridgeSocket` against a REAL WebSocket server, hands it the REAL production
 * callback (`socketStateHandler`, which `serve` wires and which was extracted from an inline lambda
 * for this reason), holds a session in a runtime double, and kills the server end. The assertion is
 * on the state of the hold AFTER a genuine transport-level drop.
 *
 * WHY THE BACKSTOP MATTERS. `SessionHold.sweep` is passive - it runs only inside `deliver`/`get`,
 * matching `SecretHold` - so an idle daemon sitting in `reconnecting` never sweeps. This callback is
 * the ONLY thing that drops a delivered, credential-equivalent `storageState` when the channel dies,
 * and a `reconnecting` period can be long.
 */

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

/** Stands in for `DaemonRuntime` at exactly the surface the handler uses. The real runtime's own
 *  hold behaviour is proven in `security/session-injection.test.ts`; what is under test HERE is
 *  whether a real socket drop reaches `clearSessions` at all. */
function runtimeDouble(): { clearSessions(): void; held: () => number } {
  let held = 1; // one delivered session, resident
  return {
    clearSessions: () => {
      held = 0;
    },
    held: () => held,
  };
}

const noopIo = { out: (): void => undefined, err: (): void => undefined };

describe('a delivered session does not survive the socket that authorised it', () => {
  let server: Server;
  let wss: WebSocketServer;
  let port: number;
  let serverSockets: ServerWebSocket[];
  let socket: BridgeSocket | undefined;

  beforeEach(async () => {
    serverSockets = [];
    server = createServer();
    wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req: IncomingMessage, sock, head) => {
      wss.handleUpgrade(req, sock, head, (ws) => {
        serverSockets.push(ws);
      });
    });
    await new Promise<void>((r) => server.listen(0, () => r()));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    socket?.close();
    for (const ws of serverSockets) {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }
    await new Promise<void>((r) => wss.close(() => r()));
    await new Promise<void>((r) => server.close(() => r()));
  });

  /** A socket wired the way `serve` wires it: the production state handler, nothing re-implemented. */
  function makeWiredSocket(runtime: { clearSessions(): void }): {
    sock: BridgeSocket;
    states: BridgeSocketState[];
    advertised: () => number;
  } {
    const states: BridgeSocketState[] = [];
    let advertised = 0;
    const handler = socketStateHandler({
      io: noopIo,
      runtime,
      advertise: () => {
        advertised += 1;
      },
    });
    const sock = new BridgeSocket({
      wsBase: `http://127.0.0.1:${port}`,
      pairingId: 'p-custody',
      getToken: async () => 'tok',
      onFrame: (_f: BridgeFrame) => undefined,
      onStateChange: (s) => {
        states.push(s);
        handler(s);
      },
      backoff: TEST_BACKOFF,
    });
    socket = sock;
    return { sock, states, advertised: () => advertised };
  }

  it('KEEPS the session while the socket is open', async () => {
    const runtime = runtimeDouble();
    const { sock, advertised } = makeWiredSocket(runtime);

    await sock.connect();
    await until(() => sock.currentState() === 'open');

    // Non-vacuity for every case below: reaching `open` must not itself clear. `open` is the channel
    // ARRIVING, and clearing on it would wipe a delivery that raced the callback.
    expect(runtime.held()).toBe(1);
    expect(advertised()).toBe(1);
  });

  it('drops the session when the server kills the connection (reconnecting)', async () => {
    const runtime = runtimeDouble();
    const { sock, states } = makeWiredSocket(runtime);

    await sock.connect();
    await until(() => sock.currentState() === 'open' && serverSockets.length === 1);
    expect(runtime.held()).toBe(1);

    // A REAL transport drop, not a synthetic state push: the server end goes away and the socket's
    // own reconnect path is what produces the state change.
    serverSockets[0]!.terminate();

    await until(() => states.includes('reconnecting'));
    expect(runtime.held()).toBe(0);
  });

  it('drops the session when the daemon closes the socket itself', async () => {
    const runtime = runtimeDouble();
    const { sock, states } = makeWiredSocket(runtime);

    await sock.connect();
    await until(() => sock.currentState() === 'open');
    expect(runtime.held()).toBe(1);

    // Ordinary shutdown of the channel. `installShutdown` also zeroizes, but the custody claim is
    // that the CHANNEL closing is sufficient on its own.
    sock.close();

    await until(() => states.includes('closed'));
    expect(runtime.held()).toBe(0);
  });
});
