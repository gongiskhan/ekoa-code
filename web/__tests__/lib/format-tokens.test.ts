import { describe, it, expect } from 'vitest';
import { fmtTokens } from '@/lib/format/tokens';

/**
 * fmtTokens must be TOTAL over the wire's optional fields: the /users and /usage pages
 * crashed on `undefined.toLocaleString()` when admin usage rows arrived without the
 * gauge fields. Missing/NaN input renders the em-dash placeholder, never throws.
 */
describe('fmtTokens', () => {
  it('formats plain, thousand and million magnitudes', () => {
    expect(fmtTokens(0)).toBe('0');
    expect(fmtTokens(999)).toBe('999');
    expect(fmtTokens(1_000)).toBe('1k');
    expect(fmtTokens(12_345)).toBe('12.3k');
    expect(fmtTokens(1_000_000)).toBe('1M');
    expect(fmtTokens(1_500_000)).toBe('1.5M');
  });

  it('renders a placeholder for null/undefined/NaN instead of throwing', () => {
    expect(fmtTokens(null)).toBe('—');
    expect(fmtTokens(undefined)).toBe('—');
    expect(fmtTokens(Number.NaN)).toBe('—');
    expect(fmtTokens(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
