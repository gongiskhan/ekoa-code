import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  CofreItem,
  CofreItemListResponse,
  CofreGrantResponse,
  CofreLockResponse,
  CofreDeleteResponse,
  CofreSessionEstablishResponse,
  cofreEndpoints,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * Cofre CONTRACT test (WS-B B-3): every wire shape validates against the shared schemas through
 * the REAL app, the VALUE is write-only across the whole surface, and the two encoded invariants
 * (I7's no-TTL-on-a-signature-identity, I6's mandatory origin binding) surface as proper 4xx
 * envelopes rather than 500s.
 */
let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const SECRET = 'sk-live-CONTRACT-COFRE-0001';

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
  });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_cofre_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  await users.deleteMany({});
  await userSettings.deleteMany({});
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  for (const id of ['usr', 'usr2']) {
    await users.insert({
      _id: id,
      username: id,
      passwordHash: await hashPassword('pw123456'),
      role: 'user',
      orgId: 'orgA',
      active: true,
    });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
});

const createItem = (t: string, over: Record<string, unknown> = {}) =>
  authed('/api/v1/cofre/items', t, {
    method: 'POST',
    body: JSON.stringify({
      type: 'password',
      label: 'Citius',
      value: SECRET,
      boundOrigins: ['citius.tribunaisnet.mj.pt'],
      ...over,
    }),
  });

describe('cofre contract', () => {
  it('descriptors: self-service auth class on every op', () => {
    for (const d of Object.values(cofreEndpoints)) expect(d.auth).toBe('user');
    expect(cofreEndpoints.cofreItemsList.path).toBe('/api/v1/cofre/items');
    expect(cofreEndpoints.cofreLockAll.path).toBe('/api/v1/cofre/lock-all');
  });

  it('create -> the item VIEW (no value anywhere); list -> CofreItemListResponse', async () => {
    const t = await tokenFor('usr');
    const res = await createItem(t);
    expect(res.status).toBe(201);
    const created: unknown = await res.json();
    expect(CofreItem.safeParse(created), JSON.stringify(created)).toMatchObject({ success: true });
    // The whole point: the value is write-only. It goes in and is returned by nothing.
    expect(JSON.stringify(created)).not.toContain(SECRET);

    const listRes = await authed('/api/v1/cofre/items', t);
    expect(listRes.status).toBe(200);
    const list: unknown = await listRes.json();
    expect(CofreItemListResponse.safeParse(list), JSON.stringify(list)).toMatchObject({ success: true });
    expect(JSON.stringify(list)).not.toContain(SECRET);
    expect((list as { items: Array<{ state: string }> }).items[0]!.state).toBe('locked');
  });

  it('grant -> CofreGrantResponse and the item reads unlocked', async () => {
    const t = await tokenFor('usr');
    const id = ((await (await createItem(t)).json()) as { id: string }).id;
    const g = await authed(`/api/v1/cofre/items/${id}/grants`, t, {
      method: 'POST',
      body: JSON.stringify({ duration: '10_minutes' }),
    });
    expect(g.status).toBe(200);
    const body: unknown = await g.json();
    expect(CofreGrantResponse.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });

    const list = (await (await authed('/api/v1/cofre/items', t)).json()) as { items: Array<{ state: string }> };
    expect(list.items[0]!.state).toBe('unlocked');
  });

  it('lock -> CofreLockResponse and the item reads locked again', async () => {
    const t = await tokenFor('usr');
    const id = ((await (await createItem(t)).json()) as { id: string }).id;
    await authed(`/api/v1/cofre/items/${id}/grants`, t, { method: 'POST', body: JSON.stringify({ duration: 'until_locked' }) });
    const lock = await authed(`/api/v1/cofre/items/${id}/lock`, t, { method: 'POST' });
    expect(lock.status).toBe(200);
    expect(CofreLockResponse.safeParse(await lock.json()).success).toBe(true);
    const list = (await (await authed('/api/v1/cofre/items', t)).json()) as { items: Array<{ state: string }> };
    expect(list.items[0]!.state).toBe('locked');
  });

  it('lock-all -> CofreLockResponse', async () => {
    const t = await tokenFor('usr');
    const id = ((await (await createItem(t)).json()) as { id: string }).id;
    await authed(`/api/v1/cofre/items/${id}/grants`, t, { method: 'POST', body: JSON.stringify({ duration: 'until_locked' }) });
    const res = await authed('/api/v1/cofre/lock-all', t, { method: 'POST' });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(CofreLockResponse.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
    expect((body as { revoked: number }).revoked).toBe(1);
  });

  it('delete -> CofreDeleteResponse; a foreign item is a uniform 404, not a 403', async () => {
    const t = await tokenFor('usr');
    const other = await tokenFor('usr2');
    const id = ((await (await createItem(t)).json()) as { id: string }).id;

    const foreign = await authed(`/api/v1/cofre/items/${id}`, other, { method: 'DELETE' });
    expect(foreign.status).toBe(404); // a 403 would confirm the item exists
    expect(ErrorEnvelope.safeParse(await foreign.json()).success).toBe(true);

    const mine = await authed(`/api/v1/cofre/items/${id}`, t, { method: 'DELETE' });
    expect(mine.status).toBe(200);
    expect(CofreDeleteResponse.safeParse(await mine.json()).success).toBe(true);
  });

  it('I6: an origin-bound type with NO bound origin is a 4xx envelope, not a 500', async () => {
    const t = await tokenFor('usr');
    const res = await createItem(t, { boundOrigins: [] });
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(ErrorEnvelope.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
    expect(JSON.stringify(body)).toMatch(/bound origin/);
  });

  it('I7: a TTL grant on a certificate identity is REFUSED with an envelope, never downgraded', async () => {
    const t = await tokenFor('usr');
    const created = await createItem(t, {
      type: 'certificate_identity',
      label: 'Cartão OA',
      value: 'pointer-only',
      boundOrigins: [],
      identityPointer: 'cartão OA no computador do escritório',
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const g = await authed(`/api/v1/cofre/items/${id}/grants`, t, {
      method: 'POST',
      body: JSON.stringify({ duration: '1_day' }),
    });
    expect(g.status).toBe(400);
    const body: unknown = await g.json();
    expect(ErrorEnvelope.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
    expect(JSON.stringify(body)).toMatch(/I7/);
  });

  it('a grant on a foreign item is a uniform 404', async () => {
    const t = await tokenFor('usr');
    const other = await tokenFor('usr2');
    const id = ((await (await createItem(t)).json()) as { id: string }).id;
    const g = await authed(`/api/v1/cofre/items/${id}/grants`, other, {
      method: 'POST',
      body: JSON.stringify({ duration: '10_minutes' }),
    });
    expect(g.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await g.json()).success).toBe(true);
  });

  /**
   * The ad-hoc ceremony's entry point (D-ADHOC-1). NO MACHINE IS CONNECTED in this suite, which is
   * the case worth having in a contract test: the endpoint answers `started: false` WITH A MESSAGE
   * and a 200, because "nobody is at a machine right now" is a refusal the user can act on rather
   * than an error. A 4xx here would put a red banner in front of someone whose only problem is that
   * their laptop is closed.
   */
  it('session establish -> CofreSessionEstablishResponse, and refuses in-band with no machine', async () => {
    const t = await tokenFor('usr');
    const res = await authed('/api/v1/cofre/sessions/establish', t, {
      method: 'POST',
      body: JSON.stringify({ origin: 'orders.adhoc.example' }),
    });
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(CofreSessionEstablishResponse.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
    expect((body as { started: boolean }).started).toBe(false);
    expect((body as { message: string }).message.length).toBeGreaterThan(0);
  });

  /**
   * The value becomes the address a headed browser opens on the caller's own machine, so the
   * contract has to be "a hostname" and not "a string". A URL would carry a path and a query, and a
   * login link's query routinely carries a token; the daemon prepends `https://` to whatever it is
   * handed, so anything richer than a host is refused at the boundary rather than normalised.
   */
  it('session establish: anything that is not a bare hostname is a 4xx envelope, never a ceremony', async () => {
    const t = await tokenFor('usr');
    for (const origin of ['', 'https://orders.example/login?token=abc', 'orders.example/login', 'orders.example:8443', 'localhost']) {
      const res = await authed('/api/v1/cofre/sessions/establish', t, {
        method: 'POST',
        body: JSON.stringify({ origin }),
      });
      expect(res.status, origin).toBeGreaterThanOrEqual(400);
      expect(ErrorEnvelope.safeParse(await res.json()).success, origin).toBe(true);
    }
  });

  it('every endpoint requires auth', async () => {
    for (const [p, method] of [
      ['/api/v1/cofre/items', 'GET'],
      ['/api/v1/cofre/items', 'POST'],
      ['/api/v1/cofre/lock-all', 'POST'],
      ['/api/v1/cofre/sessions/establish', 'POST'],
    ] as const) {
      const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(res.status, `${method} ${p}`).toBe(401);
    }
  });
});
