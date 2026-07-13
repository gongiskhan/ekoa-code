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
import { ChangeRequest, ChangeRequestListResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * Operator-run H4 — the request-changes queue, driven through the REAL router (mongo-mem).
 *
 * The security crux is CROSS-ORG ISOLATION: a served-app filing lands in the app OWNER's org
 * queue (never the requester's), an org-admin reads/acts on ONLY its own org, and a plain user
 * cannot read the queue at all. requesterUserId + orgId are always server-stamped, never trusted
 * from the caller body. The refused-build feed files to the requester's OWN org (no served app).
 *
 * Topology: reqU (plain user, orgA) is the filer; appX is an ORG app OWNED by admB in orgB. So a
 * filing about appX must surface to admB (orgB), NOT to admA (orgA) — proving both the owner-org
 * routing and the isolation boundary in one shape.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const fileWithApp = (t: string, appId: string, body: Record<string, unknown>) =>
  authed('/api/v1/change-requests', t, { method: 'POST', headers: { 'x-ekoa-app-id': appId }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_change_requests');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await changeRequests.deleteMany({}); await artifacts.deleteMany({}); await userSettings.deleteMany({});
  for (const [id, role, org] of [['reqU', 'user', 'orgA'], ['admA', 'org-admin', 'orgA'], ['admB', 'org-admin', 'orgB']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: org, active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
  // An ORG app owned by admB in orgB (org-shared so an org-admin can loadWritable it later).
  await artifacts.insert({ _id: 'appX', name: 'App X', slug: 'app-x', userId: 'admB', orgId: 'orgB', visibility: 'org', status: 'active', data: { projectDir: '/sbx/user-admB/appX' } } as never);
});

describe('H4 change-requests: file (served-app) lands in the OWNER org queue', () => {
  it('a plain user files via X-Ekoa-App-Id -> the request lands in the app owner org, server-stamped', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um botão de exportação na tabela', route: '/faturas' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ChangeRequest.safeParse(body).success, JSON.stringify(ChangeRequest.safeParse(body))).toBe(true);
    expect(body.orgId).toBe('orgB');           // the OWNER org, NOT the requester's orgA
    expect(body.requesterUserId).toBe('reqU'); // from the verified JWT, never the body
    expect(body.requesterName).toBe('reqU');
    expect(body.appId).toBe('appX');
    expect(body.status).toBe('open');
    expect(body.route).toBe('/faturas');
  });

  it('an unknown app id is a 404 (shared error envelope), never a silent misfile', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'no-such-app', { text: 'Olá' });
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('H4 change-requests: the org-admin queue read is org-scoped (cross-org isolation)', () => {
  it('an org-admin sees its OWN org only; another org-admin never sees it', async () => {
    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido 1' }); // -> orgB

    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
    expect(ChangeRequestListResponse.safeParse(admBList).success).toBe(true);
    const bItems = admBList.items as Array<Record<string, unknown>>;
    expect(bItems.length).toBe(1);
    expect(bItems.every((r) => r.orgId === 'orgB')).toBe(true);

    // admA is in orgA — the crux: it MUST NOT see orgB's request.
    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
    const aItems = admAList.items as Array<Record<string, unknown>>;
    expect(admAList.total).toBe(0);
    expect(aItems.some((r) => r.requesterUserId === 'reqU')).toBe(false);
    expect(aItems.every((r) => r.orgId === 'orgA')).toBe(true);
  });

  it('a plain user cannot read the queue -> 403 FORBIDDEN (shared envelope)', async () => {
    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'));
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('FORBIDDEN');
  });

  it('a super-admin can narrow across orgs with ?orgId=', async () => {
    await users.insert({ _id: 'root', username: 'root', passwordHash: await hashPassword('pw123456'), role: 'super-admin', orgId: 'orgRoot', active: true });
    setActivation('root', { active: true, billingLocked: false });
    await userSettings.put({ _id: 'root', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
    await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido super' }); // -> orgB

    const all = await readJson(await authed('/api/v1/change-requests', await tokenFor('root')));
    expect((all.items as unknown[]).length).toBe(1);
    const scoped = await readJson(await authed('/api/v1/change-requests?orgId=orgA', await tokenFor('root')));
    expect((scoped.items as unknown[]).length).toBe(0); // no orgA requests exist
  });
});

describe('H4 change-requests: convert / dismiss are org-scoped', () => {
  it('convert flips status to converted + links the jobId; a cross-org convert is a uniform 404', async () => {
    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'Adicione um campo de data' }));
    const id = filed.id as string;

    // admA (orgA) must NOT be able to convert orgB's request — uniform 404, no cross-org oracle.
    const cross = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admA'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
    expect(cross.status).toBe(404);
    expect((await readJson(cross)).error).toBeTruthy();

    // admB (owner org) converts, linking the follow-up-build job the dashboard already started.
    const conv = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admB'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
    expect(conv.status).toBe(200);
    const cbody = await readJson(conv);
    expect(ChangeRequest.safeParse(cbody).success).toBe(true);
    expect(cbody.status).toBe('converted');
    expect(cbody.jobId).toBe('job-xyz');
  });

  it('dismiss flips status to dismissed (own org)', async () => {
    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appX', { text: 'pedido a dispensar' }));
    const id = filed.id as string;
    const res = await authed(`/api/v1/change-requests/${id}/dismiss`, await tokenFor('admB'), { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await readJson(res)).status).toBe('dismissed');
  });
});

describe('H4 change-requests: the refused-build feed files to the requester OWN org', () => {
  it('filing WITHOUT the served-app header lands in the requester own org (never a dead end)', async () => {
    // No X-Ekoa-App-Id header: the dashboard refused-build path. orgId is the requester's OWN org
    // (orgA), the body appId is kept only as an informational label.
    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'), { method: 'POST', body: JSON.stringify({ text: 'Não consegui construir; peço ao administrador.', appId: 'appX' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ChangeRequest.safeParse(body).success).toBe(true);
    expect(body.orgId).toBe('orgA');           // the REQUESTER's own org
    expect(body.requesterUserId).toBe('reqU');
    expect(body.appId).toBe('appX');           // informational label; convert re-gates via H1

    // It surfaces to admA (orgA), and NOT to admB (orgB) — isolation holds on this path too.
    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
    expect((admAList.items as Array<Record<string, unknown>>).some((r) => r.requesterUserId === 'reqU')).toBe(true);
    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
    expect((admBList.items as Array<Record<string, unknown>>).some((r) => r.text === 'Não consegui construir; peço ao administrador.')).toBe(false);
  });
});
