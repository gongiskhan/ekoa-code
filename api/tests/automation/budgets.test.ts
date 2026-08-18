/**
 * The engine's knobs, pinned.
 *
 * `budgets.ts` exists so that every retry / cap / ceiling is a named field with its reason written
 * next to it. That only holds if changing one of those numbers is a DELIBERATE act - hence this
 * suite. `REHEARSAL_BUDGET` in particular moved here from `rehearsal.ts` and its values must be
 * byte-for-byte what they were, so the move is provably behaviour-free.
 */
import { describe, it, expect } from 'vitest';

import {
  REHEARSAL_BUDGET,
  STEP_RETRY_BUDGET,
  NORMAL_RUN_BUDGET,
  DISCOVERY_BUDGET,
  createStepRetryLedger,
} from '../../src/automation/budgets.js';
import { REHEARSAL_BUDGET as REHEARSAL_BUDGET_VIA_REHEARSAL } from '../../src/automation/rehearsal.js';

describe('REHEARSAL_BUDGET', () => {
  it('matches the agreed limits (unchanged by the move to budgets.ts)', () => {
    expect(REHEARSAL_BUDGET.maxFixerCalls).toBe(25);
    expect(REHEARSAL_BUDGET.maxWallClockMs).toBe(4 * 60 * 1000);
    expect(REHEARSAL_BUDGET.maxPatchesPerIndex).toBe(5);
    expect(REHEARSAL_BUDGET.maxNormalPauses).toBe(5);
  });

  it('is still reachable from rehearsal.ts, and is the same object', () => {
    // The re-export is what kept every existing call site (engine.ts, automation/index.ts, the
    // rehearsal suite) working across the move. Same identity, not merely equal values.
    expect(REHEARSAL_BUDGET_VIA_REHEARSAL).toBe(REHEARSAL_BUDGET);
  });
});

describe('STEP_RETRY_BUDGET', () => {
  it('allows exactly one deterministic re-attempt and one counted vision re-ground per step', () => {
    expect(STEP_RETRY_BUDGET.deterministicRetries).toBe(1);
    expect(STEP_RETRY_BUDGET.visionRegroundsPerStep).toBe(1);
  });
});

describe('NORMAL_RUN_BUDGET', () => {
  it('caps a normal run at eight minutes - twice the rehearsal budget, deliberately', () => {
    expect(NORMAL_RUN_BUDGET.maxWallClockMs).toBe(8 * 60 * 1000);
    expect(NORMAL_RUN_BUDGET.maxWallClockMs).toBeGreaterThan(REHEARSAL_BUDGET.maxWallClockMs);
  });

  it('pins its pause cap to the rehearsal value rather than restating it', () => {
    expect(NORMAL_RUN_BUDGET.maxNormalPauses).toBe(REHEARSAL_BUDGET.maxNormalPauses);
  });
});

describe('DISCOVERY_BUDGET', () => {
  // No consumer yet: discovery does not exist (P2). Declared and pinned now so the phase that
  // builds it spends a reviewed budget instead of inventing three inline literals.
  it('bounds re-plans, wall clock and fixer calls', () => {
    expect(DISCOVERY_BUDGET.maxRePlans).toBe(3);
    expect(DISCOVERY_BUDGET.maxWallClockMs).toBe(6 * 60 * 1000);
    expect(DISCOVERY_BUDGET.maxFixerCalls).toBe(REHEARSAL_BUDGET.maxFixerCalls);
  });
});

describe('createStepRetryLedger', () => {
  it('grants the budgeted re-grounds per index and refuses the next one', () => {
    const ledger = createStepRetryLedger();
    for (let n = 0; n < STEP_RETRY_BUDGET.visionRegroundsPerStep; n += 1) {
      expect(ledger.claimVisionReground(0)).toBe(true);
    }
    expect(ledger.claimVisionReground(0)).toBe(false);
    expect(ledger.visionRegrounds(0)).toBe(STEP_RETRY_BUDGET.visionRegroundsPerStep);
  });

  it('accounts per INDEX - one exhausted step does not spend another step\'s budget', () => {
    const ledger = createStepRetryLedger();
    expect(ledger.claimVisionReground(0)).toBe(true);
    expect(ledger.claimVisionReground(0)).toBe(false);
    // Index 1 is untouched: the budget is "getting past position N", not "this run's total".
    expect(ledger.visionRegrounds(1)).toBe(0);
    expect(ledger.claimVisionReground(1)).toBe(true);
  });
});
