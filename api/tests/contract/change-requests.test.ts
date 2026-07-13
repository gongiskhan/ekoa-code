import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, changeRequests, artifacts } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  ChangeRequest,
  ChangeRequestFileRequest,
  ChangeRequestConvertRequest,
  ChangeRequestListResponse,
  changeRequestsEndpoints,
} from '@ekoa/shared';

/**
 * H4 change-requests CONTRACT test: the wire SHAPES + descriptor declarations, and that the real
 * file/list/convert responses validate against the shared schemas (a new endpoint => a new
 * contract test, same slice). Behaviour/isolation lives in tests/routes/change-requests.test.ts.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
  for (const [id, role, org] of [['usr', 'user', 'orgA'], ['adm', 'org-admin', 'orgA']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
  await artifacts.insert({ _id: 'appA', name: 'App A', userId: 'adm', orgId: 'orgA', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-adm/appA' } } as never);
});

describe('H4 change-requests contract: schema shapes', () => {
  it('ChangeRequest parses a full doc AND a minimal doc; rejects extra keys and a bad status', () => {
    const full = { id: 'c1', appId: 'appA', orgId: 'orgA', requesterUserId: 'usr', requesterName: 'usr', route: '/x', screenState: 's', text: 't', status: 'converted', createdAt: '2026-07-13T00:00:00.000Z', jobId: 'j1' };
    expect(ChangeRequest.safeParse(full).success).toBe(true);
    const minimal = { id: 'c2', orgId: 'orgA', requesterUserId: 'usr', requesterName: 'usr', text: 't', status: 'open', createdAt: '2026-07-13T00:00:00.000Z' };
    expect(ChangeRequest.safeParse(minimal).success).toBe(true);
    expect(ChangeRequest.safeParse({ ...minimal, bogus: 1 }).success).toBe(false); // .strict()
    expect(ChangeRequest.safeParse({ ...minimal, status: 'weird' }).success).toBe(false);
  });

  it('the file body requires non-empty bounded text; convert requires a jobId', () => {
    expect(ChangeRequestFileRequest.safeParse({ text: 'olá', route: '/x' }).success).toBe(true);
    expect(ChangeRequestFileRequest.safeParse({ text: '' }).success).toBe(false);
    expect(ChangeRequestFileRequest.safeParse({ text: 'x'.repeat(4001) }).success).toBe(false);
    expect(ChangeRequestConvertRequest.safeParse({ jobId: 'j' }).success).toBe(true);
    expect(ChangeRequestConvertRequest.safeParse({}).success).toBe(false);
  });

  it('the descriptors declare the right auth classes (file user; queue org-admin)', () => {
    expect(changeRequestsEndpoints.file.auth).toBe('user');
    expect(changeRequestsEndpoints.file.path).toBe('/api/v1/change-requests');
    expect(changeRequestsEndpoints.list.auth).toBe('org-admin');
    expect(changeRequestsEndpoints.convert.auth).toBe('org-admin');
    expect(changeRequestsEndpoints.dismiss.auth).toBe('org-admin');
  });
});

describe('H4 change-requests contract: live responses validate against the shared schemas', () => {
  it('file -> ChangeRequest; list -> ChangeRequestListResponse; convert -> ChangeRequest', async () => {
    const filed = await readJson(
      await authed('/api/v1/change-requests', await tokenFor('usr'), { method: 'POST', headers: { 'x-ekoa-app-id': 'appA' }, body: JSON.stringify({ text: 'Mude o título', route: '/inicio' }) }),
    );
    expect(ChangeRequest.safeParse(filed).success, JSON.stringify(ChangeRequest.safeParse(filed))).toBe(true);

    const list = await readJson(await authed('/api/v1/change-requests', await tokenFor('adm')));
    expect(ChangeRequestListResponse.safeParse(list).success, JSON.stringify(ChangeRequestListResponse.safeParse(list))).toBe(true);

    const conv = await readJson(
      await authed(`/api/v1/change-requests/${filed.id as string}/convert`, await tokenFor('adm'), { method: 'POST', body: JSON.stringify({ jobId: 'job-1' }) }),
    );
    expect(ChangeRequest.safeParse(conv).success).toBe(true);
    expect(conv.status).toBe('converted');
  });
});
