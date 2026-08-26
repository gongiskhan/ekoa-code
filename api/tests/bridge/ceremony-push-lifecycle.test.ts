import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket as WsClient } from 'ws';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { mintBridgeToken } from '../../src/bridge/token.js';
import { attachBridgeServer, type BridgeServerHandle } from '../../src/bridge/server.js';
import { getLiveConnection, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';

/**
 * The `session.push` -> `onCeremonyEnded` lifecycle (D-CEREMONY-STREAM, L4). The live view is keyed
 * by the ceremony requestId and torn down when the login ends. A SUCCESSFUL push always ended it; a
 * REFUSED push (unknown/duplicate requestId, wrong machine, empty jar) used to leave it open - the
 * viewer sat 'Ligado' on a frozen frame until the backstop fired. The daemon has closed its window
 * and will never push again for that ceremony, so a refusal ends the stream just as a success does.
 *
 * Exercised end to end over a real HTTP Upgrade + `ws` client (as `connect-auth.test.ts` does), with
 * `onCeremonyEnded` injected so the test can observe the teardown.
 */
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;
const ended: string[] = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-ceremony-push';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_ceremony_push');
  server = createServer();
  handle = attachBridgeServer(server, {
    resolveUserOrg: async () => 'orgA',
    onCeremonyEnded: (requestId) => ended.push(requestId),
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  await handle.close();
  await new Promise<void>((r) => server.close(() => r()));
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetLiveConnectionsForTests();
  ended.length = 0;
  await bridgePairings.deleteMany({});
});

/** Dial in as the daemon would and resolve once the socket is open. */
function dial(pairingId: string, token: string): Promise<WsClient> {
  return new Promise((resolve, reject) => {
    const ws = new WsClient(`ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairingId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    ws.on('open', () => resolve(ws));
    ws.on('unexpected-response', (_req, res) => reject(new Error(`upgrade refused ${res.statusCode}`)));
    ws.on('error', reject);
  });
}

async function waitUntil(pred: () => boolean, ms = 1500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

describe('a refused session.push still tears the live view down (L4)', () => {
  it('calls onCeremonyEnded for the frame requestId when the push is REFUSED (unknown ceremony)', async () => {
    setActivation('owner-1', { active: true, billingLocked: false });
    const { token } = mintBridgeToken({ sub: 'owner-1' }, 'p-refuse');
    const ws = await dial('p-refuse', token);
    try {
      // The server registers the live socket a beat after the upgrade completes.
      expect(await waitUntil(() => getLiveConnection('p-refuse') !== undefined)).toBe(true);

      // A push for a ceremony that was never opened: `acceptSessionPush` throws, so this exercises the
      // CATCH branch. Before the fix onCeremonyEnded was called only on the success path, so `ended`
      // stayed empty here and the viewer was stranded until the backstop.
      ws.send(JSON.stringify({ type: 'session.push', requestId: 'never-opened-req', origin: 'x', storageState: {} }));

      expect(await waitUntil(() => ended.includes('never-opened-req'))).toBe(true);
    } finally {
      ws.close();
    }
  });
});
