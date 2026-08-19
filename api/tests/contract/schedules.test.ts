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

  it('per-schedule runs honour the DECLARED status filter, not just the limit', async () => {
    // `listRuns` declares `query: ScheduleRunListQuery`, which carries `status` AND `limit`. A
    // client that filters and silently gets everything cannot tell the difference from a
    // schedule whose runs really are all in that status, so the filter is asserted against a
    // history holding BOTH statuses.
    const t = await tokenFor('usr');
    const created = await authed('/api/v1/schedules', t, { method: 'POST', body: JSON.stringify(VALID_BODY) });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const fire = async (): Promise<string> => {
      const res = await authed(`/api/v1/schedules/${id}/run-now`, t, { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(202);
      return ((await res.json()) as { run: { id: string } }).run.id;
    };
    const completed = await fire();
    const stillPending = await fire();
    const done = await authed(`/api/v1/schedules/runs/${completed}/complete`, t, {
      method: 'POST',
      body: JSON.stringify({ outcome: 'done' }),
    });
    expect(done.status).toBe(200);

    const idsOf = async (query: string): Promise<string[]> => {
      const res = await authed(`/api/v1/schedules/${id}/runs${query}`, t);
      expect(res.status).toBe(200);
      const body: unknown = await res.json();
      expect(ScheduleRunListResponse.safeParse(body), JSON.stringify(body)).toMatchObject({ success: true });
      return (body as { items: Array<{ id: string }> }).items.map((i) => i.id);
    };

    expect((await idsOf('')).sort()).toEqual([completed, stillPending].sort());
    expect(await idsOf('?status=pending')).toEqual([stillPending]);
    expect(await idsOf('?status=done')).toEqual([completed]);
    expect(await idsOf('?status=failed')).toEqual([]);
    // The limit caps the FILTERED rows, so a status with one row survives a limit of one.
    expect(await idsOf('?status=done&limit=1')).toEqual([completed]);
  });

  it('preview anchors on an existing schedule, so the edit dialog shows what the supervisor fires', async () => {
    const t = await tokenFor('usr');
    // A 5-hour stride counts from the schedule's CREATION, not from the moment someone opens the
    // edit dialog. Seeded directly so the anchor (07:32Z) is genuinely older than the request
    // instant (BASE, 10:00Z) - the exact case a request-anchored preview got wrong.
    const spec = { kind: 'recurring', rule: { every: 'hour', interval: 5, timezone: 'Europe/Lisbon' } };
    await schedulesStore.insert({
      _id: 'sch-anchored',
      orgId: 'orgA',
      ownerUserId: 'usr',
      name: 'A cada 5 horas',
      target: { kind: 'manual' },
      spec,
      enabled: true,
      nextRunAt: '2026-08-17T12:32:00.000Z',
      consecutiveFailures: 0,
      createdAt: '2026-08-17T07:32:00.000Z',
      updatedAt: '2026-08-17T07:32:00.000Z',
    } as never);

    const anchored = await authed('/api/v1/schedules/preview', t, {
      method: 'POST',
      body: JSON.stringify({ spec, count: 3, scheduleId: 'sch-anchored' }),
    });
    expect(anchored.status).toBe(200);
    const anchoredBody: unknown = await anchored.json();
    expect(SchedulePreviewResponse.safeParse(anchoredBody), JSON.stringify(anchoredBody)).toMatchObject({ success: true });
    const occurrences = (anchoredBody as { occurrences: string[] }).occurrences;
    expect(occurrences).toEqual([
      '2026-08-17T12:32:00.000Z',
      '2026-08-17T17:32:00.000Z',
      '2026-08-17T22:32:00.000Z',
    ]);

    // The claim is not just "some other series": it is the SUPERVISOR's. A PATCH recomputes
    // `nextRunAt` through the same anchored math the supervisor's advance uses, so the first
    // previewed occurrence must be the very instant the schedule now points at.
    const patched = await authed('/api/v1/schedules/sch-anchored', t, { method: 'PATCH', body: JSON.stringify({ spec }) });
    expect(patched.status).toBe(200);
    expect((await patched.json() as { nextRunAt: string | null }).nextRunAt).toBe(occurrences[0]);

    // Without the id (the create form) the request instant stays the anchor: 10:00Z + 5h.
    const anchorless = await authed('/api/v1/schedules/preview', t, {
      method: 'POST',
      body: JSON.stringify({ spec, count: 1 }),
    });
    expect(anchorless.status).toBe(200);
    expect((await anchorless.json() as { occurrences: string[] }).occurrences).toEqual(['2026-08-17T15:00:00.000Z']);

    // An id the actor cannot read is the uniform not-found - never a preview off someone else's
    // anchor, and no wider an oracle than GET /:id.
    const foreign = await authed('/api/v1/schedules/preview', t, {
      method: 'POST',
      body: JSON.stringify({ spec, scheduleId: 'sch-does-not-exist' }),
    });
    expect(foreign.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await foreign.json()).success).toBe(true);
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

/**
 * THE OWNER SAYING "GO" CLEARS THE NEUTRAL COOLDOWN, not only the failure ceiling.
 *
 * A neutral block (`awaiting_daemon`) earns a cooldown during which the supervisor advances the
 * pointer without firing - that is what bounds an exemption from the ceiling. A re-enable is the
 * owner stating that the environment changed, so making them wait out a backoff earned by the
 * state they just fixed would read as the schedule ignoring them. The fields are supervisor
 * internals and deliberately not on the wire (`toWireSchedule` projects explicitly), so the
 * assertion reads the store.
 */
describe('re-enabling a schedule clears the neutral cooldown', () => {
  it('a PATCH enabled:true resets the streak, the cooldown and the ceiling together', async () => {
    const t = await tokenFor('usr');
    await schedulesStore.insert({
      _id: 'sch-cooling',
      orgId: 'orgA',
      ownerUserId: 'usr',
      name: 'Arrefecida',
      target: { kind: 'manual' },
      spec: { kind: 'recurring', rule: { every: 'minute', interval: 1, timezone: 'Europe/Lisbon' } },
      enabled: false,
      nextRunAt: null,
      consecutiveFailures: 4,
      consecutiveNeutralBlocks: 6,
      neutralBackoffUntil: '2099-01-01T00:00:00.000Z',
      lastNeutralNotifiedAt: '2026-08-17T09:00:00.000Z',
      autoPausedAt: '2026-08-17T09:00:00.000Z',
      createdAt: '2026-08-17T07:00:00.000Z',
      updatedAt: '2026-08-17T09:00:00.000Z',
    } as never);

    const patched = await authed('/api/v1/schedules/sch-cooling', t, { method: 'PATCH', body: JSON.stringify({ enabled: true }) });
    expect(patched.status).toBe(200);
    expect(Schedule.safeParse(await patched.json()).success).toBe(true);

    const row = (await schedulesStore.get('sch-cooling')) as unknown as {
      enabled: boolean; consecutiveFailures: number; consecutiveNeutralBlocks?: number;
      neutralBackoffUntil?: string | null; autoPausedAt?: string; nextRunAt: string | null;
    };
    expect(row.enabled).toBe(true);
    expect(row.consecutiveFailures).toBe(0);
    expect(row.consecutiveNeutralBlocks).toBe(0);
    expect(row.neutralBackoffUntil).toBeNull();
    expect(row.autoPausedAt).toBeUndefined();
    // A far-future cooldown left in place would have kept the next fire from happening at all,
    // which is the failure this clears: the pointer is live again.
    expect(row.nextRunAt).not.toBeNull();
  });
});
