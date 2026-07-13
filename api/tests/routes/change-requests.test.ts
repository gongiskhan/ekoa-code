import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sseManager } from '../../src/events/sse-manager.js';
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
 * The security crux is CROSS-ORG ISOLATION on BOTH directions:
 *  - WRITE (codex HIGH - queue injection): filing about a served app requires the REQUESTER to be
 *    able to READ that app (own, or org-shared WITHIN THEIR org). A user cannot inject a request
 *    into another org's queue by naming that org's app id/slug - loadReadable rejects it as a
 *    uniform 404. Because a readable app is always in the requester's org, the request always lands
 *    in the requester's OWN org.
 *  - READ: an org-admin reads/acts on ONLY its own org; a plain user cannot read the queue at all.
 * requesterUserId + orgId are always server-stamped, never trusted from the caller body.
 *
 * Topology (all filers are `reqU`, a plain user in orgA):
 *   appA     - orgA, OWNED by admA, visibility 'org'    -> reqU CAN read (org-shared, same org)
 *   appOwn   - orgA, OWNED by reqU, visibility 'private' -> reqU CAN read (own)
 *   appApriv - orgA, OWNED by admA, visibility 'private' -> reqU CANNOT read (another user's private)
 *   appB     - orgB, OWNED by admB, visibility 'org'     -> reqU CANNOT read (cross-org)
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
const queueOf = async (u: string) => (await readJson(await authed('/api/v1/change-requests', await tokenFor(u)))).items as Array<Record<string, unknown>>;

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
  const seedApp = (id: string, userId: string, orgId: string, visibility: 'org' | 'private') =>
    artifacts.insert({ _id: id, name: id, slug: id, userId, orgId, visibility, status: 'active', data: { projectDir: `/sbx/user-${userId}/${id}` } } as never);
  await seedApp('appA', 'admA', 'orgA', 'org');        // reqU can read (org-shared, same org)
  await seedApp('appOwn', 'reqU', 'orgA', 'private');   // reqU can read (own)
  await seedApp('appApriv', 'admA', 'orgA', 'private'); // reqU cannot read (another user's private)
  await seedApp('appB', 'admB', 'orgB', 'org');         // reqU cannot read (cross-org)
});

describe('H4 change-requests: filing requires the requester can READ the app; lands in own org', () => {
  it('a user files about an org-shared app in their org -> 200, stamped to their org', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'Adicione um botão de exportação', route: '/faturas' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ChangeRequest.safeParse(body).success, JSON.stringify(ChangeRequest.safeParse(body))).toBe(true);
    expect(body.orgId).toBe('orgA');           // the requester's own org (== the app owner org)
    expect(body.requesterUserId).toBe('reqU'); // from the verified JWT, never the body
    expect(body.requesterName).toBe('reqU');
    expect(body.appId).toBe('appA');
    expect(body.status).toBe('open');
    expect(body.route).toBe('/faturas');
  });

  it('a user files about their OWN (private) app -> 200', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'appOwn', { text: 'Mude a cor do cabeçalho' });
    expect(res.status).toBe(200);
    expect((await readJson(res)).orgId).toBe('orgA');
  });

  it('CROSS-ORG INJECTION is blocked: filing about another org app -> 404, NO row, NO notification', async () => {
    // Spy on the ACTUAL notification sink (codex-h4 re-review: assert NO emit directly, not only
    // inferred from an empty queue). A successful file fires sseManager.emit('notifications', ...)
    // via emitChangeRequest; a blocked cross-org file must fire NOTHING on that channel.
    const emitSpy = vi.spyOn(sseManager, 'emit');
    try {
      const res = await fileWithApp(await tokenFor('reqU'), 'appB', { text: 'inject into org B' });
      expect(res.status).toBe(404);
      expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
      // No row landed in org B's queue AND no notification was fired to org B's admins.
      expect((await queueOf('admB')).length).toBe(0);
      expect(await changeRequests.find({})).toHaveLength(0);
      const notifs = emitSpy.mock.calls.filter((c) => c[0] === 'notifications');
      expect(notifs, `a blocked cross-org file must fire no notification, saw ${JSON.stringify(notifs)}`).toHaveLength(0);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('filing about another user PRIVATE app the requester cannot read -> 404 (uniform, no oracle)', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'appApriv', { text: 'peek' });
    expect(res.status).toBe(404);
    expect(await changeRequests.find({})).toHaveLength(0);
  });

  it('an unknown app id is a 404 (shared error envelope), never a silent misfile', async () => {
    const res = await fileWithApp(await tokenFor('reqU'), 'no-such-app', { text: 'Olá' });
    expect(res.status).toBe(404);
    expect(((await readJson(res)).error as { code: string }).code).toBe('NOT_FOUND');
  });
});

describe('H4 change-requests: the org-admin queue read is org-scoped (cross-org isolation)', () => {
  it('an org-admin sees its OWN org only; another org-admin never sees it', async () => {
    await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'pedido 1' }); // -> orgA

    const admAList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admA')));
    expect(ChangeRequestListResponse.safeParse(admAList).success).toBe(true);
    const aItems = admAList.items as Array<Record<string, unknown>>;
    expect(aItems.length).toBe(1);
    expect(aItems.every((r) => r.orgId === 'orgA')).toBe(true);

    // admB is in orgB — the crux: it MUST NOT see orgA's request.
    const admBList = await readJson(await authed('/api/v1/change-requests', await tokenFor('admB')));
    expect(admBList.total).toBe(0);
    expect((admBList.items as Array<Record<string, unknown>>).some((r) => r.requesterUserId === 'reqU')).toBe(false);
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
    await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'pedido super' }); // -> orgA

    const all = await readJson(await authed('/api/v1/change-requests', await tokenFor('root')));
    expect((all.items as unknown[]).length).toBe(1);
    const scoped = await readJson(await authed('/api/v1/change-requests?orgId=orgB', await tokenFor('root')));
    expect((scoped.items as unknown[]).length).toBe(0); // no orgB requests exist
  });
});

describe('H4 change-requests: convert / dismiss are org-scoped', () => {
  it('convert flips status to converted + links the jobId; a cross-org convert is a uniform 404', async () => {
    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'Adicione um campo de data' })); // -> orgA
    const id = filed.id as string;

    // admB (orgB) must NOT be able to convert orgA's request — uniform 404, no cross-org oracle.
    const cross = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admB'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
    expect(cross.status).toBe(404);
    expect((await readJson(cross)).error).toBeTruthy();

    // admA (own org) converts, linking the follow-up-build job the dashboard already started.
    const conv = await authed(`/api/v1/change-requests/${id}/convert`, await tokenFor('admA'), { method: 'POST', body: JSON.stringify({ jobId: 'job-xyz' }) });
    expect(conv.status).toBe(200);
    const cbody = await readJson(conv);
    expect(ChangeRequest.safeParse(cbody).success).toBe(true);
    expect(cbody.status).toBe('converted');
    expect(cbody.jobId).toBe('job-xyz');
  });

  it('dismiss flips status to dismissed (own org)', async () => {
    const filed = await readJson(await fileWithApp(await tokenFor('reqU'), 'appA', { text: 'pedido a dispensar' })); // -> orgA
    const id = filed.id as string;
    const res = await authed(`/api/v1/change-requests/${id}/dismiss`, await tokenFor('admA'), { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await readJson(res)).status).toBe('dismissed');
  });
});

describe('H4 change-requests: the refused-build feed files to the requester OWN org', () => {
  it('filing WITHOUT the served-app header lands in the requester own org (never a dead end)', async () => {
    // No X-Ekoa-App-Id header: the dashboard refused-build path. orgId is the requester's OWN org
    // (orgA), the body appId is kept only as an informational label (no loadReadable gate applies -
    // there is no served app to read; the request is confined to the requester's own org anyway).
    const res = await authed('/api/v1/change-requests', await tokenFor('reqU'), { method: 'POST', body: JSON.stringify({ text: 'Não consegui construir; peço ao administrador.', appId: 'appB' }) });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(ChangeRequest.safeParse(body).success).toBe(true);
    expect(body.orgId).toBe('orgA');           // the REQUESTER's own org, NOT appB's orgB
    expect(body.requesterUserId).toBe('reqU');

    // It surfaces to admA (orgA), and NOT to admB (orgB) — isolation holds on this path too.
    expect((await queueOf('admA')).some((r) => r.requesterUserId === 'reqU')).toBe(true);
    expect((await queueOf('admB')).some((r) => r.text === 'Não consegui construir; peço ao administrador.')).toBe(false);
  });
});
