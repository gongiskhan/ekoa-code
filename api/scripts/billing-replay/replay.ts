/**
 * Billing parity Part A - deterministic ledger replay (ch10 §10.4, tolerance ZERO).
 *
 * Cutover requires proof that the NEW metering (ch06) bills the same work the OLD stack did.
 * Part A proves the accounting MATH with no model calls at all: export the old stack's
 * token-event ledger for a full closed billing period, feed the RAW per-event token counts
 * through the new billing module's PURE computation path, aggregate per user with the exact
 * §6.6.2 lazy-period-reset semantics, and assert the recomputed per-user totals EQUAL the old
 * stack's stored aggregates EXACTLY (tolerance zero).
 *
 * The pure path binds to the real billing module, not a re-implementation:
 *   - per-event metered = `computeMetered(tier, raw)` (billing/tracker, the §6.5.2 formula:
 *     round(w*(input+output+cacheCreate) + w*cacheReadFactor()*cacheRead), w=tierWeight(tier));
 *   - per-user aggregation folds each event's metered into a running meter through
 *     `applyLazyReset` (billing/tracker, §6.6.2) - the SAME fold `recordTokenEvent` performs and
 *     `service.usageFor`/`adminListUsage` read back - so a period boundary zeroes the meter and
 *     advances the start exactly as production would.
 * No DB writes are needed: the meter is reconstructed from the raw events in timestamp order.
 *
 * Weights + cache-read factor come from the carried config (billing/constants -> config.ts,
 * ch06 §6.2.3): parity holds because the new stack single-sources the weights the old stack used.
 */
import { computeMetered, applyLazyReset, type BillingAccountDoc, type Tier } from '../../src/billing/tracker.js';

export interface ReplayEvent {
  billeeUserId: string;
  tier: Tier;
  raw: { input: number; output: number; cacheCreate: number; cacheRead: number };
  timestamp: number;
  /** The old stack's stored per-event metered value, cross-checked against the recompute. */
  metered?: number;
}

export interface ReplayLedger {
  /** Period start for the closed billing period under replay. */
  periodStart: number;
  events: ReplayEvent[];
}

export type ExpectedAggregates = Record<string, number>;

export interface PerUserParity {
  userId: string;
  recomputed: number;
  expected: number;
  diff: number;
  match: boolean;
}

export interface PerEventMismatch {
  index: number;
  billeeUserId: string;
  stored: number;
  recomputed: number;
}

export interface ReplayResult {
  recomputed: ExpectedAggregates;
  perUser: PerUserParity[];
  perEventMismatches: PerEventMismatch[];
  /** True IFF every per-user diff is zero AND every stored per-event metered matches (tolerance zero). */
  match: boolean;
}

/** A minimal billing account for the §6.6.2 lazy-reset fold - only the two fields it reads matter. */
function seedAccount(periodStart: number): BillingAccountDoc {
  return {
    _id: 'replay',
    monthlyBaseTokensUsed: 0,
    creditBalanceUsd: 0,
    overageEnabled: false,
    currentPeriodStart: periodStart,
    tokenLimit: null,
  };
}

/**
 * Replay the ledger through the pure billing path and compare to the stored aggregates.
 * Zero tolerance: any per-user difference or per-event metered mismatch flips `match` to false.
 */
export function replay(ledger: ReplayLedger, expected: ExpectedAggregates): ReplayResult {
  const perEventMismatches: PerEventMismatch[] = [];
  // Group events by billee, preserving global order for the per-event cross-check.
  const byUser = new Map<string, ReplayEvent[]>();
  ledger.events.forEach((e, index) => {
    const metered = computeMetered(e.tier, e.raw);
    if (typeof e.metered === 'number' && e.metered !== metered) {
      perEventMismatches.push({ index, billeeUserId: e.billeeUserId, stored: e.metered, recomputed: metered });
    }
    const list = byUser.get(e.billeeUserId) ?? [];
    list.push(e);
    byUser.set(e.billeeUserId, list);
  });

  const recomputed: ExpectedAggregates = {};
  for (const [userId, events] of byUser) {
    // Fold in timestamp order through the exact §6.6.2 reset the write path uses.
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
    let acct = seedAccount(ledger.periodStart);
    for (const e of sorted) {
      const { used, periodStart } = applyLazyReset(acct, e.timestamp);
      acct = { ...acct, monthlyBaseTokensUsed: used + computeMetered(e.tier, e.raw), currentPeriodStart: periodStart };
    }
    recomputed[userId] = acct.monthlyBaseTokensUsed;
  }

  const userIds = new Set([...Object.keys(recomputed), ...Object.keys(expected)]);
  const perUser: PerUserParity[] = [...userIds].sort().map((userId) => {
    const r = recomputed[userId] ?? 0;
    const ex = expected[userId] ?? 0;
    const diff = r - ex;
    return { userId, recomputed: r, expected: ex, diff, match: diff === 0 };
  });

  const match = perUser.every((p) => p.match) && perEventMismatches.length === 0;
  return { recomputed, perUser, perEventMismatches, match };
}
