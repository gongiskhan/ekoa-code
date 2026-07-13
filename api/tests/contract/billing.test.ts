import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, billingAccounts, tokenEvents, settings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { recordTokenEvent } from '../../src/billing/tracker.js';
import { __resetBillingConfigForTests } from '../../src/billing/constants.js';
import {
  BillingUsage,
  BillingHistoryResponse,
  BillingBreakdownResponse,
  PurchaseCreditsResponse,
  ToggleOverageResponse,
  AdminGlobalOverageResponse,
  AdminUsageResponse,
  AdminResetUsageResponse,
  AdminSetLimitResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * ch03 §3.8.21 / ch06 §6.6 billing REST contract. Every response validates against its named
 * `shared/` schema; every non-2xx validates against the error envelope (ch13 §13 binding rule).
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: 'orgA', active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const jwtApi = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
// contract bodies are validated by schema safeParse; property reads use a loose view
const readJson = async (r: Response): Promise<Record<string, any>> => (await r.json()) as Record<string, any>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_billing');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetBillingConfigForTests();
  for (const s of [users, billingAccounts, tokenEvents, settings]) await s.deleteMany({});
});

describe('GET /billing/usage (derived view, §6.6.2)', () => {
  it('validates BillingUsage and carries the full gauge surface', async () => {
    await mkUser('u1', 'user');
    const t = await tokenFor('u1');
    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'EXPERT', raw: { input: 200_000, output: 30_000, cacheCreate: 0, cacheRead: 800_000 }, now: deps.now() });
    const res = await jwtApi('/api/v1/billing/usage', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BillingUsage.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ tokensUsed: 172_000, tokensBase: 10_000_000, gaugeColor: 'green' });
    expect(body.tokensRemaining).toBe(10_000_000 - 172_000);
    expect(body.effectiveTotal).toBe(10_000_000); // hard-limit ON → no credit headroom
    expect(typeof body.currentPeriodStart).toBe('string');
  });
});

describe('GET /billing/history (§3.8.21)', () => {
  it('validates BillingHistoryResponse; newest-first, paginated', async () => {
    await mkUser('u1', 'user');
    const t = await tokenFor('u1');
    for (let i = 0; i < 3; i++) {
      await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: `agent${i}`, model: 'm', tier: 'FAST', raw: { input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: 1_700_000_000_000 + i });
    }
    const res = await jwtApi('/api/v1/billing/history', t);
    const body = await readJson(res);
    expect(BillingHistoryResponse.safeParse(body).success).toBe(true);
    expect(body.total).toBe(3);
    expect(body.items[0].type).toBe('agent2'); // newest first

    const paged = await readJson(await jwtApi('/api/v1/billing/history?limit=1&offset=0', t));
    expect(paged.items).toHaveLength(1);
    expect(paged.total).toBe(3);
  });
});

describe('POST /billing/credits + PUT /billing/overage (user)', () => {
  it('purchase-credits validates PurchaseCreditsResponse and increments the balance', async () => {
    await mkUser('u1', 'user');
    const t = await tokenFor('u1');
    const res = await jwtApi('/api/v1/billing/credits', t, { method: 'POST', body: JSON.stringify({ amountUsd: 10 }) });
    const body = await readJson(res);
    expect(PurchaseCreditsResponse.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, newBalance: 10 });
    const again = await readJson(await jwtApi('/api/v1/billing/credits', t, { method: 'POST', body: JSON.stringify({ amountUsd: 5 }) }));
    expect(again.newBalance).toBe(15);
  });

  it('a non-positive amount → 400 VALIDATION_FAILED (error envelope)', async () => {
    await mkUser('u1', 'user');
    const t = await tokenFor('u1');
    const res = await jwtApi('/api/v1/billing/credits', t, { method: 'POST', body: JSON.stringify({ amountUsd: -1 }) });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('toggle-overage validates ToggleOverageResponse', async () => {
    await mkUser('u1', 'user');
    const t = await tokenFor('u1');
    const res = await jwtApi('/api/v1/billing/overage', t, { method: 'PUT', body: JSON.stringify({ enabled: true }) });
    const body = await readJson(res);
    expect(ToggleOverageResponse.safeParse(body).success).toBe(true);
    expect(body.overageEnabled).toBe(true);
  });
});

describe('super-admin surfaces (§6.6.2)', () => {
  it('breakdown: builder → 403 FORBIDDEN (envelope); super-admin → BillingBreakdownResponse grouped by agentType', async () => {
    await mkUser('u1', 'user');
    await mkUser('admin', 'super-admin');
    // seed platform-wide events across two agent types / two users
    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST', raw: { input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });
    await recordTokenEvent({ billeeUserId: 'admin', attributionKind: 'user_work', agentType: 'build', model: 'm', tier: 'FAST', raw: { input: 3000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });

    const forbidden = await jwtApi('/api/v1/billing/breakdown', await tokenFor('u1'));
    expect(forbidden.status).toBe(403);
    const fBody = await readJson(forbidden);
    expect(ErrorEnvelope.safeParse(fBody).success).toBe(true);
    expect(fBody.error.code).toBe('FORBIDDEN');

    const res = await jwtApi('/api/v1/billing/breakdown', await tokenFor('admin'));
    const body = await readJson(res);
    expect(BillingBreakdownResponse.safeParse(body).success).toBe(true);
    expect(body.items[0]).toMatchObject({ agentType: 'build', tokens: 60 }); // 3000*0.02
    expect(body.items[1]).toMatchObject({ agentType: 'chat', tokens: 20 }); // 1000*0.02
  });

  it('admin global overage validates AdminGlobalOverageResponse and persists to settings', async () => {
    await mkUser('admin', 'super-admin');
    const t = await tokenFor('admin');
    const res = await jwtApi('/api/v1/billing/admin/overage', t, { method: 'PUT', body: JSON.stringify({ enabled: false }) });
    const body = await readJson(res);
    expect(AdminGlobalOverageResponse.safeParse(body).success).toBe(true);
    expect(body.globalOverageEnabled).toBe(false);
    const stored = (await settings.get('default')) as unknown as { billing: { globalOverageEnabled: boolean } };
    expect(stored.billing.globalOverageEnabled).toBe(false);
  });

  it('admin list/reset/set-limit validate their schemas and round-trip', async () => {
    await mkUser('admin', 'super-admin');
    await mkUser('u1', 'user');
    const t = await tokenFor('admin');
    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST', raw: { input: 5000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });

    const list = await readJson(await jwtApi('/api/v1/billing/admin/usage', t));
    expect(AdminUsageResponse.safeParse(list).success).toBe(true);
    expect(list.items.find((r: { userId: string }) => r.userId === 'u1').tokensUsed).toBe(100);

    const limit = await jwtApi('/api/v1/billing/admin/limits/u1', t, { method: 'PUT', body: JSON.stringify({ tokenLimit: 42 }) });
    const lBody = await readJson(limit);
    expect(AdminSetLimitResponse.safeParse(lBody).success).toBe(true);
    expect(lBody).toEqual({ userId: 'u1', tokenLimit: 42 });
    // clear back to platform default
    const cleared = await readJson(await jwtApi('/api/v1/billing/admin/limits/u1', t, { method: 'PUT', body: JSON.stringify({ tokenLimit: null }) }));
    expect(cleared.tokenLimit).toBeNull();

    const reset = await jwtApi('/api/v1/billing/admin/usage/u1/reset', t, { method: 'POST' });
    const rBody = await readJson(reset);
    expect(AdminResetUsageResponse.safeParse(rBody).success).toBe(true);
    expect(rBody).toEqual({ userId: 'u1', tokensUsed: 0 });
    const relisted = await readJson(await jwtApi('/api/v1/billing/admin/usage', t));
    expect(relisted.items.find((r: { userId: string }) => r.userId === 'u1').tokensUsed).toBe(0);
  });

  it('admin usage rows carry identity + gauge fields; account-less users appear zeroed', async () => {
    await mkUser('admin', 'super-admin');
    await mkUser('u1', 'user');
    await mkUser('fresh', 'user'); // never made a metered call → no billing account row
    const t = await tokenFor('admin');
    await recordTokenEvent({ billeeUserId: 'u1', attributionKind: 'user_work', agentType: 'chat', model: 'm', tier: 'FAST', raw: { input: 5000, output: 0, cacheCreate: 0, cacheRead: 0 }, now: deps.now() });

    const list = await readJson(await jwtApi('/api/v1/billing/admin/usage', t));
    expect(AdminUsageResponse.safeParse(list).success).toBe(true);

    const u1 = list.items.find((r: { userId: string }) => r.userId === 'u1');
    expect(u1).toMatchObject({
      username: 'u1', role: 'user', isActive: true,
      tokensUsed: 100, tokensBase: 10_000_000, tokensRemaining: 10_000_000 - 100,
      tokenLimit: null, isCustomLimit: false, percentage: 0, lastLoginAt: null,
    });
    expect(typeof u1.currentPeriodStart).toBe('string');

    // The account-less user still appears, zeroed against the platform default base.
    const fresh = list.items.find((r: { userId: string }) => r.userId === 'fresh');
    expect(fresh).toMatchObject({
      username: 'fresh', role: 'user', isActive: true,
      tokensUsed: 0, tokensBase: 10_000_000, tokensRemaining: 10_000_000,
      tokenLimit: null, isCustomLimit: false, percentage: 0,
    });

    // A custom limit flips isCustomLimit and rebases the gauge.
    await jwtApi('/api/v1/billing/admin/limits/u1', t, { method: 'PUT', body: JSON.stringify({ tokenLimit: 1000 }) });
    const relisted = await readJson(await jwtApi('/api/v1/billing/admin/usage', t));
    const u1Limited = relisted.items.find((r: { userId: string }) => r.userId === 'u1');
    expect(u1Limited).toMatchObject({ tokensBase: 1000, isCustomLimit: true, tokenLimit: 1000, percentage: 10 });
  });

  it('a builder is refused every admin route with 403 FORBIDDEN (envelope)', async () => {
    await mkUser('u1', 'user');
    const t = await tokenFor('u1');
    for (const [p, init] of [
      ['/api/v1/billing/admin/usage', {}],
      ['/api/v1/billing/admin/overage', { method: 'PUT', body: JSON.stringify({ enabled: true }) }],
      ['/api/v1/billing/admin/limits/u1', { method: 'PUT', body: JSON.stringify({ tokenLimit: 1 }) }],
      ['/api/v1/billing/admin/usage/u1/reset', { method: 'POST' }],
    ] as const) {
      const res = await jwtApi(p, t, init);
      expect(res.status, p).toBe(403);
      expect(ErrorEnvelope.safeParse(await readJson(res)).success, p).toBe(true);
    }
  });
});
