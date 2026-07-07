/**
 * Trigger delivery pipeline (ch02 §2.6 events/; ch05 §5.6.7 retry boundary; carried mechanics
 * reference/invisible-behaviors.md §12.3). Drains the durable event queue and dispatches each
 * event to its trigger's target — starting an automation run or invoking an artifact backend.
 *
 * ALL retry semantics for triggered work live HERE (30s / 2m / 10m / 1h / 6h ±30% jitter, dead
 * after 5 attempts, boot recovery of stuck deliveries): the automation engine and the artifact
 * backend runtime never retry themselves. A trigger-started run that ends non-`completed`
 * counts as a delivery failure and re-enters the schedule; a user-started run never retries.
 *
 * Delivery targets are callbacks INJECTED at the composition root (never upward imports —
 * ch02 §2.8), and the pipeline exposes explicit start()/stop(): server.ts starts it only AFTER
 * the HTTP server is listening (boot ordering constraint — re-entrant deliveries must find a
 * live listener).
 */
import { triggers } from '../data/stores.js';
import {
  claimNext,
  markDelivered,
  markFailed,
  markDead,
  recoverStuck,
  type QueuedEvent,
} from './queue.js';
import type { TriggerDoc } from './service.js';

/** The event context a target receives — the payload plus the server-trusted trigger row.
 *  RunContext.ownerUserId MUST come from trigger.ownerUserId, never from the payload (B7). */
export interface DeliveryEvent {
  eventId: string;
  trigger: TriggerDoc;
  /** The raw enqueued payload (webhook body as UTF-8 text for ingress events). */
  payload: unknown;
  attempts: number;
}

export type DeliveryOutcome =
  | { ok: true }
  | { ok: false; reason: string; permanent?: boolean };

export interface DeliveryTargets {
  /** Start an automation run under the TRIGGER OWNER's identity and await its terminal
   *  status; non-`completed` is a delivery failure (re-enters the retry schedule). */
  startAutomationRun(automationId: string, event: DeliveryEvent): Promise<DeliveryOutcome>;
  /** Invoke an artifact backend entrypoint with the event envelope. */
  invokeArtifactBackend(artifactId: string, entrypoint: string, event: DeliveryEvent): Promise<DeliveryOutcome>;
}

const defaultTargets: DeliveryTargets = {
  // Honest defaults: a target that is not wired yet fails the attempt (retry schedule applies),
  // so an event is never silently swallowed before the composition root binds the real targets.
  async startAutomationRun() {
    return { ok: false, reason: 'automation delivery target not wired' };
  },
  async invokeArtifactBackend() {
    return { ok: false, reason: 'artifact-backend delivery target not wired' };
  },
};
let targets: DeliveryTargets = defaultTargets;
export function setDeliveryTargets(t: DeliveryTargets): void {
  targets = t;
}

const MAX_IN_FLIGHT = 4; // carried concurrency (§12.3)
const SAFETY_NET_INTERVAL_MS = 5_000;

interface PipelineState {
  running: boolean;
  inFlight: Set<Promise<void>>;
  timer?: NodeJS.Timeout;
  draining: boolean;
}
const state: PipelineState = { running: false, inFlight: new Set(), draining: false };

async function dispatchOne(row: QueuedEvent, now: () => number): Promise<void> {
  const trigger = (await triggers.get(row.triggerId)) as TriggerDoc | null;
  if (!trigger) {
    await markDead(row._id, 'trigger no longer exists');
    return;
  }
  const event: DeliveryEvent = { eventId: row._id, trigger, payload: row.payload, attempts: row.attempts };
  let outcome: DeliveryOutcome;
  try {
    if (trigger.targetKind === 'automation') {
      if (!trigger.automationId) {
        await markDead(row._id, 'trigger has no automationId');
        return;
      }
      outcome = await targets.startAutomationRun(trigger.automationId, event);
    } else {
      if (!trigger.artifactId || !trigger.entrypoint) {
        await markDead(row._id, 'trigger has no artifact target');
        return;
      }
      outcome = await targets.invokeArtifactBackend(trigger.artifactId, trigger.entrypoint, event);
    }
  } catch (err) {
    outcome = { ok: false, reason: err instanceof Error ? err.message : 'delivery threw' };
  }
  if (outcome.ok) {
    await markDelivered(row._id);
  } else if (outcome.permanent) {
    await markDead(row._id, outcome.reason);
  } else {
    await markFailed(row._id, outcome.reason, now());
  }
}

async function drain(now: () => number): Promise<void> {
  if (state.draining) return; // one drain loop at a time; in-flight slots bound the work
  state.draining = true;
  try {
    while (state.running && state.inFlight.size < MAX_IN_FLIGHT) {
      const row = await claimNext(new Date(now()).toISOString());
      if (!row) break;
      const p = dispatchOne(row, now)
        .catch(() => undefined)
        .finally(() => {
          state.inFlight.delete(p);
          if (state.running) void drain(now);
        });
      state.inFlight.add(p);
    }
  } finally {
    state.draining = false;
  }
}

/** Nudge the pipeline (called by ingress after a successful enqueue). No-op when stopped. */
export function wakeDelivery(now: () => number = Date.now): void {
  if (state.running) void drain(now);
}

/** Start the pipeline: boot recovery, then the 5s unref'd safety-net poll (§12.3). Called by
 *  server.ts strictly AFTER listen. Idempotent. */
export async function startDelivery(now: () => number = Date.now): Promise<void> {
  if (state.running) return;
  state.running = true;
  await recoverStuck(now());
  state.timer = setInterval(() => void drain(now), SAFETY_NET_INTERVAL_MS);
  state.timer.unref?.();
  void drain(now);
}

/** Stop the pipeline; waits up to 30s for in-flight deliveries (the rest recovers next boot). */
export async function stopDelivery(waitMs = 30_000): Promise<void> {
  state.running = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
  const pending = [...state.inFlight];
  if (pending.length) {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise((r) => setTimeout(r, waitMs)),
    ]);
  }
}

/** Reset targets + state (tests). */
export function __resetDeliveryForTests(): void {
  targets = defaultTargets;
  state.running = false;
  if (state.timer) clearInterval(state.timer);
  state.timer = undefined;
  state.inFlight.clear();
  state.draining = false;
}
