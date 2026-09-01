/**
 * Listener supervisor + poll loop for `kind: 'listener'` triggers (2A-S1).
 *
 * For each active listener trigger the supervisor maintains a long-lived per-trigger poll task:
 * every `pollConfig.intervalMs` it polls the trigger's source, normalises the response, and
 * enqueues one durable event per item into the SHARED event queue (never a second queue). Ported
 * from ekoa-dev (cortex/src/services/listener-supervisor.ts); the isolation contract, exponential
 * restart backoff, and cursor-advance-only-after-enqueue discipline are carried verbatim.
 *
 * ekoa-code adaptations:
 *  - DEPS-INJECTED. Everything the loop needs (list of listeners, the listener-state cursor store,
 *    the queue enqueue adapter, the platform OAuth-refreshing call, and the clock) arrives via a
 *    `ListenerSupervisorDeps` bundle wired ONLY at the composition root (server.ts). The dev version
 *    reached module-level singletons; here nothing crosses a seam except through the injected deps.
 *  - CANCEL-SAFE. `start()`/`stop()` are idempotent; a `stop()` cancels every loop, clears every
 *    (unref'd) timer, and AWAITS any in-flight tick so a stale poll cannot write its cursor after
 *    stop. No work happens after `stop()`.
 *  - RECONCILE instead of a store event-bus. ekoa-code's triggers store has no lifecycle emitter, so
 *    the supervisor diffs the store's listener set against its running loops on `start()` and then on
 *    an unref'd reconcile interval: a newly-created listener spins up within one interval, a
 *    deleted/disabled one is stopped. LIMITATION (v1, documented): reconcile keys on the trigger id
 *    only, so a `pollConfig` change on an EXISTING listener is not picked up until the loop is
 *    stopped+restarted (delete+recreate, or process restart) — the dev version stop/restarted on an
 *    'updated' event. The behavioural property the gate cares about (a listener polls + enqueues; a
 *    failing listener backs off without affecting siblings) is fully met.
 *  - TWO poll branches, one shape. Platform providers (M365/Google) poll through
 *    `pollPlatformSource` + the injected `callPlatform` (OAuth refresh in core). Every other
 *    (user-defined / IMAP / generic) listener polls through `pollUserDefinedSource` + the injected
 *    `callUserIntegration` (the integrations/ action executor), driven by the integration package's
 *    `listenerConfig` (2A-S4). Both branches carry the same durability contract
 *    (cursor-advance-only-after-enqueue, deterministic dedup key, cancel-safe, first-poll = no
 *    backfill) and both report a `stalled` tick so a non-advancing cursor is observable.
 *
 * Isolation contract: a thrown exception in one listener's tick never affects siblings or the
 * main-thread dispatcher. Each listener is an independent timer loop with try/catch at every tick +
 * an exponential restart backoff (1s → 5m).
 */

import { enqueue } from './queue.js';
import type { TriggerDoc } from './service.js';
import {
  isPlatformProvider,
  pollPlatformSource,
  type EnqueueInput,
  type EnqueueResult,
  type PlatformCallResult,
} from '../integrations/event-sources/platform-poll.js';
import {
  pollUserDefinedSource,
  isBlockedPollError,
  type UserIntegrationCallResult,
} from '../integrations/event-sources/user-defined-poll.js';

const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 120_000, 300_000];

/**
 * The cadence for a poll that CANNOT succeed until something changes (`isBlockedPollError`).
 *
 * WHY THE FAST RAMP IS WRONG HERE, and it is not a matter of taste. `RESTART_BACKOFF_MS` starts at
 * one second because a transient failure plausibly clears in one second. A missing session does
 * not: it clears when a person completes a ceremony, pairs a machine, or grants an approval. And a
 * poll is not a cheap probe - an automation-backed poll RUNS THE AUTOMATION, so with
 * `desktop.automation` granted every attempt OPENS A REAL BROWSER WINDOW on the owner's desktop.
 * Ramping from 1s therefore opened a window at 1, 2, 4, 8, 16, 32 and 60 seconds and then once a
 * minute for as long as the daemon stayed up, against a live court portal (found live 2026-08-31:
 * the owner watched a browser open and close on a loop and asked for it to be stopped).
 *
 * ESCALATING, NOT FLAT, and capped an hour out. Flat-at-15-minutes still costs 96 windows a day for
 * a block nobody is clearing; the streak makes an unattended block cost 24 a day at worst while a
 * block that IS about to be cleared still resumes within a quarter of an hour. The floor never goes
 * below the trigger's own configured interval - a listener must not poll FASTER while blocked than
 * it does while healthy.
 *
 * THIS IS THE SAME TRADE `schedules/supervisor.ts` MAKES (`NEUTRAL_BACKOFF_BASE_MS`, cap 15
 * minutes): "the cost of the halt becomes latency, which is the honest price of waiting, instead of
 * an unbounded write rate". The cap is longer here because the unit of cost is worse - a schedule's
 * repetition writes a row, a listener's opens a window in front of a human.
 */
const BLOCKED_BACKOFF_MS = [900_000, 1_800_000, 3_600_000]; // 15min -> 30min -> 60min

/**
 * How long before the next attempt, given what just happened. PURE, and exported so the policy is
 * pinned by its numbers rather than by racing `setTimeout` in a test.
 *
 * `blocks` and `failures` are separate streaks on purpose: a block must never advance the failure
 * ramp (it would reach the 5-minute ceiling and stay there, still opening a window every 5 minutes)
 * and a failure must never advance the blocked one (a genuinely flaky poll would be pushed out to
 * an hour, which is the opposite mistake).
 */
export function nextPollDelayMs(input: {
  blocked: boolean;
  failures: number;
  blocks: number;
  intervalMs: number | undefined;
}): number {
  if (input.blocked) {
    const idx = Math.min(Math.max(input.blocks, 1) - 1, BLOCKED_BACKOFF_MS.length - 1);
    // A blocked listener must never poll FASTER than its healthy cadence: a package that declares a
    // two-hour interval has said something about the cost of asking, and being blocked does not
    // make asking cheaper.
    return Math.max(BLOCKED_BACKOFF_MS[idx]!, input.intervalMs ?? DEFAULT_INTERVAL_MS);
  }
  const idx = Math.min(Math.max(input.failures, 1) - 1, RESTART_BACKOFF_MS.length - 1);
  return RESTART_BACKOFF_MS[idx]!;
}
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_RECONCILE_MS = 30_000;

/** The trigger fields a poll loop needs — a projection of the durable TriggerDoc. */
export type SupervisorTrigger = Pick<
  TriggerDoc,
  '_id' | 'orgId' | 'ownerUserId' | 'integrationKey' | 'eventName' | 'pollConfig' | 'disabled'
>;

export interface ListenerSupervisorDeps {
  /** The set of ACTIVE (non-disabled) `kind:'listener'` triggers to poll. */
  listListeners(): Promise<SupervisorTrigger[]>;
  /** Durable per-listener cursor store (events/listener-state.ts). */
  readCursor(triggerId: string): Promise<unknown>;
  writeCursor(triggerId: string, cursor: unknown): Promise<void>;
  bumpFailure(triggerId: string, error: string): Promise<void>;
  /** Enqueue a polled item into the SHARED durable queue (idempotency is the queue's job). */
  enqueue(input: EnqueueInput): Promise<EnqueueResult>;
  /** Platform OAuth-refreshing call, bound to the trigger's org by the composition root. */
  callPlatform(trigger: SupervisorTrigger, args: Record<string, unknown>): Promise<PlatformCallResult>;
  /**
   * User-defined (non-platform) integration action call — `executeUserIntegrationAction`, bound to
   * the trigger's org + owner by the composition root (2A-S4). REQUIRED: making it optional would
   * let the process boot with a half-wired listener rail whose only symptom is a runtime throw;
   * the type system catches it instead.
   */
  callUserIntegration(
    trigger: SupervisorTrigger,
    call: { integrationKey: string; actionName: string; args: Record<string, unknown> },
  ): Promise<UserIntegrationCallResult>;
  /** Current ISO timestamp (injected so tests are deterministic). */
  now(): string;
  /** How often to reconcile the active loop set against the store. Default 30s. */
  reconcileIntervalMs?: number;
}

interface ActiveListener {
  triggerId: string;
  trigger: SupervisorTrigger;
  cancelled: boolean;
  consecutiveFailures: number;
  /** Consecutive BLOCKED polls (see BLOCKED_BACKOFF_MS) - tracked apart from failures so a block
   *  never advances the failure ramp and a failure never advances the blocked one. */
  consecutiveBlocks: number;
  nextTimer: NodeJS.Timeout | null;
  /** In-flight tick promise, if any. Awaited by stopListener so a stale tick cannot write its
   *  cursor over a fresh listener's / after stop. */
  tickPromise: Promise<void> | null;
}

export class ListenerSupervisor {
  private readonly active = new Map<string, ActiveListener>();
  private running = false;
  private reconcileTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ListenerSupervisorDeps) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.reconcile();
    const ms = this.deps.reconcileIntervalMs ?? DEFAULT_RECONCILE_MS;
    this.reconcileTimer = setInterval(() => { void this.reconcile(); }, ms);
    this.reconcileTimer.unref?.();
    if (this.active.size > 0) {
      console.log(`[listener-supervisor] started ${this.active.size} listener(s)`);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = null;
    await Promise.all([...this.active.keys()].map((id) => this.stopListener(id)));
  }

  /** Diff the store's listener set against the running loops: start new, stop removed/disabled. */
  async reconcile(): Promise<void> {
    if (!this.running) return;
    let listeners: SupervisorTrigger[];
    try {
      listeners = await this.deps.listListeners();
    } catch (err) {
      console.warn(`[listener-supervisor] reconcile failed: ${msgOf(err)}`);
      return;
    }
    if (!this.running) return;
    const wanted = new Set(listeners.map((t) => t._id));
    for (const id of [...this.active.keys()]) {
      if (!wanted.has(id)) await this.stopListener(id);
    }
    for (const t of listeners) {
      if (!this.active.has(t._id)) this.startListener(t);
    }
  }

  private startListener(t: SupervisorTrigger): void {
    if (this.active.has(t._id)) return;
    const state: ActiveListener = {
      triggerId: t._id,
      trigger: t,
      cancelled: false,
      consecutiveFailures: 0,
      consecutiveBlocks: 0,
      nextTimer: null,
      tickPromise: null,
    };
    this.active.set(t._id, state);
    this.scheduleTick(state, 0);
  }

  private async stopListener(triggerId: string): Promise<void> {
    const s = this.active.get(triggerId);
    if (!s) return;
    s.cancelled = true;
    if (s.nextTimer) clearTimeout(s.nextTimer);
    this.active.delete(triggerId);
    // Wait for any in-flight tick to settle so a late cursor write can't resurrect deleted state
    // or overwrite a freshly-started listener.
    if (s.tickPromise) {
      try { await s.tickPromise; } catch { /* tick errors already logged */ }
    }
  }

  private scheduleTick(state: ActiveListener, delayMs: number): void {
    if (state.cancelled || !this.running) return;
    state.nextTimer = setTimeout(() => {
      const p = this.runTick(state);
      state.tickPromise = p;
      void p.finally(() => { if (state.tickPromise === p) state.tickPromise = null; });
    }, delayMs);
    state.nextTimer.unref?.();
  }

  private async runTick(state: ActiveListener): Promise<void> {
    if (state.cancelled || !this.running) return;
    try {
      await this.pollOnce(state);
      if (state.cancelled) return;
      state.consecutiveFailures = 0;
      state.consecutiveBlocks = 0;
      const interval = state.trigger.pollConfig?.intervalMs ?? DEFAULT_INTERVAL_MS;
      this.scheduleTick(state, interval);
    } catch (err) {
      if (state.cancelled) return;
      const message = msgOf(err);
      // BLOCKED IS NOT FAILED. A poll that cannot succeed until a person acts gets its own, slow
      // cadence and its own streak: counting it as a failure would ramp from one second toward a
      // state no amount of retrying reaches, and every one of those attempts opens a browser window
      // (see BLOCKED_BACKOFF_MS). The audit row is still written - a blocked listener must be just
      // as visible as a failing one, it must simply stop hammering.
      const blocked = isBlockedPollError(err);
      if (blocked) state.consecutiveBlocks += 1;
      else state.consecutiveFailures += 1;
      try { await this.deps.bumpFailure(state.triggerId, message); } catch { /* best-effort audit */ }
      if (state.cancelled) return;

      const delay = nextPollDelayMs({
        blocked,
        failures: state.consecutiveFailures,
        blocks: state.consecutiveBlocks,
        intervalMs: state.trigger.pollConfig?.intervalMs,
      });

      console.warn(
        `[listener-supervisor] trigger ${state.triggerId} (${state.trigger.integrationKey}) `
        + (blocked
          ? `BLOCKED (${state.consecutiveBlocks}) - waiting rather than retrying: ${message}; next attempt in ${delay}ms`
          : `failed (${state.consecutiveFailures}): ${message}; backoff ${delay}ms`),
      );
      this.scheduleTick(state, delay);
    }
  }

  private async pollOnce(state: ActiveListener): Promise<void> {
    const trigger = state.trigger;
    // Platform providers (M365 / Google) go through the injected callPlatform so the OAuth refresh
    // happens in core; the cursor/dedup/advance contract lives in the generic platform-poll helper.
    if (isPlatformProvider(trigger.integrationKey)) {
      const res = await pollPlatformSource(
        { id: trigger._id, integrationKey: trigger.integrationKey },
        {
          call: (args) => this.deps.callPlatform(trigger, args),
          readCursor: (id) => this.deps.readCursor(id),
          writeCursor: (id, cursor) => this.deps.writeCursor(id, cursor),
          enqueue: (input) => this.deps.enqueue(input),
          now: () => this.deps.now(),
          isCancelled: () => state.cancelled,
        },
      );
      if (res.stalled) {
        // Observable, not silent: the per-tick item cap was hit. The remainder is picked up next
        // tick; the durable fix is the Graph change-notification upgrade.
        console.warn(
          `[listener-supervisor] trigger ${trigger._id} (${trigger.integrationKey}): poll hit the per-tick item cap; deferring the remainder to the next tick`,
        );
      }
      return;
    }

    // User-defined (IMAP/generic) listener path (2A-S4): the poll runs through the integrations/
    // action executor, driven by the integration package's listenerConfig. Any failure — unknown
    // package, missing listenerConfig, a failed action, or the deferred IMAP transport's
    // `unsupported_transport` refusal — THROWS here, so the backoff absorbs it and bumpFailure
    // leaves an audit row. Never a silent no-op.
    const res = await pollUserDefinedSource(
      {
        id: trigger._id,
        integrationKey: trigger.integrationKey,
        // A2/F5: the poll rail resolves the integration package TENANT-SCOPED, and that scoping is
        // dead code unless the org travels with the trigger. `TriggerDoc` carries both fields as
        // REQUIRED, so passing them costs nothing and is what makes the listener read this org's
        // package instead of whatever is in the process-wide runtime tier.
        orgId: trigger.orgId,
        ...(trigger.ownerUserId ? { ownerUserId: trigger.ownerUserId } : {}),
        ...(trigger.pollConfig?.actionName ? { pollActionName: trigger.pollConfig.actionName } : {}),
      },
      {
        call: (call) => this.deps.callUserIntegration(trigger, call),
        readCursor: (id) => this.deps.readCursor(id),
        writeCursor: (id, cursor) => this.deps.writeCursor(id, cursor),
        enqueue: (input) => this.deps.enqueue(input),
        now: () => this.deps.now(),
        isCancelled: () => state.cancelled,
      },
    );
    if (res.stalled) {
      // Observable, not silent: the tick delivered its items but could not advance the cursor, so
      // the next tick re-fetches the same window (the queue's UNIQUE dedupes the repeats).
      console.warn(
        `[listener-supervisor] trigger ${trigger._id} (${trigger.integrationKey}): cursor did not advance — ${res.stallReason ?? 'unknown reason'}`,
      );
    }
  }
}

/**
 * Bridge the platform-poll injected-enqueue contract (EnqueueInput) to the durable event queue.
 * The payload persisted is the item's JSON text — mirroring the webhook ingress path, which stores
 * the raw body as UTF-8 text. Wired by server.ts and reused by the poll tests so both drive the
 * exact production enqueue path.
 */
export async function enqueueListenerEvent(input: EnqueueInput, nowIso: string): Promise<EnqueueResult> {
  const r = await enqueue(input.triggerId, input.dedupKey, input.rawBody.toString('utf8'), nowIso);
  return r.duplicate ? { kind: 'duplicate' } : { kind: 'inserted' };
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Module-level lifecycle wrappers (mirroring events/delivery.ts): the composition root configures
// the singleton with the real deps, then starts it AFTER the HTTP server is listening and stops it
// on shutdown. Tests construct `new ListenerSupervisor(deps)` directly instead.
// ---------------------------------------------------------------------------

let singleton: ListenerSupervisor | null = null;

/** Bind the supervisor's injected deps (server.ts only). Replaces any prior instance. */
export function configureListenerSupervisor(deps: ListenerSupervisorDeps): ListenerSupervisor {
  singleton = new ListenerSupervisor(deps);
  return singleton;
}

/** Start the configured supervisor (no-op if unconfigured). Idempotent. */
export async function startListenerSupervisor(): Promise<void> {
  if (singleton) await singleton.start();
}

/** Stop the configured supervisor (no-op if unconfigured). Idempotent. */
export async function stopListenerSupervisor(): Promise<void> {
  if (singleton) await singleton.stop();
}

/** Reset the singleton (tests). */
export function __resetListenerSupervisorForTests(): void {
  singleton = null;
}
