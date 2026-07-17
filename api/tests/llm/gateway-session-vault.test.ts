import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import {
  proxyGatewayMessages,
  __setTransportForTests,
  __resetTransportForTests,
  setOrgResolver,
  __resetOrgResolverForTests,
  type ChokepointTransport,
  type RestCallParams,
} from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests, __setNowForTests } from '../../src/llm/credentials.js';
import { setRulesetResolver, __resetRulesetResolverForTests, __resetVaultForTests, type OrgRuleset } from '../../src/llm/anonymise/index.js';
import { __vaultCount } from '../../src/llm/anonymise/vault.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';

/**
 * S7 stable gateway-session vault (run 20260717-071930-d1244839). A stock Anthropic client
 * (Claude Code) sends no session_id, so before S7 each gateway request opened a FRESH ephemeral
 * vault and a deny-list literal tokenized inconsistently across the agentic tool loop (a prior
 * turn's token failed to detokenize -> the CLI saw a directory that "did not exist"). S7 keys
 * the vault by the gateway KEY id: all of a key's requests share ONE vault, so the same literal
 * gets the SAME token every turn and detokenizes reliably. Proven deterministically here via the
 * injected transport - no live model. The empty-ruleset case stays a true per-request no-op.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;
const PARTY = 'ZarkovHoldings77';

function captureTransport(): { calls: string[]; transport: ChokepointTransport } {
  const calls: string[] = [];
  const transport: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages(p: RestCallParams) {
      calls.push(JSON.stringify(p.payload));
      // Echo the tokenized user text back so the response detokenization is exercised.
      const msgs = p.payload.messages as Array<{ content: unknown }>;
      const text = typeof msgs?.[0]?.content === 'string' ? (msgs[0].content as string) : 'ok';
      return { status: 200, headers: {}, body: JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) };
    },
  };
  return { calls, transport };
}

/** The token a given payload used for the deny-listed party (the fake in place of PARTY). */
function partyTokenIn(payload: string): string | null {
  // The party literal is replaced by a synthetic fake; find the fake that sits where PARTY was.
  // We assert stability by comparing the WHOLE tokenized payload across calls with the same text.
  return payload.includes(PARTY) ? '<CLEARTEXT-LEAKED>' : payload;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_gateway_session_vault');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  __resetTransportForTests();
  __resetCredentialsForTests();
  __resetRateCapsForTests();
  __resetOrgResolverForTests();
  __resetRulesetResolverForTests();
  __resetVaultForTests();
  __setNowForTests(() => T0);
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
  setOrgResolver(async () => 'org1');
  setRulesetResolver((orgId): OrgRuleset => ({ orgId, denyList: [PARTY] }));
});
afterEach(() => vi.restoreAllMocks());

const body = () => ({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: `abre a pasta ${PARTY} e le o ficheiro` }] });

describe('gateway vault keying', () => {
  it('a KEY principal shares ONE vault across requests: the same deny-list literal gets the SAME tokenized payload every turn, and the vault persists', async () => {
    const { calls, transport } = captureTransport();
    __setTransportForTests(transport);

    const opts = { agentType: 'gateway-client' as const, keyId: 'kid_stable' };
    await proxyGatewayMessages(body(), 'owner1', undefined, opts);
    await proxyGatewayMessages(body(), 'owner1', undefined, opts);

    // Neither outbound leaked the cleartext party literal...
    expect(calls[0]).not.toContain(PARTY);
    expect(calls[1]).not.toContain(PARTY);
    // ...and the two tokenized payloads are IDENTICAL - the literal mapped to the same fake both
    // turns (the whole point: cross-request token stability for the tool loop).
    expect(partyTokenIn(calls[0]!)).toBe(partyTokenIn(calls[1]!));
    expect(calls[0]).toBe(calls[1]);
    // The stable per-key vault persists (NOT cleared per request) - it TTL-sweeps on its own.
    expect(__vaultCount()).toBe(1);
  });

  it('two DIFFERENT keys get DIFFERENT vaults (no cross-key token bleed)', async () => {
    const { transport } = captureTransport();
    __setTransportForTests(transport);
    await proxyGatewayMessages(body(), 'owner1', undefined, { agentType: 'gateway-client', keyId: 'kid_A' });
    await proxyGatewayMessages(body(), 'owner1', undefined, { agentType: 'gateway-client', keyId: 'kid_B' });
    expect(__vaultCount()).toBe(2);
  });

  it('NO key + NO session_id stays EPHEMERAL: a fresh vault per request, cleared after each (unchanged legacy behavior)', async () => {
    const { transport } = captureTransport();
    __setTransportForTests(transport);
    await proxyGatewayMessages(body(), 'owner1'); // no opts, no keyId
    await proxyGatewayMessages(body(), 'owner1');
    // Both ephemeral vaults were cleared in the finally - none linger.
    expect(__vaultCount()).toBe(0);
  });

  it('an explicit session_id still wins and its vault persists (bridge path unchanged)', async () => {
    const { transport } = captureTransport();
    __setTransportForTests(transport);
    const withSession = { ...body(), metadata: { session_id: 'conv-42' } };
    await proxyGatewayMessages(withSession, 'owner1', undefined, { agentType: 'gateway-client', keyId: 'kid_X' });
    // The explicit conversation id is the vault key (not the gwkey), and it persists.
    expect(__vaultCount()).toBe(1);
  });

  it('a crafted session_id cannot HIJACK another key\'s vault (codex S7 High: namespace isolation)', async () => {
    const { transport } = captureTransport();
    __setTransportForTests(transport);
    // Victim: key kid_victim mints a vault with its tokens.
    await proxyGatewayMessages(body(), 'ownerV', undefined, { agentType: 'gateway-client', keyId: 'kid_victim' });
    // Attacker (a DIFFERENT owner) crafts session_id = the victim's reserved key-vault name.
    const crafted = { ...body(), metadata: { session_id: 'gwkey:kid_victim' } };
    await proxyGatewayMessages(crafted, 'ownerA', undefined);
    // TWO distinct vaults: the attacker's client-supplied id is billee-scoped
    // (csid:ownerA:gwkey:kid_victim), never the victim's gwkey:kid_victim - no shared vault.
    expect(__vaultCount()).toBe(2);
  });
});
