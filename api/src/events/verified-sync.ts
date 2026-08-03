/**
 * Run-level COMPLETENESS VERIFICATION (slice CS3) — the genuinely-new design of the Citius proof,
 * but with ZERO Citius (or network) specifics. `runVerifiedSync` is a PURE, deps-injected
 * orchestrator: it owns the cursor / seen-set / two-pass reconciliation discipline; the mechanism
 * that actually ENUMERATES a window (an HTTP connector today, an engine run later) and the mechanism
 * that LANDS an item are injected functions. This module therefore imports nothing from `data/` or
 * any transport — its only dependency is the `SyncRunReport` TYPE from the contract.
 *
 * The two disciplines it mirrors, from the modules named in the CS3 brief:
 *
 *  - Cursor-advance-only-after-durable-enqueue (integrations/event-sources/platform-poll.ts): the
 *    watermark advances ONLY after a run is PROVED complete. A window is enumerated inclusively from
 *    the stored watermark W; the boundary item is re-seen every run and deduped by the seen-set.
 *
 *  - Emit-first-then-persist, at-least-once (legal/insolvencia-watch.ts): every new item is LANDED
 *    before its reference is absorbed into the durable seen-set. `land` is idempotent (a
 *    deterministic-id insert — a duplicate returns `landed:false`), so a crash between a land and
 *    the seen-set write re-lands harmlessly on the next run rather than dropping the item. A
 *    reference is therefore NEVER marked "seen" (and thus skippable) unless its item was already
 *    landed.
 *
 * WHY no silent miss (the two invariants together): (1) because refs are absorbed only AFTER every
 * new item is landed, the seen-set can never name an unlanded item — so dedup can never skip an item
 * that was not already durably landed; (2) because the watermark advances only on a `complete`
 * outcome (pass 2 revealed nothing pass 1 missed AND completeness was PROVED - either both passes
 * reached the end of the window, or a page-total count check matched), a proved-partial run - which
 * now INCLUDES a run whose passes truncated at `maxPages` without such proof - leaves the window open
 * to be re-swept. A machinery `failed` (an enumerate returning `ok:false`) moves nothing at all. A
 * genuinely missed item is thus either landed-and-absorbed this run, or the window stays open until a
 * run comes back clean; it is never both unlanded and behind the cursor.
 *
 * ================================================================================================
 * ENUMERATE/LAND CONTRACT (CS6 MUST GUARANTEE)
 * ------------------------------------------------------------------------------------------------
 * The completeness proof is only as sound as the two injected seams. Any CS6 wiring (the HTTP Citius
 * connector today, an engine run later) MUST honour every clause below; a violation reintroduces the
 * silent-miss vector this module exists to close.
 *
 *   (1) #complete-or-ok:false - `enumerate` is COMPLETE-OR-`ok:false`. It MUST NOT return `ok:true`
 *       with a partially-swept window UNLESS it either sets `reachedEnd:false` (the window was
 *       truncated at `maxPages`) OR supplies `pageTotal` (so the count check can independently prove
 *       the sweep). Now ENFORCED by the `clean` gate: a clean-but-truncated pass with neither proof
 *       is `incomplete`, not `complete`, so the watermark cannot advance past unpaged items.
 *       When supplied, `pageTotal` MUST be the source's TRUE, COMPLETE count of items in the window
 *       `[since, until]` — never a per-page subset, a stale figure, or a capped/estimated total. The
 *       count check trusts it absolutely (a matching `pageTotal` certifies completeness and overrides
 *       `reachedEnd`), so a source that under-reports the total re-opens the silent-miss this module
 *       closes. A connector that cannot compute the true window total MUST omit `pageTotal` and rely
 *       on `reachedEnd`. CS6 MUST test its `pageTotal` producer against this clause.
 *
 *   (2) #visibility-monotonic - the enumeration cursor MUST be monotonic in VISIBILITY, not in
 *       item-timestamp. An item must NEVER become visible to `enumerate` AFTER the window ceiling
 *       that would exclude it (a source that back-dates a late-published item would slip it behind
 *       the advancing watermark, unseen). If the source can publish late, the caller MUST set
 *       `untilSkewMs` beyond the source's maximum publish lag so the ceiling stays behind that lag.
 *
 *   (3) #land-throws-or-duplicate - `land` MUST THROW on a real land failure (the throw propagates,
 *       the run ends `failed`, and NOTHING moves) and return `{landed:false}` ONLY for a genuine
 *       deterministic-id duplicate (already landed). Returning `{landed:false}` for a transient
 *       failure would mark the ref "seen" for an item that never landed - a silent drop.
 *
 *   (4) #serialize - at most ONE verified-sync per key runs at a time (one poll/run per action). The
 *       durable state mutators are CAS-guarded so an accidental overlap cannot silently clobber a
 *       concurrent write, but the completeness reasoning above still assumes serialized runs per key.
 * ================================================================================================
 */
import type { SyncRunReport, SyncOutcome, SyncSessionEvent } from '@ekoa/shared';

/** One reference in the durable seen-set: a stable dedup key plus the item's own timestamp/cursor
 *  value (used by the store to prune the set relative to the watermark). Both opaque strings. */
export interface SeenRef {
  ref: string;
  itemDate: string;
}

/** The read view the orchestrator needs of the per-action sync state. */
export interface SyncStateSnapshot {
  /** The high-water mark; null before the first ever complete run. */
  watermark: string | null;
  seenRefs: SeenRef[];
  consecutiveIncomplete: number;
  consecutiveFailures: number;
}

/**
 * The injected sync-state store handle — pre-bound to one `(orgId, integrationKey, actionKey)` key,
 * so the orchestrator never needs to know the key format. `api/src/events/sync-state.ts` provides
 * the Mongo-backed implementation (`makeSyncStateStore(key)`); tests inject an in-memory fake.
 */
export interface SyncStateStore {
  read(): Promise<SyncStateSnapshot>;
  /** On `complete`: advance the watermark to `watermark` and absorb `newSeen`; reset both streaks. */
  advanceWatermark(watermark: string, newSeen: SeenRef[]): Promise<void>;
  /** On `incomplete`: absorb the refs into the seen-set; the watermark stays put. */
  absorbRefs(refs: SeenRef[]): Promise<void>;
  /** On `incomplete`: record the proved-partial run (watermark unchanged). */
  bumpIncomplete(): Promise<void>;
  /** On `failed`: record the machinery error (nothing else moves). */
  bumpFailure(error: string): Promise<void>;
  /** Persist the report into the capped per-key history. */
  saveReport(report: SyncRunReport): Promise<void>;
}

/** One enumerated item: its dedup ref, its timestamp/cursor value, and the opaque payload the
 *  `land` seam knows how to persist. */
export interface EnumeratedItem {
  ref: string;
  itemDate: string;
  payload: unknown;
}

/** The window an enumeration pass sweeps. `sinceIso` is the stored watermark (null = from the
 *  beginning); it is INCLUSIVE, so the boundary item is re-seen and deduped every run. `maxPages`
 *  bounds one pass. (Named `sinceIso` for the connector's benefit; the orchestrator treats it as
 *  an opaque cursor.) */
export interface EnumerateWindow {
  sinceIso: string | null;
  maxPages: number;
}

/** Result of one enumeration pass. `ok:false` is a MACHINERY failure (→ `failed`), never an empty
 *  result (an empty window is `ok:true` with `items:[]`). `reachedEnd` is LOAD-BEARING (contract
 *  clause #complete-or-ok:false): it MUST be `false` whenever the pass truncated at `maxPages`
 *  without exhausting the window - only then, or with a matching `pageTotal`, can a clean run be
 *  `complete`. `pageTotal`, when the source advertises it, drives the optional count reconciliation.
 *  `sessionEvents` lets a session-managing enumerator report its lifecycle for the report. */
export type EnumerateResult =
  | {
      ok: true;
      result: {
        items: EnumeratedItem[];
        pages: number;
        reachedEnd: boolean;
        pageTotal?: number;
        sessionEvents?: SyncSessionEvent[];
      };
    }
  | { ok: false; error: string };

/** Everything `runVerifiedSync` needs: the run parameters plus every injected seam. A single input
 *  object (the brief's `runVerifiedSync(input)`) keeps the call site — and CS6's wiring — explicit. */
export interface RunVerifiedSyncInput {
  /** The logical sync id, recorded verbatim on the report. */
  syncKey: string;
  orgId: string;
  /** The window ceiling this run advances the watermark to on `complete`. Defaults to the run's
   *  start time held back by `untilSkewMs` — the inclusive-from-W, up-to-(now-skew) sweep of the poll
   *  precedent. An explicit value overrides both the clock and the skew. */
  until?: string;
  /** Hold the default window ceiling this many ms behind the run clock to absorb source PUBLISH LAG
   *  (an item that becomes visible to `enumerate` slightly after its own timestamp — see contract
   *  clause #visibility-monotonic). When `until` is not set explicitly, `until = clock() -
   *  untilSkewMs`. Default 0 (ceiling = now); plumb a value at least the source's max publish lag. */
  untilSkewMs?: number;
  /** Per-pass page bound handed to `enumerate`; also recorded on the report as truncation evidence. */
  maxPages?: number;
  /** Deterministic report id (tests set it); otherwise derived from `syncKey` + start time. */
  reportId?: string;

  /** Enumerate a window. Called TWICE per run with the SAME window (the two verification passes).
   *  CONTRACT: MUST be complete-or-`ok:false` (#complete-or-ok:false) — never `ok:true` for a
   *  partially-swept window unless it sets `reachedEnd:false` or supplies `pageTotal`; and its cursor
   *  MUST be monotonic in VISIBILITY, not item-timestamp (#visibility-monotonic). See module header. */
  enumerate: (window: EnumerateWindow) => Promise<EnumerateResult>;
  /** Land one item. Idempotent deterministic-id insert: `landed:false` = already present.
   *  CONTRACT (#land-throws-or-duplicate): MUST THROW on a real land failure (propagates → `failed`,
   *  nothing moves) and return `{landed:false}` ONLY for a genuine deterministic-id duplicate — never
   *  for a transient failure (that would mark an unlanded item "seen"). See module header. */
  land: (item: EnumeratedItem) => Promise<{ landed: boolean }>;
  store: SyncStateStore;
  clock: () => Date;
  /**
   * The LESSONS seam (declared CS3, made real CS8). Called ONCE per run, AFTER the report is durably
   * persisted and after the durable state has already moved (or deliberately not moved), so it can
   * neither change what the run decided nor observe it before it is final.
   *
   * NEVER LOAD-BEARING, and that is now structural rather than a promise: a sink that THROWS is
   * caught here (see `recordLessonSafely`) and the report is still returned. A telemetry write must
   * not be able to turn a proved-complete run - watermark already advanced, items already landed -
   * into a thrown error at the caller, which is what would reach an operator as "the sync failed".
   * That would make the audit trail lie in exactly the place this whole rail exists to be honest.
   *
   * `events/sync-lessons.ts` provides the durable implementation (`makeSyncLessonRecorder(key)`);
   * `legal/citius-sync.ts` wires it and adds the observations only the connector can see.
   */
  recordLesson?: (report: SyncRunReport) => void | Promise<void>;
}

const DEFAULT_MAX_PAGES = 50;

/**
 * Run one completeness-verified sync. Returns (and persists) a `SyncRunReport`. Never throws for a
 * transport problem — an enumerate `ok:false` becomes a `failed` report; only a genuine bug (or a
 * store write blowing up) propagates.
 */
export async function runVerifiedSync(input: RunVerifiedSyncInput): Promise<SyncRunReport> {
  const { enumerate, land, store, clock, recordLesson } = input;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  // A window swept in <1 page cannot be proven complete by reachedEnd; reject rather than risk a
  // vacuous 'complete'. (Only harmful paired with a lying enumerate, which #complete-or-ok:false
  // forbids — but fail loudly here rather than trust the seam.)
  if (maxPages < 1) throw new Error('runVerifiedSync: maxPages must be >= 1');
  const untilSkewMs = input.untilSkewMs ?? 0;

  const startClock = clock();
  const startedAt = startClock.toISOString();
  // Default ceiling = now held back by the publish-lag skew (#visibility-monotonic); explicit wins.
  const until = input.until ?? new Date(startClock.getTime() - untilSkewMs).toISOString();
  const reportId = input.reportId ?? `${input.syncKey}::${startedAt}`;

  const state = await store.read();
  const W = state.watermark;
  const seen = new Set(state.seenRefs.map((r) => r.ref));
  const sessionEvents: SyncSessionEvent[] = [];

  let landed = 0;
  let duplicatesSuppressed = 0;
  // New references gathered across BOTH passes, absorbed into the seen-set only after the outcome is
  // known — and always strictly AFTER their item was landed (at-least-once).
  const newSeen: SeenRef[] = [];

  const window: EnumerateWindow = { sinceIso: W, maxPages };

  // --- Pass 1 -------------------------------------------------------------------------------------
  const p1 = await enumerate(window);
  if (!p1.ok) {
    return finishFailed(input, {
      reportId,
      startedAt,
      until,
      W,
      error: p1.error,
      sessionEvents,
      maxPages,
    });
  }
  if (p1.result.sessionEvents) sessionEvents.push(...p1.result.sessionEvents);

  const pass1Items = p1.result.items;
  const pass1Refs = new Set(pass1Items.map((i) => i.ref));
  const pass1New = pass1Items.filter((i) => !seen.has(i.ref));

  // Emit-FIRST: land each genuinely-new item, THEN queue its ref for absorption. Items already in
  // the seen-set are skipped entirely (cross-run dedup) — they are neither re-landed nor counted.
  for (const item of pass1New) {
    const r = await land(item);
    if (r.landed) landed++;
    else duplicatesSuppressed++;
    newSeen.push({ ref: item.ref, itemDate: item.itemDate });
  }

  // --- Pass 2: RE-enumerate the SAME window [W, until] --------------------------------------------
  const p2 = await enumerate(window);
  if (!p2.ok) {
    // Pass 1's items are already durably landed; we simply do not move the cursor or the seen-set.
    // "Nothing moves" in the durable state — a re-run re-lands them idempotently.
    return finishFailed(input, {
      reportId,
      startedAt,
      until,
      W,
      error: p2.error,
      sessionEvents,
      maxPages,
      pass1: {
        pages: p1.result.pages,
        itemsSeen: pass1Items.length,
        newRefs: pass1New.length,
        reachedEnd: p1.result.reachedEnd,
      },
      // Pass 1's lands are durable even though the run is unverifiable; report them honestly.
      landed,
      duplicatesSuppressed,
    });
  }
  if (p2.result.sessionEvents) sessionEvents.push(...p2.result.sessionEvents);

  const pass2Items = p2.result.items;
  // A miss = a ref pass 2 saw that pass 1 did NOT, and that we did not already know.
  const pass2Only = pass2Items.filter((i) => !pass1Refs.has(i.ref) && !seen.has(i.ref));
  const refsOnlyInPass2 = pass2Only.map((i) => i.ref);

  // Land the missed items too (idempotent), and absorb their refs.
  for (const item of pass2Only) {
    const r = await land(item);
    if (r.landed) landed++;
    else duplicatesSuppressed++;
    newSeen.push({ ref: item.ref, itemDate: item.itemDate });
  }

  // Optional count reconciliation from pass 1's advertised total.
  const countCheck =
    p1.result.pageTotal === undefined
      ? undefined
      : {
          pageTotal: p1.result.pageTotal,
          enumerated: pass1Items.length,
          match: p1.result.pageTotal === pass1Items.length,
        };

  // A run is `complete` only when it is clean at the ref level AND completeness was PROVED: either a
  // count check matched, or — with no count check — BOTH passes reached the end of the window. A
  // clean-but-truncated pass (both `reachedEnd:false`, no matching count) is a proved-partial run:
  // treated as `incomplete` so the watermark stays at W and the window reopens for a re-sweep, rather
  // than silently advancing past items that were never paged in (Finding 1, the silent-miss vector).
  const clean =
    refsOnlyInPass2.length === 0 &&
    (countCheck ? countCheck.match : p1.result.reachedEnd && p2.result.reachedEnd);
  const outcome: SyncOutcome = clean ? 'complete' : 'incomplete';

  if (outcome === 'complete') {
    // Cursor advances ONLY here, after a proved-clean sweep.
    await store.advanceWatermark(until, newSeen);
  } else {
    // Proved-partial: the seen-set absorbs (so nothing re-emits), but the watermark STAYS at W so
    // the window is re-swept until a run comes back clean.
    await store.absorbRefs(newSeen);
    await store.bumpIncomplete();
  }

  const report: SyncRunReport = {
    id: reportId,
    syncKey: input.syncKey,
    orgId: input.orgId,
    startedAt,
    endedAt: clock().toISOString(),
    outcome,
    window: { since: W, until },
    verification: {
      pass1: {
        pages: p1.result.pages,
        itemsSeen: pass1Items.length,
        newRefs: pass1New.length,
        reachedEnd: p1.result.reachedEnd,
      },
      pass2: {
        pages: p2.result.pages,
        itemsSeen: pass2Items.length,
        refsOnlyInPass2,
        reachedEnd: p2.result.reachedEnd,
      },
      maxPages,
      ...(countCheck ? { countCheck } : {}),
    },
    landed,
    duplicatesSuppressed,
    sessionEvents,
  };

  await store.saveReport(report);
  await recordLessonSafely(recordLesson, report, input.syncKey);
  return report;
}

/**
 * Run the lessons sink without letting it fail the run. The report is already persisted and the
 * cursor has already made its decision by the time this is called, so there is nothing left for a
 * throw to protect: it would only replace a truthful answer with an exception. Swallow it, say so
 * loudly, and hand the caller the report the run actually produced.
 */
async function recordLessonSafely(
  recordLesson: RunVerifiedSyncInput['recordLesson'],
  report: SyncRunReport,
  syncKey: string,
): Promise<void> {
  if (!recordLesson) return;
  try {
    await recordLesson(report);
  } catch (err) {
    console.warn(
      `[verified-sync] lessons sink failed for ${syncKey} (report ${report.id}); the run itself is ` +
        `unaffected: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Build + persist the `failed` report and bump the failure streak. Nothing else moves. */
async function finishFailed(
  input: RunVerifiedSyncInput,
  ctx: {
    reportId: string;
    startedAt: string;
    until: string;
    W: string | null;
    error: string;
    sessionEvents: SyncSessionEvent[];
    maxPages: number;
    pass1?: { pages: number; itemsSeen: number; newRefs: number; reachedEnd: boolean };
    landed?: number;
    duplicatesSuppressed?: number;
  },
): Promise<SyncRunReport> {
  const report: SyncRunReport = {
    id: ctx.reportId,
    syncKey: input.syncKey,
    orgId: input.orgId,
    startedAt: ctx.startedAt,
    endedAt: input.clock().toISOString(),
    outcome: 'failed',
    window: { since: ctx.W, until: ctx.until },
    verification: {
      // A `failed` run proved nothing about completeness: `reachedEnd:false` on both passes.
      pass1: ctx.pass1 ?? { pages: 0, itemsSeen: 0, newRefs: 0, reachedEnd: false },
      pass2: { pages: 0, itemsSeen: 0, refsOnlyInPass2: [], reachedEnd: false },
      maxPages: ctx.maxPages,
    },
    landed: ctx.landed ?? 0,
    duplicatesSuppressed: ctx.duplicatesSuppressed ?? 0,
    sessionEvents: ctx.sessionEvents,
    error: ctx.error.slice(0, 1000),
  };
  await input.store.bumpFailure(report.error ?? ctx.error);
  await input.store.saveReport(report);
  await recordLessonSafely(input.recordLesson, report, input.syncKey);
  return report;
}
