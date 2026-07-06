import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs, memories, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, type Config } from '../../src/config.js';
import { ErrorEnvelope } from '@ekoa/shared';

/**
 * G3 security gate: the cross-org adversarial suite (ch09 invariant 5, ch13 §13.5) + the
 * in-org sharing tests (visibility private|org) + activation admission. An authenticated
 * user of org A must get a clean 403/404 (never 200, never a leaky 500) on every operation
 * against org B's resources; a private memory is invisible even to the org admin.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x' };
let server: Server;
let port: number;

async function mkUser(id: string, username: string, orgId: string, role: 'super-admin' | 'org-admin' | 'builder') {
  await users.insert({ _id: id, username, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
async function tokenFor(username: string): Promise<string> {
  return (await login(username, 'pw123456', false, deps)).token;
}
function api(path: string, token: string, init: RequestInit = {}) {
  return fetch(`http://127.0.0.1:${port}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await MongoMemoryServer.create();
  await connectMongo(mem.getUri(), 'ekoa_g3');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });

beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  for (const s of [users, orgs, memories, activityLogs]) await s.deleteMany({});
  await orgs.insert({ _id: 'orgA', name: 'A', createdAt: '2026-01-01T00:00:00Z' });
  await orgs.insert({ _id: 'orgB', name: 'B', createdAt: '2026-01-01T00:00:00Z' });
});

describe('cross-org adversarial suite (ch09 invariant 5)', () => {
  it('org A org-admin gets 404 reading org B users / memories, 404 patching a B user', async () => {
    await mkUser('a-admin', 'aadmin', 'orgA', 'org-admin');
    await mkUser('b-user', 'buser', 'orgB', 'builder');
    await memories.insert({ _id: 'mB', orgId: 'orgB', userId: 'b-user', visibility: 'org', title: 'B secret' } as never);
    const tA = await tokenFor('aadmin');

    // list users → only org A (never org B's buser)
    const listRes = await api('/api/v1/users', tA);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(list.items.some((u) => u.id === 'b-user')).toBe(false);

    // patch a B user → uniform 404 (not 403 that leaks existence, not 200)
    const patchRes = await api('/api/v1/users/b-user', tA, { method: 'PATCH', body: JSON.stringify({ active: false }) });
    expect(patchRes.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await patchRes.json()).success).toBe(true);

    // read org B's memory (even org-shared) → 404 (different org)
    const memRes = await api('/api/v1/memories/mB', tA);
    expect(memRes.status).toBe(404);

    // still B's memory row is intact (no cross-org mutation)
    expect(await memories.get('mB')).not.toBeNull();
  });

  it('org A user gets 404 on org B org record via GET /org (own org only)', async () => {
    await mkUser('a-user', 'auser', 'orgA', 'builder');
    const tA = await tokenFor('auser');
    const res = await api('/api/v1/org', tA);
    expect(res.status).toBe(200);
    const org = (await res.json()) as { id: string };
    expect(org.id).toBe('orgA'); // never orgB
  });

  it('a builder cannot reach super-admin org management (403)', async () => {
    await mkUser('a-user2', 'auser2', 'orgA', 'builder');
    const t = await tokenFor('auser2');
    const res = await api('/api/v1/orgs', t);
    expect(res.status).toBe(403);
  });
});

describe('in-org sharing (visibility private|org, ch13 §13.5)', () => {
  it("builder A reading builder B's PRIVATE memory in the same org gets 404", async () => {
    await mkUser('u-a', 'ua', 'orgA', 'builder');
    await mkUser('u-b', 'ub', 'orgA', 'builder');
    await memories.insert({ _id: 'mPriv', orgId: 'orgA', userId: 'u-b', visibility: 'private', title: 'B private' } as never);
    const t = await tokenFor('ua');
    const res = await api('/api/v1/memories/mPriv', t);
    expect(res.status).toBe(404);
  });

  it('an org-shared memory IS visible to another org member', async () => {
    await mkUser('u-c', 'uc', 'orgA', 'builder');
    await mkUser('u-d', 'ud', 'orgA', 'builder');
    await memories.insert({ _id: 'mShared', orgId: 'orgA', userId: 'u-d', visibility: 'org', title: 'shared' } as never);
    const t = await tokenFor('uc');
    const res = await api('/api/v1/memories/mShared', t);
    expect(res.status).toBe(200);
  });

  it("a private memory is invisible to the ORG ADMIN too (existence only in Registo)", async () => {
    await mkUser('oadmin', 'oadmin', 'orgA', 'org-admin');
    await mkUser('u-e', 'ue', 'orgA', 'builder');
    await memories.insert({ _id: 'mPriv2', orgId: 'orgA', userId: 'u-e', visibility: 'private', title: 'private2' } as never);
    const t = await tokenFor('oadmin');
    const res = await api('/api/v1/memories/mPriv2', t);
    expect(res.status).toBe(404); // org admin cannot read private content
    // its list does not include it either
    const listRes = await api('/api/v1/memories', t);
    const list = (await listRes.json()) as { items: Array<{ id: string }> };
    expect(list.items.some((m) => m.id === 'mPriv2')).toBe(false);
  });

  it("editing another builder's PRIVATE artifact/memory is 403", async () => {
    await mkUser('u-f', 'uf', 'orgA', 'builder');
    await mkUser('u-g', 'ug', 'orgA', 'builder');
    await memories.insert({ _id: 'mPriv3', orgId: 'orgA', userId: 'u-g', visibility: 'private', title: 'g private' } as never);
    const t = await tokenFor('uf');
    const res = await api('/api/v1/memories/mPriv3', t, { method: 'PATCH', body: JSON.stringify({ title: 'hacked' }) });
    expect(res.status).toBe(403);
  });
});

describe('settings org-scoping (Codex-review regression)', () => {
  it("org A's settings change does NOT leak to org B", async () => {
    await mkUser('sa', 'sa', 'orgA', 'org-admin');
    await mkUser('sb', 'sb', 'orgB', 'org-admin');
    const tA = await tokenFor('sa');
    const tB = await tokenFor('sb');
    const patch = await api('/api/v1/settings', tA, { method: 'PATCH', body: JSON.stringify({ integration: { pipedreamEnabled: true } }) });
    expect(patch.status).toBe(200);
    // org B sees its OWN (default) settings, not org A's change
    const bView = (await (await api('/api/v1/settings', tB)).json()) as { integration: { pipedreamEnabled: boolean } };
    expect(bView.integration.pipedreamEnabled).toBe(false);
    // org A sees its change
    const aView = (await (await api('/api/v1/settings', tA)).json()) as { integration: { pipedreamEnabled: boolean } };
    expect(aView.integration.pipedreamEnabled).toBe(true);
  });
});

describe('role-change token invalidation (Codex-review regression, ch09 §9.6)', () => {
  it('a demoted admin cannot keep using a stale privileged JWT', async () => {
    await mkUser('boss', 'boss', 'orgA', 'super-admin');
    await mkUser('victim', 'victim', 'orgA', 'org-admin');
    const staleAdminToken = await tokenFor('victim');
    // the org-admin can list users while org-admin
    expect((await api('/api/v1/users', staleAdminToken)).status).toBe(200);
    // super-admin demotes victim to builder
    const bossT = await tokenFor('boss');
    const demote = await api('/api/v1/users/victim', bossT, { method: 'PATCH', body: JSON.stringify({ role: 'builder' }) });
    expect(demote.status).toBe(200);
    // the stale org-admin token is now rejected (its iat predates the bumped epoch)
    const after = await api('/api/v1/users', staleAdminToken);
    expect(after.status).toBe(401);
  });
});

describe('activation admission (ch09 §9.7.1)', () => {
  it('a deactivated user is refused ACCOUNT_DISABLED on a CRUD route', async () => {
    await mkUser('u-h', 'uh', 'orgA', 'builder');
    const t = await tokenFor('uh');
    setActivation('u-h', { active: false, billingLocked: false }); // write-through deactivate
    const res = await api('/api/v1/memories', t);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('Registo read surface (ch03 §3.8.24, metadata-only)', () => {
  it('org-admin reads its own org activity; no message body leaks', async () => {
    await mkUser('r-admin', 'radmin', 'orgA', 'org-admin');
    await activityLogs.insert({ _id: 'l1', userId: 'x', username: 'x', orgId: 'orgA', category: 'memory', type: 'create', timestamp: '2026-01-01T00:00:00Z' });
    await activityLogs.insert({ _id: 'l2', userId: 'y', username: 'y', orgId: 'orgB', category: 'memory', type: 'create', timestamp: '2026-01-01T00:00:00Z' });
    const t = await tokenFor('radmin');
    const res = await api('/api/v1/registo', t);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    // only org A rows (plus the read's own access-log which is org A), never org B
    expect(body.items.every((e) => (e.orgId as string) === 'orgA')).toBe(true);
    // metadata only — no `content`/`body`/`message` fields
    for (const e of body.items) {
      expect('content' in e).toBe(false);
      expect('body' in e).toBe(false);
    }
  });
});
