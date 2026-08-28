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

/**
 * The blocked causes that are NEUTRAL against the failure ceiling (P4.1).
 *
 * The test is not "is it blocked" but "does waiting fix it". `awaiting_daemon` is a statement about
 * the ENVIRONMENT: the owner's machine is not connected, and the moment they open the laptop the
 * next fire succeeds with nobody having touched the schedule. Counting that punishes a working
 * schedule for its owner's sleep.
 *
 * Nothing else qualifies. `awaiting_consent` and `needs_credentials` are blocked on a HUMAN ACT,
 * and no number of retries brings one closer - they are exactly the cases where an unbounded retry
 * is the hazard (a rejected password resubmitted nightly against a portal with an unknown lock-out
 * policy), so they keep driving the ceiling and the schedule eventually auto-pauses. See
 * `recordOutcome`.
 */
export const NEUTRAL_BLOCKED_CODES: ReadonlySet<string> = new Set(['awaiting_daemon']);

/**
 * NEUTRAL IS NOT THE SAME AS FREE. The cooldown that bounds a neutral block's cost.
 *
 * Exempting `awaiting_daemon` from the ceiling removed the only cap on REPEATING it, and nothing
 * else bounded what a repetition costs. A per-minute schedule pointed at a bridge-only automation
 * with no daemon connected fired 1440 times a day, for ever: 1440 schedule-run rows plus 1440
 * automation-run rows, neither store having retention, and 1440 `schedule_blocked` notifications -
 * so the compensating measure that tells the owner was itself the unbounded thing. On main the
 * ceiling paused it after 20 fires. That pause was wrong (a shut laptop must not disable a working
 * schedule) and the answer to it must not be "unbounded" - it is "back off".
 *
 * So a neutral streak COOLS the schedule instead of pausing it: the pointer is advanced past the
 * cooldown without claiming an occurrence, so those fires leave no row, no run and no notification.
 * The schedule stays ENABLED and self-heals - the first fire after the cooldown either succeeds (the
 * streak resets) or blocks again (the streak grows). The cost of the halt becomes latency, which is
 * the honest price of waiting, instead of an unbounded write rate.
 *
 * THE CAP IS 15 MINUTES, deliberately below any cadence a person schedules by hand: an hourly or
 * nightly schedule never notices this exists, because its own next occurrence is always further out
 * than the cooldown. It only bites schedules that fire faster than they can possibly be unblocked -
 * which is exactly the unbounded case. Worst case for a per-minute schedule becomes ~96 rows a day
 * instead of 1440, and it resumes within 15 minutes of the laptop opening.
 */
const NEUTRAL_BACKOFF_BASE_MS = 60_000;
const NEUTRAL_BACKOFF_MAX_MS = 15 * 60_000;
/**
 * How often a CONTINUING neutral block may re-tell the owner. The first block of a streak notifies
 * immediately; after that, at most once a day. Without this the notification rate is the FIRE rate,
 * which is the thing being bounded - and a push repeated every minute is not a louder signal, it is
 * a channel the owner mutes.
 */
const NEUTRAL_RENOTIFY_MS = 24 * 60 * 60_000;

/** The cooldown a streak of `n` consecutive neutral blocks earns. */
export function neutralBackoffMs(n: number): number {
  if (n < 1) return 0;
  return Math.min(NEUTRAL_BACKOFF_BASE_MS * 2 ** (n - 1), NEUTRAL_BACKOFF_MAX_MS);
}

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
      // Only an actual EXECUTION costs a slot: a stale verdict, a manual task and a COOLING
      // schedule (all three of which fire nothing) must never queue behind a slow automation. A
      // deferred occurrence keeps its `seenDue` entry, so the next pass judges it by the grace it
      // had when we first saw it - and the due list is ordered by `nextRunAt`, so the oldest
      // deferral wins the next slot.
      const cooling = this.coolingUntilMs(schedule) > nowMs;
      if (!stale && !cooling && schedule.target.kind !== 'manual' && this.inFlight.size >= maxConcurrent) {
        deferred += 1;
        continue;
      }
      await this.claimAndFire(schedule, gen, { stale, cooling, nowMs });
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

  /** When this schedule's neutral cooldown ends, in ms; 0 when it is not cooling. ONE expression,
   *  because the pass reads it to keep a cooling schedule out of the slot gate (it fires nothing,
   *  so it must not queue behind a slow automation) and `claimAndFire` reads it to skip the claim.
   *  Two copies could disagree, and the disagreement would be a schedule that occupies a slot it
   *  never uses. A corrupt stamp answers 0: fail OPEN here, because a cooldown that cannot be read
   *  must not be able to stop a schedule for ever. */
  private coolingUntilMs(schedule: ScheduleDoc): number {
    const at = schedule.neutralBackoffUntil ? Date.parse(schedule.neutralBackoffUntil) : 0;
    return Number.isFinite(at) ? at : 0;
  }

  private async claimAndFire(
    schedule: ScheduleDoc,
    gen: number,
    judged: { stale: boolean; cooling: boolean; nowMs: number },
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

    // 1b. COOLING after a neutral block. The last fire halted on something only waiting fixes
    //     (`NEUTRAL_BLOCKED_CODES`), so firing again now costs a run row, an automation run and a
    //     notification to say the identical thing. Advance the pointer past the cooldown and claim
    //     nothing: the occurrence leaves NO trace, which is the point - neutrality is what stops
    //     the ceiling pausing a working schedule, and this is what stops it being unbounded.
    //     The schedule stays enabled and resumes by itself at the far side.
    if (judged.cooling) {
      await this.advance(schedule._id, plannedFor, this.coolingUntilMs(schedule));
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
    const { notify } = await this.recordOutcome(schedule._id, runId, outcome, false);
    // P4.1 - A BLOCKED FIRE TELLS ITS OWNER, whichever kind of block it is. `ok` needs no telling
    // and `failed` drives the ceiling and eventually auto-pauses loudly, but an ENVIRONMENT block is
    // neutral by design (`NEUTRAL_BLOCKED_CODES`), so without this a schedule could sit waiting on a
    // machine for weeks in silence. The alternative the rest of this slice exists to forbid is worse
    // - running the work anyway from a datacenter IP against an origin declared bridge-only.
    //
    // BOUNDED for the neutral kind (`notify`, decided in `recordOutcome`): the first block of a
    // streak tells the owner at once, and a CONTINUING one at most daily. A push repeated at the
    // fire rate is not a louder signal - it is the unbounded thing the cooldown exists to stop, one
    // channel over. Non-neutral blocks are unchanged: they drive the ceiling and auto-pause, so they
    // are already capped.
    if (outcome.status === 'blocked' && notify) {
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
   * BLOCKED IS NEUTRAL ONLY WHEN THE BLOCK IS ABOUT THE ENVIRONMENT - `NEUTRAL_BLOCKED_CODES`, and
   * the distinction is the whole of P4.1's honesty here.
   *
   * `awaiting_daemon` (a machine of the owner's is not connected) neither resets the counter nor
   * increments it. Counting it - the behaviour before this slice - meant twenty nights with the
   * laptop shut auto-paused a perfectly good schedule, and the owner would find it disabled rather
   * than waiting. Resetting it would be the opposite error: a genuinely broken schedule could hide
   * behind an occasional blocked fire and never reach the ceiling at all. Neither direction is a
   * judgement that outcome is entitled to make, so it makes neither.
   *
   * EVERY OTHER BLOCK STILL COUNTS, and that is not a concession - it IS the cap. A block on a
   * DECISION or a CREDENTIAL (`awaiting_consent`, `needs_credentials`) does not resolve by waiting:
   * nothing changes between fires unless a human acts. Making those neutral too removed the only
   * limit on repeating them, and the worst shape of that is concrete - a portal password changes,
   * the nightly fire routes to the typist under a standing grant, submits, meets the wrong-password
   * signature, halts `needs_credentials`, and then does it again every night forever against a
   * portal with an unknown lock-out policy. The failure ceiling is the per-schedule cap on exactly
   * that, it existed before this slice, and this is why it stays.
   *
   * AND NEUTRAL IS NOT FREE. Exempting a block from the ceiling removes the only cap on REPEATING
   * it, so the exemption has to bring its own bound or it is just an unbounded loop wearing a
   * better name. A neutral fire therefore earns a COOLDOWN (`neutralBackoffMs`, doubling to a
   * 15-minute cap) during which `claimAndFire` advances the pointer without claiming: no run row,
   * no automation run, no notification, and the schedule still enabled and still self-healing. The
   * returned `notify` carries the other half - the first block of a streak tells the owner at once,
   * a continuing one at most daily - because a push at the fire rate is the same unbounded thing
   * one channel over.
   */
  private async recordOutcome(
    scheduleId: string,
    runId: string,
    outcome: ScheduleFireOutcome,
    manualTask: boolean,
  ): Promise<{ notify: boolean }> {
    const nowIso = this.deps.now();
    const nowMs = Date.parse(nowIso);
    let notify = outcome.status === 'blocked';
    await updateScheduleSystem(scheduleId, (cur) => {
      const ok = outcome.status === 'ok';
      const neutral = outcome.status === 'blocked' && NEUTRAL_BLOCKED_CODES.has(outcome.code ?? '');
      const failures = ok ? 0 : neutral ? cur.consecutiveFailures : cur.consecutiveFailures + 1;
      const autoPause = !ok && !neutral && failures >= FAILURE_CEILING && cur.enabled;
      if (autoPause) {
        console.warn(
          `[schedule-supervisor] schedule ${scheduleId} disabled after ${failures} consecutive non-ok fires (last: ${outcome.code ?? outcome.status})`,
        );
      }
      // A manual task is complete at claim and reports nothing about the environment, so it neither
      // starts a cooldown nor clears one.
      if (manualTask) return { ...cur, lastRun: { runId, status: 'pending' as const, at: nowIso, ...(outcome.code ? { code: outcome.code } : {}) }, updatedAt: nowIso };

      const streak = neutral ? (cur.consecutiveNeutralBlocks ?? 0) + 1 : 0;
      const lastToldMs = cur.lastNeutralNotifiedAt ? Date.parse(cur.lastNeutralNotifiedAt) : NaN;
      if (neutral) {
        notify = streak === 1 || !Number.isFinite(lastToldMs) || nowMs - lastToldMs >= NEUTRAL_RENOTIFY_MS;
      }
      return {
        ...cur,
        lastRun: {
          runId,
          status: outcome.status,
          at: nowIso,
          ...(outcome.code ? { code: outcome.code } : {}),
        },
        consecutiveFailures: failures,
        consecutiveNeutralBlocks: streak,
        neutralBackoffUntil: neutral ? new Date(nowMs + neutralBackoffMs(streak)).toISOString() : null,
        ...(neutral && notify ? { lastNeutralNotifiedAt: nowIso } : {}),
        ...(autoPause ? { enabled: false, nextRunAt: null, autoPausedAt: nowIso } : {}),
        updatedAt: nowIso,
      };
    }).catch((err) => {
      console.warn(`[schedule-supervisor] record ${scheduleId} failed: ${msgOf(err)}`);
    });
    return { notify };
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
 * its owner's machine or credential is not a failure of the schedule.
 *
 * THE CODE TRAVELS VERBATIM, and it has to. `recordOutcome` treats only the ENVIRONMENT block as
 * neutral against the ceiling, and the badge the owner sees derives its words from this code - both
 * of which need to know WHICH block it was. A single flat `automation_blocked` (the first cut of
 * this slice) is what made "your laptop is shut" and "your password was rejected" the same event,
 * which cost the credential case its only retry cap and told the owner to go find an approval that
 * does not exist. It falls back to the flat code only when the seam supplied none.
 */
export function mapAutomationOutcome(o: {
  outcome: 'completed' | 'failed' | 'blocked';
  code?: string;
  permanent: boolean;
  runId?: string;
}): ScheduleFireOutcome {
  if (o.outcome === 'blocked') {
    return {
      status: 'blocked',
      code: o.code ?? 'automation_blocked',
      ...(o.runId ? { automationRunId: o.runId } : {}),
    };
  }
  return {
    status: o.outcome === 'completed' ? 'ok' : 'failed',
    ...(o.outcome === 'failed' ? { code: o.permanent ? 'automation_gone' : 'automation_failed' } : {}),
    ...(o.runId ? { automationRunId: o.runId } : {}),
  };
}

/** executeUserIntegrationAction's result → a fire outcome. `awaiting_consent` and
 *  `needs_credentials` are BLOCKED — both need the owner (an approval, a credential ceremony),
 *  never a failure to retry and never a thing to resolve from here. Before K2 the credential halt
 *  arrived flattened as `automation_failed`, so an integration_action schedule burned the failure
 *  ceiling and auto-paused with no notification (the ledgered finding). */
export function mapIntegrationOutcome(r: {
  success: boolean;
  code?: string;
  error?: string;
}): ScheduleFireOutcome {
  if (r.success) return { status: 'ok' };
  return {
    status: r.code === 'awaiting_consent' || r.code === 'needs_credentials' ? 'blocked' : 'failed',
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
