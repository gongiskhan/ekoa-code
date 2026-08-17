/**
 * Schedule supervisor — the timer rail. One unref'd interval tick (default 30s) claims due
 * schedules and fires them; there is deliberately NO per-schedule timer map (the store's
 * `nextRunAt` is the source of truth, so restarts and edits need no reconciliation diff).
 *
 * The execution DISCIPLINE, in order, per due schedule:
 *  1. SKIP stale occurrences: a `plannedFor` older than the 5-minute grace is advanced without
 *     firing (the house "adopt now as the cursor, no backfill" precedent; observable via a log
 *     line, not a run row — a boot after a weekend must not manufacture history).
 *  2. CLAIM the occurrence: the run row's DETERMINISTIC _id over (scheduleId, plannedFor) is
 *     inserted first; a duplicate-key refusal means a previous process already owns this fire
 *     (crash recovery), and this tick only advances the pointer.
 *  3. ADVANCE `nextRunAt` BEFORE executing: a crash mid-execution leaves a claimed `running`
 *     row and a moved pointer — never a double fire. (`once` specs advance to null.)
 *  4. EXECUTE without awaiting in the tick (an automation fire awaits its FULL run): in-flight
 *     fires are tracked and awaited by stop(); concurrency is capped so a burst of due
 *     schedules cannot stampede the engine.
 *
 * The write gate is untouched: a mutating integration action with no live standing approval
 * comes back `awaiting_consent` and is recorded as a `blocked` run — the supervisor never
 * approves, never retries into consent (the listener rail's posture).
 *
 * Failure ceiling: FAILURE_CEILING consecutive non-ok automatic fires disable the schedule
 * (`autoPausedAt`), so an abandoned broken schedule cannot burn forever; the owner's next edit
 * or re-enable clears the counter (service.ts).
 *
 * Tier note: this module executes targets ONLY through the injected deps — automation/ and the
 * integrations executor are bound at the composition root (server.ts), the events-rail rule.
 */
import type { ScheduleTarget } from '@ekoa/shared';
import {
  insertRun,
  finalizeRun,
  listDueSchedules,
  occurrenceRunId,
  updateScheduleSystem,
  type ScheduleDoc,
  type ScheduleRunDoc,
} from './store.js';
import { nextOccurrence } from './recurrence.js';

const DEFAULT_TICK_MS = 30_000;
const SKIP_GRACE_MS = 5 * 60_000;
const MAX_CONCURRENT_FIRES = 3;
export const FAILURE_CEILING = 20;

export interface ScheduleFireOutcome {
  status: 'ok' | 'failed' | 'blocked';
  /** Machine-readable cause (executor code / service error code). */
  code?: string;
  message?: string;
  automationRunId?: string;
}

export interface ScheduleSupervisorDeps {
  /** Start an automation run AS THE SCHEDULE'S OWNER and await its terminal status. Bound to
   *  automation/service startRunForTrigger at the composition root. REQUIRED — an optional
   *  seam would let the process boot with a half-wired rail (the listener-supervisor rule). */
  runAutomation(
    schedule: ScheduleDoc,
    target: Extract<ScheduleTarget, { kind: 'automation' }>,
  ): Promise<ScheduleFireOutcome>;
  /** Execute an integration action as the owner — the ONE existing executor rail, with the
   *  automation-backed handler bound. */
  runIntegrationAction(
    schedule: ScheduleDoc,
    target: Extract<ScheduleTarget, { kind: 'integration_action' }>,
  ): Promise<ScheduleFireOutcome>;
  /** Current ISO timestamp (injected so tests are deterministic). */
  now(): string;
  genId(): string;
  tickMs?: number;
  maxConcurrent?: number;
}

export class ScheduleSupervisor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private ticking = false;
  private generation = 0;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(private readonly deps: ScheduleSupervisorDeps) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;
    const ms = this.deps.tickMs ?? DEFAULT_TICK_MS;
    // Immediate first tick (post-listen), then the interval.
    void this.tick(gen);
    this.timer = setInterval(() => { void this.tick(gen); }, ms);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled([...this.inFlight]);
  }

  /** One pass: claim + fire everything due. Re-entrancy-guarded (a slow store must not stack
   *  ticks); a generation moved by stop() abandons the pass. Callable directly (tests, and a
   *  future admin poke) — `running` gates only the interval, not a pass. */
  async tick(gen: number = this.generation): Promise<void> {
    if (gen !== this.generation || this.ticking) return;
    this.ticking = true;
    try {
      const nowIso = this.deps.now();
      const due = await listDueSchedules(nowIso);
      for (const schedule of due) {
        if (gen !== this.generation) return;
        while (this.inFlight.size >= (this.deps.maxConcurrent ?? MAX_CONCURRENT_FIRES)) {
          await Promise.race([...this.inFlight]);
        }
        await this.claimAndFire(schedule, gen);
      }
    } catch (err) {
      console.warn(`[schedule-supervisor] tick failed: ${msgOf(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async claimAndFire(schedule: ScheduleDoc, gen: number): Promise<void> {
    const plannedFor = schedule.nextRunAt;
    if (!plannedFor) return;
    const nowMs = new Date(this.deps.now()).getTime();

    // 1. Stale window → advance without firing (observable, never silent).
    if (nowMs - new Date(plannedFor).getTime() > SKIP_GRACE_MS) {
      console.warn(
        `[schedule-supervisor] schedule ${schedule._id} missed ${plannedFor} beyond grace; advancing without firing`,
      );
      await this.advance(schedule._id, plannedFor);
      return;
    }

    // 2. Claim the occurrence (the insert IS the at-most-once guard).
    const runId = occurrenceRunId(schedule._id, plannedFor);
    const nowIso = this.deps.now();
    const isManual = schedule.target.kind === 'manual';
    const claimed = await insertRun({
      _id: runId,
      scheduleId: schedule._id,
      orgId: schedule.orgId,
      ownerUserId: schedule.ownerUserId,
      status: isManual ? 'pending' : 'running',
      plannedFor,
      firedAt: nowIso,
      trigger: 'auto',
      createdAt: nowIso,
    });

    // 3. Advance the pointer whether or not WE claimed (a stale claim means a crashed
    //    predecessor already fired it — the pointer still has to move).
    await this.advance(schedule._id, plannedFor);
    if (!claimed) return;

    // 4. Execute (manual targets are complete at claim: the pending row IS the task).
    if (isManual) {
      await this.recordOutcome(schedule._id, runId, { status: 'ok' }, /* manual */ true);
      return;
    }
    const fire = this.execute(schedule, runId)
      .catch((err) => {
        console.warn(`[schedule-supervisor] fire ${runId} failed: ${msgOf(err)}`);
      });
    this.inFlight.add(fire);
    void fire.finally(() => this.inFlight.delete(fire));
    // Fires are awaited only by stop(); the tick moves on.
    void gen;
  }

  /** Fire out of band (the run-now route). Random run id, `trigger: 'manual'`, no advance. */
  async fireNow(schedule: ScheduleDoc): Promise<ScheduleRunDoc> {
    const nowIso = this.deps.now();
    const isManual = schedule.target.kind === 'manual';
    const doc: ScheduleRunDoc = {
      _id: this.deps.genId(),
      scheduleId: schedule._id,
      orgId: schedule.orgId,
      ownerUserId: schedule.ownerUserId,
      status: isManual ? 'pending' : 'running',
      plannedFor: nowIso,
      firedAt: nowIso,
      trigger: 'manual',
      createdAt: nowIso,
    };
    await insertRun(doc);
    if (!isManual) {
      const fire = this.execute(schedule, doc._id).catch((err) => {
        console.warn(`[schedule-supervisor] run-now ${doc._id} failed: ${msgOf(err)}`);
      });
      this.inFlight.add(fire);
      void fire.finally(() => this.inFlight.delete(fire));
    }
    return doc;
  }

  private async execute(schedule: ScheduleDoc, runId: string): Promise<void> {
    let outcome: ScheduleFireOutcome;
    try {
      if (schedule.target.kind === 'automation') {
        outcome = await this.deps.runAutomation(schedule, schedule.target);
      } else if (schedule.target.kind === 'integration_action') {
        outcome = await this.deps.runIntegrationAction(schedule, schedule.target);
      } else {
        outcome = { status: 'ok' };
      }
    } catch (err) {
      outcome = { status: 'failed', code: 'internal', message: msgOf(err) };
    }
    const nowIso = this.deps.now();
    await finalizeRun(runId, {
      status: outcome.status,
      finishedAt: nowIso,
      ...(outcome.code || outcome.message
        ? { detail: { ...(outcome.code ? { code: outcome.code } : {}), ...(outcome.message ? { message: outcome.message.slice(0, 2000) } : {}) } }
        : {}),
      ...(outcome.automationRunId ? { automationRunId: outcome.automationRunId } : {}),
    });
    await this.recordOutcome(schedule._id, runId, outcome, false);
  }

  /** Advance `nextRunAt` past `firedPlannedFor` (CAS; anchored at creation). No-op when a
   *  concurrent edit already moved the pointer elsewhere. */
  private async advance(scheduleId: string, firedPlannedFor: string): Promise<void> {
    await updateScheduleSystem(scheduleId, (cur) => {
      if (cur.nextRunAt !== firedPlannedFor) return cur; // an edit outran us — theirs wins
      const next = cur.enabled
        ? nextOccurrence(cur.spec, new Date(firedPlannedFor), new Date(cur.createdAt))
        : null;
      return { ...cur, nextRunAt: next ? next.toISOString() : null };
    }).catch((err) => {
      console.warn(`[schedule-supervisor] advance ${scheduleId} failed: ${msgOf(err)}`);
    });
  }

  /** Denormalise the outcome onto the schedule + drive the failure ceiling. */
  private async recordOutcome(
    scheduleId: string,
    runId: string,
    outcome: ScheduleFireOutcome,
    manualTask: boolean,
  ): Promise<void> {
    const nowIso = this.deps.now();
    await updateScheduleSystem(scheduleId, (cur) => {
      const ok = outcome.status === 'ok';
      const failures = ok ? 0 : cur.consecutiveFailures + 1;
      const autoPause = !ok && failures >= FAILURE_CEILING && cur.enabled;
      if (autoPause) {
        console.warn(
          `[schedule-supervisor] schedule ${scheduleId} disabled after ${failures} consecutive non-ok fires (last: ${outcome.code ?? outcome.status})`,
        );
      }
      return {
        ...cur,
        lastRun: {
          runId,
          status: manualTask ? 'pending' : outcome.status,
          at: nowIso,
          ...(outcome.code ? { code: outcome.code } : {}),
        },
        consecutiveFailures: manualTask ? cur.consecutiveFailures : failures,
        ...(autoPause ? { enabled: false, nextRunAt: null, autoPausedAt: nowIso } : {}),
        updatedAt: nowIso,
      };
    }).catch((err) => {
      console.warn(`[schedule-supervisor] record ${scheduleId} failed: ${msgOf(err)}`);
    });
  }
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Outcome mapping — kept HERE (testable module code, not composition-root lambda bodies).
// Parameter types are STRUCTURAL on purpose: schedules/ (tier 4) must not import
// automation/ (tier 5); the shapes are the seam's contract.
// ---------------------------------------------------------------------------

/** startRunForTrigger's outcome → a fire outcome. */
export function mapAutomationOutcome(o: {
  outcome: 'completed' | 'failed';
  permanent: boolean;
  runId?: string;
}): ScheduleFireOutcome {
  return {
    status: o.outcome === 'completed' ? 'ok' : 'failed',
    ...(o.outcome === 'failed' ? { code: o.permanent ? 'automation_gone' : 'automation_failed' } : {}),
    ...(o.runId ? { automationRunId: o.runId } : {}),
  };
}

/** executeUserIntegrationAction's result → a fire outcome. `awaiting_consent` is BLOCKED —
 *  needs the owner, never a failure to retry and never a thing to approve from here. */
export function mapIntegrationOutcome(r: {
  success: boolean;
  code?: string;
  error?: string;
}): ScheduleFireOutcome {
  if (r.success) return { status: 'ok' };
  return {
    status: r.code === 'awaiting_consent' ? 'blocked' : 'failed',
    ...(r.code ? { code: r.code } : {}),
    ...(r.error ? { message: r.error } : {}),
  };
}

// ---------------------------------------------------------------------------
// Module-level lifecycle wrappers (the listener-supervisor shape): the composition root
// configures the singleton, starts it AFTER the HTTP server is listening, stops it on shutdown.
// Tests construct `new ScheduleSupervisor(deps)` directly.
// ---------------------------------------------------------------------------

let singleton: ScheduleSupervisor | null = null;

export function configureScheduleSupervisor(deps: ScheduleSupervisorDeps): ScheduleSupervisor {
  singleton = new ScheduleSupervisor(deps);
  return singleton;
}

/** The configured instance, for the run-now route dep (null before configure — the route seam
 *  is bound at the composition root, so a null here is a wiring bug, not a runtime state). */
export function getScheduleSupervisor(): ScheduleSupervisor | null {
  return singleton;
}

/** Start the configured supervisor. No-op when unconfigured or killed by env. */
export function startScheduleSupervisor(): void {
  if (process.env.EKOA_SCHEDULES_DISABLED === '1') {
    console.log('[schedule-supervisor] disabled by EKOA_SCHEDULES_DISABLED=1');
    return;
  }
  singleton?.start();
}

export async function stopScheduleSupervisor(): Promise<void> {
  if (singleton) await singleton.stop();
}

/** Tests only. */
export function __resetScheduleSupervisorForTests(): void {
  singleton = null;
}
