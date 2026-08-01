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
 * CONCURRENCY: like listener-state, the mutators are read-modify-put WITHOUT a CAS loop. The
 * platform runs at most one verified-sync per key at a time (one poll/run per action), so there is
 * no concurrent writer to race; a future concurrent driver must add CAS here.
 */
import { syncState, syncReports } from '../data/stores.js';
import type { Doc } from '../data/store.js';
import type { SyncRunReport } from '@ekoa/shared';
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

/** Deterministic `_id`: `${orgId}::${integrationKey}::${actionKey}`. */
export function syncStateId(key: SyncStateKey): string {
  return `${key.orgId}::${key.integrationKey}::${key.actionKey}`;
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
  return out.slice(0, SEEN_HARD_CAP);
}

function dateKey(s: string): number {
  const d = Date.parse(s);
  return Number.isNaN(d) ? -Infinity : d;
}

/** On `complete`: advance the watermark, absorb `newSeen`, reset BOTH streaks. */
export async function advanceWatermark(
  key: SyncStateKey,
  watermark: string,
  newSeen: SeenRef[],
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const cur = await readSyncState(key);
  await writeSyncState({
    ...cur,
    watermark,
    seenRefs: pruneSeen([...cur.seenRefs, ...newSeen], watermark),
    lastRunAt: nowIso,
    lastOutcome: 'complete',
    consecutiveIncomplete: 0,
    consecutiveFailures: 0,
  });
}

/** On `incomplete`: absorb refs into the seen-set; the watermark STAYS put. */
export async function absorbRefs(
  key: SyncStateKey,
  refs: SeenRef[],
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const cur = await readSyncState(key);
  await writeSyncState({
    ...cur,
    seenRefs: pruneSeen([...cur.seenRefs, ...refs], cur.watermark),
    lastRunAt: nowIso,
  });
}

/** On `incomplete`: record the proved-partial run (watermark + seen-set left as `absorbRefs` set
 *  them). Increments the incomplete streak and resets the failure streak (a proved miss is not a
 *  machinery error). */
export async function bumpIncomplete(
  key: SyncStateKey,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const cur = await readSyncState(key);
  await writeSyncState({
    ...cur,
    lastRunAt: nowIso,
    lastOutcome: 'incomplete',
    consecutiveIncomplete: cur.consecutiveIncomplete + 1,
    consecutiveFailures: 0,
  });
}

/** On `failed`: record the machinery error. Watermark AND seen-set are left untouched (spread from
 *  the current row) — nothing moves. */
export async function bumpFailure(
  key: SyncStateKey,
  error: string,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const cur = await readSyncState(key);
  await writeSyncState({
    ...cur,
    lastRunAt: nowIso,
    lastOutcome: 'failed',
    consecutiveFailures: cur.consecutiveFailures + 1,
    lastError: error.slice(0, 1000),
  });
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
  await syncReports.insert({ ...report, _id: report.id, stateKey } as Doc);
  const rows = await syncReports.find({ stateKey }, { startedAt: -1 });
  if (rows.length > REPORT_HISTORY_CAP) {
    for (const r of rows.slice(REPORT_HISTORY_CAP)) await syncReports.delete(r._id);
  }
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
