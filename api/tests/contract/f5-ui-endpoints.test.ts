import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, knowledgeSources } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  KnowledgeSource, CrawlStartResponse, CrawlStatusResponse, RefreshScheduleResponse,
  SessionCaptureStatus, ConnectSessionResponse, ProvisionAutomationsResponse, ErrorEnvelope,
} from '@ekoa/shared';

/**
 * F5 subset (batch-1 S6): the knowledge + integrations endpoints the dashboard calls. Several have
 * NO backing infrastructure (no crawler; no server-side session-capture orchestration). Per the F5
 * brief those get HONEST contract-valid minimal implementations: they answer the declared shape
 * with truthful "nothing happened" values and NEVER fabricate a completed crawl or a captured
 * session. A fake success here would be worse than the 404 it replaces.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_f5_ui_endpoints');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await orgs.deleteMany({}); await knowledgeSources.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'A', createdAt: 'x' } as never);
  await orgs.insert({ _id: 'orgB', name: 'B', createdAt: 'x' } as never);
  await users.insert({ _id: 'u1', username: 'u1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'orgA', active: true });
  setActivation('u1', { active: true, billingLocked: false });
});
const tokenFor = async () => (await login('u1', 'pw123456', false, deps)).token;

const seedSource = () =>
  knowledgeSources.insert({ _id: 's1', orgId: 'orgA', url: 'https://exemplo.pt', kind: 'web', seedId: 'seed-1' } as never);
const seedForeignSource = () =>
  knowledgeSources.insert({ _id: 's-other', orgId: 'orgB', url: 'https://outra.pt', kind: 'web' } as never);

describe('knowledge: PATCH /sources/:id', () => {
  it('updates a source and returns a contract-valid KnowledgeSource', async () => {
    await seedSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s1', t, { method: 'PATCH', body: JSON.stringify({ enabled: false, collection: 'docs' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(KnowledgeSource.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.id).toBe('s1');
    expect(body.enabled).toBe(false);
    expect(body.collection).toBe('docs');
    // sourceView aligned to the contract: `kind` surfaces as `type`, `seedId` as `seedTemplate`
    expect(body.type).toBe('web');
    expect(body.seedTemplate).toBe('seed-1');
  });

  it('another org\'s source is invisible: 404 envelope, nothing written', async () => {
    await seedForeignSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s-other', t, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect((await knowledgeSources.get('s-other') as unknown as { enabled?: boolean }).enabled).toBeUndefined();
  });
});

describe('knowledge: crawl endpoints (no crawler infra — honest, never a fake completed crawl)', () => {
  it('POST /sources/:id/crawl answers CrawlStartResponse WITHOUT claiming a crawl started', async () => {
    await seedSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s1/crawl', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(CrawlStartResponse.safeParse(body).success).toBe(true);
    expect(body.started).toBe(false);        // truthful: no crawler exists
    expect(body.alreadyRunning).toBe(false);
  });

  it('GET /sources/:id/crawl answers CrawlStatusResponse with running:false and an honest reason', async () => {
    await seedSource();
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/sources/s1/crawl', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(CrawlStatusResponse.safeParse(body).success).toBe(true);
    expect(body.running).toBe(false);
    expect(JSON.stringify(body)).toContain('crawler'); // the reason is surfaced, not hidden
  });

  it('crawl endpoints 404 on another org\'s source', async () => {
    await seedForeignSource();
    const t = await tokenFor();
    for (const init of [{ method: 'POST' }, {}]) {
      const res = await authed('/api/v1/knowledge/sources/s-other/crawl', t, init);
      expect(res.status).toBe(404);
      expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    }
  });

  it('GET /knowledge/refresh-schedule answers RefreshScheduleResponse with a null schedule (none configured)', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/knowledge/refresh-schedule', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(RefreshScheduleResponse.safeParse(body).success).toBe(true);
    expect(body.schedule).toBeNull();
  });
});

describe('integrations: session + provisioning (no capture infra — honest, never a fake captured session)', () => {
  it('GET /:key/session answers SessionCaptureStatus with status none', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/integrations/gmail/session', t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(SessionCaptureStatus.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.status).toBe('none');
    expect((body.session as { status: string }).status).toBe('none');
    // The dashboard derefs `.actions` on this body (integrations page automation rows):
    // the contract carries an explicit (possibly empty) array, never undefined.
    expect(Array.isArray(body.actions), JSON.stringify(body)).toBe(true);
  });

  it('POST /:key/session answers ConnectSessionResponse WITHOUT claiming a session was started', async () => {
    const t = await tokenFor();
    const res = await authed('/api/v1/integrations/gmail/session', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ConnectSessionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.started).toBe(false);
    expect((body.session as { status: string }).status).toBe('failed'); // the enum's honest value
  });

  it('the session responses never carry captured credential material (storageState/cookies)', async () => {
    const t = await tokenFor();
    for (const init of [{}, { method: 'POST' }]) {
      const text = await (await authed('/api/v1/integrations/gmail/session', t, init)).text();
      expect(text).not.toContain('storageState');
      expect(text).not.toContain('cookies');
    }
  });

  it('POST /:key/provision-automations: unknown key → 404 envelope; a bound key MATERIALIZES managed automations idempotently', async () => {
    const t = await tokenFor();
    // Unknown definition → uniform 404 (the pre-provisioner stub answered fake zeros here).
    const missing = await authed('/api/v1/integrations/gmail/provision-automations', t, { method: 'POST' });
    expect(missing.status).toBe(404);

    // citius ships 4 automation-bound actions with repo-authored templates: provisioning
    // materializes them as org automations with deterministic `citius-<template>` ids.
    const res = await authed('/api/v1/integrations/citius/provision-automations', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ProvisionAutomationsResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.provisioned).toBe(true);
    expect(body.created).toBe(4);
    const rows = body.actions as Array<{ provisioned: boolean; automationId: string | null; automationName: string | null }>;
    expect(rows.filter((row) => row.provisioned)).toHaveLength(4);
    for (const row of rows.filter((r) => r.provisioned)) {
      expect(String(row.automationId)).toMatch(/^citius-/);
      expect(row.automationName).toBeTruthy();
    }

    // Idempotent: a re-provision refreshes in place, never duplicates.
    const again = await readJson(await authed('/api/v1/integrations/citius/provision-automations', t, { method: 'POST' }));
    expect(again.created).toBe(0);
    expect(again.updated).toBe(4);

    // The session view reflects the materialized rows (the dashboard's card state).
    const session = await readJson(await authed('/api/v1/integrations/citius/session', t));
    const sRows = (session.actions ?? []) as Array<{ provisioned: boolean }>;
    expect(sRows.filter((row) => row.provisioned)).toHaveLength(4);
  });

  it('all three require auth (401 envelope)', async () => {
    for (const [m, p] of [['GET', '/session'], ['POST', '/session'], ['POST', '/provision-automations']] as const) {
      const res = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/gmail${p}`, { method: m, headers: { 'content-type': 'application/json' } });
      expect(res.status).toBe(401);
      expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    }
  });
});
