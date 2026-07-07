import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { setOrgResolver, __resetOrgResolverForTests, __setTransportForTests, __resetTransportForTests, proxyGatewayMessages, type ChokepointTransport } from '../../src/llm/client.js';
import { setRulesetResolver, __resetRulesetResolverForTests, __resetVaultForTests, setAuditSink, __resetAuditForTests, type OrgRuleset } from '../../src/llm/anonymise/index.js';
import { mintBridgeToken } from '../../src/bridge/token.js';
import { attachBridgeServer, type BridgeServerHandle } from '../../src/bridge/server.js';
import { createProviderHandler } from '../../src/bridge/provider.js';
import { registerPairing, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { delegateToLocal, __resetPendingDelegationsForTests } from '../../src/bridge/delegation.js';
import { FakeDaemonClient } from '../../test/fake-daemon/ws-client.js';
import type { Grant } from '../../test/fake-daemon/daemon.js';

/**
 * Correlation-id join (ch18 §18.5 S6, §18.8 criterion 5) + bridge-path payload-capture (§18.7.3):
 * a delegated read's local ledger row and the hosted anon-audit entry for the same provider request
 * share ONE correlation id; and a planted sensitive value in the local loop's provider request is
 * tokenized in every captured outbound Anthropic payload while the derived answer stays cleartext.
 */
const PARTY = 'Petrova Holdings'; // a deny-listed value the anonymiser must tokenize
let mem: MongoMemoryServer;
let server: Server;
let handle: BridgeServerHandle;
let port: number;
let fixtureRoot: string;
let grantRoot: string;
let capturedOutbound = '';
const auditCorrelationIds: string[] = [];
const ledgerRows: Array<{ correlationId: string }> = [];

const fakeTransport = (over: Partial<ChokepointTransport>): ChokepointTransport => ({
  async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
  async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
  async messages() { return { status: 200, headers: {}, body: '{}' }; },
  ...over,
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 'test-secret-join';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_join');
  server = createServer();
  handle = attachBridgeServer(server, {
    resolveUserOrg: async () => 'orgA',
    onLedgerRow: (_taskId, row) => ledgerRows.push({ correlationId: row.correlationId }),
    // The real provider handler, but with the pairing/org chain injected and the REAL chokepoint
    // (proxyGatewayMessages) as the completion so the anon-audit fires under the request's id.
    provider: createProviderHandler({
      resolvePairingByCredential: async () => ({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' }),
      resolveSessionOrg: async () => 'orgA',
      getActivation: () => ({ active: true, billingLocked: false }),
      runCompletion: (body, billee, correlationId) => proxyGatewayMessages(body as Record<string, unknown>, billee, correlationId),
    }),
  });
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  await handle.close();
  await new Promise<void>((r) => server.close(() => r()));
  __resetTransportForTests();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetLiveConnectionsForTests();
  __resetPendingDelegationsForTests();
  __resetCredentialsForTests();
  __resetOrgResolverForTests();
  __resetRulesetResolverForTests();
  __resetVaultForTests();
  __resetAuditForTests();
  for (const c of ['credentials', 'settings', 'users']) await getDb().collection(c).deleteMany({});
  await bridgePairings.deleteMany({});
  capturedOutbound = '';
  auditCorrelationIds.length = 0;
  ledgerRows.length = 0;
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: Date.now() + 3_600_000 });
  setOrgResolver(async () => 'orgA');
  setRulesetResolver((orgId): OrgRuleset => ({ orgId, denyList: [PARTY] }));
  setAuditSink({ write: (_actor, meta) => { if (typeof meta.correlationId === 'string') auditCorrelationIds.push(meta.correlationId); } });
  // Capture the outbound Anthropic payload; return a de-tokenizable canned completion.
  __setTransportForTests(fakeTransport({
    async messages(p: { payload: unknown }) { capturedOutbound = JSON.stringify(p.payload); return { status: 200, headers: {}, body: JSON.stringify({ content: [{ type: 'text', text: 'resumo derivado' }], usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) }; },
  }));
  fixtureRoot = mkdtempSync(join(tmpdir(), 'fd-join-'));
  grantRoot = join(fixtureRoot, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  writeFileSync(join(grantRoot, 'contrato.txt'), `Parte: ${PARTY}. Secção 3.1 indemnizações.`);
});
afterEach(async () => { rmSync(fixtureRoot, { recursive: true, force: true }); });

describe('correlation-id join + bridge payload-capture (§18.5 S6, §18.7.3)', () => {
  it('the daemon ledger row and the hosted anon-audit share one correlationId; the outbound payload is tokenized', async () => {
    setActivation('u1', { active: true, billingLocked: false });
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    const { token } = mintBridgeToken({ sub: 'u1' }, 'p1');
    const grants: Grant[] = [{ grantRef: 'g1', root: grantRoot, session: 'sess-1' }];
    const client = new FakeDaemonClient({
      pairingId: 'p1', org: 'orgA', signingSecret: loadConfig().jwtSecret, grants,
      wsBase: `ws://127.0.0.1:${port}`, bridgeToken: token,
      // The local loop reasons over the file excerpt (containing PARTY) via a provider request,
      // then reads within the grant and returns a derived answer.
      script: {
        provider: { body: { messages: [{ role: 'user', content: `Resume o contrato da ${PARTY}` }] } },
        read: { grantRef: 'g1', relPath: 'contrato.txt' },
        answer: 'A secção 3.1 trata das indemnizações.',
        citations: [{ path: 'contrato.txt', range: '0-40' }],
      },
    });
    await client.connect();
    await new Promise((r) => setTimeout(r, 50));
    try {
      const result = await delegateToLocal(
        { userId: 'u1', sessionId: 'sess-1' },
        { task: 'resume', grantRefs: ['g1'], budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } } },
      );
      expect(result.status).toBe('ok');

      // JOIN (§18.5 S6, criterion 5): the hosted audit correlationId == the daemon ledger row id.
      expect(auditCorrelationIds.length).toBeGreaterThan(0);
      expect(ledgerRows.length).toBeGreaterThan(0);
      expect(ledgerRows[0]!.correlationId).toBe(client.daemon.ledger[0]!.correlationId);
      expect(auditCorrelationIds).toContain(ledgerRows[0]!.correlationId);

      // PAYLOAD-CAPTURE (§18.7.3): the planted deny-listed value is tokenized in the outbound
      // Anthropic payload, while the derived answer the user sees is cleartext.
      expect(capturedOutbound).not.toContain(PARTY);
      expect(result.answer).not.toContain(PARTY);
    } finally {
      client.close();
    }
  });
});
