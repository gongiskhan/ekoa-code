import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, gatewayKeys, integrationDefinitions, integrationConfigs, approvedIntegrationActions, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import {
  mintGatewayKey,
  revokeGatewayKey,
  GATEWAY_KEY_PREFIX,
  __resetGatewayKeysServiceForTests,
} from '../../src/auth/gateway-keys-service.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import { ErrorEnvelope, integrationsEndpoints } from '@ekoa/shared';

/**
 * Slice D1 — the PER-DOMAIN auth suite for the integrations capability surface (Capability
 * Contract rule 4).
 *
 * WHY A PER-DOMAIN SUITE EXISTS AT ALL, given `tests/auth/api-key-middleware.test.ts` already
 * proves the middleware: that suite mounts `requireUserOrApiKey` on a TOY express app. It proves
 * the middleware is correct; it cannot prove that THIS domain mounts it, on THESE routes, and
 * nowhere else. The contract document names that gap explicitly — "a generic cross-domain check
 * that every `user-or-key` descriptor route mounts the middleware does not exist". This suite
 * closes it for the integrations domain, the same way `tests/contract/memvault.test.ts` does for
 * memvault: every verdict of the admission plane, driven through the REAL app on the REAL
 * capability paths.
 *
 * Every case below runs against all three declared capability routes, so a route that admits keys
 * through a DIFFERENT path — a hand-rolled header check, a mount that forgot the middleware, a
 * fourth route that quietly became key-reachable — fails here rather than being covered by the one
 * route somebody remembered to test.
 */
let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const KEY = 'd1-auth-probe';
const OWNER = { userId: 'capOwner', username: 'cap-owner', orgId: 'orgCap' };
const readAction: IntegrationAction = {
  actionName: 'list_things',
  description: 'Listar coisas',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: 'https://auth.example', path: '/things' },
};

/** The three declared `user-or-key` routes, derived FROM THE DESCRIPTORS rather than retyped, so a
 *  fourth capability endpoint added to the domain is automatically exercised by every case here. */
const CAPABILITY_CALLS = Object.entries(integrationsEndpoints)
  .filter(([, d]) => d.auth === 'user-or-key')
  .map(([name, d]) => ({
    name,
    method: d.method,
    path: d.path.replace('/:key/', `/${KEY}/`).replace(/\/:key$/, `/${KEY}`).replace(':actionName', 'list_things'),
  }));

const probe = (
  op: { method: string; path: string },
  auth?: string,
  headers: Record<string, string> = {},
): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}${op.path}`, {
    method: op.method,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}), ...headers },
    ...(op.method === 'GET' || op.method === 'DELETE' ? {} : { body: '{}' }),
  });

async function expectEnvelope(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, JSON.stringify(body)).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

/** Run one expectation across EVERY declared capability route. */
async function forEachCapabilityRoute(fn: (op: { name: string; method: string; path: string }) => Promise<void>): Promise<void> {
  for (const op of CAPABILITY_CALLS) await fn(op);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d1_capability_auth');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  delete process.env.EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY;
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  __resetGatewayKeysServiceForTests();
  for (const s of [users, orgs, gatewayKeys, activityLogs, integrationDefinitions, integrationConfigs, approvedIntegrationActions]) {
    await s.deleteMany({});
  }
  await orgs.insert({ _id: 'orgCap', name: 'Cap Org' } as never);
  await users.insert({ _id: 'capOwner', username: 'cap-owner', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgCap', active: true } as never);
  setActivation('capOwner', { active: true, billingLocked: false });
  await integrationDefinitionStore.create(
    {
      orgId: 'orgCap', userId: 'capOwner', visibility: 'private', key: KEY,
      displayName: 'D1 auth probe', configSchema: [], actions: [readAction], skillMd: '# probe', authType: 'none',
    },
    { actor: { userId: 'capOwner', orgId: 'orgCap', role: 'user' }, onConflict: 'replace' },
  );
});

describe('the domain really declares three capability routes (a floor, so an empty matrix cannot pass)', () => {
  it('descriptor-derived call list covers list + get + execute', () => {
    expect(CAPABILITY_CALLS.map((c) => c.name).sort()).toEqual(['executeAction', 'getIntegration', 'list']);
    expect(CAPABILITY_CALLS.map((c) => c.path)).toEqual([
      '/api/v1/integrations',
      `/api/v1/integrations/${KEY}`,
      `/api/v1/integrations/${KEY}/actions/list_things/execute`,
    ]);
  });
});

describe('gateway-key admission on the integrations capability routes: fail closed, every verdict', () => {
  it('a live key is admitted on all three, and only the key path leaves an audit principal', async () => {
    const minted = await mintGatewayKey(OWNER, 'live', deps);
    await forEachCapabilityRoute(async (op) => {
      const res = await probe(op, `Bearer ${minted.key}`, { 'x-client': 'claude-code' });
      expect(res.status, `${op.name} should admit a live key`).toBe(200);
    });
    // The trace-only tag reached the audit row on the one op that writes one (Rule 3: read, never
    // branched on — the other two ops behave identically with and without the header).
    const rows = (await activityLogs.find({ category: 'integrations' } as never)) as unknown as Array<{ metadata: Record<string, unknown> }>;
    expect(rows.some((r) => r.metadata.keyId === minted.id && r.metadata.xClient === 'claude-code')).toBe(true);
  });

  it('an UNKNOWN key is 401 on every capability route, with one uniform message', async () => {
    const bodies = new Set<string>();
    await forEachCapabilityRoute(async (op) => {
      const res = await probe(op, `Bearer ${GATEWAY_KEY_PREFIX}not-a-real-secret`);
      await expectEnvelope(res, 401, 'UNAUTHENTICATED');
      bodies.add(JSON.stringify((await probe(op, `Bearer ${GATEWAY_KEY_PREFIX}another-fake`).then((r) => r.json())) as unknown));
    });
    // One message for every unknown key: never a key-state oracle.
    expect(bodies.size).toBe(1);
  });

  it('a REVOKED key is 401 on every capability route', async () => {
    const minted = await mintGatewayKey(OWNER, 'to-revoke', deps);
    await revokeGatewayKey(OWNER, minted.id, deps);
    await forEachCapabilityRoute(async (op) => {
      await expectEnvelope(await probe(op, `Bearer ${minted.key}`), 401, 'UNAUTHENTICATED');
    });
  });

  it('a DEACTIVATED owner is 401 on every capability route (activation cache)', async () => {
    const minted = await mintGatewayKey(OWNER, 'inactive', deps);
    setActivation('capOwner', { active: false, billingLocked: false });
    await forEachCapabilityRoute(async (op) => {
      await expectEnvelope(await probe(op, `Bearer ${minted.key}`), 401, 'UNAUTHENTICATED');
    });
  });

  it('STORE DRIFT fails closed: an inactive owner doc, and a DELETED owner doc, are both 401', async () => {
    const minted = await mintGatewayKey(OWNER, 'drift', deps);
    // The activation cache still says active — the LIVE users read is the second gate, and a key
    // must never outlive its user.
    await users.update('capOwner', (d) => ({ ...d, active: false }));
    await forEachCapabilityRoute(async (op) => {
      await expectEnvelope(await probe(op, `Bearer ${minted.key}`), 401, 'UNAUTHENTICATED');
    });
    await users.delete('capOwner');
    await forEachCapabilityRoute(async (op) => {
      await expectEnvelope(await probe(op, `Bearer ${minted.key}`), 401, 'UNAUTHENTICATED');
    });
  });

  it('a BILLING-LOCKED owner is 402 on every capability route, never 401', async () => {
    const minted = await mintGatewayKey(OWNER, 'locked', deps);
    setActivation('capOwner', { active: true, billingLocked: true });
    await forEachCapabilityRoute(async (op) => {
      await expectEnvelope(await probe(op, `Bearer ${minted.key}`), 402, 'BILLING_LOCKED');
    });
  });

  it('NO credential at all is 401 on every capability route', async () => {
    await forEachCapabilityRoute(async (op) => {
      await expectEnvelope(await probe(op), 401, 'UNAUTHENTICATED');
    });
  });
});

describe('the JWT path stays byte-identical to requireAuth on these routes', () => {
  it('a garbage bearer answers exactly what a plain requireAuth route answers', async () => {
    // `/api/v1/integrations/active` is the same router, mounted on plain `requireAuth`. Comparing
    // against it is what makes this a PARITY assertion rather than a re-statement of the envelope.
    for (const auth of [undefined, 'Bearer garbage', 'Token abc'] as const) {
      const reference = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/active`, {
        headers: { ...(auth ? { authorization: auth } : {}) },
      });
      await forEachCapabilityRoute(async (op) => {
        const res = await probe(op, auth);
        expect(res.status, `${op.name} @ ${String(auth)}`).toBe(reference.status);
        expect(await res.text(), `${op.name} @ ${String(auth)}`).toBe(await reference.clone().text());
      });
    }
  });

  it('a valid JWT is admitted and carries NO key principal into the audit row', async () => {
    const { token } = await login('cap-owner', 'pw123456', false, deps);
    await forEachCapabilityRoute(async (op) => {
      expect((await probe(op, `Bearer ${token}`)).status, op.name).toBe(200);
    });
    const rows = (await activityLogs.find({ category: 'integrations' } as never)) as unknown as Array<{ metadata: Record<string, unknown> }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.metadata.keyId).toBeUndefined();
  });
});

describe('the per-key capability window applies to this domain, and JWT sessions are never counted', () => {
  it('an over-cap key is 429 on a capability route while the same user\'s JWT is unaffected', async () => {
    __resetCapabilityRateForTests({ maxCallsPerKey: 2 });
    const { token } = await login('cap-owner', 'pw123456', false, deps);
    const get = CAPABILITY_CALLS.find((c) => c.name === 'getIntegration')!;

    // Well past the key cap on the JWT path: not counted by the per-key window.
    for (let i = 0; i < 5; i++) expect((await probe(get, `Bearer ${token}`)).status).toBe(200);

    const minted = await mintGatewayKey(OWNER, 'capped', deps);
    expect((await probe(get, `Bearer ${minted.key}`)).status).toBe(200);
    expect((await probe(get, `Bearer ${minted.key}`)).status).toBe(200);
    await expectEnvelope(await probe(get, `Bearer ${minted.key}`), 429, 'RATE_LIMITED');

    // Per keyId, not per user: a second key of the same user is not throttled by the first's window.
    const other = await mintGatewayKey(OWNER, 'fresh', deps);
    expect((await probe(get, `Bearer ${other.key}`)).status).toBe(200);
  });

  it('the window covers EXECUTE too — a throttled key cannot spend its budget on side effects', async () => {
    __resetCapabilityRateForTests({ maxCallsPerKey: 1 });
    const minted = await mintGatewayKey(OWNER, 'exec-capped', deps);
    const exec = CAPABILITY_CALLS.find((c) => c.name === 'executeAction')!;
    expect((await probe(exec, `Bearer ${minted.key}`)).status).toBe(200);
    await expectEnvelope(await probe(exec, `Bearer ${minted.key}`), 429, 'RATE_LIMITED');
  });
});
