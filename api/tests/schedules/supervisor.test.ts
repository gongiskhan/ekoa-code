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
 *
 * Plus the four shutdown/backpressure invariants, each pinning a defect the first cut had:
 *  - a slow fire DEFERS the tail of the due list instead of starving it into the stale skip;
 *  - stale recovery ADOPTS THE PRESENT in one jump, never one cadence step per tick;
 *  - a missed ONE-TIME schedule leaves a terminal `failed`/`missed` row, never silence;
 *  - stop() drains a fire launched after shutdown began (no occurrence left claimed-but-running).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { schedules, scheduleRuns } from '../../src/data/stores.js';
import {
  ScheduleSupervisor,
  FAILURE_CEILING,
  MISSED_RUN_CODE,
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

/** REAL milliseconds (the supervisor's fake clock is `clock`; these two wait on the event loop). */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await sleep(5);
  }
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

  it('a slow fire defers the tail of the due list instead of starving it into the stale skip', async () => {
    // The single fire slot goes to a schedule whose automation takes 10 fake minutes. The tail's
    // occurrence must survive that: the grace runs from when the supervisor FIRST SAW it due,
    // not from the moment our own queueing gets round to it.
    const fired: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const deps = makeDeps({
      maxConcurrent: 1,
      runAutomation: async (s) => {
        fired.push(s._id);
        if (s.name === 'lenta') await gate;
        return { status: 'ok' };
      },
    });
    const sup = new ScheduleSupervisor(deps);
    // `once` for the slow one: it exhausts to null and cannot re-take the slot on a later tick.
    const slowAt = new Date(clock - 60_000).toISOString();
    const slow = await seedSchedule({ name: 'lenta', spec: { kind: 'once', at: slowAt }, nextRunAt: slowAt });
    const tail = await seedSchedule({ name: 'cauda' }); // due exactly now

    const pass1 = sup.tick(); // NOT awaited: a tick that blocks on the slot never settles here
    await waitFor(() => fired.includes(slow._id));
    clock += 10 * 60_000; // the slow fire outlasts the 5-minute grace
    release();
    await pass1;

    for (let i = 0; i < 5 && !fired.includes(tail._id); i++) {
      await sleep(10);
      await sup.tick();
    }
    await sup.stop();

    expect(fired).toContain(tail._id);
    const runs = (await scheduleRuns.find({ scheduleId: tail._id })) as unknown as ScheduleRunDoc[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.plannedFor).toBe(T0.toISOString()); // the occurrence it was owed, not a later one
    expect(runs[0]!.status).toBe('ok');
  });

  it('stale recovery jumps the pointer to the present in ONE step', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    // Every 5 minutes, anchored 4 hours ago, pointer 3 hours stale: an outage, not a slow fire.
    const s = await seedSchedule({
      spec: { kind: 'recurring', rule: { every: 'minute', interval: 5, timezone: 'Europe/Lisbon' } },
      createdAt: new Date(clock - 4 * 3_600_000).toISOString(),
      nextRunAt: new Date(clock - 3 * 3_600_000).toISOString(),
    });

    await sup.tick();
    await sup.stop();

    expect(deps.automationCalls).toHaveLength(0); // still no backfill
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    // The occurrence landing exactly on now - one jump, not 06:05 (one cadence step per tick).
    expect(after.nextRunAt).toBe(T0.toISOString());
    expect(await scheduleRuns.find({ scheduleId: s._id })).toHaveLength(0);
  });

  it('a one-time schedule missed while the process was down leaves a MISSED run row', async () => {
    const deps = makeDeps();
    const sup = new ScheduleSupervisor(deps);
    const missedAt = new Date(clock - 6 * 3_600_000).toISOString();
    const s = await seedSchedule({ spec: { kind: 'once', at: missedAt }, nextRunAt: missedAt });

    await sup.tick();
    await sup.stop();

    expect(deps.automationCalls).toHaveLength(0); // never executed late
    const runs = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.detail?.code).toBe(MISSED_RUN_CODE);
    expect(runs[0]!.plannedFor).toBe(missedAt);
    expect(runs[0]!.trigger).toBe('auto');
    expect(runs[0]!.firedAt).toBeUndefined(); // nothing ran
    expect(runs[0]!.finishedAt).toBeDefined(); // but the row is terminal
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.nextRunAt).toBeNull();
    expect(after.lastRun?.status).toBe('failed');
    expect(after.lastRun?.code).toBe(MISSED_RUN_CODE);

    // At-most-once holds: a second supervisor over the same occurrence adds nothing.
    await schedules.update(s._id, (cur) => ({ ...cur, nextRunAt: missedAt }));
    const sup2 = new ScheduleSupervisor(deps);
    await sup2.tick();
    await sup2.stop();
    expect(await scheduleRuns.find({ scheduleId: s._id })).toHaveLength(1);
  });

  it('stop() drains a fire launched after shutdown began (nothing left claimed-but-running)', async () => {
    const fired: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const deps = makeDeps({
      maxConcurrent: 1,
      runAutomation: async (s) => {
        fired.push(s._id);
        await (s.name === 'lenta' ? gate : sleep(300));
        return { status: 'ok' };
      },
    });
    const sup = new ScheduleSupervisor(deps);
    const slowAt = new Date(clock - 60_000).toISOString();
    const slow = await seedSchedule({ name: 'lenta', spec: { kind: 'once', at: slowAt }, nextRunAt: slowAt });
    await seedSchedule({ name: 'seguinte' });

    const pass = sup.tick(); // not awaited: the pass is still live when shutdown starts
    await waitFor(() => fired.includes(slow._id));
    const stopped = sup.stop();
    release();
    await Promise.all([pass, stopped]);
    await sleep(80); // an escapee would claim + launch inside this window

    const rows = (await scheduleRuns.find({})) as unknown as ScheduleRunDoc[];
    expect(rows.filter((r) => r.status === 'running')).toEqual([]);
    expect(rows.find((r) => r.scheduleId === slow._id)?.status).toBe('ok');
  });
});
