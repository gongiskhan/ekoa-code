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
import { registerPairing, bridgeConnectionCount, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';

/**
 * Connect-auth chain (ch18 §18.3.2, §18.8 criterion 6/7). Ordered: bridge-token verify -> pairing
 * claim == path (connection-mismatch) -> resolved owner == subject (ownership-mismatch) -> activation
 * admission (ACCOUNT_DISABLED / BILLING_LOCKED). Exercised end to end over a real HTTP Upgrade with a
 * `ws` client standing in for the daemon dial-out.
 */
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-connect';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_connect_test');
  server = createServer();
  // Org resolution injected (avoids seeding the users store); activation is the real map.
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
  await bridgePairings.deleteMany({});
});

interface DialResult {
  open: boolean;
  status?: number;
  code?: string;
  reason?: string;
  ws?: WsClient;
}

function dial(pairingId: string, token: string | undefined): Promise<DialResult> {
  return new Promise((resolve) => {
    const url = `ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairingId}`;
    const ws = new WsClient(url, token ? { headers: { authorization: `Bearer ${token}` } } : {});
    ws.on('open', () => resolve({ open: true, ws }));
    ws.on('unexpected-response', (_req, res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => {
        let code: string | undefined;
        let reason: string | undefined;
        try {
          const parsed = JSON.parse(body) as { error?: { code?: string; details?: { reason?: string } } };
          code = parsed.error?.code;
          reason = parsed.error?.details?.reason;
        } catch {
          /* non-JSON body */
        }
        resolve({ open: false, status: res.statusCode, code, reason });
      });
    });
    ws.on('error', () => {
      /* the unexpected-response handler resolves; swallow the paired error */
    });
  });
}

describe('connect auth chain (§18.3.2)', () => {
  it('accepts a valid pairing token for an active owner and registers the live connection', async () => {
    setActivation('owner-1', { active: true, billingLocked: false });
    const { token } = mintBridgeToken({ sub: 'owner-1' }, 'p1');
    const res = await dial('p1', token);
    expect(res.open).toBe(true);
    expect(bridgeConnectionCount()).toBe(1);
    const row = await bridgePairings.get('p1');
    expect((row as { org?: string } | null)?.org).toBe('org-1');
    res.ws?.close();
  });

  it('refuses when no token is presented (401)', async () => {
    const res = await dial('p1', undefined);
    expect(res.open).toBe(false);
    expect(res.status).toBe(401);
  });

  it('refuses a token minted for a different pairing (connection-mismatch, 401)', async () => {
    setActivation('owner-1', { active: true, billingLocked: false });
    const { token } = mintBridgeToken({ sub: 'owner-1' }, 'p-other');
    const res = await dial('p1', token);
    expect(res.open).toBe(false);
    expect(res.status).toBe(401);
    expect(res.reason).toBe('connection-mismatch');
  });

  it('refuses when the pairing is owned by another user (ownership-mismatch, 401)', async () => {
    // Pre-register the pairing to owner-X; a token for owner-Y must not steal it.
    await registerPairing({ pairingId: 'p1', org: 'org-1', ownerUserId: 'owner-X' });
    setActivation('owner-Y', { active: true, billingLocked: false });
    const { token } = mintBridgeToken({ sub: 'owner-Y' }, 'p1');
    const res = await dial('p1', token);
    expect(res.open).toBe(false);
    expect(res.status).toBe(401);
    expect(res.reason).toBe('ownership-mismatch');
  });

  it('refuses a deactivated owner with ACCOUNT_DISABLED (403)', async () => {
    setActivation('owner-1', { active: false, billingLocked: false });
    const { token } = mintBridgeToken({ sub: 'owner-1' }, 'p1');
    const res = await dial('p1', token);
    expect(res.open).toBe(false);
    expect(res.status).toBe(403);
    expect(res.code).toBe('ACCOUNT_DISABLED');
  });

  it('refuses a billing-locked owner with BILLING_LOCKED (402)', async () => {
    setActivation('owner-1', { active: true, billingLocked: true });
    const { token } = mintBridgeToken({ sub: 'owner-1' }, 'p1');
    const res = await dial('p1', token);
    expect(res.open).toBe(false);
    expect(res.status).toBe(402);
    expect(res.code).toBe('BILLING_LOCKED');
  });
});
