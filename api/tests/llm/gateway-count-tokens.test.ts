import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { tokenEvents, billingAccounts } from '../../src/data/stores.js';
import { gatewayRouter, __resetGatewayCountersForTests } from '../../src/llm/gateway.js';
import {
  __setTransportForTests,
  __resetTransportForTests,
  setOrgResolver,
  __resetOrgResolverForTests,
  type ChokepointTransport,
  type RestCallParams,
} from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests, __setNowForTests, __setRefreshFnForTests } from '../../src/llm/credentials.js';
import { setRulesetResolver, __resetRulesetResolverForTests, __resetVaultForTests, type OrgRuleset } from '../../src/llm/anonymise/index.js';
import { __vaultCount } from '../../src/llm/anonymise/vault.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';

/**
 * S3 count_tokens forwarding (run 20260717-071930-d1244839): POST /v1/messages/count_tokens
 * (+ /messages/count_tokens alias) forwards through the chokepoint with the FULL anonymisation
 * posture and the S2 tier resolution, but is NEVER billed, NEVER rate-capped, and skips the
 * allowance gate (free upstream; Claude Code polls it continuously).
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
const T0 = 1_800_000_000_000;
const GATEWAY_KEY = 'gw-secret';
const PARTY = 'Petrova Holdings'; // deny-listed synthetic party name (anonymise precedent)

const verifyToken = (token: string) => {
  const m = /^good:([^:]+):([^:]*)$/.exec(token);
  if (!m) throw new Error('bad token');
  return { sub: m[1]!, orgId: m[2]! };
};

const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

function stubTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"input_tokens": 42}' }; },
  };
  return { ...base, ...over };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.LLM_GATEWAY_API_KEY = GATEWAY_KEY;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_llm_count_tokens');
  const app = express();
  app.use('/api/v1/llm', gatewayRouter({ verifyToken }));
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
  delete process.env.LLM_GATEWAY_API_KEY;
});

beforeEach(async () => {
  __resetGatewayCountersForTests();
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
});
afterEach(() => {
  delete process.env.EKOA_RATECAP_CALLS_PER_USER;
  __resetRateCapsForTests();
  vi.restoreAllMocks();
});

describe('POST /v1/messages/count_tokens (+ alias) — forwarded, never billed, never capped', () => {
  it('forwards to the count_tokens endpoint with the resolved wire model; response passes through; ZERO token_events', async () => {
    const calls: RestCallParams[] = [];
    __setTransportForTests(stubTransport({
      async messages(p) {
        calls.push(p);
        return { status: 200, headers: { 'content-type': 'application/json' }, body: '{"input_tokens": 42}' };
      },
    }));
    for (const path of ['/api/v1/llm/v1/messages/count_tokens', '/api/v1/llm/messages/count_tokens']) {
      const before = calls.length;
      const res = await api(path, {
        method: 'POST',
        headers: { 'x-api-key': GATEWAY_KEY },
        body: JSON.stringify({ model: 'claude-3-7-sonnet-20250219', messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ input_tokens: 42 });
      expect(calls.length).toBe(before + 1);
      const got = calls[calls.length - 1]!;
      expect(got.endpoint).toBe('count_tokens');
      expect(got.stream).toBe(false);
      // Family-matched sonnet -> configured WORKHORSE model on the wire (honest count).
      expect((got.payload as { model: string }).model).toBe('claude-sonnet-5');
    }
    expect(await tokenEvents.find({})).toHaveLength(0);
  });

  it('drops non-count_tokens fields (stream/max_tokens/metadata) and keeps the count surface (system/tools/thinking on a family match)', async () => {
    let captured: Record<string, unknown> | undefined;
    __setTransportForTests(stubTransport({
      async messages(p) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: '{"input_tokens": 7}' };
      },
    }));
    const res = await api('/api/v1/llm/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        stream: true,
        max_tokens: 32000,
        metadata: { user_id: 'u1' },
        temperature: 0.7,
        system: 'be terse',
        tools: [{ name: 't1', input_schema: { type: 'object' } }],
        thinking: { type: 'enabled', budget_tokens: 1024 },
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(captured).toBeDefined();
    for (const gone of ['stream', 'max_tokens', 'metadata', 'temperature']) expect(captured).not.toHaveProperty(gone);
    expect(captured!.system).toBe('be terse');
    expect(Array.isArray(captured!.tools)).toBe(true);
    expect(captured!.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('unknown model: FAST clamp strips thinking, counts against the FAST wire model', async () => {
    let captured: Record<string, unknown> | undefined;
    __setTransportForTests(stubTransport({
      async messages(p) {
        captured = p.payload as Record<string, unknown>;
        return { status: 200, headers: {}, body: '{"input_tokens": 7}' };
      },
    }));
    const res = await api('/api/v1/llm/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'some-alien-model', thinking: { type: 'enabled', budget_tokens: 1024 }, messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(captured!.model).toBe('claude-haiku-4-5-20251001');
    expect(captured).not.toHaveProperty('thinking');
  });

  it('anonymisation applies: a deny-listed literal never reaches the transport', async () => {
    setOrgResolver(async () => 'org1');
    setRulesetResolver((orgId): OrgRuleset => ({ orgId, denyList: [PARTY] }));
    let captured = '';
    __setTransportForTests(stubTransport({
      async messages(p) {
        captured = JSON.stringify(p.payload);
        return { status: 200, headers: {}, body: '{"input_tokens": 9}' };
      },
    }));
    const res = await api('/api/v1/llm/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: `contract with ${PARTY} attached` }] }),
    });
    expect(res.status).toBe(200);
    expect(captured).not.toContain(PARTY);
    // The ephemeral (no session_id) vault is cleared in the finally - never lingers to TTL.
    expect(__vaultCount()).toBe(0);
  });

  it('a crafted session_id cannot open a reserved gwkey vault on the count_tokens path either (S7 codex High sibling)', async () => {
    __setTransportForTests(stubTransport({}));
    // A messages call under a real key builds the victim's gwkey:kid_v vault.
    const { proxyGatewayMessages } = await import('../../src/llm/client.js');
    await proxyGatewayMessages({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: `abre ${PARTY}` }] }, 'ownerV', undefined, { agentType: 'gateway-client', keyId: 'kid_v' });
    setOrgResolver(async () => 'org1');
    setRulesetResolver((orgId) => ({ orgId, denyList: [PARTY] }));
    const before = __vaultCount();
    // count_tokens by a DIFFERENT owner crafting session_id = the victim's gwkey vault name.
    const res = await api('/api/v1/llm/v1/messages/count_tokens', {
      method: 'POST',
      headers: { authorization: 'Bearer good:ownerA:org1' },
      body: JSON.stringify({ model: 'claude-sonnet-5', metadata: { session_id: 'gwkey:kid_v' }, messages: [{ role: 'user', content: `algo com ${PARTY}` }] }),
    });
    expect(res.status).toBe(200);
    // The crafted call got its OWN billee-scoped vault (csid:ownerA:gwkey:kid_v), not the
    // victim's - a NEW vault appeared, the victim's is untouched.
    expect(__vaultCount()).toBe(before + 1);
  });

  it('is NOT rate-capped (cap 0 trips real messages but count_tokens still answers) and skips the allowance gate (billing-blocked owner still counts)', async () => {
    process.env.EKOA_RATECAP_CALLS_PER_USER = '0';
    __resetRateCapsForTests();
    await billingAccounts.insert({ _id: 'brokeUser', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false, currentPeriodStart: T0, tokenLimit: 0 } as never);
    __setTransportForTests(stubTransport({}));

    const count = await api('/api/v1/llm/v1/messages/count_tokens', {
      method: 'POST',
      headers: { authorization: 'Bearer good:brokeUser:orgA' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(count.status).toBe(200);
    expect(await count.json()).toEqual({ input_tokens: 42 });

    // The sibling REAL message from the same broke user is still blocked (allowance 402).
    const real = await api('/api/v1/llm/v1/messages', {
      method: 'POST',
      headers: { authorization: 'Bearer good:brokeUser:orgA' },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(real.status).toBe(402);
  });

  it('refresh-and-retry-once on 401 (same posture as messages)', async () => {
    const refresh = vi.fn(async () => ({ secret: 'fresh', expiresAt: T0 + 60 * 60 * 1000 }));
    __setRefreshFnForTests(refresh);
    const secrets: string[] = [];
    __setTransportForTests(stubTransport({
      async messages(p) {
        secrets.push(p.secret);
        if (secrets.length === 1) return { status: 401, headers: {}, body: '' };
        return { status: 200, headers: {}, body: '{"input_tokens": 5}' };
      },
    }));
    const res = await api('/api/v1/llm/v1/messages/count_tokens', {
      method: 'POST',
      headers: { 'x-api-key': GATEWAY_KEY },
      body: JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.status).toBe(200);
    expect(secrets).toEqual(['tok', 'fresh']);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('unauthenticated -> clean 401 in the gateway error shape', async () => {
    const res = await api('/api/v1/llm/v1/messages/count_tokens', { method: 'POST', body: JSON.stringify({ messages: [] }) });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { type: string } };
    expect(body.error.type).toBe('authentication_error');
  });
});
