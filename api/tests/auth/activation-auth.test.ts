import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs } from '../../src/data/stores.js';
import { loadActivation, setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { loadRevocations, __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login, setUserActive, seedAdmin } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

/**
 * G2 admission gates: activation write-through (ch09 §9.7.1), token revocation (P-03),
 * auth contract (ch03 §3.8.1), boot fail-closed (ch09 §9.7).
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 'test-secret', encryptionKey: 'test-key', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };
let server: Server | undefined;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-key';
  process.env.JWT_SECRET = 'test-secret';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_auth_test');
}, 60_000);

afterAll(async () => {
  server?.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  await users.deleteMany({});
  await orgs.deleteMany({});
});

async function makeUser(id: string, username: string, password: string, active = true) {
  await users.insert({ _id: id, username, passwordHash: await hashPassword(password), role: 'builder', orgId: 'org-1', active });
  setActivation(id, { active, billingLocked: false });
}

describe('activation write-through (ch09 §9.7.1)', () => {
  it('deactivation is immediate on the auth plane (no TTL wait) and revokes tokens', async () => {
    await makeUser('u1', 'ana', 'pw123456');
    const { token } = await login('ana', 'pw123456', false, deps);
    const app = buildApp(cfg, deps);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const port = (server!.address() as { port: number }).port;

    // authed request works while active
    let res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);

    // deactivate through the write-through service (no TTL wait)
    await setUserActive('u1', false, [], deps);
    res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('ACCOUNT_DISABLED');
    server!.close(); server = undefined;
  });

  it('a deactivated user cannot log in (ACCOUNT_DISABLED)', async () => {
    await makeUser('u2', 'bob', 'pw123456', false);
    await expect(login('bob', 'pw123456', false, deps)).rejects.toMatchObject({ code: 'ACCOUNT_DISABLED', status: 403 });
  });

  it('billing-locked account is refused with BILLING_LOCKED (402)', async () => {
    await makeUser('u3', 'cid', 'pw123456');
    setActivation('u3', { active: true, billingLocked: true });
    const { token } = await login('cid', 'pw123456', false, deps);
    const app = buildApp(cfg, deps);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const port = (server!.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('BILLING_LOCKED');
    server!.close(); server = undefined;
  });
});

describe('token security (P-03, ch09 §9.6) — Codex-review regressions', () => {
  it('a token whose subject is not in the activation map is refused (fail-closed)', async () => {
    await makeUser('u6', 'frank', 'pw123456');
    const { token } = await login('frank', 'pw123456', false, deps);
    __resetActivationForTests(); // simulate a cache that lost the entry
    const app = buildApp(cfg, deps);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const port = (server!.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401); // NOT fail-open to 200; UNAUTHENTICATED, not ACCOUNT_DISABLED (§3.3)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');
    server!.close(); server = undefined;
  });

  it('a hand-forged token without a jti is refused (revocation-bypass guard)', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const noJti = jwt.sign({ sub: 'u7', role: 'builder', scope: 'user', orgId: 'org-1', username: 'gwen' }, cfg.jwtSecret, { expiresIn: 3600 });
    setActivation('u7', { active: true, billingLocked: false });
    const app = buildApp(cfg, deps);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const port = (server!.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`, { headers: { authorization: `Bearer ${noJti}` } });
    expect(res.status).toBe(401);
    server!.close(); server = undefined;
  });
});

describe('auth contract (ch03 §3.8.1)', () => {
  it('login returns a token + user; bad creds → 401', async () => {
    await makeUser('u4', 'dee', 'pw123456');
    const app = buildApp(cfg, deps);
    await new Promise<void>((r) => { server = app.listen(0, () => r()); });
    const port = (server!.address() as { port: number }).port;
    let res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'dee', password: 'pw123456' }),
    });
    expect(res.status).toBe(200);
    const ok = (await res.json()) as { token: string; user: { username: string } };
    expect(ok.token).toBeTruthy();
    expect(ok.user.username).toBe('dee');

    res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'dee', password: 'wrong' }),
    });
    expect(res.status).toBe(401);

    // an unauthenticated /me is rejected
    res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/me`);
    expect(res.status).toBe(401);
    server!.close(); server = undefined;
  });
});

describe('admin seeding (ch04 §4.8 item 12)', () => {
  it('seeds exactly one super-admin + org, idempotently', async () => {
    await seedAdmin('founder', 'pw12345678', deps);
    await seedAdmin('founder', 'pw12345678', deps); // idempotent
    const admins = await users.find({ role: 'super-admin' });
    expect(admins).toHaveLength(1);
    expect((await orgs.find({})).length).toBeGreaterThanOrEqual(1);
  });
});

describe('boot fail-closed (ch09 §9.7)', () => {
  it('config refuses without ENCRYPTION_KEY', () => {
    process.env.JWT_SECRET = 'x';
    delete process.env.ENCRYPTION_KEY;
    __resetConfigForTests();
    expect(() => loadConfig()).toThrow(/ENCRYPTION_KEY/);
    // restore for other suites
    process.env.ENCRYPTION_KEY = 'test-key';
    __resetConfigForTests();
    loadConfig();
  });

  it('loadActivation + loadRevocations run without error at boot', async () => {
    await makeUser('u5', 'evan', 'pw123456');
    loadActivation([{ userId: 'u5', active: true }]);
    await loadRevocations(Math.floor(Date.now() / 1000));
    expect(true).toBe(true);
  });
});
