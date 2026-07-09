import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, revokedTokens } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  RefreshResponse,
  DeviceStartResponse,
  DevicePollResponse,
  OkResponse,
  ErrorEnvelope,
  AuthUser,
} from '@ekoa/shared';

/**
 * F1 (batch-1 S4): the auth lifecycle endpoints (ch03 §3.8.1/§3.8.2). Every endpoint declared in
 * shared/src/auth.ts + users.resetPassword must be MOUNTED, respond with its named shared schema,
 * and enforce the lifecycle semantics: logout revokes the jti (subsequent /me 401s); password
 * change verifies the current password and clears passwordChangeRequired; the device flow is a
 * mongo-backed pending -> approved/denied/expired machine with single-use approval. Every non-2xx
 * body validates against the shared error envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, role: 'super-admin' | 'org-admin' | 'builder', opts: { orgId?: string; passwordChangeRequired?: boolean } = {}) {
  await users.insert({
    _id: id, username: id, passwordHash: await hashPassword('pw123456'), role,
    orgId: opts.orgId ?? 'orgA', active: true,
    ...(opts.passwordChangeRequired !== undefined ? { passwordChangeRequired: opts.passwordChangeRequired } : {}),
  });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const authed = (p: string, t: string, init: RequestInit = {}) =>
  api(p, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_auth_lifecycle');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  await users.deleteMany({}); await revokedTokens.deleteMany({});
  const db = (await import('../../src/data/mongo.js')).getDb();
  await db.collection('device_auth').deleteMany({});
});

describe('POST /api/v1/auth/refresh', () => {
  it('re-signs the authed claims: 200 RefreshResponse, and the new token works on /me', async () => {
    await mkUser('u1', 'builder');
    const t = await tokenFor('u1');
    const res = await authed('/api/v1/auth/refresh', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(RefreshResponse.safeParse(body).success).toBe(true);
    const me = await authed('/api/v1/auth/me', body.token as string);
    expect(me.status).toBe(200);
    expect(AuthUser.safeParse(await readJson(me)).success).toBe(true);
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/auth/refresh', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the caller token: 200 OkResponse, then GET /me with the SAME token -> 401', async () => {
    await mkUser('u1', 'builder');
    const t = await tokenFor('u1');
    expect((await authed('/api/v1/auth/me', t)).status).toBe(200);
    const res = await authed('/api/v1/auth/logout', t, { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(200);
    expect(OkResponse.safeParse(await readJson(res)).success).toBe(true);
    const me = await authed('/api/v1/auth/me', t);
    expect(me.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(me)).success).toBe(true);
  });

  it('admin variant: super-admin logs out ANOTHER user (their outstanding token dies); a builder may not', async () => {
    await mkUser('root', 'super-admin');
    await mkUser('victim', 'builder');
    await mkUser('bob', 'builder');
    const rootT = await tokenFor('root');
    const victimT = await tokenFor('victim');
    const bobT = await tokenFor('bob');

    // builder cannot log out someone else
    const forbidden = await authed('/api/v1/auth/logout', bobT, { method: 'POST', body: JSON.stringify({ userId: 'victim' }) });
    expect(forbidden.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(forbidden)).success).toBe(true);
    expect((await authed('/api/v1/auth/me', victimT)).status).toBe(200); // untouched

    // super-admin can
    const res = await authed('/api/v1/auth/logout', rootT, { method: 'POST', body: JSON.stringify({ userId: 'victim' }) });
    expect(res.status).toBe(200);
    expect((await authed('/api/v1/auth/me', victimT)).status).toBe(401);
    expect((await authed('/api/v1/auth/me', rootT)).status).toBe(200); // the admin's own token survives
  });

  it('org-admin variant is scoped to its own org: cross-org logout -> 403/404 envelope', async () => {
    await mkUser('orgadminA', 'org-admin', { orgId: 'orgA' });
    await mkUser('outsider', 'builder', { orgId: 'orgB' });
    const aT = await tokenFor('orgadminA');
    const oT = await tokenFor('outsider');
    const res = await authed('/api/v1/auth/logout', aT, { method: 'POST', body: JSON.stringify({ userId: 'outsider' }) });
    expect([403, 404]).toContain(res.status);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect((await authed('/api/v1/auth/me', oT)).status).toBe(200); // untouched
  });
});

describe('POST /api/v1/auth/password (self password change)', () => {
  it('verifies the current password, changes it, clears passwordChangeRequired on re-login', async () => {
    await mkUser('u1', 'builder', { passwordChangeRequired: true });
    const t = await tokenFor('u1');
    const res = await authed('/api/v1/auth/password', t, {
      method: 'POST', body: JSON.stringify({ currentPassword: 'pw123456', newPassword: 'newpw9999' }),
    });
    expect(res.status).toBe(200);
    expect(OkResponse.safeParse(await readJson(res)).success).toBe(true);
    // old password no longer works; new one does and the flag is cleared
    const bad = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'pw123456' }) });
    expect(bad.status).toBe(401);
    const good = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'newpw9999' }) });
    expect(good.status).toBe(200);
    expect(((await readJson(good)) as { passwordChangeRequired?: boolean }).passwordChangeRequired).toBe(false);
  });

  it('a wrong current password -> 401 envelope, nothing changed', async () => {
    await mkUser('u1', 'builder');
    const t = await tokenFor('u1');
    const res = await authed('/api/v1/auth/password', t, {
      method: 'POST', body: JSON.stringify({ currentPassword: 'WRONG', newPassword: 'newpw9999' }),
    });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect((await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'pw123456' }) })).status).toBe(200);
  });

  it('schema-invalid body -> 400 envelope', async () => {
    await mkUser('u1', 'builder');
    const t = await tokenFor('u1');
    const res = await authed('/api/v1/auth/password', t, { method: 'POST', body: JSON.stringify({ newPassword: 'x' }) });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});

describe('device flow: /auth/device -> /auth/device/poll -> /auth/device/approve', () => {
  it('start (public) -> DeviceStartResponse; poll pending; approve by an authed user; poll returns the token ONCE (single-use)', async () => {
    await mkUser('approver', 'builder');
    const start = await api('/api/v1/auth/device', { method: 'POST', body: JSON.stringify({}) });
    expect(start.status).toBe(200);
    const s = await readJson(start);
    expect(DeviceStartResponse.safeParse(s).success).toBe(true);

    // pending before approval
    const p1 = await api('/api/v1/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode: s.deviceCode }) });
    expect(p1.status).toBe(200);
    const p1b = await readJson(p1);
    expect(DevicePollResponse.safeParse(p1b).success).toBe(true);
    expect(['pending', 'slow_down']).toContain(p1b.status as string);

    // approve with the authed user's code
    const t = await tokenFor('approver');
    const ap = await authed('/api/v1/auth/device/approve', t, { method: 'POST', body: JSON.stringify({ userCode: s.userCode }) });
    expect(ap.status).toBe(200);
    expect(OkResponse.safeParse(await readJson(ap)).success).toBe(true);

    // poll -> approved with a working token + AuthUser (single-use: second poll must NOT re-issue)
    const p2 = await api('/api/v1/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode: s.deviceCode }) });
    const p2b = await readJson(p2);
    expect(DevicePollResponse.safeParse(p2b).success).toBe(true);
    expect(p2b.status).toBe('approved');
    expect(AuthUser.safeParse(p2b.user).success).toBe(true);
    const me = await authed('/api/v1/auth/me', p2b.token as string);
    expect(me.status).toBe(200);

    const p3 = await api('/api/v1/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode: s.deviceCode }) });
    const p3b = await readJson(p3);
    expect(DevicePollResponse.safeParse(p3b).success).toBe(true);
    expect(p3b.status).not.toBe('approved'); // consumed — a stolen device code cannot re-mint
  });

  it('deny marks the code denied', async () => {
    await mkUser('approver', 'builder');
    const s = await readJson(await api('/api/v1/auth/device', { method: 'POST', body: JSON.stringify({}) }));
    const t = await tokenFor('approver');
    await authed('/api/v1/auth/device/approve', t, { method: 'POST', body: JSON.stringify({ userCode: s.userCode, deny: true }) });
    const p = await readJson(await api('/api/v1/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode: s.deviceCode }) }));
    expect(DevicePollResponse.safeParse(p).success).toBe(true);
    expect(p.status).toBe('denied');
  });

  it('an unknown deviceCode polls as expired; approve requires auth (401 envelope)', async () => {
    const p = await readJson(await api('/api/v1/auth/device/poll', { method: 'POST', body: JSON.stringify({ deviceCode: 'nope' }) }));
    expect(DevicePollResponse.safeParse(p).success).toBe(true);
    expect(p.status).toBe('expired');
    const ap = await api('/api/v1/auth/device/approve', { method: 'POST', body: JSON.stringify({ userCode: 'XXXX' }) });
    expect(ap.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(ap)).success).toBe(true);
  });
});

describe('POST /api/v1/users/:id/password (super-admin reset)', () => {
  it('super-admin resets a user password and sets passwordChangeRequired', async () => {
    await mkUser('root', 'super-admin');
    await mkUser('u1', 'builder', { passwordChangeRequired: false });
    const rootT = await tokenFor('root');
    const res = await authed('/api/v1/users/u1/password', rootT, { method: 'POST', body: JSON.stringify({ password: 'resetpw99' }) });
    expect(res.status).toBe(200);
    expect(OkResponse.safeParse(await readJson(res)).success).toBe(true);
    const relogin = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'resetpw99' }) });
    expect(relogin.status).toBe(200);
    expect(((await readJson(relogin)) as { passwordChangeRequired?: boolean }).passwordChangeRequired).toBe(true);
  });

  it('non-super-admin -> 403 envelope; nothing changed', async () => {
    await mkUser('orgadmin', 'org-admin');
    await mkUser('u1', 'builder');
    const t = await tokenFor('orgadmin');
    const res = await authed('/api/v1/users/u1/password', t, { method: 'POST', body: JSON.stringify({ password: 'resetpw99' }) });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect((await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u1', password: 'pw123456' }) })).status).toBe(200);
  });
});
