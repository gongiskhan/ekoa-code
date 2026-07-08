import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replay, type ReplayLedger, type ExpectedAggregates } from '../../scripts/billing-replay/replay.js';
import { computeMetered } from '../../src/billing/tracker.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { __resetBillingConfigForTests, periodMs } from '../../src/billing/constants.js';

/**
 * ch10 §10.4 Part A - deterministic ledger replay, tolerance ZERO. The replay binds to the real
 * billing computation path (computeMetered, §6.5.2) and the §6.6.2 lazy-reset aggregation, under
 * the carried default weight config. The corrupted-fixture variant proves the zero-tolerance
 * check actually bites.
 */
const DIR = join(__dirname, '..', '..', 'scripts', 'billing-replay', 'fixtures');
const ledger = JSON.parse(readFileSync(join(DIR, 'ledger.json'), 'utf8')) as ReplayLedger;
const ledgerCorrupt = JSON.parse(readFileSync(join(DIR, 'ledger-corrupt.json'), 'utf8')) as ReplayLedger;
const expected = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8')) as ExpectedAggregates;

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetBillingConfigForTests();
  __resetConfigForTests();
  loadConfig(); // default tier weights (FAST 0.02, WORKHORSE 0.1, EXPERT 0.4, cacheRead 0.25)
});

describe('exact ledger replay (tolerance zero)', () => {
  it('recomputes every per-user aggregate to equal the stored total exactly', () => {
    const result = replay(ledger, expected);
    expect(result.match).toBe(true);
    expect(result.perEventMismatches).toHaveLength(0);
    for (const p of result.perUser) {
      expect(p.diff, `${p.userId} diff`).toBe(0);
      expect(p.recomputed).toBe(p.expected);
    }
  });

  it('crosses a billing-period boundary: applyLazyReset zeroes the meter so only the current period counts (§6.6.2)', () => {
    const P = 1_700_000_000_000;
    const raw1 = { input: 5000, output: 0, cacheCreate: 0, cacheRead: 0 };
    const raw2 = { input: 1000, output: 0, cacheCreate: 0, cacheRead: 0 };
    // One event in period 1, one in period 2 (crossing P + periodMs()). After the reset, only the
    // period-2 event survives in the current-period meter.
    const multi: ReplayLedger = {
      periodStart: P,
      events: [
        { billeeUserId: 'u-multi', tier: 'FAST', raw: raw1, timestamp: P + 1000 },
        { billeeUserId: 'u-multi', tier: 'FAST', raw: raw2, timestamp: P + periodMs() + 1000 },
      ],
    };
    const currentPeriodOnly = computeMetered('FAST', raw2);
    // Correct expected (post-reset) matches exactly.
    expect(replay(multi, { 'u-multi': currentPeriodOnly }).match).toBe(true);
    // If the reset did NOT fire (naive sum of both periods), the total would be larger - so the
    // sum-of-both expected must MISMATCH, proving the period boundary is really exercised.
    const naiveSum = computeMetered('FAST', raw1) + currentPeriodOnly;
    expect(naiveSum).toBeGreaterThan(currentPeriodOnly);
    expect(replay(multi, { 'u-multi': naiveSum }).match).toBe(false);
  });

  it('binds to computeMetered: the aggregate is exactly the sum of the §6.5.2 formula per event', () => {
    const bySum: Record<string, number> = {};
    for (const e of ledger.events) {
      bySum[e.billeeUserId] = (bySum[e.billeeUserId] ?? 0) + computeMetered(e.tier, e.raw);
    }
    const result = replay(ledger, expected);
    expect(result.recomputed).toEqual(bySum);
    // and the stored per-event metered values equal the recompute (per-event parity)
    for (const e of ledger.events) {
      expect(e.metered).toBe(computeMetered(e.tier, e.raw));
    }
  });
});

describe('the zero-tolerance check bites', () => {
  it('detects a corrupted ledger: a single tampered raw count breaks parity', () => {
    const result = replay(ledgerCorrupt, expected);
    expect(result.match).toBe(false);
    const alice = result.perUser.find((p) => p.userId === 'u-alice')!;
    expect(alice.diff).not.toBe(0);
    expect(alice.recomputed).toBe(176970); // 20 + 176000 + 950 (output tampered 30k -> 40k)
    // the stored per-event metered (172000) no longer matches the recompute (176000) either
    expect(result.perEventMismatches.some((m) => m.billeeUserId === 'u-alice')).toBe(true);
  });

  it('a wrong expected aggregate is caught even with a clean ledger', () => {
    const wrong: ExpectedAggregates = { ...expected, 'u-bob': 9999 };
    const result = replay(ledger, wrong);
    expect(result.match).toBe(false);
    expect(result.perUser.find((p) => p.userId === 'u-bob')!.diff).toBe(2260 - 9999);
  });
});
