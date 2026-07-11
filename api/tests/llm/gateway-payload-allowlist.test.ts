import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import {
  proxyGatewayMessages,
  setOrgResolver,
  __resetOrgResolverForTests,
  __setTransportForTests,
  __resetTransportForTests,
  type ChokepointTransport,
  type RestCallParams,
} from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests } from '../../src/llm/credentials.js';
import { __resetAttributionCountersForTests } from '../../src/llm/attribution.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';
import { __resetPlatformBilleeForTests } from '../../src/billing/tracker.js';
import {
  setRulesetResolver,
  __resetRulesetResolverForTests,
  __resetVaultForTests,
  __resetAuditForTests,
  type OrgRuleset,
} from '../../src/llm/anonymise/index.js';

/**
 * F2 live-turn regression (batch-1 S1): the Anthropic OAuth beta endpoint
 * (/v1/messages?beta=true) validates request bodies STRICTLY and 400s on any top-level field
 * outside its schema - observed live as
 *   HTTP 400 "context_management: Extra inputs are not permitted"
 * when the installed Agent SDK subprocess sent `context_management` through the gateway.
 *
 * The gateway (client.proxyGatewayMessages) is a metered pass-through on the ONE egress route
 * (FIXED-13); it must forward ONLY the documented Messages API top-level request fields and
 * drop everything else (logging the dropped KEY NAMES, never values). Otherwise any unknown
 * field a future SDK adds breaks every default-topology chat turn again.
 */
let mem: MongoMemoryServer;
const T0 = 1_800_000_000_000;

function fakeTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
  return { ...base, ...over };
}

const okBody = JSON.stringify({
  content: [{ type: 'text', text: 'ok' }],
  usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
});

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_gateway_allowlist');
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
  setRulesetResolver((orgId): OrgRuleset => ({ orgId }));
});
afterEach(() => vi.restoreAllMocks());

describe('proxyGatewayMessages forwards ONLY the documented Messages API top-level fields (F2 live-turn 400)', () => {
  it('strips context_management and any other unknown top-level field from the forwarded payload', async () => {
    let captured: Record<string, unknown> | null = null;
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: okBody };
      },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await proxyGatewayMessages(
      {
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 512,
        metadata: { session_id: 'conv-strip' },
        // The field the OAuth beta endpoint rejected live (Agent SDK context-editing):
        context_management: { edits: [{ type: 'clear_tool_uses_20250919' }] },
        // A synthetic future-SDK field - the strip must be an allowlist, not a blocklist:
        some_future_sdk_field: { secret_marker: 'MARKER-DO-NOT-LOG' },
        // Model-tuned reasoning params: the gateway clamps `model` to the FAST wire tier
        // (§6.5.4), and the FAST model rejects the CLIENT model's reasoning config outright
        // (observed live: 400 "adaptive thinking is not supported on <model>"). Clamp these too.
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      },
      'u1',
    );

    expect(captured).not.toBeNull();
    const keys = Object.keys(captured!);
    expect(keys).not.toContain('context_management');
    expect(keys).not.toContain('some_future_sdk_field');
    expect(keys).not.toContain('thinking');
    expect(keys).not.toContain('output_config');
    // the documented fields survive
    expect(keys).toContain('messages');
    expect(keys).toContain('max_tokens');
    expect(keys).toContain('model');
    expect(keys).toContain('metadata');

    // dropped KEY NAMES are logged for observability; VALUES never are
    const logged = warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('context_management');
    expect(logged).toContain('some_future_sdk_field');
    expect(logged).toContain('thinking');
    expect(logged).toContain('output_config');
    expect(logged).not.toContain('MARKER-DO-NOT-LOG');
  });

  it('forwards every documented model-independent Messages API field intact (allowlist is not over-broad)', async () => {
    let captured: Record<string, unknown> | null = null;
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: okBody };
      },
    }));

    await proxyGatewayMessages(
      {
        messages: [{ role: 'user', content: 'hello' }],
        max_tokens: 1024,
        system: 'be terse',
        stop_sequences: ['\n\n'],
        stream: false,
        temperature: 0.5,
        top_k: 4,
        top_p: 0.9,
        tools: [{ name: 't', description: 'd', input_schema: { type: 'object', properties: {} } }],
        tool_choice: { type: 'auto' },
        service_tier: 'auto',
        betas: ['oauth-2025-04-20'],
        mcp_servers: [],
        container: 'cont_1',
        cache_control: { type: 'ephemeral' },
        metadata: { session_id: 'conv-keep', user_id: 'client-user' },
      },
      'u1',
    );

    expect(captured).not.toBeNull();
    const c = captured!;
    for (const k of [
      'messages', 'max_tokens', 'system', 'stop_sequences', 'stream', 'temperature', 'top_k',
      'top_p', 'tools', 'tool_choice', 'service_tier', 'betas',
      'mcp_servers', 'container', 'cache_control', 'metadata', 'model',
    ]) {
      expect(Object.keys(c), `field ${k} must be forwarded`).toContain(k);
    }
    // gateway semantics preserved: wire model clamped, client metadata kept
    expect((c.metadata as Record<string, unknown>).user_id).toBe('client-user');
    expect(c.max_tokens).toBe(1024);
  });

  it('a configured EXPERT model runs at EXPERT: model honored ([1m] stripped on the wire), reasoning params preserved, metered at EXPERT (rc-1 amendment to §6.5.4)', async () => {
    let captured: Record<string, unknown> | null = null;
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: okBody };
      },
    }));
    const tiers = loadConfig().llm.tiers;

    await proxyGatewayMessages(
      {
        model: tiers.EXPERT.model, // 'claude-opus-4-8[1m]' by default
        messages: [{ role: 'user', content: 'plan this' }],
        max_tokens: 2048,
        metadata: { session_id: 'conv-expert' },
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      },
      'u1',
    );

    expect(captured).not.toBeNull();
    // The wire model is the CONFIGURED tier model with the client-side '[1m]' alias stripped.
    expect(captured!.model).toBe(tiers.EXPERT.model.replace(/\[1m\]$/, ''));
    // Reasoning params target the model the client asked for — they survive.
    expect(Object.keys(captured!)).toContain('thinking');
    expect(Object.keys(captured!)).toContain('output_config');
    // Metered at the tier that ran, not FAST.
    const events = await getDb().collection('token_events').find({}).toArray();
    expect(events).toHaveLength(1);
    expect(events[0]!.tier).toBe('EXPERT');
  });

  it('a configured WORKHORSE model runs at WORKHORSE with reasoning params preserved', async () => {
    let captured: Record<string, unknown> | null = null;
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: okBody };
      },
    }));
    const tiers = loadConfig().llm.tiers;

    await proxyGatewayMessages(
      {
        model: tiers.WORKHORSE.model,
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { session_id: 'conv-wh' },
        thinking: { type: 'adaptive' },
      },
      'u1',
    );

    expect(captured!.model).toBe(tiers.WORKHORSE.model.replace(/\[1m\]$/, ''));
    expect(Object.keys(captured!)).toContain('thinking');
    const events = await getDb().collection('token_events').find({}).toArray();
    expect(events[0]!.tier).toBe('WORKHORSE');
  });

  it('an UNKNOWN model keeps the legacy behavior: FAST clamp + reasoning params stripped', async () => {
    let captured: Record<string, unknown> | null = null;
    __setTransportForTests(fakeTransport({
      async messages(p: RestCallParams) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: okBody };
      },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tiers = loadConfig().llm.tiers;

    await proxyGatewayMessages(
      {
        model: 'some-alien-model-id',
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { session_id: 'conv-alien' },
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high' },
      },
      'u1',
    );

    expect(captured!.model).toBe(tiers.FAST.model.replace(/\[1m\]$/, ''));
    expect(Object.keys(captured!)).not.toContain('thinking');
    expect(Object.keys(captured!)).not.toContain('output_config');
    const logged = warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).toContain('fast-clamp');
    const events = await getDb().collection('token_events').find({}).toArray();
    expect(events[0]!.tier).toBe('FAST');
  });

  it('does not warn when the body carries only documented fields', async () => {
    __setTransportForTests(fakeTransport({
      async messages() { return { status: 200, headers: {}, body: okBody }; },
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await proxyGatewayMessages(
      { messages: [{ role: 'user', content: 'hi' }], metadata: { session_id: 'conv-clean' } },
      'u1',
    );
    const logged = warn.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('dropped');
  });
});
