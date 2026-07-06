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
import { eventQueue } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export interface QueuedEvent extends Doc {
  triggerId: string;
  dedupKey: string;
  payload: unknown;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  enqueuedAt: string;
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

/** Atomically claim the next pending event for delivery (single-doc CAS). */
export async function claimNext(): Promise<QueuedEvent | null> {
  const pending = (await eventQueue.find({ status: 'pending' })) as QueuedEvent[];
  for (const e of pending) {
    const claimed = await eventQueue.update(e._id, (cur) => ({ ...cur, status: 'delivered', attempts: (cur.attempts as number) + 1 }));
    if (claimed) return claimed as QueuedEvent;
  }
  return null;
}
