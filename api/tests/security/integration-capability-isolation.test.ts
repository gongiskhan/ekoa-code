import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  users,
  orgs,
  gatewayKeys,
  activityLogs,
  integrationConfigs,
  integrationDefinitions,
  approvedIntegrationActions,
} from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { __resetGatewayKeysServiceForTests } from '../../src/auth/gateway-keys-service.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import { approveAction, describeAction } from '../../src/integrations/action-consent.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * SECURITY SUITE — tenancy on the PUBLIC integrations capability surface (slice D1), in the class
 * of `tests/security/memvault-isolation.test.ts`: the real app, real minted gateway keys, and every
 * probe driven from the OTHER tenant rather than asserted against a data structure.
 *
 * FOUR CLASSES:
 *
 *  A. BLINDNESS. Another org's `private` definition is invisible to `GET /:key`, to
 *     `POST …/execute` and to the list — under a JWT and under a real key alike — and the refusal
 *     is BYTE-IDENTICAL to one for a key that does not exist. A same-org PEER is blind to a private
 *     row too, and sees an `org` one: the boundary is the A1 visibility gate, not "same company".
 *  B. NO REQUEST NAMES A TENANT. Body, query and header attempts to select another org are inert.
 *     This is the property that makes rule 5 real: tenancy is not a parameter of the capability
 *     API, so a consumer cannot get it wrong and an attacker cannot get it right.
 *  C. AUTHORSHIP DOES NOT LEAK THROUGH THE ONE ROW THAT IS SHARED. A `global` definition is
 *     readable cross-org by design; its author's org, its author's user, its stored id and any
 *     credential material pasted into it are not.
 *  D. AN APPROVAL DOES NOT CROSS. The write gate's approval is keyed on (org, user, …), so an
 *     approval granted in one tenant does not let another tenant's key execute the same action of
 *     the same shared integration.
 *
 * NO CREDENTIAL LITERAL EXISTS IN THIS FILE. The pasted-secret probe is composed at run time from
 * parts, so nothing here is a credential-shaped string a scanner must be told to ignore.
 * The outbound transport is faked so "zero requests left the process" is an assertion about the
 * real executor rather than about a stub of it.
 */
const upstream = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('../../src/services/url-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/url-fetcher.js')>();
  return {
    ...actual,
    guardedFetch: async (url: string) => {
      upstream.calls.push(url);
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  };
});

/** Composed at run time — never a literal (see the header). */
const PASTED_SECRET = ['sk', 'live', 'PROBE', Math.random().toString(36).slice(2, 12)].join('');

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const HOST = 'https://tenant.example';
const PRIVATE_KEY = 'd1-tenant-private';
const ORG_KEY = 'd1-tenant-org';
const GLOBAL_KEY = 'd1-tenant-global';

const read: IntegrationAction = {
  actionName: 'list_things', description: 'Listar', mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/things' },
};
const write: IntegrationAction = {
  actionName: 'send_message', description: 'Enviar', mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/messages' },
};

const call = (p: string, auth: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(init.headers ?? {}) },
  });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

async function mintKey(token: string, label: string): Promise<{ id: string; key: string }> {
  const res = await call('/api/v1/gateway-keys', token, { method: 'POST', body: JSON.stringify({ label }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
}

async function mkUser(id: string, orgId: string, role: 'user' | 'org-admin' | 'super-admin' = 'user'): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seed(
  key: string,
  orgId: string,
  userId: string,
  visibility: 'private' | 'org' | 'global',
  actions: IntegrationAction[],
): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility, key,
      displayName: `probe ${key}`, configSchema: [], actions, skillMd: '# probe', authType: 'none',
    },
    { actor: { userId, orgId, role: visibility === 'global' ? 'super-admin' : 'user' }, onConflict: 'replace' },
  );
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d1_capability_isolation');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
  // Users and orgs are FIXTURES, created once: no test here mutates them (the store-drift cases
  // live in tests/auth/integration-capability-auth.test.ts), and re-hashing four passwords per
  // test costs more wall clock than everything this suite actually asserts.
  await orgs.insert({ _id: 'orgA', name: 'A' } as never);
  await orgs.insert({ _id: 'orgB', name: 'B' } as never);
  await mkUser('ownerA', 'orgA');
  await mkUser('peerA', 'orgA');
  await mkUser('adminA', 'orgA', 'org-admin');
  await mkUser('ownerB', 'orgB');
  await mkUser('adminB', 'orgB', 'org-admin');
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  __resetGatewayKeysServiceForTests();
  upstream.calls.length = 0;
  for (const s of [gatewayKeys, activityLogs, integrationConfigs, integrationDefinitions, approvedIntegrationActions]) {
    await s.deleteMany({});
  }
  for (const id of ['ownerA', 'peerA', 'adminA', 'ownerB', 'adminB']) setActivation(id, { active: true, billingLocked: false });
  await seed(PRIVATE_KEY, 'orgA', 'ownerA', 'private', [read, write]);
  await seed(ORG_KEY, 'orgA', 'ownerA', 'org', [read, write]);
});

const getCap = (key: string, auth: string) => call(`/api/v1/integrations/${key}`, auth);
const execCap = (key: string, action: string, auth: string, body: unknown = {}) =>
  call(`/api/v1/integrations/${key}/actions/${action}/execute`, auth, { method: 'POST', body: JSON.stringify(body) });

// ---------------------------------------------------------------------------------------------
// A. Blindness
// ---------------------------------------------------------------------------------------------

describe('A. another tenant is blind, on every capability operation and under both admissions', () => {
  it('GET: org B sees the same 404 for org A\'s private row as for a key that never existed', async () => {
    const tokenB = await tokenFor('ownerB');
    const keyB = await mintKey(tokenB, 'iso-get');
    for (const auth of [tokenB, keyB.key]) {
      const hidden = await getCap(PRIVATE_KEY, auth);
      const missing = await getCap('a-key-that-was-never-created', auth);
      expect(hidden.status).toBe(404);
      expect(await hidden.text()).toBe(await missing.text());
    }
  });

  it('EXECUTE: org B cannot run org A\'s action, and NOTHING leaves the process', async () => {
    const tokenB = await tokenFor('ownerB');
    const keyB = await mintKey(tokenB, 'iso-exec');
    for (const auth of [tokenB, keyB.key]) {
      const hidden = await execCap(PRIVATE_KEY, 'list_things', auth);
      const missing = await execCap('a-key-that-was-never-created', 'list_things', auth);
      expect(hidden.status).toBe(404);
      expect(await hidden.text()).toBe(await missing.text());
    }
    expect(upstream.calls).toEqual([]);
  });

  it('EXECUTE: a MUTATING action of another tenant is a 404, never an awaiting_consent leak', async () => {
    // A 403 here would be an existence oracle wearing a consent prompt: it would confirm both that
    // the integration exists and that the named action mutates.
    const keyB = await mintKey(await tokenFor('ownerB'), 'iso-exec-write');
    const res = await execCap(PRIVATE_KEY, 'send_message', keyB.key);
    expect(res.status).toBe(404);
    expect(upstream.calls).toEqual([]);
  });

  it('LIST: org B\'s key never sees org A\'s private or org-shared definitions', async () => {
    const keyB = await mintKey(await tokenFor('ownerB'), 'iso-list');
    const body = (await (await call('/api/v1/integrations', keyB.key)).json()) as { items: Array<{ key: string }> };
    const keys = body.items.map((i) => i.key);
    expect(keys).not.toContain(PRIVATE_KEY);
    expect(keys).not.toContain(ORG_KEY);
  });

  it('a SAME-ORG peer is blind to a private row and sees an org-shared one (the gate is visibility, not the company)', async () => {
    const keyPeer = await mintKey(await tokenFor('peerA'), 'iso-peer');
    expect((await getCap(PRIVATE_KEY, keyPeer.key)).status).toBe(404);
    expect((await getCap(ORG_KEY, keyPeer.key)).status).toBe(200);
    // …and the peer can EXECUTE the shared read, under their OWN principal.
    const res = await execCap(ORG_KEY, 'list_things', keyPeer.key);
    expect(res.status).toBe(200);
    const rows = (await activityLogs.find({ category: 'integrations' } as never)) as unknown as Array<{ userId: string; orgId: string }>;
    expect(rows.some((r) => r.userId === 'peerA' && r.orgId === 'orgA')).toBe(true);
  });

  it('an ORG-ADMIN of another org has no reach either — a platform role is not a tenant claim', async () => {
    const keyAdminB = await mintKey(await tokenFor('adminB'), 'iso-admin');
    expect((await getCap(PRIVATE_KEY, keyAdminB.key)).status).toBe(404);
    expect((await getCap(ORG_KEY, keyAdminB.key)).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------------------------
// B. No request names a tenant
// ---------------------------------------------------------------------------------------------

describe('B. nothing a caller can send selects a tenant', () => {
  const ATTEMPTS: Array<{ label: string; body?: unknown; query?: string; headers?: Record<string, string> }> = [
    { label: 'body orgId', body: { args: {}, orgId: 'orgA' } },
    { label: 'body ownerUserId', body: { args: {}, ownerUserId: 'ownerA' } },
    { label: 'body nested actor', body: { args: {}, actor: { orgId: 'orgA', userId: 'ownerA', role: 'super-admin' } } },
    { label: 'body args carrying a tenant', body: { args: { orgId: 'orgA', ownerUserId: 'ownerA' } } },
    { label: 'query string', query: '?orgId=orgA&userId=ownerA', body: { args: {} } },
    { label: 'headers', headers: { 'x-org-id': 'orgA', 'x-user-id': 'ownerA', 'x-ekoa-org': 'orgA' }, body: { args: {} } },
    { label: 'x-client naming a tenant', headers: { 'x-client': 'orgA' }, body: { args: {} } },
  ];

  let outsiderKey = '';
  beforeEach(async () => {
    outsiderKey = (await mintKey(await tokenFor('ownerB'), 'iso-inert')).key;
  });

  it.each(ATTEMPTS)('EXECUTE $label is inert: still 404 from org B, still zero requests', async (attempt) => {
    const res = await call(
      `/api/v1/integrations/${PRIVATE_KEY}/actions/list_things/execute${attempt.query ?? ''}`,
      outsiderKey,
      { method: 'POST', body: JSON.stringify(attempt.body ?? {}), ...(attempt.headers ? { headers: attempt.headers } : {}) },
    );
    expect(res.status).toBe(404);
    expect(upstream.calls).toEqual([]);
  });

  it.each(ATTEMPTS)('GET $label is inert too', async (attempt) => {
    const res = await call(
      `/api/v1/integrations/${PRIVATE_KEY}${attempt.query ?? ''}`,
      outsiderKey,
      attempt.headers ? { headers: attempt.headers } : {},
    );
    expect(res.status).toBe(404);
  });

  it('the same attempts do not change the answer for a caller who IS entitled (no accidental widening)', async () => {
    const keyA = await mintKey(await tokenFor('ownerA'), 'iso-control');
    const plain = await getCap(PRIVATE_KEY, keyA.key);
    const decorated = await call(`/api/v1/integrations/${PRIVATE_KEY}?orgId=orgB`, keyA.key, { headers: { 'x-org-id': 'orgB' } });
    expect(plain.status).toBe(200);
    expect(await decorated.text()).toBe(await plain.text());
  });
});

// ---------------------------------------------------------------------------------------------
// C. The shared row reveals no author and no pasted credential
// ---------------------------------------------------------------------------------------------

describe('C. a `global` definition is readable cross-org; its authorship and secrets are not', () => {
  beforeEach(async () => {
    await seed(GLOBAL_KEY, 'orgAUTHOR', 'userAUTHOR', 'global', [
      {
        actionName: 'list_things',
        description: 'Listar',
        mutates: false,
        httpConfig: { method: 'GET', baseUrl: HOST, path: '/things', headers: { authorization: PASTED_SECRET } },
      },
    ]);
  });

  it('org B reads it, and the body names neither the authoring org, the author, nor a stored id', async () => {
    const keyB = await mintKey(await tokenFor('ownerB'), 'iso-global');
    const res = await getCap(GLOBAL_KEY, keyB.key);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('orgAUTHOR');
    expect(text).not.toContain('userAUTHOR');
    const body = JSON.parse(text) as { integration: Record<string, unknown> };
    expect(body.integration.id).toBeUndefined();
    expect(body.integration.visibility).toBeUndefined();
    expect(body.integration.orgId).toBeUndefined();
    expect(body.integration.userId).toBeUndefined();
  });

  it('a credential pasted into the published package is redacted on the way out — to EVERY reader', async () => {
    const keyB = await mintKey(await tokenFor('ownerB'), 'iso-global-secret');
    const keyA = await mintKey(await tokenFor('ownerA'), 'iso-global-secret-a');
    for (const auth of [keyA.key, keyB.key]) {
      const text = await (await getCap(GLOBAL_KEY, auth)).text();
      expect(text, 'a pasted credential must never ride out on the capability read').not.toContain(PASTED_SECRET);
      expect(text).toContain('[REDACTED]');
    }
  });

  it('the LIST projection of the same row is redacted identically (one projection, two endpoints)', async () => {
    const keyB = await mintKey(await tokenFor('ownerB'), 'iso-global-list');
    const text = await (await call('/api/v1/integrations', keyB.key)).text();
    expect(text).toContain(GLOBAL_KEY);
    expect(text).not.toContain(PASTED_SECRET);
    expect(text).not.toContain('orgAUTHOR');
  });
});

// ---------------------------------------------------------------------------------------------
// D. An approval does not cross a tenant boundary
// ---------------------------------------------------------------------------------------------

describe('D. the write gate\'s approval is per (org, user) — a shared integration does not share consent', () => {
  beforeEach(async () => {
    await seed(GLOBAL_KEY, 'orgAUTHOR', 'userAUTHOR', 'global', [read, write]);
  });

  it('org A\'s approval of a GLOBAL integration does not let org B execute the same write', async () => {
    // Both orgs resolve the SAME published definition, so this is the gate speaking and not a
    // visibility miss: org B can READ the integration perfectly well.
    const tokenA = await tokenFor('ownerA');
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(GLOBAL_KEY, write), 'always');
    const keyA = await mintKey(tokenA, 'iso-approved-a');
    const keyB = await mintKey(await tokenFor('ownerB'), 'iso-approved-b');

    expect((await getCap(GLOBAL_KEY, keyB.key)).status).toBe(200); // visible…
    expect((await execCap(GLOBAL_KEY, 'send_message', keyB.key)).status).toBe(403); // …but not permitted
    expect(upstream.calls).toEqual([]);

    // The approving tenant's own key goes through, which is what makes the refusal above a scope
    // assertion rather than a broken fixture.
    expect((await execCap(GLOBAL_KEY, 'send_message', keyA.key)).status).toBe(200);
    expect(upstream.calls).toEqual([`${HOST}/messages`]);
  });

  it('a SAME-ORG peer of the approver is refused too — the approving human is in the key', async () => {
    await approveAction({ orgId: 'orgA', userId: 'ownerA' }, describeAction(GLOBAL_KEY, write), 'always');
    const keyPeer = await mintKey(await tokenFor('peerA'), 'iso-approved-peer');
    expect((await execCap(GLOBAL_KEY, 'send_message', keyPeer.key)).status).toBe(403);
    expect(upstream.calls).toEqual([]);
  });
});
