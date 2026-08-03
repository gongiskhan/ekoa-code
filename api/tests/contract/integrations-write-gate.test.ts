import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, integrationDefinitions, approvedIntegrationActions } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { integrationDefinitionStore } from '../../src/integrations/definition-store.js';
import {
  ErrorEnvelope,
  IntegrationActionApprovalListResponse,
  ApproveIntegrationActionResponse,
  RevokeIntegrationActionApprovalResponse,
  integrationsEndpoints,
} from '@ekoa/shared';
import type { IntegrationAction } from '../../src/integrations/definitions.js';

/**
 * Slice C2 — the WRITE GATE's HTTP surface, exercised through the REAL app.
 *
 * The three routes are a thin shell over `integrations/action-consent.ts`; the GATE itself is in
 * `executeUserIntegrationAction` and is pinned by `tests/integrations/action-consent.test.ts` and
 * `tests/security/integration-write-gate.test.ts`. What a SHELL can get wrong is what this suite
 * pins: which state becomes which status, that the acting tenant is the JWT and never the body or
 * the path, that a definition the caller cannot see is a byte-identical 404 rather than an
 * existence oracle, and that every non-2xx is the shared error envelope.
 *
 * Everything runs against `buildApp` on a real socket with a real login, so a route left unmounted
 * or mounted without `requireAuth` fails here rather than passing against a handler stub.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const HOST = 'https://writes.example';
const KEY = 'c2-gate-probe';
const writeAction: IntegrationAction = {
  actionName: 'send_message', description: 'Enviar mensagem', mutates: true,
  httpConfig: { method: 'POST', baseUrl: HOST, path: '/messages' },
};
const readAction: IntegrationAction = {
  actionName: 'list_things', description: 'Listar coisas', mutates: false,
  httpConfig: { method: 'GET', baseUrl: HOST, path: '/things' },
};

const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, t: string | null, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) },
  });

const listApprovals = (t: string, key = KEY) => api(`/api/v1/integrations/${key}/action-approvals`, t);
const approve = (t: string, action: string, body: unknown, key = KEY) =>
  api(`/api/v1/integrations/${key}/actions/${action}/approval`, t, { method: 'POST', body: JSON.stringify(body) });
const revoke = (t: string, action: string, key = KEY) =>
  api(`/api/v1/integrations/${key}/actions/${action}/approval`, t, { method: 'DELETE' });

async function expectEnvelope(res: Response, status: number, code: string): Promise<void> {
  expect(res.status).toBe(status);
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, `non-2xx body must validate against ErrorEnvelope: ${JSON.stringify(body)}`).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
}

async function mkUser(id: string, orgId: string, role: 'super-admin' | 'org-admin' | 'user') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
  setActivation(id, { active: true, billingLocked: false });
}

async function seed(actions: IntegrationAction[], visibility: 'private' | 'org' = 'private') {
  await integrationDefinitionStore.create(
    {
      orgId: 'orgA', userId: 'ownerA', visibility, key: KEY,
      displayName: 'C2 Gate Probe', configSchema: [], actions, skillMd: '# probe', authType: 'none',
    },
    { actor: { userId: 'ownerA', orgId: 'orgA', role: 'user' }, onConflict: 'replace' },
  );
}

/** The shape the server currently reports for an action — the client always echoes this back. */
async function shapeOf(t: string, actionName: string): Promise<string> {
  const body = (await (await listApprovals(t)).json()) as { items: Array<{ actionName: string; shape: string }> };
  return body.items.find((i) => i.actionName === actionName)!.shape;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_c2_write_gate');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests();
  for (const s of [users, integrationDefinitions, approvedIntegrationActions]) await s.deleteMany({});
  await mkUser('ownerA', 'orgA', 'user');
  await mkUser('peerA', 'orgA', 'user');
  await mkUser('ownerB', 'orgB', 'user');
  await seed([readAction, writeAction]);
});

describe('GET /:key/action-approvals', () => {
  it('lists every action with its target, shape and (initially null) decision — schema-valid', async () => {
    const t = await tokenFor('ownerA');
    const res = await listApprovals(t);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(IntegrationActionApprovalListResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);

    const items = (body as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((i) => i.actionName).sort()).toEqual(['list_things', 'send_message']);
    const write = items.find((i) => i.actionName === 'send_message')!;
    expect(write.requiresConsent).toBe(true);
    expect(write.target).toBe(`POST ${HOST}/messages`);
    expect(write.decision).toBeNull();
    expect(write.expiresAt).toBeNull();
    // A READ is listed and flagged as needing nothing — "no permission required" and "not yet
    // asked" must be distinguishable in the UI, which an omitted row would not be.
    const read = items.find((i) => i.actionName === 'list_things')!;
    expect(read.requiresConsent).toBe(false);
    expect(read.decision).toBeNull();
  });

  it('reflects a granted approval, and stops reflecting it after a revoke', async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'send_message');
    expect((await approve(t, 'send_message', { decision: 'always', shape })).status).toBe(200);

    const granted = (await (await listApprovals(t)).json()) as { items: Array<Record<string, unknown>> };
    const row = granted.items.find((i) => i.actionName === 'send_message')!;
    expect(row.decision).toBe('always');
    expect(typeof row.expiresAt).toBe('string');

    expect((await revoke(t, 'send_message')).status).toBe(200);
    const after = (await (await listApprovals(t)).json()) as { items: Array<Record<string, unknown>> };
    expect(after.items.find((i) => i.actionName === 'send_message')!.decision).toBeNull();
  });

  it('a definition the caller cannot see is a 404, byte-identical with one that does not exist', async () => {
    const other = await tokenFor('ownerB');
    const hidden = await listApprovals(other);           // orgB cannot see orgA's private row
    const missing = await listApprovals(other, 'nothing-at-all');
    expect(hidden.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await hidden.text()).toBe(await missing.text());
  });

  it('unauthenticated is 401 with the shared envelope', async () => {
    await expectEnvelope(await listApprovals(null as unknown as string), 401, 'UNAUTHENTICATED');
  });
});

describe('POST /:key/actions/:actionName/approval', () => {
  it('grants an approval and echoes the decision + expiry — schema-valid', async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'send_message');
    const res = await approve(t, 'send_message', { decision: 'always', shape });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ApproveIntegrationActionResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect((body as { decision: string }).decision).toBe('always');
    // The row is the ACTOR's, off the JWT — never a body or path field.
    const rows = (await approvedIntegrationActions.find({})) as unknown as Array<{ orgId: string; userId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ orgId: 'orgA', userId: 'ownerA' });
  });

  it('refuses a STALE shape — the answer must be about the action the human was shown', async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'send_message');
    // The action is re-authored between render and click.
    await seed([readAction, { ...writeAction, httpConfig: { ...writeAction.httpConfig!, path: '/messages/v2' } }]);
    await expectEnvelope(await approve(t, 'send_message', { decision: 'always', shape }), 400, 'VALIDATION_FAILED');
    expect(await approvedIntegrationActions.find({})).toHaveLength(0);
  });

  it('refuses to approve a NON-MUTATING action — a read must not gain a standing permission row', async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'list_things');
    await expectEnvelope(await approve(t, 'list_things', { decision: 'always', shape }), 400, 'VALIDATION_FAILED');
    expect(await approvedIntegrationActions.find({})).toHaveLength(0);
  });

  it('a malformed body is a 400 VALIDATION_FAILED (decision outside the enum, missing shape)', async () => {
    const t = await tokenFor('ownerA');
    await expectEnvelope(await approve(t, 'send_message', { decision: 'forever', shape: 'x' }), 400, 'VALIDATION_FAILED');
    await expectEnvelope(await approve(t, 'send_message', { decision: 'always' }), 400, 'VALIDATION_FAILED');
  });

  it('an unknown ACTION on a visible integration is a 404, byte-identical with an unknown integration', async () => {
    const t = await tokenFor('ownerA');
    const unknownAction = await approve(t, 'no-such-action', { decision: 'always', shape: 'x' });
    const unknownKey = await approve(t, 'send_message', { decision: 'always', shape: 'x' }, 'no-such-integration');
    expect(unknownAction.status).toBe(404);
    expect(await unknownAction.text()).toBe(await unknownKey.text());
  });

  it("another tenant cannot approve this tenant's action, and gets no existence signal", async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'send_message');
    const other = await tokenFor('ownerB');
    const res = await approve(other, 'send_message', { decision: 'always', shape });
    expect(res.status).toBe(404);
    expect(await approvedIntegrationActions.find({})).toHaveLength(0);
  });

  it('a same-org PEER approving an org-shared action banks their OWN approval, not the owner\'s', async () => {
    await seed([readAction, writeAction], 'org');
    const owner = await tokenFor('ownerA');
    const peer = await tokenFor('peerA');
    const shape = await shapeOf(owner, 'send_message');
    expect((await approve(peer, 'send_message', { decision: 'always', shape })).status).toBe(200);

    const rows = (await approvedIntegrationActions.find({})) as unknown as Array<{ userId: string }>;
    expect(rows.map((r) => r.userId)).toEqual(['peerA']);
    // …and the owner still has none: an approval is per-human, and the list proves it per-caller.
    const ownerList = (await (await listApprovals(owner)).json()) as { items: Array<Record<string, unknown>> };
    expect(ownerList.items.find((i) => i.actionName === 'send_message')!.decision).toBeNull();
  });
});

describe('DELETE /:key/actions/:actionName/approval', () => {
  it('revokes every decision and every past shape the caller holds for that action', async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'send_message');
    await approve(t, 'send_message', { decision: 'always', shape });
    await approve(t, 'send_message', { decision: 'once', shape });
    // …plus a row from an OLDER shape of the same action (re-authored since).
    await seed([readAction, { ...writeAction, httpConfig: { ...writeAction.httpConfig!, path: '/v2' } }]);
    await approve(t, 'send_message', { decision: 'always', shape: await shapeOf(t, 'send_message') });
    expect(await approvedIntegrationActions.find({})).toHaveLength(3);

    const res = await revoke(t, 'send_message');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(RevokeIntegrationActionApprovalResponse.safeParse(body).success, JSON.stringify(body)).toBe(true);
    expect((body as { revoked: number }).revoked).toBe(3);
    expect(await approvedIntegrationActions.find({})).toHaveLength(0);
  });

  it('revokes only the CALLER\'s rows — a peer\'s standing approval survives', async () => {
    await seed([readAction, writeAction], 'org');
    const owner = await tokenFor('ownerA');
    const peer = await tokenFor('peerA');
    const shape = await shapeOf(owner, 'send_message');
    await approve(owner, 'send_message', { decision: 'always', shape });
    await approve(peer, 'send_message', { decision: 'always', shape });

    expect((await (await revoke(owner, 'send_message')).json() as { revoked: number }).revoked).toBe(1);
    const left = (await approvedIntegrationActions.find({})) as unknown as Array<{ userId: string }>;
    expect(left.map((r) => r.userId)).toEqual(['peerA']);
  });

  it('revoking an action that no longer exists still works — a user must be able to withdraw permission from a deleted action', async () => {
    const t = await tokenFor('ownerA');
    const shape = await shapeOf(t, 'send_message');
    await approve(t, 'send_message', { decision: 'always', shape });
    await seed([readAction]); // the write is gone from the definition
    expect((await (await revoke(t, 'send_message')).json() as { revoked: number }).revoked).toBe(1);
  });
});

describe('descriptors', () => {
  it('the three write-gate endpoints are declared `user` — never `user-or-key`', () => {
    // A gateway key is an agent. If any of these were `user-or-key`, an agent refused at the
    // execution gate could approve itself with the shape it was just handed and retry.
    for (const name of ['listActionApprovals', 'approveAction', 'revokeActionApproval'] as const) {
      expect(integrationsEndpoints[name].auth, `${name} must be user-only`).toBe('user');
    }
    expect(integrationsEndpoints.approveAction.method).toBe('POST');
    expect(integrationsEndpoints.revokeActionApproval.method).toBe('DELETE');
    expect(integrationsEndpoints.approveAction.path).toBe(integrationsEndpoints.revokeActionApproval.path);
  });
});
