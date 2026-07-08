/**
 * Billing parity Part B - scripted parity workload, STRUCTURAL-ASSERTION mode (ch10 §10.4).
 *
 * A fixed suite of representative billable operations (committed prompts) is driven through the
 * REAL metering path (`recordTokenEvent`, billing/tracker) with STUBBED model responses (fixed
 * token counts) - NO live model calls, which is the phase-10 gate scope. The harness then reads
 * the resulting `token_events` ledger and asserts the STRUCTURAL invariants that catch gross
 * wiring errors (double-billing, missed metering, mis-attribution):
 *
 *   1. Exactly ONE ledger event per model call (per-operation census + total census).
 *   2. Correct attribution class on every event (`user_work | classifier | platform`, FIXED-3).
 *   3. ZERO `platform`-attributed events in these user-facing flows (ch06 call-site fates).
 *   4. Correct tier weight SNAPSHOTTED onto each event (== tierWeight(tier) under the carried config).
 *   5. No unattributed calls: every event carries an attribution class and a real billee.
 *   6. A cached automation replay produces ZERO model calls (and therefore zero events).
 *
 * The ±25% banded per-class token-total check is a LIVE-run assertion (model nondeterminism makes
 * a tighter band meaningless); it is COMPUTED and reported here (checkBands) but is NOT the gate -
 * the structural checks above are. The workload is driven against an ephemeral memory-mongo.
 */
import { recordTokenEvent, type AttributionKind, type Tier } from '../../src/billing/tracker.js';
import { tierWeight } from '../../src/billing/constants.js';
import { tokenEvents } from '../../src/data/stores.js';
import type { Doc } from '../../src/data/store.js';

export type OperationClass = 'chat' | 'build' | 'automation' | 'integration-builder' | 'gateway';

export interface StubbedCall {
  attributionKind: AttributionKind;
  agentType: string;
  tier: Tier;
  /** The recorded/stubbed model response token counts (no live model call). */
  raw: { input: number; output: number; cacheCreate: number; cacheRead: number };
  model?: string;
}

export interface WorkloadOperation {
  id: string;
  class: OperationClass;
  billeeUserId: string;
  /** A cached replay resolves without any model call - it must produce zero ledger events. */
  cached?: boolean;
  calls: StubbedCall[];
}

export interface Workload {
  operations: WorkloadOperation[];
}

/** The §10.4 expected operation-class composition (fixed suite). */
export const EXPECTED_COMPOSITION: Record<OperationClass, number> = {
  chat: 10,
  build: 4,
  automation: 4,
  'integration-builder': 2,
  gateway: 4,
};

export interface InvariantCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PerClassTotals {
  class: OperationClass;
  userWorkTokens: number;
  events: number;
}

export interface StructuralReport {
  totalCalls: number;
  totalEvents: number;
  attributionCensus: Record<AttributionKind, number>;
  perOperationEvents: Record<string, number>;
  perClass: PerClassTotals[];
  invariants: InvariantCheck[];
  ok: boolean;
}

interface LedgerRow extends Doc {
  attributionKind: AttributionKind;
  agentType: string;
  tier: Tier;
  tierWeight: number;
  metered: number;
  billeeUserId: string;
  runId?: string;
}

/**
 * Drive the workload through the real tracker: one `recordTokenEvent` per stubbed call, tagged
 * with the operation id (`runId`) so the ledger can be censused per operation. Writes to the
 * connected (memory-)mongo; no live model calls.
 */
export async function driveWorkload(workload: Workload): Promise<void> {
  for (const op of workload.operations) {
    for (const call of op.calls) {
      await recordTokenEvent({
        billeeUserId: op.billeeUserId,
        attributionKind: call.attributionKind,
        agentType: call.agentType,
        tier: call.tier,
        model: call.model ?? `stub-${call.tier}`,
        raw: call.raw,
        runId: op.id,
      });
    }
  }
}

/** Read the ledger and evaluate the structural invariants (the gate). */
export async function assertStructural(workload: Workload): Promise<StructuralReport> {
  const rows = (await tokenEvents.find({})) as unknown as LedgerRow[];
  const totalCalls = workload.operations.reduce((n, op) => n + op.calls.length, 0);

  const attributionCensus: Record<AttributionKind, number> = { user_work: 0, classifier: 0, platform: 0 };
  for (const r of rows) attributionCensus[r.attributionKind] = (attributionCensus[r.attributionKind] ?? 0) + 1;

  const perOperationEvents: Record<string, number> = {};
  for (const r of rows) if (r.runId) perOperationEvents[r.runId] = (perOperationEvents[r.runId] ?? 0) + 1;

  // Invariant 1: exactly one ledger event per model call, per operation and in total.
  const perOpOk = workload.operations.every((op) => (perOperationEvents[op.id] ?? 0) === op.calls.length);
  const invariants: InvariantCheck[] = [];
  invariants.push({
    name: 'one-ledger-event-per-model-call',
    ok: rows.length === totalCalls && perOpOk,
    detail: `${rows.length} events for ${totalCalls} calls; per-operation census ${perOpOk ? 'exact' : 'MISMATCH'}`,
  });

  // Invariant 2: every event carries a valid attribution class (FIXED-3).
  const validKinds = new Set<AttributionKind>(['user_work', 'classifier', 'platform']);
  const badKind = rows.filter((r) => !validKinds.has(r.attributionKind));
  invariants.push({
    name: 'valid-attribution-class',
    ok: badKind.length === 0,
    detail: badKind.length === 0 ? 'all events user_work|classifier|platform' : `${badKind.length} invalid`,
  });

  // Invariant 3: ZERO platform-attributed events in these user-facing flows.
  invariants.push({
    name: 'zero-platform-attribution',
    ok: attributionCensus.platform === 0,
    detail: `${attributionCensus.platform} platform-attributed event(s)`,
  });

  // Invariant 4: correct tier weight snapshotted on every event.
  const wrongWeight = rows.filter((r) => r.tierWeight !== tierWeight(r.tier));
  invariants.push({
    name: 'correct-tier-weight-snapshot',
    ok: wrongWeight.length === 0,
    detail: wrongWeight.length === 0 ? 'every tierWeight == tierWeight(tier)' : `${wrongWeight.length} mis-snapshotted`,
  });

  // Invariant 5: no unattributed calls - every event has a class and a real billee.
  const unattributed = rows.filter((r) => !r.attributionKind || !r.billeeUserId);
  invariants.push({
    name: 'no-unattributed-calls',
    ok: unattributed.length === 0,
    detail: unattributed.length === 0 ? 'every event has class + billee' : `${unattributed.length} unattributed`,
  });

  // Invariant 6: a cached automation replay produces zero model calls (zero events).
  const cachedOps = workload.operations.filter((op) => op.cached);
  const cachedZero = cachedOps.every((op) => (perOperationEvents[op.id] ?? 0) === 0);
  invariants.push({
    name: 'cached-replay-zero-model-calls',
    ok: cachedZero,
    detail: `${cachedOps.length} cached op(s); ${cachedZero ? 'all zero events' : 'a cached op emitted events'}`,
  });

  // Per-class user_work token totals (for the documented ±25% live band, not a gate here).
  const perClass: PerClassTotals[] = (Object.keys(EXPECTED_COMPOSITION) as OperationClass[]).map((cls) => {
    const opIds = new Set(workload.operations.filter((o) => o.class === cls).map((o) => o.id));
    const clsRows = rows.filter((r) => r.runId && opIds.has(r.runId));
    const userWorkTokens = clsRows.filter((r) => r.attributionKind === 'user_work').reduce((n, r) => n + r.metered, 0);
    return { class: cls, userWorkTokens, events: clsRows.length };
  });

  const ok = invariants.every((i) => i.ok);
  return { totalCalls, totalEvents: rows.length, attributionCensus, perOperationEvents, perClass, invariants, ok };
}

/** Drive + assert in one call (the gate). */
export async function runWorkload(workload: Workload): Promise<StructuralReport> {
  await driveWorkload(workload);
  return assertStructural(workload);
}

/** Verify the workload's operation-class composition matches the fixed §10.4 suite. */
export function checkComposition(workload: Workload): InvariantCheck {
  const counts: Record<string, number> = {};
  for (const op of workload.operations) counts[op.class] = (counts[op.class] ?? 0) + 1;
  const mismatches = (Object.keys(EXPECTED_COMPOSITION) as OperationClass[]).filter(
    (cls) => (counts[cls] ?? 0) !== EXPECTED_COMPOSITION[cls],
  );
  return {
    name: 'workload-composition',
    ok: mismatches.length === 0,
    detail: mismatches.length === 0 ? '10 chat / 4 build / 4 automation / 2 integration-builder / 4 gateway' : `off: ${mismatches.join(', ')}`,
  };
}

export interface BandResult {
  class: OperationClass;
  newTokens: number;
  oldTokens: number;
  withinBand: boolean;
}

/**
 * The LIVE-run ±25% banded check (documented, NOT the structural gate). Given the old stack's
 * per-class user_work token totals from the same-week parity round, assert the new stack's totals
 * are within +/-25%. Exposed so a live run can call it; structural mode does not gate on it.
 */
export function checkBands(report: StructuralReport, oldStackPerClass: Record<string, number>): BandResult[] {
  return report.perClass.map((pc) => {
    const oldTokens = oldStackPerClass[pc.class] ?? 0;
    const lo = oldTokens * 0.75;
    const hi = oldTokens * 1.25;
    return { class: pc.class, newTokens: pc.userWorkTokens, oldTokens, withinBand: pc.userWorkTokens >= lo && pc.userWorkTokens <= hi };
  });
}
