import { describe, it, expect } from 'vitest';
import { matchFamilyTier } from '../../src/llm/client.js';

/**
 * S2 model family mapping (run 20260717-071930-d1244839): stock Claude Code model ids land on
 * tiers by FAMILY (opus -> EXPERT, sonnet -> WORKHORSE, haiku -> FAST) instead of exact-missing
 * into the FAST clamp. Pure unit matrix; the wire/integration behavior (params travel, metering
 * at the resolved tier) is pinned in gateway.test.ts.
 */
describe('matchFamilyTier', () => {
  const cases: Array<[string, string | null]> = [
    ['claude-opus-4-8', 'EXPERT'],
    ['claude-opus-4-8[1m]', 'EXPERT'],
    ['claude-opus-4-5-20260115', 'EXPERT'],
    ['claude-sonnet-5', 'WORKHORSE'],
    ['claude-3-7-sonnet-20250219', 'WORKHORSE'],
    ['claude-sonnet-4-5[1m]', 'WORKHORSE'],
    ['claude-haiku-4-5-20251001', 'FAST'],
    ['claude-3-5-haiku-20241022', 'FAST'],
    ['CLAUDE-OPUS-X', 'EXPERT'],
    ['gpt-5', null],
    ['some-alien-model', null],
    ['', null],
  ];
  for (const [model, tier] of cases) {
    it(`${JSON.stringify(model)} -> ${tier}`, () => {
      expect(matchFamilyTier(model)).toBe(tier);
    });
  }
});
