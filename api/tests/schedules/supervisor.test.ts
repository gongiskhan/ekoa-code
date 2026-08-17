/**
 * Schedule supervisor (schedules/supervisor.ts) — driven with FAKE executor seams and a fake
 * clock over the REAL store (in-memory Mongo), the listener-supervisor testing posture. Proves:
 *  - a due schedule fires ONCE: the deterministic run-id insert is the at-most-once claim
 *    (a second tick over the same occurrence claims nothing);
 *  - `nextRunAt` advances BEFORE execution, and a `once` spec exhausts to null;
 *  - a manual target creates a `pending` run and executes nothing;
 *  - an integration `awaiting_consent` records a BLOCKED run (never a retry, never approval);
 *  - a stale occurrence (beyond the 5-minute grace) advances WITHOUT firing (no backfill);
 *  - the failure ceiling auto-pauses the schedule and stamps `autoPausedAt`;
 *  - fireNow runs out of band and does NOT advance the pointer.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { schedules, scheduleRuns } from '../../src/data/stores.js';
import {
  ScheduleSupervisor,
  FAILURE_CEILING,
  mapIntegrationOutcome,
  mapAutomationOutcome,
  type ScheduleSupervisorDeps,
} from '../../src/schedules/supervisor.js';
import type { ScheduleDoc, ScheduleRunDoc } from '../../src/schedules/store.js';

let mem: MongoMemoryServer;
beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_schedule_supervisor');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  await schedules.deleteMany({});
  await scheduleRuns.deleteMany({});
});

const T0 = new Date('2026-08-17T09:00:00.000Z');
let clock = T0.getTime();
let seq = 0;

function makeDeps(over: Partial<ScheduleSupervisorDeps> = {}): ScheduleSupervisorDeps & {
  automationCalls: unknown[];
  integrationCalls: unknown[];
} {
  const automationCalls: unknown[] = [];
  const integrationCalls: unknown[] = [];
  return {
    automationCalls,
    integrationCalls,
    runAutomation: async (s, t) => {
      automationCalls.push({ scheduleId: s._id, target: t });
      return { status: 'ok', automationRunId: 'arun_1' };
    },
    runIntegrationAction: async (s, t) => {
      integrationCalls.push({ scheduleId: s._id, target: t });
      return { status: 'ok' };
    },
    now: () => new Date(clock).toISOString(),
    genId: () => `gid_${seq++}`,
    ...over,
  };
}

async function seedSchedule(over: Partial<ScheduleDoc> = {}): Promise<ScheduleDoc> {
  const doc: ScheduleDoc = {
    _id: `sch_${seq++}`,
    orgId: 'orgA',
    ownerUserId: 'usr1',
    name: 'Teste',
    target: { kind: 'automation', automationId: 'auto1' },
    spec: { kind: 'recurring', rule: { every: 'hour', interval: 1, timezone: 'Europe/Lisbon' } },
    enabled: true,
    nextRunAt: new Date(clock).toISOString(),
    consecutiveFailures: 0,
    createdAt: new Date(clock - 3_600_000).toISOString(),
    updatedAt: new Date(clock - 3_600_000).toISOString(),
    ...over,
  };
  await schedules.insert(doc as never);
  return doc;
}

beforeEach(() => {
  clock = T0.getTime();
});

describe('ScheduleSupervisor', () => {
  it('fires a due automation schedule exactly once and advances nextRunAt first', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule();

    await sup.tick();
    await sup.stop(); // awaits the in-flight fire

    expect(deps.automationCalls).toHaveLength(1);
    const runs = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('ok');
    expect(runs[0]!.trigger).toBe('auto');
    expect(runs[0]!.automationRunId).toBe('arun_1');

    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.nextRunAt).toBe('2026-08-17T10:00:00.000Z'); // anchor-aligned next hour
    expect(after.lastRun?.status).toBe('ok');
    expect(after.consecutiveFailures).toBe(0);
  });

  it('the SAME occurrence cannot fire twice (deterministic claim), even across two supervisors', async () => {
    const deps1 = makeDeps();
    const deps2 = makeDeps();
    const a = new ScheduleSupervisor(deps1);
    const b = new ScheduleSupervisor(deps2);
    const s = await seedSchedule();
    // Freeze the pointer: restore nextRunAt after A's advance so B sees the same occurrence.
    const planned = s.nextRunAt!;
    await a.tick();
    await a.stop();
    await schedules.update(s._id, (cur) => ({ ...cur, nextRunAt: planned }));
    await b.tick();
    await b.stop();
    expect(deps1.automationCalls.length + deps2.automationCalls.length).toBe(1);
    expect(await scheduleRuns.find({ scheduleId: s._id })).toHaveLength(1);
  });

  it('a once spec exhausts to null after firing', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ spec: { kind: 'once', at: new Date(clock).toISOString() } });
    await sup.tick();
    await sup.stop();
    expect((await schedules.get(s._id) as unknown as ScheduleDoc).nextRunAt).toBeNull();
    expect(deps.automationCalls).toHaveLength(1);
  });

  it('a manual target creates a pending run and executes nothing', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ target: { kind: 'manual', instructions: 'Rever contratos' } });
    await sup.tick();
    await sup.stop();
    const runs = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('pending');
    expect(deps.automationCalls).toHaveLength(0);
    expect(deps.integrationCalls).toHaveLength(0);
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.lastRun?.status).toBe('pending');
  });

  it('awaiting_consent records a BLOCKED run with the code', async () => {
    const deps = makeDeps({
      runIntegrationAction: async () => mapIntegrationOutcome({ success: false, code: 'awaiting_consent', error: 'aguarda aprovação' }),
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({
      target: { kind: 'integration_action', integrationKey: 'ntfy', actionName: 'publish', args: { topic: 'x' } },
    });
    await sup.tick();
    await sup.stop();
    const runs = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];
    expect(runs[0]!.status).toBe('blocked');
    expect(runs[0]!.detail?.code).toBe('awaiting_consent');
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.lastRun?.status).toBe('blocked');
    expect(after.consecutiveFailures).toBe(1); // blocked counts toward the ceiling
  });

  it('a stale occurrence advances WITHOUT firing (no backfill beyond the grace)', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    // Planned 30 minutes ago — beyond the 5-minute grace.
    const s = await seedSchedule({ nextRunAt: new Date(clock - 30 * 60_000).toISOString() });
    await sup.tick();
    await sup.stop();
    expect(deps.automationCalls).toHaveLength(0);
    expect(await scheduleRuns.find({ scheduleId: s._id })).toHaveLength(0);
    const mid = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    // Advanced past the MISSED 08:30 occurrence to the next on-cadence one (09:00 — due now,
    // fresh, so the NEXT tick fires it: downtime skips history, not the live cadence).
    expect(mid.nextRunAt).toBe('2026-08-17T09:00:00.000Z');
    // A fresh supervisor (stop() bumped the old one's generation) fires the fresh occurrence.
    const sup2 = new ScheduleSupervisor(deps);
    await sup2.tick();
    await sup2.stop();
    expect(deps.automationCalls).toHaveLength(1);
    expect(await scheduleRuns.find({ scheduleId: s._id })).toHaveLength(1);
  });

  it('the failure ceiling auto-pauses the schedule', async () => {
    const deps = makeDeps({
      runAutomation: async () => mapAutomationOutcome({ outcome: 'failed', permanent: false }),
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ consecutiveFailures: FAILURE_CEILING - 1 });
    await sup.tick();
    await sup.stop();
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.enabled).toBe(false);
    expect(after.autoPausedAt).toBeDefined();
    expect(after.nextRunAt).toBeNull();
    expect(after.consecutiveFailures).toBe(FAILURE_CEILING);
    expect(after.lastRun?.code).toBe('automation_failed');
  });

  it('fireNow runs out of band: random id, manual trigger, pointer untouched', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    const future = new Date(clock + 3_600_000).toISOString();
    const s = await seedSchedule({ nextRunAt: future });
    const run = await sup.fireNow(s);
    await sup.stop();
    expect(run.trigger).toBe('manual');
    expect(deps.automationCalls).toHaveLength(1);
    expect((await schedules.get(s._id) as unknown as ScheduleDoc).nextRunAt).toBe(future);
  });

  it('stop() abandons later ticks (generation guard)', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    await seedSchedule();
    await sup.stop();
    await sup.tick(0); // stale generation
    expect(deps.automationCalls).toHaveLength(0);
  });
});
