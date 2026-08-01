/**
 * Completeness-verified sync contract (slice CS3) — an INTERNAL data contract, not an endpoint
 * descriptor. `SyncRunReport` is the durable, auditable record of one run of the two-pass
 * completeness-verification orchestrator (`api/src/events/verified-sync.ts`): what window was
 * swept, what the two enumeration passes each saw, whether pass 2 revealed anything pass 1 missed,
 * how many items landed vs were suppressed as already-landed duplicates, and how the transport
 * session behaved. It is transport-agnostic — the HTTP Citius connector (CS6) is one producer, an
 * engine run a later one — so nothing here names a provider, a URL, or a network shape.
 *
 * DELIBERATELY NOT a REST endpoint: there is no `*Endpoints` descriptor map in this file and it is
 * NOT added to `ALL_ENDPOINTS`. It touches neither OpenAPI, the COVERED allowlist, nor the
 * user-or-key auth surface — it is a shape shared between `api/`'s orchestrator and its store, and
 * (later) whatever surfaces the history for operators. The barrel re-exports it exactly like the
 * schema-only `events.ts` / `voice.ts` carve-outs.
 */
import { z } from 'zod';
import { IsoTimestamp } from './common.js';

/** A non-negative integer count field, reused across the verification block. */
const Count = z.number().int().nonnegative();

/**
 * The trichotomy that is the whole point of the design. `incomplete` is a PROVED miss (pass 2 saw
 * a reference pass 1 did not, or a page-total count check failed) — the machinery worked and the
 * data is known-partial, so the watermark must NOT advance. `failed` is a MACHINERY error (an
 * enumeration call returned `ok:false`) — nothing is known about completeness, so nothing moves.
 * Conflating the two would let a transport blip masquerade as a clean sweep (or vice-versa); they
 * are kept distinct precisely so the caller can react differently (retry vs alert-and-hold).
 */
export const SyncOutcome = z.enum(['complete', 'incomplete', 'failed']);
export type SyncOutcome = z.infer<typeof SyncOutcome>;

/** Transport-session lifecycle events the injected enumerator may report per run, threaded into
 *  the report so an operator can see when a long-lived session was reused, re-established, or
 *  retired as unhealthy. The orchestrator only aggregates these — it never manages a session. */
export const SyncSessionEvent = z.enum(['reused', 'reestablished', 'marked-unhealthy']);
export type SyncSessionEvent = z.infer<typeof SyncSessionEvent>;

/** Optional page-total reconciliation: if the source advertises a total, we compare it against the
 *  number of items actually enumerated. A mismatch blocks a `complete` outcome (it is a count-level
 *  proof of a miss, complementary to the ref-level pass-1-vs-pass-2 diff). */
export const SyncCountCheck = z.object({
  /** The source-advertised total for the window (e.g. a results-grid "N results" figure). */
  pageTotal: Count,
  /** How many items the enumeration actually yielded in pass 1. */
  enumerated: Count,
  match: z.boolean(),
});
export type SyncCountCheck = z.infer<typeof SyncCountCheck>;

/** The two-pass verification evidence. `pass1.newRefs` is a COUNT (references not already in the
 *  seen-set); `pass2.refsOnlyInPass2` is the LIST of references pass 2 surfaced that pass 1 did not
 *  — the load-bearing proof, kept as concrete strings because a non-empty list IS the miss. */
export const SyncVerification = z.object({
  pass1: z.object({ pages: Count, itemsSeen: Count, newRefs: Count }),
  pass2: z.object({ pages: Count, itemsSeen: Count, refsOnlyInPass2: z.array(z.string()) }),
  countCheck: SyncCountCheck.optional(),
});
export type SyncVerification = z.infer<typeof SyncVerification>;

export const SyncRunReport = z.object({
  /** Stable id for this run's report row (`_id` when persisted). */
  id: z.string(),
  /** The logical sync this run belongs to — `${orgId}::${integrationKey}::${actionKey}` in the
   *  connector wiring, but opaque here (the orchestrator only records it). */
  syncKey: z.string(),
  orgId: z.string(),
  startedAt: IsoTimestamp,
  endedAt: IsoTimestamp,
  outcome: SyncOutcome,
  /** The window that was swept: `[since, until]`. `since` is the stored watermark (null on the very
   *  first run — a full backfill); `until` is the ceiling the watermark advances to on `complete`.
   *  Both are opaque cursor strings, not necessarily ISO timestamps (transport-agnostic). */
  window: z.object({ since: z.string().nullable(), until: z.string() }),
  verification: SyncVerification,
  /** New items durably landed this run (across both passes). */
  landed: Count,
  /** Items whose deterministic-id land returned "already present" — the at-least-once safety net
   *  firing (a re-land after a crash, or the inclusive-boundary re-fetch), never a lost item. */
  duplicatesSuppressed: Count,
  sessionEvents: z.array(SyncSessionEvent),
  /** Present only on `failed`: the truncated enumerator error string. */
  error: z.string().optional(),
});
export type SyncRunReport = z.infer<typeof SyncRunReport>;
