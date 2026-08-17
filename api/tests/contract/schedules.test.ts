/**
 * Schedules CONTRACT test: the full endpoint family through the REAL app, under BOTH admissions
 * the `user-or-key` class carries — a platform JWT and a REAL key minted through POST
 * /api/v1/gateway-keys — plus the revoked-key 401 and billing-locked 402 the class promises.
 * Every 2xx body validates against the shared schemas; every non-2xx against the shared error
 * envelope. The preview endpoint is exercised as the single occurrence-math truth, and run-now
 * + complete drive a manual task end to end over the wire.
 *
 * (The no-gate-checks-middleware gap is closed HERE by design: no CI gate verifies a
 * `user-or-key` descriptor actually mounts requireUserOrApiKey, so this suite probes both
 * admissions itself — the recon rule from api-key-middleware.test.ts:18-24.)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, gatewayKeys, activityLogs, schedules as schedulesStore, scheduleRuns, automations } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { stopScheduleSupervisor } from '../../src/schedules/supervisor.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  schedulesEndpoints,
  Schedule,
  ScheduleListResponse,
  ScheduleRunListResponse,
  ScheduleRunResponse,
  SchedulePreviewResponse,
  OkResponse,
  ErrorEnvelope,
} from '@ekoa/shared';

let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
// A fixed, DST-safe base instant; the fake clock ticks 1ms per call so ids/audits stay unique.
const BASE = Date.parse('2026-08-17T10:00:00.000Z');
const deps = { now: () => BASE + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

const VALID_BODY = {
  name: 'Relatório diário',
  target: { kind: 'manual', instructions: 'Rever os processos novos' },
  spec: { kind: 'recurring', rule: { every: 'day', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } },
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_schedules_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close();
  await stopScheduleSupervisor(); // drain in-flight fires BEFORE Mongo closes
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
  await automations.deleteMany({});
  await users.insert({ _id: 'usr', username: 'usr', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true } as never);
  setActivation('usr', { active: true, billingLocked: false });
  await userSettings.put({ _id: 'usr', memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
});

describe('schedules contract', () => {
  it('descriptors: the whole family is user-or-key under /api/v1/schedules', () => {
    for (const [name, d] of Object.entries(schedulesEndpoints)) {
      expect(d.auth, `schedules.${name}`).toBe('user-or-key');
      expect(d.path.startsWith('/api/v1/schedules'), `schedules.${name}`).toBe(true);
    }
    expect(schedulesEndpoints.create.successStatus).toBe(201);
    expect(schedulesEndpoints.runNow.successStatus).toBe(202);
  });

  it('JWT round trip: create (201) -> list -> get -> patch -> preview -> delete, all schema-valid', async () => {
    const t = await tokenFor('usr');
    const created = await authed('/api/v1/schedules', t, { method: 'POST', body: JSON.stringify(VALID_BODY) });
    expect(created.status).toBe(201);
    const sched: unknown = await created.json();
    expect(Schedule.safeParse(sched), JSON.stringify(sched)).toMatchObject({ success: true });
    const id = (sched as { id: string }).id;
    expect((sched as { enabled: boolean }).enabled).toBe(true);
    expect((sched as { nextRunAt: string | null }).nextRunAt).toBe('2026-08-18T08:00:00.000Z'); // 09:00 Lisbon summer = 08:00Z

    const list = await authed('/api/v1/schedules', t);
    expect(list.status).toBe(200);
    const listBody: unknown = await list.json();
    expect(ScheduleListResponse.safeParse(listBody), JSON.stringify(listBody)).toMatchObject({ success: true });
    expect((listBody as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(id);

    const got = await authed(`/api/v1/schedules/${id}`, t);
    expect(got.status).toBe(200);
    expect(Schedule.safeParse(await got.json()).success).toBe(true);

    const patched = await authed(`/api/v1/schedules/${id}`, t, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
    expect(patched.status).toBe(200);
    const patchedBody = (await patched.json()) as { enabled: boolean; nextRunAt: string | null };
    expect(Schedule.safeParse(patchedBody).success).toBe(true);
    expect(patchedBody.enabled).toBe(false);
    expect(patchedBody.nextRunAt).toBeNull(); // disabled → no planned fire

    const preview = await authed('/api/v1/schedules/preview', t, {
      method: 'POST',
      body: JSON.stringify({ spec: VALID_BODY.spec, count: 3 }),
    });
    expect(preview.status).toBe(200);
    const prevBody: unknown = await preview.json();
    expect(SchedulePreviewResponse.safeParse(prevBody), JSON.stringify(prevBody)).toMatchObject({ success: true });
    expect((prevBody as { occurrences: string[] }).occurrences).toEqual([
      '2026-08-18T08:00:00.000Z',
      '2026-08-19T08:00:00.000Z',
      '2026-08-20T08:00:00.000Z',
    ]);

    const del = await authed(`/api/v1/schedules/${id}`, t, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(OkResponse.safeParse(await del.json()).success).toBe(true);

    const gone = await authed(`/api/v1/schedules/${id}`, t);
    expect(gone.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await gone.json()).success).toBe(true);
  });

  it('REAL minted gateway key: create + list + run-now + complete a manual task, schema-valid', async () => {
    const t = await tokenFor('usr');
    const mintRes = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'schedules-ct' }) });
    expect(mintRes.status).toBe(201);
    const minted = (await mintRes.json()) as { key: string };
    expect(minted.key.startsWith('ekoa_gk_')).toBe(true);
    const keyed = (p: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${minted.key}`, 'x-client': 'claude-code', ...(init.headers ?? {}) } });

    const created = await keyed('/api/v1/schedules', { method: 'POST', body: JSON.stringify(VALID_BODY) });
    expect(created.status).toBe(201);
    const sched = (await created.json()) as { id: string; ownerId?: string };
    expect(Schedule.safeParse(sched).success).toBe(true);
    expect(sched.ownerId).toBe('usr'); // the key's OWNER, never a wider principal

    const ran = await keyed(`/api/v1/schedules/${sched.id}/run-now`, { method: 'POST', body: JSON.stringify({}) });
    expect(ran.status).toBe(202);
    const ranBody: unknown = await ran.json();
    expect(ScheduleRunResponse.safeParse(ranBody), JSON.stringify(ranBody)).toMatchObject({ success: true });
    const run = (ranBody as { run: { id: string; status: string; trigger: string } }).run;
    expect(run.status).toBe('pending'); // manual target → a task, not an execution
    expect(run.trigger).toBe('manual');

    const inbox = await keyed('/api/v1/schedules/runs?status=pending');
    expect(inbox.status).toBe(200);
    const inboxBody: unknown = await inbox.json();
    expect(ScheduleRunListResponse.safeParse(inboxBody), JSON.stringify(inboxBody)).toMatchObject({ success: true });
    expect((inboxBody as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(run.id);

    const done = await keyed(`/api/v1/schedules/runs/${run.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'done', note: 'Feito' }),
    });
    expect(done.status).toBe(200);
    const doneBody = (await done.json()) as { run: { status: string; note?: string; finishedAt?: string } };
    expect(ScheduleRunResponse.safeParse(doneBody).success).toBe(true);
    expect(doneBody.run.status).toBe('done');
    expect(doneBody.run.note).toBe('Feito');
    expect(doneBody.run.finishedAt).toBeDefined();

    const perSchedule = await keyed(`/api/v1/schedules/${sched.id}/runs`);
    expect(perSchedule.status).toBe(200);
    expect(ScheduleRunListResponse.safeParse(await perSchedule.json()).success).toBe(true);
  });

  it('validation refusals are envelope-shaped with the machine code in details', async () => {
    const t = await tokenFor('usr');
    // Zod-level: bad body.
    const bad = await authed('/api/v1/schedules', t, { method: 'POST', body: JSON.stringify({ name: '' }) });
    expect(bad.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);
    // Service-level cross-field: weekly without weekdays.
    const crossField = await authed('/api/v1/schedules', t, {
      method: 'POST',
      body: JSON.stringify({ ...VALID_BODY, spec: { kind: 'recurring', rule: { every: 'week', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Europe/Lisbon' } } }),
    });
    expect(crossField.status).toBe(400);
    const cf = (await crossField.json()) as { error: { details?: { code?: string } } };
    expect(ErrorEnvelope.safeParse(cf).success).toBe(true);
    expect(cf.error.details?.code).toBe('missing_weekdays');
    // Bad timezone.
    const badTz = await authed('/api/v1/schedules', t, {
      method: 'POST',
      body: JSON.stringify({ ...VALID_BODY, spec: { kind: 'recurring', rule: { every: 'day', interval: 1, at: { hour: 9, minute: 0 }, timezone: 'Not/AZone' } } }),
    });
    expect(badTz.status).toBe(400);
    expect(((await badTz.json()) as { error: { details?: { code?: string } } }).error.details?.code).toBe('invalid_timezone');
    // A once instant in the past.
    const past = await authed('/api/v1/schedules', t, {
      method: 'POST',
      body: JSON.stringify({ ...VALID_BODY, spec: { kind: 'once', at: '2020-01-01T00:00:00.000Z' } }),
    });
    expect(past.status).toBe(400);
    expect(((await past.json()) as { error: { details?: { code?: string } } }).error.details?.code).toBe('at_in_past');
    // An automation target the actor does not own.
    const foreign = await authed('/api/v1/schedules', t, {
      method: 'POST',
      body: JSON.stringify({ ...VALID_BODY, target: { kind: 'automation', automationId: 'nope' } }),
    });
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: { details?: { code?: string } } }).error.details?.code).toBe('unknown_automation');
  });

  it('admission: no token 401; revoked key 401 (uniform); billing-locked owner 402', async () => {
    const bare = await fetch(`http://127.0.0.1:${port}/api/v1/schedules`);
    expect(bare.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await bare.json()).success).toBe(true);

    const t = await tokenFor('usr');
    const mintRes = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'to-revoke' }) });
    const minted = (await mintRes.json()) as { id: string; key: string };
    const revoke = await authed(`/api/v1/gateway-keys/${minted.id}/revoke`, t, { method: 'POST', body: JSON.stringify({}) });
    expect([200, 204]).toContain(revoke.status);
    const refused = await fetch(`http://127.0.0.1:${port}/api/v1/schedules`, { headers: { authorization: `Bearer ${minted.key}` } });
    expect(refused.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await refused.json()).success).toBe(true);

    const mint2 = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'locked' }) });
    const key2 = ((await mint2.json()) as { key: string }).key;
    setActivation('usr', { active: true, billingLocked: true });
    const locked = await fetch(`http://127.0.0.1:${port}/api/v1/schedules`, { headers: { authorization: `Bearer ${key2}` } });
    expect(locked.status).toBe(402);
    expect(ErrorEnvelope.safeParse(await locked.json()).success).toBe(true);
  });

  it('run-now on an executing target answers 202 with a running run', async () => {
    const t = await tokenFor('usr');
    // An automation the actor owns (the run itself will fail downstream — the engine is not
    // seeded — but the WIRE contract is the 202 + `running`, and the failure lands on the run
    // row asynchronously, which is exactly the design).
    await automations.insert({ _id: 'auto1', name: 'A', ownerUserId: 'usr', orgId: 'orgA', plan: { steps: [] }, status: 'ready', visibility: 'private', createdAt: 'x', updatedAt: 'x' } as never);
    const created = await authed('/api/v1/schedules', t, {
      method: 'POST',
      body: JSON.stringify({ ...VALID_BODY, name: 'Auto', target: { kind: 'automation', automationId: 'auto1' } }),
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    const ran = await authed(`/api/v1/schedules/${id}/run-now`, t, { method: 'POST', body: JSON.stringify({}) });
    expect(ran.status).toBe(202);
    const body = (await ran.json()) as { run: { status: string } };
    expect(ScheduleRunResponse.safeParse(body).success).toBe(true);
    expect(body.run.status).toBe('running');
  });
});
