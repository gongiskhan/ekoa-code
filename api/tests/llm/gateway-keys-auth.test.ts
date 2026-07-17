import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import express from 'express';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { tokenEvents, billingAccounts, activityLogs } from '../../src/data/stores.js';
import { gatewayRouter, __resetGatewayCountersForTests, type VerifyGatewayKeySeam } from '../../src/llm/gateway.js';
import { __setTransportForTests, __resetTransportForTests, type ChokepointTransport } from '../../src/llm/client.js';
import { setCredential, __resetCredentialsForTests, __setNowForTests } from '../../src/llm/credentials.js';
import { __resetRateCapsForTests } from '../../src/billing/rate-caps.js';

/**
 * S4a per-user gateway keys on the GATEWAY (run 20260717-071930-d1244839): a key principal is
 * accepted on BOTH credential channels, bills its OWNER as 'gateway-client', passes the
 * allowance gate, gets a per-key rate-cap window, produces a metadata-only gateway_turn Registo
 * row, and every failure mode fails closed (revoked/unknown 401, locked owner 402). The seam is
 * faked here (service mechanics live in tests/auth/gateway-keys-service.test.ts).
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
const T0 = 1_800_000_000_000;
const GATEWAY_KEY = 'gw-secret';
const USER_KEY = 'ekoa_gk_test-secret-abcd';

const verifyToken = (token: string) => {
  const m = /^good:([^:]+):([^:]*)$/.exec(token);
  if (!m) throw new Error('bad token');
  return { sub: m[1]!, orgId: m[2]! };
};

type SeamVerdict = Awaited<ReturnType<VerifyGatewayKeySeam>>;
let keyVerdict: SeamVerdict = { ok: true, userId: 'owner1', orgId: 'orgK', keyId: 'kid_1', username: 'owner-one' };
const verifyGatewayKey: VerifyGatewayKeySeam = async (secret) =>
  secret === USER_KEY ? keyVerdict : { ok: false, reason: 'unknown' };

const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });

function stubTransport(over: Partial<ChokepointTransport>): ChokepointTransport {
  const base: ChokepointTransport = {
    async *streamAgent() { yield { kind: 'final', text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 }, aborted: false }; },
    async oneShot() { return { text: '', usage: { input: 0, output: 0, cacheCreate: 0, cacheRead: 0 } }; },
    async messages() { return { status: 200, headers: {}, body: providerBody(200, 40) }; },
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
  await connectMongo(mem.getUri(), 'ekoa_gateway_keys_auth');
  const app = express();
  app.use('/api/v1/llm', gatewayRouter({ verifyToken, verifyGatewayKey, now: () => T0 }));
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
  keyVerdict = { ok: true, userId: 'owner1', orgId: 'orgK', keyId: 'kid_1', username: 'owner-one' };
  __resetGatewayCountersForTests();
  __resetTransportForTests();
  __resetCredentialsForTests();
  __resetRateCapsForTests();
  __setNowForTests(() => T0);
  for (const c of ['token_events', 'billing_accounts', 'credentials', 'settings', 'activity_logs']) {
    await getDb().collection(c).deleteMany({});
  }
  await setCredential({ mode: 'oauth', secret: 'tok', refreshToken: 'rt', expiresAt: T0 + 60 * 60 * 1000 });
  __setTransportForTests(stubTransport({}));
});
afterEach(() => vi.restoreAllMocks());

const msgBody = JSON.stringify({ model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'hi' }] });

describe('user-key principal', () => {
  it('is accepted on BOTH channels (Bearer and x-api-key) and bills the OWNER as gateway-client', async () => {
    for (const headers of [{ authorization: `Bearer ${USER_KEY}` }, { 'x-api-key': USER_KEY }] as Array<Record<string, string>>) {
      await getDb().collection('token_events').deleteMany({});
      const res = await api('/api/v1/llm/messages', { method: 'POST', headers, body: msgBody });
      expect(res.status).toBe(200);
      const rows = await tokenEvents.find({ agentType: 'gateway-client' });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ billeeUserId: 'owner1', tier: 'WORKHORSE', metered: 24 });
    }
  });

  it('writes ONE metadata-only gateway_turn Registo row per metered turn (and none for the static key)', async () => {
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: msgBody });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 25)); // best-effort write lands async
    const rows = await activityLogs.find({ type: 'gateway_turn' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'owner1', username: 'owner-one', orgId: 'orgK', category: 'llm-gateway' });
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta).toMatchObject({ keyId: 'kid_1', tier: 'WORKHORSE', model: 'claude-sonnet-5', metered: 24, stream: false });
    expect(JSON.stringify(rows[0])).not.toContain('hi'); // never content

    await api('/api/v1/llm/messages', { method: 'POST', headers: { 'x-api-key': GATEWAY_KEY }, body: msgBody });
    await new Promise((r) => setTimeout(r, 25));
    expect(await activityLogs.find({ type: 'gateway_turn' })).toHaveLength(1); // static key: still one
  });

  it('unknown key -> 401; revoked -> 401; billing-locked owner -> 402 BILLING_LOCKED on messages, count_tokens and models', async () => {
    const bad = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: 'Bearer ekoa_gk_wrong' }, body: msgBody });
    expect(bad.status).toBe(401);

    keyVerdict = { ok: false, reason: 'revoked' };
    const revoked = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: msgBody });
    expect(revoked.status).toBe(401);

    keyVerdict = { ok: false, reason: 'billing_locked' };
    for (const [path, init] of [
      ['/api/v1/llm/messages', { method: 'POST', body: msgBody }],
      ['/api/v1/llm/v1/messages/count_tokens', { method: 'POST', body: msgBody }],
      ['/api/v1/llm/models', { method: 'GET' }],
    ] as const) {
      const res = await api(path, { ...init, headers: { authorization: `Bearer ${USER_KEY}` } });
      expect(res.status, path).toBe(402);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('BILLING_LOCKED');
    }
    expect(await tokenEvents.find({})).toHaveLength(0);
  });

  it('passes the allowance gate with the OWNER as billee (exhausted owner -> 402 BILLING_BLOCKED, nothing billed)', async () => {
    await billingAccounts.insert({ _id: 'owner1', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false, currentPeriodStart: T0, tokenLimit: 0 } as never);
    const res = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: msgBody });
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('BILLING_BLOCKED');
    expect(await tokenEvents.find({})).toHaveLength(0);
  });

  it('per-key caps compose: a keyCaps override of 1 call/window trips the SECOND call while user/org caps are untouched', async () => {
    keyVerdict = { ok: true, userId: 'owner1', orgId: 'orgK', keyId: 'kid_capped', username: 'owner-one', caps: { maxCallsPerWindow: 1 } };
    const first = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: msgBody });
    expect(first.status).toBe(200);
    const second = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: msgBody });
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: { type: string } };
    expect(body.error.type).toBe('rate_limit_error');
    expect(await tokenEvents.find({})).toHaveLength(1); // only the admitted call billed
  });

  it('/classify for a user-key principal: allowance-blocked owner degrades to the FREE keyword path (never bills)', async () => {
    await billingAccounts.insert({ _id: 'owner1', monthlyBaseTokensUsed: 0, creditBalanceUsd: 0, overageEnabled: false, currentPeriodStart: T0, tokenLimit: 0 } as never);
    const res = await api('/api/v1/llm/classify', {
      method: 'POST',
      headers: { authorization: `Bearer ${USER_KEY}` },
      body: JSON.stringify({ prompt: 'build a complex dashboard application' }),
    });
    expect(res.status).toBe(200); // classify never 500s and never hard-blocks
    const body = (await res.json()) as { classifier: string };
    expect(body.classifier).toBe('keyword-fallback');
    expect(await tokenEvents.find({})).toHaveLength(0); // nothing billed to the blocked owner
  });

  it('/classify for a user-key principal composes the per-key cap window: second call degrades to keyword, only one metered', async () => {
    keyVerdict = { ok: true, userId: 'owner1', orgId: 'orgK', keyId: 'kid_cls', username: 'owner-one', caps: { maxCallsPerWindow: 1 } };
    __setTransportForTests(stubTransport({
      async messages() {
        return { status: 200, headers: {}, body: JSON.stringify({ content: [{ type: 'text', text: 'FAST' }], usage: { input_tokens: 20, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } }) };
      },
    }));
    const first = await api('/api/v1/llm/classify', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: JSON.stringify({ prompt: 'ola' }) });
    expect(first.status).toBe(200);
    expect(((await first.json()) as { classifier: string }).classifier).toBe('llm');
    const second = await api('/api/v1/llm/classify', { method: 'POST', headers: { authorization: `Bearer ${USER_KEY}` }, body: JSON.stringify({ prompt: 'ola' }) });
    expect(second.status).toBe(200);
    expect(((await second.json()) as { classifier: string }).classifier).toBe('keyword-fallback'); // key window tripped
    expect(await tokenEvents.find({})).toHaveLength(1); // exactly the admitted call metered
  });

  it('static key and JWT principals are regression-pinned (unchanged behavior)', async () => {
    const platform = await api('/api/v1/llm/messages', { method: 'POST', headers: { 'x-api-key': GATEWAY_KEY }, body: msgBody });
    expect(platform.status).toBe(200);
    expect(await tokenEvents.find({ agentType: 'pi-fast-loop', billeeUserId: '' })).toHaveLength(1);

    const jwt = await api('/api/v1/llm/messages', { method: 'POST', headers: { authorization: 'Bearer good:userX:orgA' }, body: msgBody });
    expect(jwt.status).toBe(200);
    expect(await tokenEvents.find({ agentType: 'pi-fast-loop', billeeUserId: 'userX' })).toHaveLength(1);
  });
});
