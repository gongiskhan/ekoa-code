/**
 * Durable per-action completeness-verification state (slice CS3). One row per logical sync —
 * `(orgId, integrationKey, actionKey)` — holding the watermark, a bounded seen-set, and the
 * incomplete/failure streaks. This is the ekoa-code adaptation of the `listener_state` precedent
 * (events/listener-state.ts): a small Mongo-backed state doc with read/write plus the
 * outcome-specific mutators the two-pass orchestrator (events/verified-sync.ts) drives.
 *
 * The seen-set is the emit-first-then-persist dedup ledger carried from legal/insolvencia-watch.ts:
 * a ref is absorbed only AFTER its item is landed, so a ref is never marked "seen" for an unlanded
 * item. It is bounded two ways (both DOCUMENTED assumptions, mirroring insolvencia-watch's
 * `SEEN_REFS_CAP` note):
 *
 *   1. By date: on a watermark advance, refs whose `itemDate` is older than `watermark - MARGIN` are
 *      pruned — they can no longer appear inside a window whose floor is the (inclusive) watermark,
 *      so keeping them only bloats the row. The MARGIN is the slack that keeps the boundary item
 *      dedupable across the inclusive re-fetch and small clock/ordering skew.
 *
 *   2. By a hard cap (`SEEN_HARD_CAP`): a final ceiling regardless of dates. ASSUMPTION: a single
 *      window's active reference set stays under the cap. If a window legitimately holds more refs
 *      newer than `watermark - MARGIN` than the cap, the OLDEST are dropped; a dropped-then-re-seen
 *      item is re-LANDED, which is a no-op because `land` is an idempotent deterministic-id insert
 *      (`duplicatesSuppressed++`, never data loss / never a cross-key leak). Acceptable, documented
 *      v1 behaviour — raise the cap (or shard the key finer) if a real source ever approaches it.
 *
 * CONCURRENCY: the platform runs at most one verified-sync per key at a time (one poll/run per
 * action - the CS6 obligation #serialize), so in normal operation there is no concurrent writer. The
 * completeness reasoning assumes that serialization. Even so, the terminal mutators go through the
 * store's CAS `update((cur) => ...)` path (bounded-retry compare-and-swap on `_rev`), NOT a blind
 * read-modify-put, so an accidental overlap re-reads and re-applies rather than silently clobbering a
 * concurrent write. A mutator whose row does not yet exist creates the default row first, then
 * updates it (create-then-update).
 */
import { createHash } from 'node:crypto';
import { syncState, syncReports } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import { SyncRunReport } from '@ekoa/shared';
import type { SeenRef, SyncStateSnapshot, SyncStateStore } from './verified-sync.js';

export type { SeenRef } from './verified-sync.js';

/** The composite identity of one logical sync. */
export interface SyncStateKey {
  orgId: string;
  integrationKey: string;
  actionKey: string;
}

/** The durable state row. `_id` IS the composite key (deterministic — see `syncStateId`). */
export interface SyncStateDoc extends Doc {
  orgId: string;
  integrationKey: string;
  actionKey: string;
  /** The high-water mark; `null` before the first ever `complete` run (full backfill). */
  watermark: string | null;
  /** The bounded dedup ledger (ref + its timestamp/cursor value). */
  seenRefs: SeenRef[];
  /** Observability (ISO): when a run last wrote this row. */
  lastRunAt?: string;
  lastOutcome?: 'complete' | 'incomplete' | 'failed';
  /** Consecutive proved-partial runs since the last `complete` (reset on complete). */
  consecutiveIncomplete: number;
  /** Consecutive machinery failures since the last non-failure (reset on complete/incomplete). */
  consecutiveFailures: number;
  /** Truncated last error string (never a full stack). */
  lastError?: string;
  /** Opaque paging hint a connector may stash (e.g. 'skip' vs 'pageToken'); untouched here. */
  pagingMode?: string;
}

/** Date slack kept below the watermark so the inclusive-boundary re-fetch stays dedupable. */
export const SEEN_MARGIN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
/** Absolute ceiling on the seen-set size (see the cap ASSUMPTION in the module header). */
export const SEEN_HARD_CAP = 2000;
/** How many `SyncRunReport`s to keep per key. */
export const REPORT_HISTORY_CAP = 50;

/**
 * Deterministic, INJECTIVE `_id` for one logical sync. A raw `::` join is NOT injective — a component
 * that itself contains `::` collides with a differently-split tuple (e.g. `('a::b','c','d')` and
 * `('a','b::c','d')` both join to `a::b::c::d`, silently sharing one state row). So the tuple is
 * JSON-encoded and hashed, exactly as `definitionIdFor` (integrations/definition-store.ts) argues for
 * its own composite id: no separator can collide, and the id is stable across runs. */
export function syncStateId(key: SyncStateKey): string {
  assertScopedKey(key);
  return createHash('sha256')
    .update(JSON.stringify([key.orgId, key.integrationKey, key.actionKey]))
    .digest('hex');
}

/**
 * FAIL CLOSED ON IDENTITY (slice CS8), at the one chokepoint every durable path funnels through.
 *
 * A blank component is not a narrower key, it is a DIFFERENT key that several callers can land on:
 * `('', 'citius', 'sync')` is the same row for every org that failed to supply one. `legal/
 * citius-sync.ts` already refuses an empty actor at its own edge; putting the same refusal HERE means
 * a future caller - a poller, an operator script, a second connector - cannot reach the state row,
 * the report history or the lesson store with a half-built key at all. There is no legitimate
 * unscoped sync: every one of these components names a tenant, an integration or (on the Citius rail)
 * a mandatario, and merging two of them merges two watermarks.
 */
function assertScopedKey(key: SyncStateKey): void {
  for (const [name, value] of [
    ['orgId', key?.orgId],
    ['integrationKey', key?.integrationKey],
    ['actionKey', key?.actionKey],
  ] as const) {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`syncStateId: refusing an unscoped sync key (${name} is empty)`);
    }
  }
}

function defaultDoc(key: SyncStateKey): SyncStateDoc {
  return {
    _id: syncStateId(key),
    orgId: key.orgId,
    integrationKey: key.integrationKey,
    actionKey: key.actionKey,
    watermark: null,
    seenRefs: [],
    consecutiveIncomplete: 0,
    consecutiveFailures: 0,
  };
}

/** Normalise a stored row (defensive against a legacy/partial doc) into a full `SyncStateDoc`. */
function normalize(row: Doc, key: SyncStateKey): SyncStateDoc {
  const base = defaultDoc(key);
  const seen = Array.isArray(row.seenRefs)
    ? (row.seenRefs as unknown[]).flatMap((r) => {
        if (r && typeof r === 'object' && 'ref' in r && 'itemDate' in r) {
          return [{ ref: String((r as SeenRef).ref), itemDate: String((r as SeenRef).itemDate) }];
        }
        return [];
      })
    : base.seenRefs;
  return {
    ...base,
    _rev: typeof row._rev === 'number' ? row._rev : undefined,
    watermark: typeof row.watermark === 'string' ? row.watermark : null,
    seenRefs: seen,
    lastRunAt: typeof row.lastRunAt === 'string' ? row.lastRunAt : undefined,
    lastOutcome:
      row.lastOutcome === 'complete' || row.lastOutcome === 'incomplete' || row.lastOutcome === 'failed'
        ? row.lastOutcome
        : undefined,
    consecutiveIncomplete: typeof row.consecutiveIncomplete === 'number' ? row.consecutiveIncomplete : 0,
    consecutiveFailures: typeof row.consecutiveFailures === 'number' ? row.consecutiveFailures : 0,
    lastError: typeof row.lastError === 'string' ? row.lastError : undefined,
    pagingMode: typeof row.pagingMode === 'string' ? row.pagingMode : undefined,
  };
}

/** Read the state row, or a fresh (unpersisted) default when the key has never been written. */
export async function readSyncState(key: SyncStateKey): Promise<SyncStateDoc> {
  const row = await syncState.get(syncStateId(key));
  return row ? normalize(row, key) : defaultDoc(key);
}

/** Raw upsert of a full state doc (bumps `_rev`). */
export async function writeSyncState(doc: SyncStateDoc): Promise<void> {
  await syncState.put(doc);
}

/**
 * Compare-and-swap mutate of the state row (Finding 3): ensure the row exists, then apply `mutate`
 * through the store's `update((cur) => ...)` CAS path (bounded-retry on `_rev` drift) so a concurrent
 * write cannot be silently lost. `mutate` receives the NORMALISED current doc and returns the next
 * one. If the row does not yet exist we create the default first (create-then-update); a lost create
 * race is fine (`insert` returns false, the winner's row is what `update` then reads).
 */
async function mutateState(
  key: SyncStateKey,
  mutate: (cur: SyncStateDoc) => SyncStateDoc,
): Promise<void> {
  const id = syncStateId(key);
  if (!(await syncState.get(id))) await syncState.insert(defaultDoc(key) as Doc);
  const updated = await syncState.update(id, (cur) => mutate(normalize(cur, key)) as Doc);
  if (!updated) {
    // The row was deleted between the ensure and the CAS (not expected under #serialize) — recreate.
    await writeSyncState(mutate(defaultDoc(key)));
  }
}

/**
 * Bound the seen-set: dedup by ref (last wins), drop entries older than `watermark - MARGIN` (when
 * the watermark is a parseable date), then keep only the newest `SEEN_HARD_CAP` by `itemDate`.
 */
export function pruneSeen(refs: SeenRef[], watermark: string | null): SeenRef[] {
  const byRef = new Map<string, SeenRef>();
  for (const r of refs) byRef.set(r.ref, r);
  let out = [...byRef.values()];

  const wmMs = watermark ? Date.parse(watermark) : NaN;
  if (!Number.isNaN(wmMs)) {
    const floor = wmMs - SEEN_MARGIN_MS;
    out = out.filter((r) => {
      const d = Date.parse(r.itemDate);
      return Number.isNaN(d) ? true : d >= floor; // keep un-parseable dates (be liberal)
    });
  }

  out.sort((a, b) => dateKey(b.itemDate) - dateKey(a.itemDate)); // newest first
  if (out.length > SEEN_HARD_CAP) {
    // Hard-cap overflow drops the OLDEST refs; a dropped-then-re-seen item re-lands idempotently, but
    // the eviction must not be SILENT (it signals the cap ASSUMPTION being approached). No seam is
    // wired into this pure helper, so surface it on the console per the review's guidance.
    console.warn(
      `[sync-state] seen-set hard-cap overflow: ${out.length} refs exceed SEEN_HARD_CAP=${SEEN_HARD_CAP}; ` +
        `dropping ${out.length - SEEN_HARD_CAP} oldest by itemDate`,
    );
  }
  return out.slice(0, SEEN_HARD_CAP);
}

function dateKey(s: string): number {
  const d = Date.parse(s);
  return Number.isNaN(d) ? -Infinity : d;
}

/**
 * On `complete`: advance the watermark, absorb `newSeen`, reset BOTH streaks. CAS-guarded.
 *
 * The advance is MONOTONIC (CS8): a proposed watermark that is strictly OLDER than the stored one is
 * refused and the current value kept. The cursor is a promise that everything below it has been seen;
 * moving it backwards silently re-opens a window that was already proved swept, and the only things
 * that propose one are a clock that stepped back (NTP, a container start, a manual `until`) - never a
 * fact about the source. Applied ONLY when both values parse as dates: the cursor is documented as an
 * OPAQUE string, and inventing an ordering for one this module cannot read would be a second guess of
 * exactly the kind hazard 5 in `legal/citius-sync.ts` was written about. For an opaque cursor the
 * caller's word is final.
 */
export async function advanceWatermark(
  key: SyncStateKey,
  watermark: string,
  newSeen: SeenRef[],
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await mutateState(key, (cur) => {
    const next = forwardWatermark(cur.watermark, watermark);
    return {
      ...cur,
      watermark: next,
      seenRefs: pruneSeen([...cur.seenRefs, ...newSeen], next),
      lastRunAt: nowIso,
      lastOutcome: 'complete',
      consecutiveIncomplete: 0,
      consecutiveFailures: 0,
    };
  });
}

/** The greater of the two when both are readable instants; otherwise the proposed value. */
export function forwardWatermark(current: string | null, proposed: string): string {
  if (current === null) return proposed;
  const a = Date.parse(current);
  const b = Date.parse(proposed);
  if (Number.isNaN(a) || Number.isNaN(b)) return proposed; // opaque cursor: not ours to order
  if (b >= a) return proposed;
  console.warn(
    `[sync-state] refusing to move a watermark BACKWARDS (${current} -> ${proposed}); keeping the ` +
      'later value. A backwards cursor re-opens a window that was already proved swept.',
  );
  return current;
}

/** On `incomplete`: absorb refs into the seen-set; the watermark STAYS put. CAS-guarded. */
export async function absorbRefs(
  key: SyncStateKey,
  refs: SeenRef[],
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await mutateState(key, (cur) => ({
    ...cur,
    seenRefs: pruneSeen([...cur.seenRefs, ...refs], cur.watermark),
    lastRunAt: nowIso,
  }));
}

/** On `incomplete`: record the proved-partial run (watermark + seen-set left as `absorbRefs` set
 *  them). Increments the incomplete streak and resets the failure streak (a proved miss is not a
 *  machinery error). CAS-guarded. */
export async function bumpIncomplete(
  key: SyncStateKey,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await mutateState(key, (cur) => ({
    ...cur,
    lastRunAt: nowIso,
    lastOutcome: 'incomplete',
    consecutiveIncomplete: cur.consecutiveIncomplete + 1,
    consecutiveFailures: 0,
  }));
}

/** On `failed`: record the machinery error. Watermark AND seen-set are left untouched (spread from
 *  the current row) — nothing moves. CAS-guarded. */
export async function bumpFailure(
  key: SyncStateKey,
  error: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  await mutateState(key, (cur) => ({
    ...cur,
    lastRunAt: nowIso,
    lastOutcome: 'failed',
    consecutiveFailures: cur.consecutiveFailures + 1,
    lastError: error.slice(0, 1000),
  }));
}

/** The read view the orchestrator needs. */
export async function readSyncSnapshot(key: SyncStateKey): Promise<SyncStateSnapshot> {
  const doc = await readSyncState(key);
  return {
    watermark: doc.watermark,
    seenRefs: doc.seenRefs,
    consecutiveIncomplete: doc.consecutiveIncomplete,
    consecutiveFailures: doc.consecutiveFailures,
  };
}

/** Persist a run report into the capped per-key history (`_id` = report id; `stateKey` indexes back
 *  to the syncState row). Prunes reports older than the newest `REPORT_HISTORY_CAP` for the key. */
export async function persistSyncReport(key: SyncStateKey, report: SyncRunReport): Promise<void> {
  const stateKey = syncStateId(key);
  // The `insert` boolean is intentionally IGNORED: the report history is an append-only audit trail,
  // so a duplicate report id (the same run persisted twice) is a harmless no-op, not an error to
  // surface. This is audit-only bookkeeping — no completeness invariant rides on the return value.
  await syncReports.insert({ ...report, _id: report.id, stateKey } as Doc);
  const rows = await syncReports.find({ stateKey }, { startedAt: -1 });
  if (rows.length > REPORT_HISTORY_CAP) {
    for (const r of rows.slice(REPORT_HISTORY_CAP)) await syncReports.delete(r._id);
  }
}

/**
 * THE GRADUATION READ (slice CS8): the most recent run's report for one key, or `undefined`.
 *
 * CS6 answered this inline inside `readCitiusSyncState`. It is lifted here because "which report is
 * the latest" is a property of the report HISTORY, not of the Citius rail - a second sync producer
 * inherits the same three answers rather than re-deciding them - and because the three answers are
 * each a judgement that deserves to be stated once, in the file that owns the collection:
 *
 *   WHICH ONE IS "LATEST" - the greatest `startedAt`, with `endedAt` then `_id` as DETERMINISTIC
 *   tie-breaks. Ties are not hypothetical: a caller running on a fixed clock (every test does) writes
 *   reports that share `startedAt` to the millisecond, and an unbroken tie makes "latest" whatever
 *   Mongo happened to return - a read that answers differently on two calls with no writes between
 *   them. Ordering by START (not by end) is what makes `latest` mean "the most recent RUN": a long
 *   run that started first is still the earlier run, however late it finished.
 *
 *   WHEN THERE IS NONE - `undefined`, and the caller omits the field. A key with no history has never
 *   run; that is a fact, not an error, and it is exactly what a first-ever read must say.
 *
 *   WHEN THE NEWEST ROW IS AN OLDER SHAPE - it is `safeParse`d and DROPPED (CS6's precedent: an
 *   answer this chain cannot vouch for is not given). It is deliberately NOT backfilled from the next
 *   valid row: `latest` names THE MOST RECENT RUN, and serving the run before it under that name is a
 *   worse lie than serving nothing - it would show a `complete` from three runs ago while the row's
 *   own `lastOutcome` says `failed`, i.e. a view that contradicts itself. The state row (`lastRunAt`,
 *   `lastOutcome`, the streak counters) is the authority on how the last run ENDED and is unaffected
 *   by a report the contract can no longer read, so dropping the detail loses detail, not the truth.
 *   The drop is logged rather than swallowed: a report the current contract cannot read is a
 *   migration signal, and `pruneSeen`'s cap-overflow warning is the precedent for surfacing one from
 *   a module with no telemetry seam.
 */
export async function latestSyncReport(key: SyncStateKey): Promise<SyncRunReport | undefined> {
  const stateKey = syncStateId(key); // fails closed on a blank component
  const rows = await syncReports.find({ stateKey }, { startedAt: -1, endedAt: -1, _id: -1 });
  const head = rows[0];
  if (!head) return undefined;
  const parsed = SyncRunReport.safeParse(head);
  if (parsed.success) return parsed.data;
  console.warn(
    `[sync-state] latest report ${String(head._id)} for ${stateKey} does not validate against the ` +
      `current SyncRunReport contract; serving no latest report rather than an unvalidated one`,
  );
  return undefined;
}

/**
 * Build the injected `SyncStateStore` handle the orchestrator takes — pre-bound to one key. This is
 * the CS6 wiring seam: `runVerifiedSync({ ..., store: makeSyncStateStore(key) })`.
 */
export function makeSyncStateStore(key: SyncStateKey): SyncStateStore {
  return {
    read: () => readSyncSnapshot(key),
    advanceWatermark: (watermark, newSeen) => advanceWatermark(key, watermark, newSeen),
    absorbRefs: (refs) => absorbRefs(key, refs),
    bumpIncomplete: () => bumpIncomplete(key),
    bumpFailure: (error) => bumpFailure(key, error),
    saveReport: (report) => persistSyncReport(key, report),
  };
}
