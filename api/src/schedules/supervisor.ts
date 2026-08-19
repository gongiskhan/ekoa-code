/**
 * Schedule supervisor — the timer rail. One unref'd interval tick (default 30s) claims due
 * schedules and fires them; there is deliberately NO per-schedule timer map (the store's
 * `nextRunAt` is the source of truth, so restarts and edits need no reconciliation diff).
 *
 * The execution DISCIPLINE, in order, per due schedule:
 *  1. SKIP stale occurrences: a `plannedFor` older than the 5-minute grace is not fired, and the
 *     pointer ADOPTS THE PRESENT in ONE jump (the first occurrence at or after now - never one
 *     cadence step per tick, or a 5-minute schedule would spend hours walking back from an
 *     outage). A recurring miss is observable via a log line, not a run row (a boot after a
 *     weekend must not manufacture history); a `once` spec has no next occurrence to carry it,
 *     so it instead lands a TERMINAL `failed`/`missed` run row - vanishing without a trace is
 *     the one outcome a missed one-time schedule must not have.
 *     The grace is measured from when THIS process FIRST SAW the occurrence due, so the
 *     supervisor's own queueing can never turn a live occurrence into a skipped one.
 *  2. CLAIM the occurrence: the run row's DETERMINISTIC _id over (scheduleId, plannedFor) is
 *     inserted first; a duplicate-key refusal means a previous process already owns this fire
 *     (crash recovery), and this tick only advances the pointer.
 *  3. ADVANCE `nextRunAt` BEFORE executing: a crash mid-execution leaves a claimed `running`
 *     row and a moved pointer — never a double fire. (`once` specs advance to null.)
 *  4. EXECUTE without awaiting in the tick (an automation fire awaits its FULL run): concurrency
 *     is capped so a burst of due schedules cannot stampede the engine, and the pass NEVER
 *     blocks on a fire - a schedule that finds every slot busy is DEFERRED to the next tick with
 *     its grace clock intact, so one slow fire cannot starve the tail of the due list.
 *     stop() drains: it awaits the pass in flight and then every fire until none remain, because
 *     a claimed occurrence abandoned mid-flight sits `running` forever (the claim is permanent -
 *     nothing retries it).
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

/** `detail.code` on the row a missed one-time schedule leaves behind. The UI derives its text
 *  from the CODE, never from server prose - `failed` + this code reads "the planned moment
 *  passed without the schedule running", which is exactly what happened. */
export const MISSED_RUN_CODE = 'missed';

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
  /**
   * Tell the schedule's owner that a fire ended BLOCKED — it is waiting on them (P4.1).
   *
   * REQUIRED, not optional, for the reason the two executor seams are: an optional notifier would
   * let the process boot with the notification silently missing, and "the owner is never told"
   * fails in exactly the direction this seam exists to prevent. The composition root binds it to
   * the per-user notifications channel; a throw here is caught and logged, never propagated.
   *
   * NO MESSAGE FIELD — the client derives its text from `code`, the standing rule for user-facing
   * run errors. Engine prose is not a user-facing vocabulary.
   */
  notifyBlocked(input: { ownerUserId: string; scheduleId: string; runId: string; code?: string }): void;
  /** Current ISO timestamp (injected so tests are deterministic). */
  now(): string;
  genId(): string;
  tickMs?: number;
  maxConcurrent?: number;
}

export class ScheduleSupervisor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** The pass in flight, held as a PROMISE (not a boolean) so stop() can await it: a pass
   *  abandoned mid-claim is exactly how a fire escapes shutdown. */
  private ticking: Promise<void> | null = null;
  private generation = 0;
  private readonly inFlight = new Set<Promise<void>>();
  /** When this process first SAW each schedule's pending occurrence due, keyed by schedule.
   *  Only occurrences we deferred ourselves survive a pass, and the map is swept against the
   *  due list every complete pass, so it cannot grow with dead entries. */
  private readonly seenDue = new Map<string, { plannedFor: string; atMs: number }>();

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

  /** Shutdown drains to EMPTY, in two steps, because either half alone leaks a claim:
   *  the pass in flight may still be mid-claim and about to launch a fire (awaiting a ONE-SHOT
   *  snapshot of `inFlight` would miss it), and a fire that outlives the pass holds a claimed
   *  occurrence whose `running` row nothing else will ever finalise. */
  async stop(): Promise<void> {
    this.running = false;
    this.generation += 1;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const pass = this.ticking;
    if (pass) await pass;
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight]);
    this.seenDue.clear();
  }

  /** One pass: claim + fire everything due. Re-entrancy-guarded (a slow store must not stack
   *  ticks); a generation moved by stop() abandons the pass. Callable directly (tests, and a
   *  future admin poke) — `running` gates only the interval, not a pass. */
  async tick(gen: number = this.generation): Promise<void> {
    if (gen !== this.generation || this.ticking) return;
    const pass = this.pass(gen).catch((err) => {
      console.warn(`[schedule-supervisor] tick failed: ${msgOf(err)}`);
    });
    this.ticking = pass;
    try {
      await pass;
    } finally {
      if (this.ticking === pass) this.ticking = null;
    }
  }

  private async pass(gen: number): Promise<void> {
    // ONE clock for the whole pass. Every staleness verdict is judged against the instant the
    // due list was READ (or earlier - see firstSeenDue), never against a wall clock our own
    // execution moved: otherwise a slow fire ahead in the list silently drops the tail.
    const nowIso = this.deps.now();
    const nowMs = new Date(nowIso).getTime();
    const due = await listDueSchedules(nowIso);
    const maxConcurrent = this.deps.maxConcurrent ?? MAX_CONCURRENT_FIRES;
    const stillDue = new Set<string>();
    let deferred = 0;
    let completed = true;

    for (const schedule of due) {
      if (gen !== this.generation) { completed = false; break; }
      const plannedFor = schedule.nextRunAt;
      if (!plannedFor) continue;
      stillDue.add(schedule._id);
      const stale = this.firstSeenDue(schedule._id, plannedFor, nowMs) - new Date(plannedFor).getTime() > SKIP_GRACE_MS;
      // Only an actual EXECUTION costs a slot: a stale verdict and a manual task (which fires
      // nothing) must never queue behind a slow automation. A deferred occurrence keeps its
      // `seenDue` entry, so the next pass judges it by the grace it had when we first saw it -
      // and the due list is ordered by `nextRunAt`, so the oldest deferral wins the next slot.
      if (!stale && schedule.target.kind !== 'manual' && this.inFlight.size >= maxConcurrent) {
        deferred += 1;
        continue;
      }
      await this.claimAndFire(schedule, gen, { stale, nowMs });
      this.seenDue.delete(schedule._id);
    }

    if (deferred > 0) {
      console.log(
        `[schedule-supervisor] ${deferred} due schedule(s) deferred to the next tick (all ${maxConcurrent} fire slots busy)`,
      );
    }
    // Forget occurrences that stopped being due (fired, edited, paused, deleted). Skipped on an
    // abandoned pass: the un-visited tail is not proof that its occurrence went away.
    if (completed) {
      for (const id of [...this.seenDue.keys()]) if (!stillDue.has(id)) this.seenDue.delete(id);
    }
  }

  /** When this process first saw (schedule, occurrence) due, recording it on first sight. The
   *  grace runs from HERE, not from the moment we get round to the schedule: backpressure and a
   *  slow fire ahead in the list are OUR delay, and must not convert a live occurrence into a
   *  skipped one. No entry (a fresh process, a boot after an outage) means the tick's own clock
   *  - downtime still skips history, exactly as before. */
  private firstSeenDue(scheduleId: string, plannedFor: string, nowMs: number): number {
    const seen = this.seenDue.get(scheduleId);
    if (seen && seen.plannedFor === plannedFor) return seen.atMs;
    this.seenDue.set(scheduleId, { plannedFor, atMs: nowMs });
    return nowMs;
  }

  private async claimAndFire(
    schedule: ScheduleDoc,
    gen: number,
    judged: { stale: boolean; nowMs: number },
  ): Promise<void> {
    const plannedFor = schedule.nextRunAt;
    if (!plannedFor) return;

    // 1. Stale window → never fired, never silent. The pointer adopts the PRESENT in one jump,
    //    and a `once` spec - with no next occurrence to adopt - leaves the miss on the record.
    if (judged.stale) {
      if (schedule.spec.kind === 'once') {
        await this.recordMissedOccurrence(schedule, plannedFor);
      } else {
        console.warn(
          `[schedule-supervisor] schedule ${schedule._id} missed ${plannedFor} beyond grace; advancing to the next occurrence at or after now`,
        );
      }
      await this.advance(schedule._id, plannedFor, judged.nowMs);
      return;
    }

    // 2. Claim the occurrence (the insert IS the at-most-once guard). A stopped supervisor
    //    claims NOTHING new: the deterministic id makes a claim permanent, so one taken and
    //    then abandoned would leave a `running` row nothing ever retries.
    if (gen !== this.generation) return;
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
    // The pass moves on; stop() drains this fire even if it was launched after stop() began.
  }

  /** A one-time schedule whose instant passed while nobody was listening. Skipping it the way a
   *  recurring miss is skipped would erase it whole - there is no next occurrence to carry the
   *  work, so the schedule would simply go quiet with NO run row and no user-visible trace. The
   *  SAME deterministic claim keeps this at-most-once across processes, and the row lands
   *  terminal: `failed` + `missed`, `finishedAt` set, `firedAt` absent because nothing ran. */
  private async recordMissedOccurrence(schedule: ScheduleDoc, plannedFor: string): Promise<void> {
    const runId = occurrenceRunId(schedule._id, plannedFor);
    const nowIso = this.deps.now();
    const claimed = await insertRun({
      _id: runId,
      scheduleId: schedule._id,
      orgId: schedule.orgId,
      ownerUserId: schedule.ownerUserId,
      status: 'failed',
      plannedFor,
      finishedAt: nowIso,
      trigger: 'auto',
      detail: { code: MISSED_RUN_CODE },
      createdAt: nowIso,
    });
    if (!claimed) return; // a predecessor already owns this occurrence
    console.warn(
      `[schedule-supervisor] one-time schedule ${schedule._id} missed ${plannedFor} beyond grace; recorded as ${MISSED_RUN_CODE}`,
    );
    await this.recordOutcome(schedule._id, runId, { status: 'failed', code: MISSED_RUN_CODE }, false);
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
    // P4.1 — A BLOCKED FIRE TELLS ITS OWNER. It is the one outcome nothing else will surface: `ok`
    // needs no telling, `failed` drives the ceiling and eventually auto-pauses loudly, but blocked
    // is neutral by design, so a schedule could sit waiting on a machine for weeks in silence. The
    // alternative the rest of this slice exists to forbid is worse — running the work anyway from a
    // datacenter IP against an origin that was declared bridge-only.
    if (outcome.status === 'blocked') {
      try {
        this.deps.notifyBlocked({
          ownerUserId: schedule.ownerUserId,
          scheduleId: schedule._id,
          runId,
          ...(outcome.code ? { code: outcome.code } : {}),
        });
      } catch (err) {
        // Best-effort by construction: the durable record is the `blocked` run row, which the
        // schedules surface already reads. A push that failed must never fail the fire.
        console.warn(`[schedule-supervisor] blocked notify ${runId} failed: ${msgOf(err)}`);
      }
    }
  }

  /** Advance `nextRunAt` past `firedPlannedFor` (CAS; anchored at creation). No-op when a
   *  concurrent edit already moved the pointer elsewhere.
   *
   *  `adoptFromMs` (set only on the stale path) makes recovery ADOPT THE PRESENT in one step:
   *  the pointer lands on the first occurrence at or after that instant instead of the next one
   *  after the missed occurrence. Without it a 5-minute cadence recovering from a 3-hour outage
   *  would advance 5 minutes per 30-second tick and stay silent for half an hour. */
  private async advance(scheduleId: string, firedPlannedFor: string, adoptFromMs?: number): Promise<void> {
    await updateScheduleSystem(scheduleId, (cur) => {
      if (cur.nextRunAt !== firedPlannedFor) return cur; // an edit outran us — theirs wins
      // `nextOccurrence` is strictly-after, so searching from (adoptFrom - 1ms) yields the first
      // occurrence AT OR AFTER `adoptFrom`: an occurrence landing exactly on now stays live and
      // fires on the next tick, rather than being stepped over.
      const firedMs = new Date(firedPlannedFor).getTime();
      const after = new Date(Math.max(firedMs, (adoptFromMs ?? 0) - 1));
      const next = cur.enabled
        ? nextOccurrence(cur.spec, after, new Date(cur.createdAt))
        : null;
      return { ...cur, nextRunAt: next ? next.toISOString() : null };
    }).catch((err) => {
      console.warn(`[schedule-supervisor] advance ${scheduleId} failed: ${msgOf(err)}`);
    });
  }

  /**
   * Denormalise the outcome onto the schedule + drive the failure ceiling.
   *
   * BLOCKED IS NEUTRAL (P4.1): it neither resets the counter nor increments it. A blocked fire is
   * the schedule waiting for its owner — a machine of theirs that is not connected, a credential
   * only they can establish — and it says NOTHING about whether the schedule works.
   *
   * Counting it (the previous behaviour, pinned by supervisor.test.ts) meant twenty nights with the
   * laptop shut auto-paused a perfectly good schedule, and the owner would find it disabled rather
   * than waiting. Resetting the counter would be the opposite error: a schedule that is genuinely
   * broken could hide behind an occasional blocked fire and never reach the ceiling at all. Neither
   * direction is a judgement this outcome is entitled to make, so it makes neither.
   */
  private async recordOutcome(
    scheduleId: string,
    runId: string,
    outcome: ScheduleFireOutcome,
    manualTask: boolean,
  ): Promise<void> {
    const nowIso = this.deps.now();
    await updateScheduleSystem(scheduleId, (cur) => {
      const ok = outcome.status === 'ok';
      const blocked = outcome.status === 'blocked';
      const failures = ok ? 0 : blocked ? cur.consecutiveFailures : cur.consecutiveFailures + 1;
      const autoPause = !ok && !blocked && failures >= FAILURE_CEILING && cur.enabled;
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

/**
 * startRunForTrigger's outcome → a fire outcome.
 *
 * P4.1: `blocked` is a THIRD outcome now, not a shade of `failed`. A run that halted waiting for
 * its owner's machine or credential is not a failure of the schedule, and `recordOutcome` treats it
 * as neutral — see the docblock there for why counting it was actively harmful.
 */
export function mapAutomationOutcome(o: {
  outcome: 'completed' | 'failed' | 'blocked';
  permanent: boolean;
  runId?: string;
}): ScheduleFireOutcome {
  if (o.outcome === 'blocked') {
    return {
      status: 'blocked',
      code: 'automation_blocked',
      ...(o.runId ? { automationRunId: o.runId } : {}),
    };
  }
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
