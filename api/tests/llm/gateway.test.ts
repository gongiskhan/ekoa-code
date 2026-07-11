import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { tokenEvents, billingAccounts } from '../../src/data/stores.js';
import { gatewayRouter, gatewayUnmeteredCount, __resetGatewayCountersForTests } from '../../src/llm/gateway.js';
import { __setTransportForTests, __resetTransportForTests, type ChokepointTransport } from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests, __setNowForTests } from '../../src/llm/credentials.js';
import { LlmModelsResponse } from '@ekoa/shared';

/**
 * The ekoa-local gateway sub-app (ch03 §3.10; §6.5.4). Wire-tier FAST billing regardless of
 * router, parse-or-skip usage with the observable gateway_unmetered_call counter, JWT/api-key
 * auth, and the BILLING_BLOCKED 402 for an exhausted JWT principal. Transport is stubbed.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
const T0 = 1_800_000_000_000;
const GATEWAY_KEY = 'gw-secret';

// A minimal injected verifier: token "good:<userId>:<orgId>" is valid.
const verifyToken = (token: string) => {
  const m = /^good:([^:]+):([^:]*)$/.exec(token);
  if (!m) throw new Error('bad token');
  return { sub: m[1]!, orgId: m[2]! };
};

const api = (p: string, init: RequestInit = {}) => fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response): Promise<any> => res.json();

function stubTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: '{}' }; },
  };
  return { ...base, ...over };
}

const providerBody = (input: number, output: number) =>
  JSON.stringify({ content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: input, output_tokens: output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  process.env.LLM_GATEWAY_API_KEY = GATEWAY_KEY;
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_llm_gateway');
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
  __setNowForTests(() => T0);
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
});
afterEach(() => vi.restoreAllMocks());

describe('POST /messages — forward + tier-matched metering (§6.5.4, rc-1 amendment 2026-07-11)', () => {
  it('api-key principal asking for the CONFIGURED EXPERT model: runs + bills at EXPERT against the platform admin', async () => {
    __setTransportForTests(stubTransport({ async messages() { return { status: 200, headers: { 'content-type': 'application/json' }, body: providerBody(200, 40) }; } }));
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { 'x-api-key': GATEWAY_KEY }, body: JSON.stringify({ model: 'claude-opus-4-8[1m]', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(200);
    expect((await json(res)).content[0].text).toBe('hi');

    const rows = await tokenEvents.find({ agentType: 'pi-fast-loop' });
    expect(rows).toHaveLength(1);
    // The requested model IS the configured EXPERT tier model → honored + metered at EXPERT
    // (the pre-amendment gateway clamped this to FAST, silently degrading subprocess traffic).
    expect(rows[0]).toMatchObject({ tier: 'EXPERT', model: 'claude-opus-4-8[1m]', billeeUserId: '', metered: 96 }); // round(0.4*240)
  });

  it('api-key principal with an UNKNOWN model: clamped + billed at FAST (legacy behavior pinned)', async () => {
    __setTransportForTests(stubTransport({ async messages() { return { status: 200, headers: { 'content-type': 'application/json' }, body: providerBody(200, 40) }; } }));
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { 'x-api-key': GATEWAY_KEY }, body: JSON.stringify({ model: 'some-alien-model', messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(200);

    const rows = await tokenEvents.find({ agentType: 'pi-fast-loop' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tier: 'FAST', model: 'claude-haiku-4-5-20251001', billeeUserId: '', metered: 5 }); // round(0.02*240)
  });

  it('JWT principal: bills that user', async () => {
    __setTransportForTests(stubTransport({ async messages() { return { status: 200, headers: {}, body: providerBody(100, 0) }; } }));
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: 'Bearer good:userX:orgA' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(200);
    expect(await tokenEvents.find({ billeeUserId: 'userX', agentType: 'pi-fast-loop' })).toHaveLength(1);
  });

  it('unparseable 2xx body: skips billing and increments gateway_unmetered_call', async () => {
    __setTransportForTests(stubTransport({ async messages() { return { status: 200, headers: {}, body: 'not-json-no-usage' }; } }));
    expect(gatewayUnmeteredCount()).toBe(0);
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { 'x-api-key': GATEWAY_KEY }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(200);
    expect(gatewayUnmeteredCount()).toBe(1);
    expect(await tokenEvents.find({})).toHaveLength(0);
  });
});

describe('auth + billing gate', () => {
  it('no key / no JWT → 401 gateway error shape', async () => {
    const res = await api('/api/v1/llm/messages', { method: 'POST', body: JSON.stringify({ messages: [] }) });
    expect(res.status).toBe(401);
    expect((await json(res)).error.type).toBe('authentication_error');
  });

  it('JWT principal past allowance → 402 BILLING_BLOCKED envelope', async () => {
    // tokenLimit 0 → base 0 → remaining 0 → blocked (overage off).
    await billingAccounts.insert({ _id: 'brokeUser', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false, currentPeriodStart: T0, tokenLimit: 0 } as never);
    __setTransportForTests(stubTransport({ async messages() { return { status: 200, headers: {}, body: providerBody(1, 1) }; } }));
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: 'Bearer good:brokeUser:orgA' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(res.status).toBe(402);
    const body = await json(res);
    expect(body.error.code).toBe('BILLING_BLOCKED');
    expect(body.error.details.billingUrl).toBeTruthy();
    // Blocked before the forward: nothing billed.
    expect(await tokenEvents.find({ billeeUserId: 'brokeUser' })).toHaveLength(0);
  });
});

describe('POST /classify — deterministic keyword mode, never 500s', () => {
  it('keyword mode classifies a strong build to EXPERT and escalates', async () => {
    process.env.EKOA_TUI_CLASSIFY_MODE = 'keyword';
    try {
      const res = await api('/api/v1/llm/classify', { method: 'POST', headers: { 'x-api-key': GATEWAY_KEY }, body: JSON.stringify({ prompt: 'build a complex dashboard application' }) });
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.tier).toBe('EXPERT');
      expect(body.classifier).toBe('keyword');
      expect(body.escalate).toBe(true);
      expect(body.minTier).toBe('WORKHORSE');
    } finally {
      delete process.env.EKOA_TUI_CLASSIFY_MODE;
    }
  });

  it('GET /models answers the Anthropic-style LlmModelsResponse envelope ({ data })', async () => {
    const res = await api('/api/v1/llm/models', { headers: { 'x-api-key': GATEWAY_KEY } });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(LlmModelsResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    const ids = body.data.map((m: { id: string }) => m.id);
    expect(ids).toContain('claude-haiku-4-5-20251001');
  });
});
