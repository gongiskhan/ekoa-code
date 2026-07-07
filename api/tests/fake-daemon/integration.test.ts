import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { mintBridgeToken } from '../../src/bridge/token.js';
import { attachBridgeServer, type BridgeServerHandle } from '../../src/bridge/server.js';
import { registerPairing, revokePairing, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { delegateToLocal, __resetPendingDelegationsForTests } from '../../src/bridge/delegation.js';
import { FakeDaemonClient } from '../../test/fake-daemon/ws-client.js';
import type { Grant } from '../../test/fake-daemon/daemon.js';

/**
 * End-to-end delegation over the bridge (ch18 §18.8 criteria 1, 2 (S4 revoke), 4 (derived-output-
 * only)): a real HTTP bridge server + the fake-daemon dialing in as the daemon would, running a
 * delegation round trip. The result is derived output only (no raw file content), the read is
 * ledgered (S6), and a revoke mid-session disconnects + fails subsequent delegations cleanly (S4).
 */
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;
let fixtureRoot: string;
let grantRoot: string;
const ledgerSeen: Array<{ taskId: string; correlationId: string }> = [];

beforeAll(async () => {
  process.env.JWT_SECRET = 'test-secret-integration';
  process.env.ENCRYPTION_KEY = 'test-encryption-key';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_integration');
  server = createServer();
  handle = attachBridgeServer(server, {
    resolveUserOrg: async () => 'orgA',
    onLedgerRow: (taskId, row) => ledgerSeen.push({ taskId, correlationId: row.correlationId }),
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
  __resetPendingDelegationsForTests();
  ledgerSeen.length = 0;
  await bridgePairings.deleteMany({});
  fixtureRoot = mkdtempSync(join(tmpdir(), 'fd-int-'));
  grantRoot = join(fixtureRoot, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  writeFileSync(join(grantRoot, 'contrato.txt'), 'ACME Lda, NIF 500000000. Secção 3.1: indemnizações limitadas a 12 meses.');
});
afterEach(async () => { rmSync(fixtureRoot, { recursive: true, force: true }); });

async function dialDaemon(pairingId: string, ownerUserId: string): Promise<FakeDaemonClient> {
  setActivation(ownerUserId, { active: true, billingLocked: false });
  await registerPairing({ pairingId, org: 'orgA', ownerUserId });
  const { token } = mintBridgeToken({ sub: ownerUserId }, pairingId);
  const grants: Grant[] = [{ grantRef: 'g1', root: grantRoot, session: 'sess-1' }];
  const client = new FakeDaemonClient({
    pairingId, org: 'orgA', signingSecret: loadConfig().jwtSecret, grants,
    wsBase: `ws://127.0.0.1:${port}`, bridgeToken: token,
    script: { read: { grantRef: 'g1', relPath: 'contrato.txt' }, answer: 'A secção 3.1 limita as indemnizações a 12 meses; parte nomeada: ACME Lda.', citations: [{ path: 'contrato.txt', range: '0-80' }] },
  });
  await client.connect();
  // Let the server finish registering the live socket.
  await new Promise((r) => setTimeout(r, 50));
  return client;
}

describe('delegation round trip over the bridge (§18.8)', () => {
  it('delegateToLocal → daemon reads within the grant, ledgers it, returns DERIVED OUTPUT ONLY', async () => {
    const client = await dialDaemon('p1', 'u1');
    try {
      const result = await delegateToLocal(
        { userId: 'u1', sessionId: 'sess-1' },
        { task: 'resume a secção 3.1', grantRefs: ['g1'], budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } } },
      );
      expect(result.status).toBe('ok');
      expect(result.answer).toMatch(/12 meses/);
      // DERIVED OUTPUT ONLY (§18.2.2, criterion 4): the raw file body must NOT appear in the result.
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('NIF 500000000');
      expect(serialized).not.toContain('indemnizações limitadas a 12 meses'); // the raw file phrasing
      expect(result.citations).toEqual([{ path: 'contrato.txt', range: '0-80' }]);
      expect(result.telemetry.egressBytes).toBeGreaterThan(0);
      // The read was ledgered daemon-side and streamed up (S6).
      expect(ledgerSeen.length).toBeGreaterThan(0);
      // The daemon's own ledger holds the read; the hosted record never sees the bytes.
      expect(client.daemon.ledger[0]!.path).toBe('contrato.txt');
    } finally {
      client.close();
    }
  });

  it('revoke-pairing mid-session disconnects the socket and fails a subsequent delegation cleanly (S4)', async () => {
    const client = await dialDaemon('p2', 'u2');
    try {
      // First delegation works.
      const ok = await delegateToLocal({ userId: 'u2', sessionId: 'sess-1' }, { task: 't', grantRefs: ['g1'], budget: { egressBytes: 10_000, modelSpend: { userId: 'u2' } } });
      expect(ok.status).toBe('ok');
      // Revoke the pairing — the live socket is disconnected immediately (§18.3.5).
      await revokePairing('p2');
      await new Promise((r) => setTimeout(r, 60));
      expect(client.isOpen()).toBe(false);
      // A subsequent delegation finds no live pairing → unreachable, NEVER a silent upload (S5).
      const after = await delegateToLocal({ userId: 'u2', sessionId: 'sess-1' }, { task: 't2', grantRefs: ['g1'], budget: { egressBytes: 10_000, modelSpend: { userId: 'u2' } } });
      expect(after.status).toBe('unreachable');
    } finally {
      client.close();
    }
  });

  it('a delegation to an owner with NO paired daemon is unreachable (offline is honest, §18.2.3)', async () => {
    const result = await delegateToLocal({ userId: 'nobody', sessionId: 'sess-1' }, { task: 't', grantRefs: ['g1'], budget: { egressBytes: 10_000, modelSpend: { userId: 'nobody' } } });
    expect(result.status).toBe('unreachable');
  });
});
