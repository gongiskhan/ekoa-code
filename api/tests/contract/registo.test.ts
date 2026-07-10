import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { setCredential } from '../../src/llm/credentials.js';
import { __setTransportForTests, __resetTransportForTests } from '../../src/llm/client.js';
import { makeFakeTransport } from '../agents/_fake-transport.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { RegistoListResponse, RegistoEntry } from '@ekoa/shared';

/**
 * F3 (batch-final s3): the covered actions produce Registo rows visible to the org admin,
 * metadata-only. Registo READ + org scoping already worked; the gap was that no login and no
 * build lifecycle event was ever audit-logged, so the org's admin oversight surface was blind
 * to the headline events. This drives the REAL routes (login -> /jobs -> /registo) and asserts
 * the rows appear, validate against the shared schema, are org-scoped, and carry NO prompt text.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const BUILD_DESC = 'construir um CRM secreto para o cliente Petrova';

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_registo_contract');
  await setCredential({ mode: 'oauth', secret: 'tok' });
  __setTransportForTests(makeFakeTransport({ finalText: 'built' }));
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { __resetTransportForTests(); server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await activityLogs.deleteMany({}); await userSettings.deleteMany({});
  for (const [id, role, org] of [['admA', 'org-admin', 'orgA'], ['bldA', 'builder', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
});
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const registo = async (t: string) => readJson(await authed('/api/v1/registo?limit=500', t));

describe('F3 Registo: login + build + session rows, org-scoped, metadata-only', () => {
  it('a login produces an auth.login row visible to the org admin, schema-valid', async () => {
    await tokenFor('bldA'); // the audited login
    const admT = await tokenFor('admA');
    const body = await registo(admT);
    expect(RegistoListResponse.safeParse(body).success, JSON.stringify(RegistoListResponse.safeParse(body))).toBe(true);
    const items = body.items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.actionType === 'auth.login' && r.actor === 'bldA')).toBe(true);
  });

  it('POST /sessions produces a session.create row; POST /jobs produces a build.created row', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/sessions', t, { method: 'POST', body: JSON.stringify({ name: 'Nova sessão' }) });
    await authed('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: BUILD_DESC, sessionId: 'sReg', language: 'pt' }) });
    const admT = await tokenFor('admA');
    const items = (await registo(admT)).items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.actionType === 'session.create')).toBe(true);
    expect(items.some((r) => r.actionType === 'build.created' && r.actor === 'bldA')).toBe(true);
  });

  it('every row validates against RegistoEntry (targetIds is an ARRAY, not the metadata object)', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: BUILD_DESC, sessionId: 'sReg2', language: 'pt' }) });
    const admT = await tokenFor('admA');
    const items = (await registo(admT)).items as Array<Record<string, unknown>>;
    for (const item of items) {
      const p = RegistoEntry.safeParse(item);
      expect(p.success, `row ${String(item.actionType)}: ${JSON.stringify(p.success ? {} : p.error.issues)}`).toBe(true);
    }
    const build = items.find((r) => r.actionType === 'build.created')!;
    expect(Array.isArray(build.targetIds)).toBe(true); // the F3/F22-class wire-shape fix
  });

  it('rows are org-scoped: org B admin sees NONE of org A\'s activity', async () => {
    await tokenFor('bldA'); // org A login
    const admB = await tokenFor('admB');
    const items = (await registo(admB)).items as Array<Record<string, unknown>>;
    expect(items.some((r) => r.actor === 'bldA')).toBe(false);
    expect(items.every((r) => r.orgId === 'orgB')).toBe(true);
  });

  it('rows are METADATA-ONLY: no prompt/description text, no password, ever', async () => {
    const t = await tokenFor('bldA');
    await authed('/api/v1/jobs', t, { method: 'POST', body: JSON.stringify({ kind: 'build', description: BUILD_DESC, sessionId: 'sReg3', language: 'pt' }) });
    const admT = await tokenFor('admA');
    const serialized = JSON.stringify(await registo(admT));
    expect(serialized).not.toContain('Petrova'); // the build description never reaches the audit surface
    expect(serialized).not.toContain('secreto');
    expect(serialized).not.toContain('pw123456'); // the password never reaches the audit surface
  });
});
