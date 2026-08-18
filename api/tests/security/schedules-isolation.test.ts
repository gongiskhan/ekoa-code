/**
 * Schedules ISOLATION suite (Capability Contract rule 5 — the memvault-isolation class):
 * schedules hold per-user state, so cross-tenant reach is attacked through the REAL app and
 * must fail CLOSED with NO existence oracle:
 *  - a peer (same org, plain user) cannot read/patch/delete/run-now/list another user's
 *    schedule or complete their task — every refusal is a 404 BYTE-IDENTICAL to plain-missing;
 *  - a FOREIGN-ORG admin sees nothing of org A, under a JWT and under a REAL gateway key;
 *  - an org-admin of the SAME org may SEE a member's schedule but may NOT mutate it
 *    (visibility is admin-wide, authority is owner-only);
 *  - list surfaces never leak: the peer's and the foreign admin's lists are empty of the
 *    victim's rows; the run feed is equally scoped;
 *  - a gateway key is exactly its owner: key-admitted probes answer identically to the
 *    owner's JWT probes, and a foreign owner's key gets the uniform 404.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, gatewayKeys, activityLogs, schedules as schedulesStore, scheduleRuns } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { stopScheduleSupervisor } from '../../src/schedules/supervisor.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const BASE = Date.parse('2026-08-17T10:00:00.000Z');
const deps = { now: () => BASE + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

const VALID_BODY = {
  name: 'Privado da vítima',
  target: { kind: 'manual', instructions: 'segredo do processo X' },
  spec: { kind: 'recurring', rule: { every: 'day', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_schedules_isolation');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close();
  await stopScheduleSupervisor();
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  __resetCapabilityRateForTests();
  await users.deleteMany({});
  await userSettings.deleteMany({});
  await gatewayKeys.deleteMany({});
  await activityLogs.deleteMany({});
  await schedulesStore.deleteMany({});
  await scheduleRuns.deleteMany({});
  const mk = async (id: string, role: string, orgId: string) => {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true } as never);
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  };
  await mk('victim', 'user', 'orgA');
  await mk('peer', 'user', 'orgA');
  await mk('orgadmin', 'org-admin', 'orgA');
  await mk('foreignadmin', 'org-admin', 'orgB');
});

/** Create a schedule + a pending task as the victim; answer ids + the victim's plain-missing
 *  404 body (the byte-identity reference for every cross-tenant refusal). */
async function seedVictim(): Promise<{ scheduleId: string; runId: string; missing404: string }> {
  const t = await tokenFor('victim');
  const created = await authed('/api/v1/schedules', t, { method: 'POST', body: JSON.stringify(VALID_BODY) });
  expect(created.status).toBe(201);
  const scheduleId = ((await created.json()) as { id: string }).id;
  const ran = await authed(`/api/v1/schedules/${scheduleId}/run-now`, t, { method: 'POST', body: JSON.stringify({}) });
  expect(ran.status).toBe(202);
  const runId = ((await ran.json()) as { run: { id: string } }).run.id;
  const missing = await authed('/api/v1/schedules/definitely-missing', t);
  expect(missing.status).toBe(404);
  return { scheduleId, runId, missing404: await missing.text() };
}

describe('schedules isolation (Rule 5, memvault class)', () => {
  it('a same-org PEER: every read and every mutation answers the uniform 404, byte-identical to missing', async () => {
    const { scheduleId, runId, missing404 } = await seedVictim();
    const p = await tokenFor('peer');
    const probes: Array<[string, RequestInit]> = [
      [`/api/v1/schedules/${scheduleId}`, {}],
      [`/api/v1/schedules/${scheduleId}`, { method: 'PATCH', body: JSON.stringify({ name: 'roubado' }) }],
      [`/api/v1/schedules/${scheduleId}`, { method: 'DELETE' }],
      [`/api/v1/schedules/${scheduleId}/run-now`, { method: 'POST', body: JSON.stringify({}) }],
      [`/api/v1/schedules/${scheduleId}/runs`, {}],
      [`/api/v1/schedules/runs/${runId}/complete`, { method: 'POST', body: JSON.stringify({ outcome: 'done' }) }],
    ];
    for (const [path, init] of probes) {
      const res = await authed(path, p, init);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe(missing404); // byte-identical → no existence oracle
    }
    // And nothing changed for the victim.
    const t = await tokenFor('victim');
    const still = await authed(`/api/v1/schedules/${scheduleId}`, t);
    expect(still.status).toBe(200);
    expect(((await still.json()) as { name: string }).name).toBe(VALID_BODY.name);
  });

  it('a FOREIGN-ORG admin (JWT and REAL gateway key): empty lists, uniform 404 probes', async () => {
    const { scheduleId, runId, missing404 } = await seedVictim();
    const f = await tokenFor('foreignadmin');
    // JWT probes.
    for (const path of [`/api/v1/schedules/${scheduleId}`, `/api/v1/schedules/${scheduleId}/runs`]) {
      const res = await authed(path, f);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe(missing404);
    }
    const list = await authed('/api/v1/schedules', f);
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(0);
    const feed = await authed('/api/v1/schedules/runs', f);
    expect(((await feed.json()) as { items: unknown[] }).items).toHaveLength(0);
    // The same reach through a REAL key minted by the foreign admin.
    const mint = await authed('/api/v1/gateway-keys', f, { method: 'POST', body: JSON.stringify({ label: 'foreign' }) });
    const key = ((await mint.json()) as { key: string }).key;
    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
    const keyGet = await keyed(`/api/v1/schedules/${scheduleId}`);
    expect(keyGet.status).toBe(404);
    expect(await keyGet.text()).toBe(missing404);
    const keyComplete = await keyed(`/api/v1/schedules/runs/${runId}/complete`, { method: 'POST', body: JSON.stringify({ outcome: 'done' }) });
    expect(keyComplete.status).toBe(404);
    const keyList = await keyed('/api/v1/schedules');
    expect(((await keyList.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it('a SAME-org admin sees but cannot mutate: visibility is admin-wide, authority owner-only', async () => {
    const { scheduleId, runId, missing404 } = await seedVictim();
    const a = await tokenFor('orgadmin');
    const seen = await authed(`/api/v1/schedules/${scheduleId}`, a);
    expect(seen.status).toBe(200); // org-admin MAY see (the automations listRuns precedent)
    const list = await authed('/api/v1/schedules', a);
    expect(((await list.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(scheduleId);
    // ...but may not aim the member's authority.
    for (const [path, init] of [
      [`/api/v1/schedules/${scheduleId}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) }],
      [`/api/v1/schedules/${scheduleId}`, { method: 'DELETE' }],
      [`/api/v1/schedules/${scheduleId}/run-now`, { method: 'POST', body: JSON.stringify({}) }],
      [`/api/v1/schedules/runs/${runId}/complete`, { method: 'POST', body: JSON.stringify({ outcome: 'done' }) }],
    ] as Array<[string, RequestInit]>) {
      const res = await authed(path, a, init);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe(missing404);
    }
  });

  it('LIST surfaces narrow to the owner: a same-org PEER sees only their own schedules and runs', async () => {
    const { scheduleId, runId } = await seedVictim();
    // The peer owns rows of their own, so an assertion cannot be satisfied by an accidentally
    // empty answer: the claim is "mine, and ONLY mine" - a broken list surface fails too.
    const p = await tokenFor('peer');
    const PEER_BODY = { ...VALID_BODY, name: 'Do peer', target: { kind: 'manual', instructions: 'assunto do peer' } };
    const own = await authed('/api/v1/schedules', p, { method: 'POST', body: JSON.stringify(PEER_BODY) });
    expect(own.status).toBe(201);
    const peerScheduleId = ((await own.json()) as { id: string }).id;
    const peerRan = await authed(`/api/v1/schedules/${peerScheduleId}/run-now`, p, { method: 'POST', body: JSON.stringify({}) });
    expect(peerRan.status).toBe(202);
    const peerRunId = ((await peerRan.json()) as { run: { id: string } }).run.id;

    // The collection surface is guarded by the OWNER narrowing in listSchedules - not by
    // canSeeSchedule, which never runs on a list. Assert on the victim's specific id.
    const listRes = await authed('/api/v1/schedules', p);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { items: Array<{ id: string; ownerId: string; orgId: string }> };
    expect(list.items.map((i) => i.id)).toEqual([peerScheduleId]);
    expect(list.items.map((i) => i.id)).not.toContain(scheduleId);
    expect(new Set(list.items.map((i) => i.ownerId))).toEqual(new Set(['peer']));
    // `target.instructions` is free text the victim typed - no projection of it may reach a peer.
    expect(JSON.stringify(list.items)).not.toContain(VALID_BODY.target.instructions);
    expect(JSON.stringify(list.items)).not.toContain(VALID_BODY.name);

    // Same for the org run feed (listRunsForActor carries its OWN narrowing).
    const feedRes = await authed('/api/v1/schedules/runs', p);
    expect(feedRes.status).toBe(200);
    const feed = (await feedRes.json()) as { items: Array<{ id: string; scheduleId: string; ownerId: string }> };
    expect(feed.items.map((i) => i.id)).toEqual([peerRunId]);
    expect(feed.items.map((i) => i.id)).not.toContain(runId);
    expect(feed.items.map((i) => i.scheduleId)).not.toContain(scheduleId);
    expect(new Set(feed.items.map((i) => i.ownerId))).toEqual(new Set(['peer']));
    // The status filter is not a way around the narrowing either (both rows are `pending`).
    const pending = (await (await authed('/api/v1/schedules/runs?status=pending', p)).json()) as { items: Array<{ id: string }> };
    expect(pending.items.map((i) => i.id)).toEqual([peerRunId]);

    // The narrowing is deliberately admin-exempt, and that exemption is what PROVES the peer's
    // answers above are narrowing rather than an empty collection: the same two feeds, read by
    // the org-admin, carry BOTH members' rows.
    const a = await tokenFor('orgadmin');
    const adminList = (await (await authed('/api/v1/schedules', a)).json()) as { items: Array<{ id: string }> };
    expect(adminList.items.map((i) => i.id).sort()).toEqual([scheduleId, peerScheduleId].sort());
    const adminFeed = (await (await authed('/api/v1/schedules/runs', a)).json()) as { items: Array<{ id: string }> };
    expect(adminFeed.items.map((i) => i.id).sort()).toEqual([runId, peerRunId].sort());
  });

  it('concurrent two-tenant writes never bleed', async () => {
    const tV = await tokenFor('victim');
    const tF = await tokenFor('foreignadmin');
    const mk = (t: string, name: string) =>
      authed('/api/v1/schedules', t, { method: 'POST', body: JSON.stringify({ ...VALID_BODY, name }) });
    const results = await Promise.all([mk(tV, 'A1'), mk(tF, 'B1'), mk(tV, 'A2'), mk(tF, 'B2')]);
    for (const r of results) expect(r.status).toBe(201);
    const listV = (await (await authed('/api/v1/schedules', tV)).json()) as { items: Array<{ name: string; orgId?: string }> };
    const listF = (await (await authed('/api/v1/schedules', tF)).json()) as { items: Array<{ name: string; orgId?: string }> };
    expect(listV.items.map((i) => i.name).sort()).toEqual(['A1', 'A2']);
    expect(listF.items.map((i) => i.name).sort()).toEqual(['B1', 'B2']);
    expect(new Set(listV.items.map((i) => i.orgId))).toEqual(new Set(['orgA']));
    expect(new Set(listF.items.map((i) => i.orgId))).toEqual(new Set(['orgB']));
  });
});
