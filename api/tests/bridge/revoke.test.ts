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
import {
  revokePairing,
  isLive,
  bridgeConnectionCount,
  getPairingById,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';
import { delegateToLocal, __resetPendingDelegationsForTests } from '../../src/bridge/delegation.js';

/**
 * Revoke-pairing kill switch (ch18 §18.3.5, §18.8 criterion 2 S4). Revocation disconnects the live
 * socket immediately and causes in-flight and new delegations to fail cleanly. Exercised over a real
 * Upgrade with a `ws` client standing in for the daemon.
 */
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-revoke';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_revoke_test');
  server = createServer();
  handle = attachBridgeServer(server, { resolveUserOrg: async () => 'org-1' });
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
  __resetPendingDelegationsForTests();
  await bridgePairings.deleteMany({});
});

function connect(pairingId: string, ownerUserId: string): Promise<WsClient> {
  setActivation(ownerUserId, { active: true, billingLocked: false });
  const { token } = mintBridgeToken({ sub: ownerUserId }, pairingId);
  const url = `ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairingId}`;
  const ws = new WsClient(url, { headers: { authorization: `Bearer ${token}` } });
  ws.on('error', () => undefined);
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

const budget = { egressBytes: 1000, modelSpend: { userId: 'owner-1' } };

describe('revoke kill switch (§18.3.5)', () => {
  it('revoke disconnects the live socket and marks the row revoked', async () => {
    const ws = await connect('p1', 'owner-1');
    expect(bridgeConnectionCount()).toBe(1);

    const closed = new Promise<void>((r) => ws.on('close', () => r()));
    const affected = await revokePairing('p1');
    expect(affected).toBe(true);
    await closed;

    expect(isLive('p1')).toBe(false);
    expect(bridgeConnectionCount()).toBe(0);
    expect((await getPairingById('p1'))?.revokedAt).not.toBeNull();
  });

  it('an in-flight delegation fails cleanly when the pairing is revoked mid-session', async () => {
    await connect('p1', 'owner-1');
    // Dispatch (no daemon result will come back) then revoke — the in-flight delegation must fail clean.
    const pending = delegateToLocal({ userId: 'owner-1', sessionId: 's1' }, { task: 'ler', grantRefs: ['g1'], budget }, { timeoutMs: 5000 });
    await revokePairing('p1');
    const result = await pending;
    expect(result.status).toBe('unreachable');
  });

  it('a delegation after revoke is unreachable (offline), never an upload', async () => {
    await connect('p1', 'owner-1');
    await revokePairing('p1');
    const result = await delegateToLocal({ userId: 'owner-1', sessionId: 's1' }, { task: 'ler', grantRefs: ['g1'], budget }, { timeoutMs: 5000 });
    expect(result.status).toBe('unreachable');
  });
});
