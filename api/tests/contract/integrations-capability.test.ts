import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  users,
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
import { integrationsRouter } from '../../src/routes/integrations.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import type { IntegrationAction } from '../../src/integrations/definitions.js';
import {
  ErrorEnvelope,
  ExecuteIntegrationActionResponse,
  IntegrationCapability,
  IntegrationDefinitionListResponse,
  IntegrationActionConsentRequest,
  integrationsEndpoints,
} from '@ekoa/shared';

/**
 * Slice D1 — the PUBLIC CAPABILITY surface on the integrations domain, through the REAL app.
 *
 * The four things this suite exists to pin, none of which a handler stub could satisfy:
 *
 *  1. BOTH ADMISSIONS REACH IT AND ONLY IT. `list`, `getIntegration` and `executeAction` admit a
 *     REAL minted `ekoa_gk_` key as well as a platform JWT; every OTHER route of this router
 *     refuses that key with 401. The check walks the router's OWN STACK rather than a hand-written
 *     path list, so a route added to that file later is covered without anyone remembering to
 *     extend this test.
 *  2. THE WRITE GATE HOLDS ACROSS THE HTTP BOUNDARY. A `mutates` action called with a key and no
 *     approval answers 403 `awaiting_consent` and the UPSTREAM IS NEVER CALLED. The key then fails
 *     to approve itself (401 on `POST …/approval`), the refusal is unchanged, and only after the
 *     HUMAN approves through the JWT surface does the same key's call go out — exactly once.
 *  3. THE WIRE SHAPES. Every 2xx body safeParses against its named `shared/` schema, and every
 *     non-2xx against the shared error envelope.
 *  4. THE AUDIT. An execute leaves one row carrying the key principal and the outcome — and NOT
 *     the args or the response payload.
 *
 * THE OUTBOUND TRANSPORT IS THE ONLY FAKE. `guardedFetch` is mocked so the remote is deterministic
 * and no test makes a network call; everything between the socket and that call — admission, the
 * router's two tiers, the capability module, the executor, the consent store, the origin binding —
 * is the real thing. That also makes "the upstream was never called" an assertion about the real
 * executor rather than about a stub of it.
 */
const upstream = vi.hoisted(() => ({
  calls: [] as Array<{ url: string; method?: string }>,
  status: 200,
  body: '{"ok":true}',
}));
vi.mock('../../src/services/url-fetcher.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/url-fetcher.js')>();
  return {
    ...actual,
    guardedFetch: async (url: string, opts: { method?: string } = {}) => {
      upstream.calls.push({ url, method: opts.method });
      return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': 'application/json' } });
    },
  };
});

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const KEY = 'd1-caps';
const HOST = 'https://writes.example';
const writeAction: IntegrationAction = {
  actionName: 'send_message',
  description: 'Enviar mensagem',
  mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/messages' },
};
const readAction: IntegrationAction = {
  actionName: 'list_things',
  description: 'Listar coisas',
  mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/things' },
};

const call = (p: string, auth: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}), ...(init.headers ?? {}) },
  });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

/** Mint a REAL gateway key through the REAL public route, exactly as an outside client would. */
async function mintKey(token: string, label: string): Promise<{ id: string; key: string }> {
  const res = await call('/api/v1/gateway-keys', token, { method: 'POST', body: JSON.stringify({ label }) });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string };
}

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user' = 'user'): Promise<void> {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seed(actions: IntegrationAction[], key = KEY, orgId = 'orgA', userId = 'ownerA'): Promise<void> {
  await integrationDefinitionStore.create(
    {
      orgId, userId, visibility: 'private', key,
      displayName: 'D1 Capability', configSchema: [], actions, skillMd: '# probe', authType: 'none',
    },
    { actor: { userId, orgId, role: 'user' }, onConflict: 'replace' },
  );
}

async function expectEnvelope(res: Response, status: number, code: string): Promise<Record<string, unknown>> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx must be the shared envelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
  return body;
}

/** The shape token the write gate keys on, read from the surface a human answers on. */
async function shapeOf(token: string, actionName: string): Promise<string> {
  const res = await call(`/api/v1/integrations/${KEY}/action-approvals`, token);
  const body = (await res.json()) as { items: Array<{ actionName: string; shape: string }> };
  return body.items.find((i) => i.actionName === actionName)!.shape;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_d1_capability_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  __resetGatewayKeysServiceForTests();
  upstream.calls.length = 0;
  upstream.status = 200;
  upstream.body = '{"ok":true}';
  for (const s of [users, gatewayKeys, activityLogs, integrationConfigs, integrationDefinitions, approvedIntegrationActions]) {
    await s.deleteMany({});
  }
  await mkUser('ownerA', 'orgA');
  await mkUser('ownerB', 'orgB');
  await seed([readAction, writeAction]);
});

// ---------------------------------------------------------------------------------------------
// 1. Discovery + read, under both admissions
// ---------------------------------------------------------------------------------------------

describe('the capability READ surface admits a JWT and a real gateway key alike', () => {
  it('GET /api/v1/integrations: the list is unchanged and now key-reachable (the D1 flip)', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-list');

    const viaJwt = await call('/api/v1/integrations', token);
    const viaKey = await call('/api/v1/integrations', minted.key);
    expect(viaJwt.status).toBe(200);
    expect(viaKey.status).toBe(200);

    const jwtBody = (await viaJwt.json()) as { items: Array<{ key: string }> };
    const keyBody = (await viaKey.json()) as { items: Array<{ key: string }> };
    expect(IntegrationDefinitionListResponse.safeParse(jwtBody).success, JSON.stringify(jwtBody)).toBe(true);
    expect(IntegrationDefinitionListResponse.safeParse(keyBody).success, JSON.stringify(keyBody)).toBe(true);
    // Rule 7: same wire shape, same content — the flip widened WHO may ask, not WHAT comes back.
    expect(keyBody.items.map((i) => i.key).sort()).toEqual(jwtBody.items.map((i) => i.key).sort());
    expect(keyBody.items.some((i) => i.key === KEY)).toBe(true);
  });

  it('GET /api/v1/integrations/:key: schema-valid, identical under both admissions', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-get');

    const viaKey = await call(`/api/v1/integrations/${KEY}`, minted.key);
    expect(viaKey.status).toBe(200);
    const body = (await viaKey.json()) as { integration: Record<string, unknown>; connected: boolean; actions: Array<Record<string, unknown>> };
    expect(IntegrationCapability.safeParse(body).success, JSON.stringify(body)).toBe(true);

    expect(body.integration.key).toBe(KEY);
    expect(body.connected).toBe(true); // authType 'none' needs no config
    const write = body.actions.find((a) => a.actionName === 'send_message')!;
    expect(write.requiresApproval).toBe(true);
    expect(write.approved).toBe(false);
    expect(write.target).toBe(`POST ${HOST}/messages`);
    expect(write.backingType).toBe('api-call');
    const read = body.actions.find((a) => a.actionName === 'list_things')!;
    expect(read.requiresApproval).toBe(false);

    const viaJwt = await call(`/api/v1/integrations/${KEY}`, token);
    expect(await viaJwt.json()).toEqual(body);
  });

  it('an integration the caller cannot see and one that does not exist answer the IDENTICAL 404', async () => {
    const tokenB = await tokenFor('ownerB');
    const keyB = await mintKey(tokenB, 'd1-cross');
    const hidden = await call(`/api/v1/integrations/${KEY}`, keyB.key);
    const missing = await call('/api/v1/integrations/definitely-not-a-real-key', keyB.key);
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    // BYTE-identical: no existence oracle for another tenant's private definition.
    expect(await hidden.text()).toBe(await missing.text());
  });

  it('a malformed path segment is a 400 with the zod issues, not a 404', async () => {
    const token = await tokenFor('ownerA');
    const res = await call(`/api/v1/integrations/${'k'.repeat(121)}`, token);
    await expectEnvelope(res, 400, 'VALIDATION_FAILED');
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Execute — and the write gate across the HTTP boundary
// ---------------------------------------------------------------------------------------------

describe('POST /:key/actions/:actionName/execute', () => {
  const exec = (auth: string, action: string, body: unknown = {}, key = KEY) =>
    call(`/api/v1/integrations/${key}/actions/${action}/execute`, auth, { method: 'POST', body: JSON.stringify(body) });

  it('a READ runs under a gateway key and returns the upstream result, schema-valid', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-exec-read');
    upstream.body = '{"things":[1,2]}';

    const res = await exec(minted.key, 'list_things');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ExecuteIntegrationActionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body).toMatchObject({ success: true, status: 200, data: { things: [1, 2] } });
    expect(upstream.calls).toHaveLength(1);
    expect(upstream.calls[0]!.url).toBe(`${HOST}/things`);
  });

  it('AN UNAPPROVED WRITE IS 403 awaiting_consent AND NOTHING LEFT THE PROCESS', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-exec-write');

    const res = await exec(minted.key, 'send_message', { args: { text: 'olá' } });
    const body = await expectEnvelope(res, 403, 'FORBIDDEN');
    const details = (body as { error: { details?: Record<string, unknown> } }).error.details!;
    expect(details.code).toBe('awaiting_consent');
    const consent = IntegrationActionConsentRequest.safeParse(details.consentRequest);
    expect(consent.success, JSON.stringify(details.consentRequest)).toBe(true);
    expect(consent.data!.actionName).toBe('send_message');
    expect(consent.data!.target).toBe(`POST ${HOST}/messages`);
    // The gate sits before the credential is even loaded, let alone sent.
    expect(upstream.calls).toHaveLength(0);
  });

  it('THE KEY CANNOT APPROVE ITSELF: the approval route refuses it, and the refusal is unchanged', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'selfapprove');
    const shape = await shapeOf(token, 'send_message');

    // The agent has been handed the exact shape by the 403 above. It tries to bank it.
    const selfApprove = await call(`/api/v1/integrations/${KEY}/actions/send_message/approval`, minted.key, {
      method: 'POST',
      body: JSON.stringify({ decision: 'always', shape }),
    });
    await expectEnvelope(selfApprove, 401, 'UNAUTHENTICATED');
    // …and the same for revoke and the approvals list: the whole consent surface is JWT-only.
    await expectEnvelope(await call(`/api/v1/integrations/${KEY}/actions/send_message/approval`, minted.key, { method: 'DELETE' }), 401, 'UNAUTHENTICATED');
    await expectEnvelope(await call(`/api/v1/integrations/${KEY}/action-approvals`, minted.key), 401, 'UNAUTHENTICATED');
    expect(await approvedIntegrationActions.find({} as never)).toHaveLength(0);

    // Retry the write: still refused, still nothing sent.
    const retry = await exec(minted.key, 'send_message', { args: { text: 'olá' } });
    expect(retry.status).toBe(403);
    expect(upstream.calls).toHaveLength(0);
  });

  it('after the HUMAN approves through the JWT surface, the SAME key executes exactly once', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-after-approval');
    const shape = await shapeOf(token, 'send_message');

    const granted = await call(`/api/v1/integrations/${KEY}/actions/send_message/approval`, token, {
      method: 'POST',
      body: JSON.stringify({ decision: 'always', shape }),
    });
    expect(granted.status).toBe(200);

    // The capability read now reports the standing approval (advisory state, re-read per call).
    const view = (await (await call(`/api/v1/integrations/${KEY}`, minted.key)).json()) as { actions: Array<Record<string, unknown>> };
    expect(view.actions.find((a) => a.actionName === 'send_message')!.approved).toBe(true);

    const res = await exec(minted.key, 'send_message', { args: { text: 'olá' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ExecuteIntegrationActionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body).toMatchObject({ success: true });
    expect(upstream.calls).toEqual([{ url: `${HOST}/messages`, method: 'POST' }]);
  });

  it('an UPSTREAM failure is a 200 result envelope, not a Cortex error (the remote answered)', async () => {
    const token = await tokenFor('ownerA');
    upstream.status = 503;
    upstream.body = '{"message":"provider down"}';
    const res = await exec(token, 'list_things');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: number; code: string };
    expect(ExecuteIntegrationActionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body).toMatchObject({ success: false, status: 503, code: 'transient_5xx' });
  });

  it('an unknown ACTION and an unknown INTEGRATION are both the uniform 404', async () => {
    const token = await tokenFor('ownerA');
    const noAction = await exec(token, 'no_such_action');
    const noIntegration = await exec(token, 'list_things', {}, 'no-such-integration');
    expect(noAction.status).toBe(404);
    expect(noIntegration.status).toBe(404);
    expect(await noAction.text()).toBe(await noIntegration.text());
    expect(upstream.calls).toHaveLength(0);
  });

  it('a body that invents a tenant field is INERT — the call still runs as the verified principal', async () => {
    const tokenB = await tokenFor('ownerB');
    const keyB = await mintKey(tokenB, 'd1-body-tenant');
    // orgA's private definition, named from orgB with orgA spelled out in the body.
    const res = await call(`/api/v1/integrations/${KEY}/actions/list_things/execute`, keyB.key, {
      method: 'POST',
      body: JSON.stringify({ args: {}, orgId: 'orgA', ownerUserId: 'ownerA', actor: { orgId: 'orgA' } }),
    });
    expect(res.status).toBe(404);
    expect(upstream.calls).toHaveLength(0);
  });

  it('a malformed body is a 400 envelope carrying the zod issues', async () => {
    const token = await tokenFor('ownerA');
    const res = await call(`/api/v1/integrations/${KEY}/actions/list_things/execute`, token, {
      method: 'POST',
      body: JSON.stringify({ args: 'not-an-object' }),
    });
    const body = await expectEnvelope(res, 400, 'VALIDATION_FAILED');
    expect((body as { error: { details?: { issues?: unknown[] } } }).error.details?.issues).toBeDefined();
    expect(upstream.calls).toHaveLength(0);
  });

  it('the AUTOMATION SEAM is wired into the mounted router, so this rail matches the other three', async () => {
    // The composition root binds `runAutomationBackedAction` ONCE and hands it to every executor
    // rail. If the capability mount did not receive it, an automation-backed action would answer
    // `automation_required` HERE while working everywhere else — one rail quietly behaving
    // differently. With the seam wired, the call reaches the real automation service and comes back
    // `unknown_automation` (there is no such automation in this fixture), which is a DIFFERENT code
    // and is therefore proof the seam ran.
    const token = await tokenFor('ownerA');
    await seed([{
      actionName: 'run_bound',
      description: 'Ação por automação',
      mutates: false,
      automationBinding: { automationId: 'no-such-automation', automationTemplate: 'probe', passCredentials: false },
    }], 'd1-bound');
    const res = await exec(token, 'run_bound', {}, 'd1-bound');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; code: string };
    expect(ExecuteIntegrationActionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect(body.code, 'the automation seam must be bound at the capability mount').not.toBe('automation_required');
    expect(body.code).toBe('unknown_automation');
  });

  it('an EMPTY body is accepted — `args` is optional', async () => {
    const token = await tokenFor('ownerA');
    const res = await call(`/api/v1/integrations/${KEY}/actions/list_things/execute`, token, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(ExecuteIntegrationActionResponse.safeParse(await res.json()).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// 3. The audit trail
// ---------------------------------------------------------------------------------------------

describe('every execute leaves exactly one audit row, and it carries no payload', () => {
  it('key-admitted: the row names the key and the x-client tag, the outcome, and nothing else', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-audit');
    upstream.body = '{"secretish":"upstream-payload-marker"}';

    const res = await fetch(`http://127.0.0.1:${port}/api/v1/integrations/${KEY}/actions/list_things/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, 'x-client': 'claude-code' },
      body: JSON.stringify({ args: { needle: 'argument-payload-marker' } }),
    });
    expect(res.status).toBe(200);

    const rows = (await activityLogs.find({ category: 'integrations' } as never)) as unknown as Array<{ type: string; metadata: Record<string, unknown> }>;
    const execRows = rows.filter((r) => r.type === 'capability_execute');
    expect(execRows).toHaveLength(1);
    expect(execRows[0]!.metadata).toMatchObject({
      integrationKey: KEY,
      actionName: 'list_things',
      verdict: 'ok',
      status: 200,
      keyId: minted.id,
      xClient: 'claude-code',
    });
    // The args and the response body are the caller's and the remote's payloads: an audit trail
    // that quietly copies them is a new exfiltration surface, not a control.
    const serialized = JSON.stringify(execRows[0]!.metadata);
    expect(serialized).not.toContain('argument-payload-marker');
    expect(serialized).not.toContain('upstream-payload-marker');
  });

  it('a REFUSED write is audited too — with its code, and with the key that tried', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-audit-refusal');
    await fetch(`http://127.0.0.1:${port}/api/v1/integrations/${KEY}/actions/send_message/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}` },
      body: JSON.stringify({ args: {} }),
    });
    const rows = (await activityLogs.find({ category: 'integrations' } as never)) as unknown as Array<{ type: string; metadata: Record<string, unknown> }>;
    const execRows = rows.filter((r) => r.type === 'capability_execute');
    expect(execRows).toHaveLength(1);
    expect(execRows[0]!.metadata).toMatchObject({ verdict: 'failed', code: 'awaiting_consent', keyId: minted.id });
  });

  it('a JWT-admitted execute is audited as well, with no key principal', async () => {
    const token = await tokenFor('ownerA');
    await call(`/api/v1/integrations/${KEY}/actions/list_things/execute`, token, { method: 'POST', body: JSON.stringify({}) });
    const rows = (await activityLogs.find({ category: 'integrations' } as never)) as unknown as Array<{ type: string; metadata: Record<string, unknown> }>;
    const execRows = rows.filter((r) => r.type === 'capability_execute');
    expect(execRows).toHaveLength(1);
    expect(execRows[0]!.metadata.keyId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// 4. The admission boundary, walked off the router's own stack
// ---------------------------------------------------------------------------------------------

describe('admission boundary: every route of the integrations router, enumerated from the router itself', () => {
  /** The three routes D1 declares `user-or-key`. Everything else must refuse a gateway key. */
  // D3 adds `post /:key/achieve` to the key-reachable set. The census is deliberately a HAND-KEPT
  // list checked against the descriptors below in BOTH directions, so adding a capability route
  // without declaring its class (or declaring one without mounting it) fails here rather than
  // shipping a route nobody accounted for.
  const CAPABILITY_ROUTES = new Set([
    'get /',
    'get /:key',
    'post /:key/actions/:actionName/execute',
    'post /:key/achieve',
  ]);

  /** Walk the real router's layer stack — a new route is picked up here automatically. */
  function routesOf(): Array<{ method: string; path: string }> {
    const router = integrationsRouter(deps) as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> };
    const out: Array<{ method: string; path: string }> = [];
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const [method, on] of Object.entries(layer.route.methods)) {
        if (on) out.push({ method: method.toLowerCase(), path: layer.route.path });
      }
    }
    return out;
  }

  const concrete = (path: string) => path.replace(/:[A-Za-z0-9_]+/g, 'probe');

  it('the walker really finds the whole surface (a sanity floor, so an empty walk cannot pass)', () => {
    const routes = routesOf();
    // RATCHETED, never loosened: 14 before S6, +5 for the publish doors. The floor exists so a
    // walker that silently found nothing (a refactor to a nested router, an express upgrade that
    // changes `stack`) cannot make the two probes below vacuously green.
    expect(routes.length).toBeGreaterThanOrEqual(19);
    for (const declared of CAPABILITY_ROUTES) {
      expect(routes.map((r) => `${r.method} ${r.path}`)).toContain(declared);
    }
    // The publish doors are on the walked surface, so the "no route answers without a credential"
    // and "a live gateway key is refused by every non-capability route" probes below cover them.
    for (const door of [
      'get /definitions/publish-requests',
      'post /definitions/:id/publish-request',
      'delete /definitions/:id/publish-request',
      'post /definitions/:id/publish-preview',
      'post /definitions/:id/publish',
    ]) {
      expect(routes.map((r) => `${r.method} ${r.path}`)).toContain(door);
    }
  });

  it('NO route of this router answers without a credential', async () => {
    const open: string[] = [];
    for (const { method, path } of routesOf()) {
      const res = await call(`/api/v1/integrations${concrete(path)}`.replace(/\/$/, '') || '/api/v1/integrations', null, {
        method: method.toUpperCase(),
        ...(method === 'get' || method === 'delete' ? {} : { body: '{}' }),
      });
      if (res.status !== 401) open.push(`${method} ${path} -> ${res.status}`);
      else expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    }
    expect(open, `routes reachable without a credential:\n${open.join('\n')}`).toEqual([]);
  });

  it('a REAL gateway key reaches the three capability routes and is refused by every other one', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-boundary');
    const leaked: string[] = [];
    const refusedCapability: string[] = [];

    for (const { method, path } of routesOf()) {
      const id = `${method} ${path}`;
      const res = await call(`/api/v1/integrations${concrete(path)}`.replace(/\/$/, '') || '/api/v1/integrations', minted.key, {
        method: method.toUpperCase(),
        ...(method === 'get' || method === 'delete' ? {} : { body: '{}' }),
      });
      if (CAPABILITY_ROUTES.has(id)) {
        // Admitted: the handler ran (200 for the list, 404 for the `probe` key that does not exist).
        if (res.status === 401) refusedCapability.push(`${id} -> 401`);
      } else if (res.status !== 401) {
        leaked.push(`${id} -> ${res.status}`);
      }
    }

    expect(leaked, `NON-capability routes reachable with a gateway key:\n${leaked.join('\n')}`).toEqual([]);
    expect(refusedCapability, `capability routes that refused a live key:\n${refusedCapability.join('\n')}`).toEqual([]);
  });

  it('the declared user-or-key descriptors are EXACTLY the routes that admit a key', () => {
    // The descriptor map is what the OpenAPI document is generated from, so a route that admits a
    // key without declaring it (or the reverse) would make the published spec a lie.
    const declared = Object.entries(integrationsEndpoints)
      .filter(([, d]) => d.auth === 'user-or-key')
      .map(([, d]) => `${d.method.toLowerCase()} ${d.path.replace('/api/v1/integrations', '') || '/'}`)
      .sort();
    expect(declared).toEqual([...CAPABILITY_ROUTES].sort());
  });
});

// ---------------------------------------------------------------------------------------------
// 5. The tier-2 surface still works exactly as it did (the router restructure changed admission
//    plumbing, not behaviour)
// ---------------------------------------------------------------------------------------------

describe('the dashboard surface is unchanged by the two-tier restructure', () => {
  it('a JWT still reaches the literal-segment routes that now sit ABOVE the `:key` capability routes', async () => {
    const token = await tokenFor('ownerA');
    expect((await call('/api/v1/integrations/active', token)).status).toBe(200);
    expect((await call('/api/v1/integrations/configs', token)).status).toBe(200);
    // `/configs` must not be swallowed by `GET /:key` — a capability view of an integration called
    // "configs" would be a 404, so a 200 with an `items` array proves the ordering holds.
    const configs = (await (await call('/api/v1/integrations/configs', token)).json()) as { items: unknown[] };
    expect(Array.isArray(configs.items)).toBe(true);
    const active = (await (await call('/api/v1/integrations/active', token)).json()) as { items: unknown[] };
    expect(Array.isArray(active.items)).toBe(true);
  });

  it('the org-admin refresh still needs the role, and the express router is really a mounted express app', async () => {
    const token = await tokenFor('ownerA');
    await expectEnvelope(await call('/api/v1/integrations/refresh', token, { method: 'POST' }), 403, 'FORBIDDEN');
    await mkUser('adminA', 'orgA', 'org-admin');
    const adminToken = await tokenFor('adminA');
    expect((await call('/api/v1/integrations/refresh', adminToken, { method: 'POST' })).status).toBe(200);
  });

  it('the sharing routes still answer under a JWT (E1) and never under a key', async () => {
    const token = await tokenFor('ownerA');
    const minted = await mintKey(token, 'd1-sharing');
    const view = (await (await call(`/api/v1/integrations/${KEY}`, token)).json()) as { integration: { id: string } };
    const id = view.integration.id;
    expect(typeof id).toBe('string');

    const flipped = await call(`/api/v1/integrations/definitions/${id}/visibility`, token, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'org' }),
    });
    expect(flipped.status).toBe(200);
    expect(await flipped.json()).toEqual({ ok: true, visibility: 'org' });

    await expectEnvelope(
      await call(`/api/v1/integrations/definitions/${id}/visibility`, minted.key, { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) }),
      401,
      'UNAUTHENTICATED',
    );
  });
});
