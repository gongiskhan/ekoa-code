/**
 * Durable listener-state store (2A-S1). One row per `kind:'listener'` trigger, keyed by the
 * trigger id, holding the poll cursor (high-water mark / paging continuation) plus an observable
 * failure counter. This is the ekoa-code async-store adaptation of ekoa-dev's synchronous SQLite
 * `listener_state` table (cortex/src/persistence/event-queue.ts): the wire contract is unchanged,
 * only the storage idiom (Firestore/Mongo `Store<Doc>` vs better-sqlite3) differs.
 *
 * Cursor-advance-only-after-enqueue invariant (carried from the dev poll contract): the supervisor
 * / platform-poll advance the cursor ONLY after every polled item is durably enqueued, so a crash
 * re-polls the boundary rather than dropping events. This module just persists whatever cursor the
 * poll hands it; the ordering discipline lives in the callers (listener-supervisor.ts,
 * integrations/event-sources/platform-poll.ts).
 *
 * `writeListenerCursor` resets the failure counter (a successful poll clears the streak); a
 * `bumpListenerFailure` preserves the last-known cursor (a failed tick must not lose the
 * high-water mark). Mirrors the dev `upsertListenerCursor` / `bumpListenerFailure` semantics.
 */
import { listenerState } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export interface ListenerStateDoc extends Doc {
  /** `_id` IS the triggerId. The persisted poll cursor: an ISO string / epoch-seconds string, or
   *  a paging-continuation object; `null` while uninitialised. */
  cursor: unknown;
  /** Observability only (ISO): when the row was last written by a poll tick. */
  lastPollAt?: string;
  /** Consecutive failed ticks since the last success — reset to 0 on any cursor write. */
  consecutiveFailures: number;
  /** Truncated last error string (dead-simple audit; never a full stack). */
  lastError?: string;
}

/** Read the stored poll cursor for a trigger, or `undefined` when uninitialised (no row / null
 *  cursor). Callers treat `undefined` as "first poll" (initialise to now, no backfill). */
export async function readListenerCursor(triggerId: string): Promise<unknown | undefined> {
  const row = (await listenerState.get(triggerId)) as ListenerStateDoc | null;
  if (!row || row.cursor == null) return undefined;
  return row.cursor;
}

/** Upsert the poll cursor after a successful (or fully-drained) tick; resets the failure streak. */
export async function writeListenerCursor(triggerId: string, cursor: unknown, nowIso: string = new Date().toISOString()): Promise<void> {
  await listenerState.put({
    _id: triggerId,
    cursor: cursor ?? null,
    lastPollAt: nowIso,
    consecutiveFailures: 0,
  } as ListenerStateDoc);
}

/** Record a failed tick: increment the failure counter and stamp the error, PRESERVING the
 *  last-known cursor so the high-water mark survives a failure (dev `bumpListenerFailure`). */
export async function bumpListenerFailure(triggerId: string, error: string, nowIso: string = new Date().toISOString()): Promise<void> {
  const existing = (await listenerState.get(triggerId)) as ListenerStateDoc | null;
  await listenerState.put({
    _id: triggerId,
    cursor: existing?.cursor ?? null,
    lastPollAt: nowIso,
    consecutiveFailures: (existing?.consecutiveFailures ?? 0) + 1,
    lastError: error.slice(0, 1000),
  } as ListenerStateDoc);
}

/** Drop a listener's state row (on trigger deletion). No-op when absent. */
export async function deleteListenerCursor(triggerId: string): Promise<void> {
  await listenerState.delete(triggerId);
}
