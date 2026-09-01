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
  PollActionError,
  type UserIntegrationCallResult,
} from '../integrations/event-sources/user-defined-poll.js';

const RESTART_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 120_000, 300_000];
const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_RECONCILE_MS = 30_000;

/**
 * Poll outcomes that are WAITING ON AN ACT, not failing (the schedules supervisor's K2 reading:
 * `needs_credentials` / `awaiting_consent` are blocked on a human, `awaiting_daemon` on a machine
 * coming back). The seconds-first restart ladder exists for transient faults; against these codes
 * it is a browser-run storm - each retry re-executes the poll action, walks into the same wall,
 * and parks ANOTHER credential ceremony. Found live (2026-09-01) on the citius listener: retries at
 * 1s/2s/4s… each drove a fresh headed browser at a real portal's sign-in page.
 */
const WAITING_ON_ACT_CODES: ReadonlySet<string> = new Set([
  'needs_credentials',
  'awaiting_consent',
  'awaiting_daemon',
]);

/** The slowest ladder rung: a waiting poll re-checks at its own interval, never faster than this. */
const WAITING_FLOOR_MS = 300_000;

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
      const interval = state.trigger.pollConfig?.intervalMs ?? DEFAULT_INTERVAL_MS;
      this.scheduleTick(state, interval);
    } catch (err) {
      if (state.cancelled) return;
      const message = msgOf(err);
      // A poll WAITING ON AN ACT is parked at its own cadence, never walked down the seconds-first
      // ladder: retrying cannot fix it, and for `needs_credentials` every retry EXECUTES the action
      // again - a browser run into the same sign-in wall, parking one more ceremony. The audit row
      // is still written (the owner should see what the listener is waiting on), but the failure
      // streak is not advanced - waiting is not failing.
      const code = err instanceof PollActionError ? err.code : undefined;
      if (code && WAITING_ON_ACT_CODES.has(code)) {
        try { await this.deps.bumpFailure(state.triggerId, message); } catch { /* best-effort audit */ }
        if (state.cancelled) return;
        const interval = state.trigger.pollConfig?.intervalMs ?? DEFAULT_INTERVAL_MS;
        const delay = Math.max(interval, WAITING_FLOOR_MS);
        console.warn(
          `[listener-supervisor] trigger ${state.triggerId} (${state.trigger.integrationKey}) is waiting on ${code} (a person or a machine must act): ${message}; next poll in ${delay}ms`,
        );
        this.scheduleTick(state, delay);
        return;
      }
      state.consecutiveFailures += 1;
      try { await this.deps.bumpFailure(state.triggerId, message); } catch { /* best-effort audit */ }
      if (state.cancelled) return;
      const idx = Math.min(state.consecutiveFailures - 1, RESTART_BACKOFF_MS.length - 1);
      const delay = RESTART_BACKOFF_MS[idx]!; // idx is clamped in-range

      console.warn(
        `[listener-supervisor] trigger ${state.triggerId} (${state.trigger.integrationKey}) failed (${state.consecutiveFailures}): ${message}; backoff ${delay}ms`,
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
