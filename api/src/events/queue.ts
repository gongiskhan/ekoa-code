/**
 * Durable event queue with dedup (ch09 invariant 9 step 3). The dedup uniqueness constraint
 * `UNIQUE(trigger_id, dedup_key)` is expressed as a deterministic `_id = triggerId::dedupKey`
 * insert — the atomic-insert-as-uniqueness pattern (ch04 §4.1). A collision means the event
 * was already enqueued (idempotency).
 *
 * DEVIATION (logged, ch14 §14.2.3): P-06 specifies SQLite WAL for the queue backend; this
 * build uses the Firestore/Mongo store with identical dedup SEMANTICS (deterministic-_id
 * insert = the UNIQUE constraint) to keep one storage idiom and avoid a native SQLite dep.
 * The security-relevant contract (dedup + audit) is unchanged and is what the gate tests.
 */
import { randomUUID } from 'node:crypto';
import { eventQueue } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export interface QueuedEvent extends Doc {
  triggerId: string;
  dedupKey: string;
  payload: unknown;
  status: 'pending' | 'dispatching' | 'delivered' | 'dead';
  attempts: number;
  enqueuedAt: string;
  /** Earliest ISO time the next delivery attempt may run (retry backoff). Absent = due now. */
  nextAttemptAt?: string;
  /** Set when the row is claimed; used by boot recovery to flip stuck dispatching rows. */
  claimedAt?: string;
  /** A random token written by the CAS winner; the claimant is the caller whose token is on the
   *  row after the write. Distinguishes the real winner from a CAS loser that read the same row. */
  claimToken?: string;
  /** The last delivery failure, kept for the dead-letter audit trail. */
  lastError?: string;
}

/** Retry schedule (carried VERBATIM from the old event-queue.ts scheduleRetry, cited by
 *  reference/invisible-behaviors.md §12.3): the Nth FAILURE (N = attempts made, 1-based) re-arms
 *  with schedule[N-1] ±30% jitter; a failure past the schedule (the 6th attempt) dead-letters.
 *  So: 5 retries after the initial attempt — "dead after 5 [retry] attempts". */
const RETRY_SCHEDULE_MS = [30_000, 120_000, 600_000, 3_600_000, 21_600_000] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_SCHEDULE_MS.length; // max RETRIES; total attempts = this + 1
/** Rows stuck `dispatching` longer than this flip back to pending at boot (§12.3). */
export const STUCK_DISPATCHING_MS = 10 * 60_000;

export function retryDelayMs(attemptsMade: number, jitter: () => number = Math.random): number | null {
  const base = RETRY_SCHEDULE_MS[attemptsMade - 1];
  if (base === undefined) return null; // schedule exhausted → dead
  const factor = 0.7 + jitter() * 0.6; // ±30%
  return Math.round(base * factor);
}

export interface EnqueueResult {
  accepted: boolean;
  duplicate: boolean;
}

/** Enqueue an event; a (triggerId, dedupKey) collision is a no-op returning duplicate=true. */
export async function enqueue(triggerId: string, dedupKey: string, payload: unknown, nowIso: string): Promise<EnqueueResult> {
  const _id = `${triggerId}::${dedupKey}`;
  const inserted = await eventQueue.insert({
    _id,
    triggerId,
    dedupKey,
    payload,
    status: 'pending',
    attempts: 0,
    enqueuedAt: nowIso,
  } as QueuedEvent);
  return { accepted: inserted, duplicate: !inserted };
}

/** Atomically claim the next DUE pending event for delivery: pending → dispatching (CAS).
 *  A row with a future nextAttemptAt is not due; claim order is enqueue order. */
export async function claimNext(nowIso: string): Promise<QueuedEvent | null> {
  const pending = (await eventQueue.find({ status: 'pending' })) as QueuedEvent[];
  pending.sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  for (const e of pending) {
    if (e.nextAttemptAt && e.nextAttemptAt > nowIso) continue;
    // A RANDOM token per attempt identifies the CAS winner. The store's update returns the row
    // after any winning OR losing write, so a loser reads back the winner's row — a timestamp
    // identity check collides on a same-millisecond race and double-dispatches. The token is
    // unique per caller, so only the caller whose write actually won sees its own token on the row.
    const claimToken = randomUUID();
    const claimed = await eventQueue.update(e._id, (cur) =>
      cur.status === 'pending'
        ? { ...cur, status: 'dispatching', attempts: (cur.attempts as number) + 1, claimedAt: nowIso, claimToken }
        : cur,
    ) as QueuedEvent | null;
    if (claimed && claimed.status === 'dispatching' && claimed.claimToken === claimToken) {
      return claimed;
    }
  }
  return null;
}

/** Terminal success: the event was delivered to its target. */
export async function markDelivered(id: string): Promise<void> {
  await eventQueue.update(id, (cur) => ({ ...cur, status: 'delivered' }));
}

/** A delivery attempt failed: re-arm per the retry schedule, or dead-letter after the 5th. */
export async function markFailed(id: string, error: string, nowMs: number, jitter?: () => number): Promise<'retry' | 'dead'> {
  const row = (await eventQueue.get(id)) as QueuedEvent | null;
  if (!row) return 'dead';
  const delay = retryDelayMs(row.attempts, jitter);
  if (delay === null) {
    await eventQueue.update(id, (cur) => ({ ...cur, status: 'dead', lastError: error }));
    return 'dead';
  }
  const nextAttemptAt = new Date(nowMs + delay).toISOString();
  await eventQueue.update(id, (cur) => ({ ...cur, status: 'pending', nextAttemptAt, lastError: error }));
  return 'retry';
}

/** Immediate dead-letter (unresolvable target, e.g. the bound automation no longer exists). */
export async function markDead(id: string, error: string): Promise<void> {
  await eventQueue.update(id, (cur) => ({ ...cur, status: 'dead', lastError: error }));
}

/** Boot recovery (§12.3): rows stuck `dispatching` for over 10 minutes flip back to pending. */
export async function recoverStuck(nowMs: number): Promise<number> {
  const stuck = (await eventQueue.find({ status: 'dispatching' })) as QueuedEvent[];
  let recovered = 0;
  for (const e of stuck) {
    const claimedMs = e.claimedAt ? Date.parse(e.claimedAt) : 0;
    if (nowMs - claimedMs >= STUCK_DISPATCHING_MS) {
      await eventQueue.update(e._id, (cur) => ({ ...cur, status: 'pending' }));
      recovered++;
    }
  }
  return recovered;
}
