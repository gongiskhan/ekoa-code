import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, gatewayKeys, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { __resetGatewayKeysServiceForTests } from '../../src/auth/gateway-keys-service.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { cofreEndpoints, type AuthClass } from '@ekoa/shared';

/**
 * SECURITY SUITE — the Cofre is NOT on the capability surface.
 *
 * The credential store is reachable only by a human in a platform session. A gateway key
 * (`ekoa_gk_…`) is a capability credential handed to an outside client, and the whole point of
 * the Cofre's two-plane model is that such a client operates on REFERENCES while Cortex resolves
 * values — so a key that could list, create, grant or unlock a Cofre item would collapse the two
 * planes into one and hand the value plane to the consumer.
 *
 * Nothing enforced that. `docs/openapi/cortex.v1.json` is generated from the descriptors whose
 * AuthClass is `user-or-key`, so today the Cofre is absent from it as a CONSEQUENCE of every
 * cofre descriptor being `auth: 'user'` — a property no test held in place. Flipping one of them
 * to `user-or-key` (a one-word edit, and a plausible one when a consumer asks to "just read its
 * own credential") would publish the store to every key holder and pass every existing gate: the
 * OpenAPI drift test would simply regenerate a document that now contains it.
 *
 * Two assertions, deliberately at different altitudes:
 *   1. STRUCTURAL — no cofre descriptor may declare `user-or-key`. This is the one that fails on
 *      the one-word edit, at the contract, before any route exists.
 *   2. BEHAVIOURAL — a REAL minted key is refused by every mounted cofre route, with the same
 *      envelope an anonymous caller gets, and the same routes answer the owner's JWT. Without the
 *      second half the first is satisfied by a Cofre that is simply broken.
 */

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = {
  port: 0,
  jwtSecret: 's',
  encryptionKey: 'k',
  nodeEnv: 'test',
  llmChokepointBaseUrl: 'x',
  llm: defaultLlmConfig(),
};

const call = (p: string, method: string, token?: string) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    // Every cofre POST takes a body; an empty object is enough to get past body parsing and
    // reach the auth decision, which is the only thing under test here.
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_cofre_not_key_reachable');
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
  __resetCapabilityRateForTests();
  __resetGatewayKeysServiceForTests();
  await users.deleteMany({});
  await gatewayKeys.deleteMany({});
  await activityLogs.deleteMany({});
  await users.insert({
    _id: 'usrA',
    username: 'usrA',
    passwordHash: await hashPassword('pw123456'),
    role: 'user',
    orgId: 'orgA',
    active: true,
  } as never);
  setActivation('usrA', { active: true, billingLocked: false });
});

/** Every cofre route, as the CONTRACT declares it, with `:params` filled in. */
const cofreRoutes = Object.values(cofreEndpoints).map((e) => ({
  method: e.method,
  path: e.path.replace(/:[A-Za-z]+/g, 'some-item-id'),
  auth: e.auth,
}));

describe('the Cofre is not reachable with a capability key', () => {
  it('STRUCTURAL: no cofre endpoint declares the key-bearing AuthClass', () => {
    // `cofreEndpoints` is `as const`, so TS narrows every `auth` to the literal `'user'` and
    // flags a comparison against `'user-or-key'` as provably false (TS2367). That is the type
    // system agreeing with the assertion, not a reason to delete it: the check has to survive
    // the edit that makes it false, and after that edit the narrowed type is `'user-or-key'`
    // and the comparison is meaningful again. Widening to the declared union at the read is
    // what lets both states compile.
    const authOf = (e: { auth: AuthClass }): AuthClass => e.auth;
    const published = Object.entries(cofreEndpoints)
      .filter(([, e]) => authOf(e) === 'user-or-key')
      .map(([name]) => name);
    expect(
      published,
      'a cofre endpoint declaring `user-or-key` publishes the credential store to every gateway ' +
        'key and lands it in the generated OpenAPI document — the two-plane model does not ' +
        'survive that, so this is a contract decision, not a routing detail',
    ).toEqual([]);

    // Non-tautology: the same predicate DOES fire on the class it is looking for.
    const planted: Array<{ auth: AuthClass }> = [{ auth: 'user-or-key' }, { auth: 'user' }];
    expect(planted.filter((e) => authOf(e) === 'user-or-key')).toHaveLength(1);
    // And the map under test is not empty (a renamed export would otherwise pass vacuously).
    expect(cofreRoutes.length).toBeGreaterThanOrEqual(6);
  });

  it('BEHAVIOURAL: a real minted key is refused by every cofre route, exactly as an anonymous caller is', async () => {
    const { token } = await login('usrA', 'pw123456', false, deps);
    const minted = await fetch(`http://127.0.0.1:${port}/api/v1/gateway-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ label: 'cofre-probe' }),
    });
    expect(minted.status).toBe(201);
    const { key } = (await minted.json()) as { key: string };
    expect(key.startsWith('ekoa_gk_')).toBe(true);

    for (const route of cofreRoutes) {
      const withKey = await call(route.path, route.method, key);
      const anonymous = await call(route.path, route.method);

      expect(withKey.status, `${route.method} ${route.path} admitted a gateway key`).toBe(401);
      // Byte-identical to the anonymous refusal: a key holder learns nothing from probing,
      // not even that the route is one a session could have used.
      expect(await withKey.text(), `${route.method} ${route.path} answers a key differently than an anonymous caller`)
        .toBe(await anonymous.text());
    }
  });

  it('the same routes DO answer the owner\'s session — the refusal above is the key, not a dead mount', async () => {
    const { token } = await login('usrA', 'pw123456', false, deps);
    const listed = await call('/api/v1/cofre/items', 'GET', token);
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { items?: unknown[] }).items).toBeDefined();
  });
});
