/**
 * PER-KEY SERIALIZATION for completeness-verified syncs (CS3 contract clause #serialize, implemented
 * in CS8 after a fresh-context review found it named but never built).
 *
 * WHY THE COMPLETENESS ARGUMENT NEEDS IT. `runVerifiedSync` reasons about ONE run per key at a time:
 * it reads the seen-set, enumerates the window twice, diffs the two passes, and only then moves the
 * cursor. Two runs interleaved on the same key break that reasoning in a way the CAS in
 * `sync-state.ts` cannot repair - the CAS stops a LOST UPDATE, not a STALE CEILING. Both runs read
 * the same seen-set, both land the same refs, both call `advanceWatermark`, and the surviving value
 * is whichever wrote last rather than whichever is safe. `routes/sync.ts` is exactly such a
 * concurrency source: two POSTs from the same user, or a poll overlapping a manual run.
 *
 * A promise chain per key, the `services/repo-lock.ts` pattern, for the same reason it was chosen
 * there: the work being serialized is already async and in-process, and a queue of one is all the
 * mutual exclusion the invariant asks for.
 *
 * WHAT IT DOES NOT DO, stated plainly rather than implied: this lock is PROCESS-LOCAL. Two API
 * instances behind a load balancer can still overlap on one key. Closing that needs a durable lease
 * (a `sync_locks` row with an owner + expiry, or the store's CAS turned into a claim), which is a
 * design with its own failure modes - a lease that outlives a crashed holder blocks the key, one
 * that does not is not a lock. It is deliberately NOT guessed at here: the deployment this ships
 * into is single-instance, and a fake distributed lock would be worse than a documented local one
 * because the completeness argument would then rest on it. When the sync graduates onto the shared
 * capability plane, this is the seam that must become durable.
 */

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` after any in-flight sync for `key` has settled, and before any later call for the same
 * key. `key` is `syncStateId(...)`: the same identity the state row, the report history and the
 * lesson store are keyed by, so two callers that would write the same row queue behind each other
 * and two different actors (one org, two mandatarios) never do.
 *
 * The caller receives the real result or rejection; the internal chain never rejects, so a failed
 * run with no follow-up does not surface as an unhandled rejection and - more importantly - does not
 * poison the queue for the next run.
 */
export function withSyncLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = chains.get(key) ?? Promise.resolve();
  const next = prior.then(fn, fn);
  const gate: Promise<unknown> = next.then(
    () => undefined,
    () => undefined,
  );
  const tracked = gate.finally(() => {
    if (chains.get(key) === tracked) chains.delete(key);
  });
  chains.set(key, tracked);
  return next;
}
