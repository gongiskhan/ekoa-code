import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { encryptForScope } from '../../src/data/crypto.js';
import { activityLogs } from '../../src/data/stores.js';
import {
  runAgent,
  runOneShot,
  completeFast,
  proxyGatewayMessages,
  setOrgResolver,
  __resetOrgResolverForTests,
  __setTransportForTests,
  __resetTransportForTests,
  type ChokepointTransport,
  type SdkCallParams,
  type RestCallParams,
} from '../../src/llm/client.js';
import { decideForTier } from '../../src/llm/router.js';
import { __resetAttributionCountersForTests, type LlmAttribution } from '../../src/llm/attribution.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';
import { __resetPlatformBilleeForTests } from '../../src/billing/tracker.js';
import { setRulesetResolver, __resetRulesetResolverForTests, __resetVaultForTests, __resetAuditForTests, type OrgRuleset } from '../../src/llm/anonymise/index.js';
import { isValidNif } from '../../src/llm/anonymise/checksum.js';

/**
 * G7A payload-capture gate through the chokepoint (ch17 §17.8, §17.11), against the injected
 * transport (the capture harness) + the REAL billing/audit seams over mongodb-memory-server. No
 * live model, no api.anthropic.com. Proves: every chokepoint entry (runAgent, runOneShot,
 * completeFast, proxyGatewayMessages) routes its outbound payload through anonymize BEFORE the
 * transport, the outbound carries TOKENS ONLY, the user-visible response is CLEARTEXT, a
 * tool_use round trip resolves the real value locally, and the audit folds into the single
 * Registo write path as metadata only.
 *
 * Test data is SYNTHETIC. A checksum-VALID NIF is computed at runtime (never a committed
 * literal); a checksum-INVALID NIF and a party name stand in for deny-listed material.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

function computeValidNif(base8: string): string {
  for (let d = 0; d < 10; d++) if (isValidNif(base8 + d)) return base8 + d;
  throw new Error('no valid check digit');
}
const VALID_NIF = computeValidNif('50000000');
const INVALID_NIF = VALID_NIF.slice(0, 8) + String((Number(VALID_NIF[8]) + 1) % 10);
const PARTY = 'Petrova Holdings';
const DENY: string[] = [INVALID_NIF, PARTY];

function fakeTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
  return { ...base, ...over };
}

const bodyEcho = (text: string) =>
  JSON.stringify({
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; // crypto sha256-derives the key from any-length secret (data/crypto.ts); matches every other test
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_anon_chokepoint');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetAttributionCountersForTests();
  __resetTransportForTests();
  __resetCredentialsForTests();
  __resetRateCapsForTests();
  __resetOrgResolverForTests();
  __resetPlatformBilleeForTests();
  __resetRulesetResolverForTests();
  __resetVaultForTests();
  __resetAuditForTests();
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings', 'users', 'activity_logs']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
  setOrgResolver(async () => 'org1');
  setRulesetResolver((orgId): OrgRuleset => ({ orgId, denyList: DENY }));
});
afterEach(() => vi.restoreAllMocks());

const attr: LlmAttribution = { kind: 'classifier', agentType: 'classify-tui-turn', billeeUserId: 'u1' };
const PLANTED = `NIF ${VALID_NIF}, ref ${INVALID_NIF}, party ${PARTY}`;

/** Assert none of the planted cleartext values appear in a captured outbound payload. */
function assertTokensOnly(serialized: string): void {
  expect(serialized).not.toContain(VALID_NIF);
  expect(serialized).not.toContain(INVALID_NIF);
  expect(serialized).not.toContain(PARTY);
}

describe('payload-capture: every entry tokenizes the outbound payload (§17.8, §17.11)', () => {
  it('completeFast: outbound is tokens-only; the de-tokenized response is cleartext', async () => {
    let captured = '';
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = JSON.stringify(p.payload);
        const content = (p.payload.messages as Array<{ content: string }>)[0]!.content;
        return { status: 200, headers: {}, body: bodyEcho(content) }; // echo the tokenized text
      },
    }));
    const res = await completeFast({ messages: [{ role: 'user', content: PLANTED }] }, attr);
    assertTokensOnly(captured);
    expect(captured).toMatch(/\d{9}/); // a NIF-shaped token replaced the valid NIF
    // user-visible response is cleartext (round trip restored every planted value)
    expect(res.text).toContain(VALID_NIF);
    expect(res.text).toContain(INVALID_NIF);
    expect(res.text).toContain(PARTY);
  });

  it('runOneShot (SDK one-shot): outbound prompt is tokens-only; result is cleartext', async () => {
    let captured = '';
    __setTransportForTests(fakeTransport({
      async oneShot(p: SdkCallParams) {
        captured = p.prompt;
        return { text: p.prompt, usage: { input: 10, output: 5, cacheCreate: 0, cacheRead: 0 } }; // echo
      },
    }));
    const res = await runOneShot({ prompt: PLANTED, decision: decideForTier('WORKHORSE') }, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1', sessionId: 'conv-1' });
    assertTokensOnly(captured);
    expect(res.text).toContain(VALID_NIF);
    expect(res.text).toContain(PARTY);
  });

  it('runAgent (SDK stream): outbound prompt is tokens-only; streamed text is cleartext', async () => {
    let captured = '';
    __setTransportForTests(fakeTransport({
      async *streamAgent(p: SdkCallParams) {
        captured = p.prompt;
        yield { kind: 'text', text: p.prompt }; // echo the tokenized prompt back as a delta
        yield { kind: 'final', text: p.prompt, usage: { input: 10, output: 5, cacheCreate: 0, cacheRead: 0 }, aborted: false };
      },
    }));
    const handle = runAgent({ prompt: PLANTED, decision: decideForTier('EXPERT') }, { kind: 'user_work', agentType: 'chat', billeeUserId: 'u1', sessionId: 'conv-2' });
    let streamed = '';
    for await (const ev of handle.events) streamed += ev.text;
    const result = await handle.result;
    assertTokensOnly(captured);
    expect(streamed).toContain(VALID_NIF); // streamed deltas de-tokenized
    expect(result.text).toContain(PARTY);
  });

  it('proxyGatewayMessages: outbound is tokens-only; tool_use arguments de-tokenize locally', async () => {
    let captured = '';
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = JSON.stringify(p.payload);
        const content = (p.payload.messages as Array<{ content: string }>)[0]!.content;
        const token = content.match(/\d{9}/)![0]; // the NIF token the model would echo into a tool call
        // the model asks a local tool to act on the (masked) value
        return { status: 200, headers: {}, body: JSON.stringify({
          content: [{ type: 'tool_use', name: 'grep_file', input: { pattern: token } }],
          usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }) };
      },
    }));
    const result = await proxyGatewayMessages(
      { messages: [{ role: 'user', content: `Search NIF ${VALID_NIF}` }], metadata: { session_id: 'conv-3' } },
      'u1',
    );
    assertTokensOnly(captured);
    // the tool_use argument the local loop receives is the REAL value, not a placeholder
    const parsed = JSON.parse(result.body) as { content: Array<{ input: { pattern: string } }> };
    expect(parsed.content[0]!.input.pattern).toBe(VALID_NIF);
  });

  it('tool DEFINITIONS are anonymised too - PII in a tool description does not leak (dual-review Critical)', async () => {
    let captured = '';
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = JSON.stringify(p.payload);
        return { status: 200, headers: {}, body: bodyEcho('ok') };
      },
    }));
    await proxyGatewayMessages(
      {
        messages: [{ role: 'user', content: 'hi' }],
        // a client-supplied tool definition carrying PII in its description + schema default
        tools: [{ name: 'lookup', description: `Find client ${PARTY} NIF ${VALID_NIF}`, input_schema: { type: 'object', properties: { q: { type: 'string', default: VALID_NIF } } } }],
        metadata: { session_id: 'conv-tools' },
      },
      'u1',
    );
    // the whole outbound payload (incl. tools) is tokens-only: no cleartext PII reaches the model
    assertTokensOnly(captured);
    expect(captured).not.toContain(VALID_NIF);
    expect(captured).not.toContain(PARTY);
  });
});

describe('encrypted per-org deny-list is resolved at the chokepoint (§17.4 (b), D3)', () => {
  it('decrypts an org-scoped-encrypted deny-list and tokenizes the party', async () => {
    // Encrypt the deny-list bound to the SAME org the resolver reports - the org-scoped key
    // (§17.4 b) means each org's ciphertext decrypts only under its own orgId.
    setRulesetResolver((orgId): OrgRuleset => ({ orgId, denyListCiphertext: encryptForScope(JSON.stringify([PARTY]), orgId) }));
    let captured = '';
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = JSON.stringify(p.payload);
        return { status: 200, headers: {}, body: bodyEcho((p.payload.messages as Array<{ content: string }>)[0]!.content) };
      },
    }));
    await completeFast({ messages: [{ role: 'user', content: `party ${PARTY}` }] }, attr);
    expect(captured).not.toContain(PARTY); // caught via the decrypted deny-list
  });

  it('org-scoping is enforced: another org\'s ciphertext cannot be decrypted here (§17.4 b, fail-closed)', async () => {
    // Ciphertext encrypted for org "other-org" but attached to a ruleset reporting a different
    // orgId: the GCM auth fails under the wrong scoped key, the mandatory detector errors, and
    // the pipeline REFUSES (fail-closed) rather than forwarding cleartext.
    const foreignCipher = encryptForScope(JSON.stringify([PARTY]), 'other-org');
    setRulesetResolver((orgId): OrgRuleset => ({ orgId, denyListCiphertext: foreignCipher }));
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) { return { status: 200, headers: {}, body: bodyEcho((p.payload.messages as Array<{ content: string }>)[0]!.content) }; },
    }));
    await expect(completeFast({ messages: [{ role: 'user', content: `party ${PARTY}` }] }, attr)).rejects.toThrow();
  });
});

describe('audit folds into the single Registo write path, metadata only (§17.6, §17.11)', () => {
  it('writes an anonymisation activity row with classes/counts/correlation-id/hash, no bodies', async () => {
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) { return { status: 200, headers: {}, body: bodyEcho((p.payload.messages as Array<{ content: string }>)[0]!.content) }; },
    }));
    await completeFast({ messages: [{ role: 'user', content: PLANTED }] }, attr);

    // audit is async fire-and-forget; poll the single write path briefly
    let rows: Array<{ category: string; metadata?: Record<string, unknown> }> = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      rows = (await activityLogs.find({ category: 'anonymisation' })) as typeof rows;
      if (rows.length === 0) await new Promise((r) => setTimeout(r, 20));
    }
    expect(rows).toHaveLength(1);
    const m = rows[0]!.metadata!;
    expect(m.classes).toBeTruthy();
    expect(typeof m.correlationId).toBe('string');
    expect((m.payloadHash as string)).toHaveLength(64);
    // never a body, never the vault
    const serialized = JSON.stringify(rows[0]);
    assertTokensOnly(serialized);
    expect(serialized).not.toContain('valueToToken');
  });
});
