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
  neutralBackoffMs,
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

interface BlockedNotice { ownerUserId: string; scheduleId: string; runId: string; code?: string }

function makeDeps(over: Partial<ScheduleSupervisorDeps> = {}): ScheduleSupervisorDeps & {
  automationCalls: unknown[];
  integrationCalls: unknown[];
  blockedNotices: BlockedNotice[];
} {
  const automationCalls: unknown[] = [];
  const integrationCalls: unknown[] = [];
  const blockedNotices: BlockedNotice[] = [];
  return {
    automationCalls,
    integrationCalls,
    blockedNotices,
    notifyBlocked: (n) => { blockedNotices.push(n); },
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
    // STILL COUNTS, as it always did. `awaiting_consent` is blocked on a HUMAN ACT, and no number
    // of fires brings one closer, so the ceiling stays its cap. Only the ENVIRONMENT block
    // (`awaiting_daemon`, below) is neutral - see `NEUTRAL_BLOCKED_CODES`.
    expect(after.consecutiveFailures).toBe(1);
    // ...and the owner is told, for every kind of block: it is the one outcome nothing else
    // surfaces in time.
    expect(deps.blockedNotices).toEqual([
      { ownerUserId: 'usr1', scheduleId: s._id, runId: runs[0]!._id, code: 'awaiting_consent' },
    ]);
  });

  /**
   * P4.1 - WHICH BLOCK IS NEUTRAL, and why it is not all of them.
   *
   * The brief that produced this slice said "blocked must be neutral against the ceiling", and taken
   * literally that removed the only cap on repeating a block that never resolves by waiting. The
   * distinction that survives review is not "blocked vs failed" but "does waiting fix it":
   *
   *   - `awaiting_daemon` - the owner's machine is not connected. Opening the laptop fixes it with
   *     nobody touching the schedule, so twenty nights of it must not auto-pause a working schedule.
   *   - `needs_credentials` / `awaiting_consent` - a human has to act. Nothing changes between fires
   *     until they do, and an uncapped retry is the hazard itself: a portal password changes, the
   *     nightly fire routes to the typist under a standing grant, submits, meets the wrong-password
   *     signature, and repeats forever against a portal with an unknown lock-out policy.
   */
  it('a NEUTRAL block does not reset the failure counter either - it is neutral in both directions', async () => {
    const deps = makeDeps({
      runAutomation: async () => mapAutomationOutcome({ outcome: 'blocked', code: 'awaiting_daemon', permanent: false }),
    });
    const sup = new ScheduleSupervisor(deps);
    // Resetting would be the opposite error to counting: a genuinely broken schedule could hide
    // behind an occasional blocked fire and never reach the ceiling at all.
    const s = await seedSchedule({ consecutiveFailures: 7 });
    await sup.tick();
    await sup.stop();
    expect(((await schedules.get(s._id)) as unknown as ScheduleDoc).consecutiveFailures).toBe(7);
  });

  it('N CONSECUTIVE AWAITING-DAEMON FIRES NEVER AUTO-PAUSE, however many (the laptop-shut case)', async () => {
    const deps = makeDeps({
      runAutomation: async () => mapAutomationOutcome({ outcome: 'blocked', code: 'awaiting_daemon', permanent: false, runId: 'arun_b' }),
    });
    const sup = new ScheduleSupervisor(deps);
    // Start one strike below the ceiling: if this block counted at all, the FIRST fire would pause.
    const s = await seedSchedule({ consecutiveFailures: FAILURE_CEILING - 1 });
    const fires = FAILURE_CEILING + 5;
    for (let i = 0; i < fires; i++) {
      // Each iteration is a DISTINCT occurrence: the run id is deterministic over
      // (scheduleId, plannedFor), so reusing one instant would claim nothing after the first.
      clock += 3_600_000;
      await schedules.update(s._id, (cur) => ({ ...(cur as object), nextRunAt: new Date(clock).toISOString() }) as never);
      await sup.tick();
      await sup.stop();
    }
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.enabled).toBe(true);
    expect(after.autoPausedAt).toBeUndefined();
    expect(after.consecutiveFailures).toBe(FAILURE_CEILING - 1);
    expect(after.lastRun?.status).toBe('blocked');
    // The owner IS told - silence is the failure mode the notice replaces - but not once per fire.
    // These 25 fires span 25 HOURS of fake clock, so the streak's first block tells them and the
    // 24-hour re-notify floor lets exactly one more through. Telling them 25 times is not a louder
    // signal; it is the unbounded thing `neutralBackoffUntil` exists to stop, one channel over.
    expect(deps.blockedNotices.length).toBe(2);
    expect(deps.blockedNotices.every((n) => n.code === 'awaiting_daemon')).toBe(true);
    // The streak is counted, and separately from the ceiling it is deliberately not driving.
    expect(after.consecutiveNeutralBlocks).toBe(fires);
  });

  it('N CONSECUTIVE NEEDS-CREDENTIALS FIRES DO auto-pause - the cap on a rejected password', async () => {
    const deps = makeDeps({
      runAutomation: async () => mapAutomationOutcome({ outcome: 'blocked', code: 'needs_credentials', permanent: false, runId: 'arun_c' }),
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ consecutiveFailures: FAILURE_CEILING - 1 });
    clock += 3_600_000;
    await schedules.update(s._id, (cur) => ({ ...(cur as object), nextRunAt: new Date(clock).toISOString() }) as never);
    await sup.tick();
    await sup.stop();

    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.consecutiveFailures).toBe(FAILURE_CEILING);
    expect(after.enabled).toBe(false);
    expect(after.autoPausedAt).toBeTruthy();
    // Still a `blocked` run row and still a notice: auto-pausing is the cap, not a reclassification
    // of what happened.
    expect(after.lastRun?.status).toBe('blocked');
    expect(deps.blockedNotices).toHaveLength(1);
  });

  it('a blocked outcome with NO code counts, because an unnamed block is not a known-safe one', async () => {
    // The seam is structural, so a caller can omit `code`. The closed reading of "we do not know
    // which block this was" is the one that keeps the cap.
    const deps = makeDeps({
      runAutomation: async () => mapAutomationOutcome({ outcome: 'blocked', permanent: false }),
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ consecutiveFailures: 3 });
    await sup.tick();
    await sup.stop();
    expect(((await schedules.get(s._id)) as unknown as ScheduleDoc).consecutiveFailures).toBe(4);
  });

  it('an ok or failed fire notifies nobody — only blocked does', async () => {
    for (const runAutomation of [
      async () => mapAutomationOutcome({ outcome: 'completed', permanent: false }),
      async () => mapAutomationOutcome({ outcome: 'failed', permanent: false }),
    ]) {
      const deps = makeDeps({ runAutomation });
      const sup = new ScheduleSupervisor(deps);
      await seedSchedule();
      await sup.tick();
      await sup.stop();
      expect(deps.blockedNotices).toEqual([]);
    }
  });

  it('a notifier that throws never fails the fire (the run row is the durable record)', async () => {
    const deps = makeDeps({
      runAutomation: async () => mapAutomationOutcome({ outcome: 'blocked', permanent: false }),
      notifyBlocked: () => { throw new Error('push rail down'); },
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule();
    await sup.tick();
    await sup.stop();
    const runs = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];
    expect(runs[0]!.status).toBe('blocked');
    expect(((await schedules.get(s._id)) as unknown as ScheduleDoc).lastRun?.status).toBe('blocked');
  });

  it('mapAutomationOutcome opens a blocked channel out of the automation path, CARRYING WHICH', () => {
    // The collapse this replaces: every non-`completed` status became `failed`, so a run halted in
    // `awaiting_daemon` was indistinguishable from one that threw. The code travels verbatim
    // because the two blocked causes get opposite treatment above, and because the badge the owner
    // reads derives its words from it.
    expect(mapAutomationOutcome({ outcome: 'blocked', code: 'awaiting_daemon', permanent: false, runId: 'r1' })).toEqual({
      status: 'blocked',
      code: 'awaiting_daemon',
      automationRunId: 'r1',
    });
    expect(mapAutomationOutcome({ outcome: 'blocked', code: 'needs_credentials', permanent: false }).code)
      .toBe('needs_credentials');
    // No code from the seam ⇒ the flat label, which `NEUTRAL_BLOCKED_CODES` does not contain.
    expect(mapAutomationOutcome({ outcome: 'blocked', permanent: false, runId: 'r1' })).toEqual({
      status: 'blocked',
      code: 'automation_blocked',
      automationRunId: 'r1',
    });
    expect(mapAutomationOutcome({ outcome: 'completed', permanent: false }).status).toBe('ok');
    expect(mapAutomationOutcome({ outcome: 'failed', permanent: true })).toEqual({
      status: 'failed',
      code: 'automation_gone',
    });
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

/**
 * NEUTRALITY IS NOT FREE - the cap the exemption owed (P4 round eight).
 *
 * Exempting `awaiting_daemon` from the failure ceiling removed the only limit on REPEATING it, and
 * nothing replaced it. A per-minute schedule pointed at a bridge-only automation with no daemon
 * connected fired 1440 times a day for ever: ~1440 schedule-run rows plus ~1440 automation-run rows
 * (neither store has retention) and 1440 `schedule_blocked` notifications - so the compensating
 * measure that tells the owner was itself the unbounded thing. On main the ceiling paused it after
 * 20 fires; that pause was WRONG, and the answer to a wrong pause is not "no bound at all".
 *
 * The bound is a COOLDOWN rather than a count, because a neutral halt is by definition one that
 * waiting fixes: the schedule stays enabled, the fires inside the cooldown leave NO trace, and the
 * first fire on the far side either succeeds (streak resets) or blocks again (streak grows, capped
 * at 15 minutes - deliberately below any hand-authored cadence, so an hourly or nightly schedule
 * never notices this exists).
 */
describe('a neutral block is bounded by a cooldown, not by the ceiling', () => {
  /** Deps whose automation ALWAYS halts on a missing daemon, still counting the calls it makes. */
  function daemonless() {
    const calls: string[] = [];
    const deps = makeDeps({
      runAutomation: async (s) => {
        calls.push(s._id);
        return mapAutomationOutcome({ outcome: 'blocked', code: 'awaiting_daemon', permanent: false, runId: 'arun_n' });
      },
    });
    return { deps, calls };
  }

  it('doubles to a 15-minute cap and never further', () => {
    expect(neutralBackoffMs(0)).toBe(0);
    expect(neutralBackoffMs(1)).toBe(60_000);
    expect(neutralBackoffMs(2)).toBe(120_000);
    expect(neutralBackoffMs(5)).toBe(900_000);
    expect(neutralBackoffMs(50)).toBe(900_000);
  });

  it('A PER-MINUTE SCHEDULE WITH NO DAEMON STOPS WRITING A ROW A MINUTE', async () => {
    const { deps, calls } = daemonless();
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ spec: { kind: 'recurring', rule: { every: 'minute', interval: 1, timezone: 'Europe/Lisbon' } } });

    // Two hours of ticks at the schedule's own cadence. Unbounded, this is 120 fires, 120 durable
    // rows and 120 notifications; bounded, the cooldown doubles 1-2-4-8-15-15... and the pointer is
    // advanced past each one without claiming anything.
    for (let i = 0; i < 120; i++) {
      clock += 60_000;
      await sup.tick();
      await sup.stop();
    }

    const rows = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.length).toBeGreaterThan(1); // it is a cooldown, not a stop
    expect(calls.length).toBe(rows.length); // no run row without a run, and none without a row
    expect(deps.blockedNotices.length).toBe(1); // the streak's first block; the floor holds the rest
    // Still ENABLED and still counting nothing against the ceiling: the laptop is shut, not broken.
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.enabled).toBe(true);
    expect(after.autoPausedAt).toBeUndefined();
    expect(after.consecutiveFailures).toBe(0);
  });

  it('a fire inside the cooldown leaves NO trace at all - no row, no run, no notice', async () => {
    const { deps, calls } = daemonless();
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ spec: { kind: 'recurring', rule: { every: 'minute', interval: 1, timezone: 'Europe/Lisbon' } } });
    await sup.tick();
    await sup.stop();
    const afterFirst = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(afterFirst.consecutiveNeutralBlocks).toBe(1);
    expect(Date.parse(afterFirst.neutralBackoffUntil!)).toBe(clock + 60_000);
    const rowsAfterFirst = (await scheduleRuns.find({ scheduleId: s._id })) as unknown as ScheduleRunDoc[];

    clock += 30_000; // still inside the cooldown
    await sup.tick();
    await sup.stop();
    expect((await scheduleRuns.find({ scheduleId: s._id })).length).toBe(rowsAfterFirst.length);
    expect(calls.length).toBe(1);
    expect(deps.blockedNotices.length).toBe(1);
    // The pointer was still advanced - to the first occurrence at or after the cooldown ends - so
    // the schedule is not stuck on a stale instant and does not walk one cadence step per tick.
    const cooled = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(Date.parse(cooled.nextRunAt!)).toBeGreaterThanOrEqual(Date.parse(afterFirst.neutralBackoffUntil!));
  });

  it('the laptop opening resumes the schedule and clears the streak', async () => {
    let connected = false;
    const deps = makeDeps({
      runAutomation: async () =>
        connected
          ? mapAutomationOutcome({ outcome: 'completed', permanent: false, runId: 'arun_ok' })
          : mapAutomationOutcome({ outcome: 'blocked', code: 'awaiting_daemon', permanent: false, runId: 'arun_n' }),
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ spec: { kind: 'recurring', rule: { every: 'minute', interval: 1, timezone: 'Europe/Lisbon' } } });
    for (let i = 0; i < 5; i++) {
      clock += 60_000;
      await sup.tick();
      await sup.stop();
    }
    expect(((await schedules.get(s._id)) as unknown as ScheduleDoc).consecutiveNeutralBlocks).toBeGreaterThan(1);

    // The laptop opens. The schedule keeps ticking at its own cadence and resumes by itself at the
    // far side of the cooldown - within its cap, not within one tick, which is the price of the bound.
    connected = true;
    for (let i = 0; i < 20 && (((await schedules.get(s._id)) as unknown as ScheduleDoc).lastRun?.status !== 'ok'); i++) {
      clock += 60_000;
      await sup.tick();
      await sup.stop();
    }
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.lastRun?.status).toBe('ok');
    expect(after.consecutiveNeutralBlocks).toBe(0);
    expect(after.neutralBackoffUntil).toBeNull();
  });

  it('a NON-neutral block is unaffected: it still fires every occurrence and still auto-pauses', async () => {
    // The cooldown is earned by the environment saying "wait". A block on a HUMAN ACT is already
    // capped - by the ceiling - and must not be quietly slowed as well, because slowing it would
    // delay the auto-pause that is how the owner finds out.
    const calls: string[] = [];
    const deps = makeDeps({
      runAutomation: async (s) => {
        calls.push(s._id);
        return mapAutomationOutcome({ outcome: 'blocked', code: 'needs_credentials', permanent: false, runId: 'arun_c' });
      },
    });
    const sup = new ScheduleSupervisor(deps);
    const s = await seedSchedule({ spec: { kind: 'recurring', rule: { every: 'minute', interval: 1, timezone: 'Europe/Lisbon' } } });
    for (let i = 0; i < 3; i++) {
      clock += 60_000;
      await sup.tick();
      await sup.stop();
    }
    expect(calls.length).toBe(3);
    expect(deps.blockedNotices.length).toBe(3);
    const after = (await schedules.get(s._id)) as unknown as ScheduleDoc;
    expect(after.consecutiveFailures).toBe(3);
    expect(after.neutralBackoffUntil ?? null).toBeNull();
  });
});
