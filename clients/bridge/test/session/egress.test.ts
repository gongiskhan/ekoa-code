import { describe, it, expect } from 'vitest';
import { EgressAccounting } from '../../src/session/index.js';

/**
 * Per-session egress accounting (S5). Raw byte counts; accumulation persists per session across
 * tasks; the breach check is `used + new > budget` (STRICT `>`, harness parity — daemon.ts
 * lines 137-142), so hitting the budget exactly is allowed and one byte over is not.
 */
describe('EgressAccounting — per-session raw-byte egress (S5)', () => {
  it('accumulates raw bytes per session across calls', () => {
    const eg = new EgressAccounting();
    expect(eg.used('s1')).toBe(0);
    eg.add('s1', 100);
    eg.add('s1', 50);
    expect(eg.used('s1')).toBe(150);
  });

  it('wouldExceed compares accumulated+new against the budget with a strict >', () => {
    const eg = new EgressAccounting();
    eg.add('s1', 90);
    expect(eg.wouldExceed('s1', 10, 100)).toBe(false); // 90 + 10 == 100 → allowed
    expect(eg.wouldExceed('s1', 11, 100)).toBe(true); // 90 + 11 == 101 → breach
  });

  it('treats the exact budget boundary as allowed on a fresh session', () => {
    const eg = new EgressAccounting();
    expect(eg.wouldExceed('s1', 100, 100)).toBe(false); // exactly the budget
    expect(eg.wouldExceed('s1', 101, 100)).toBe(true); // one byte over
  });

  it('isolates accumulation per session', () => {
    const eg = new EgressAccounting();
    eg.add('s1', 500);
    expect(eg.used('s2')).toBe(0); // s2 has read nothing
    expect(eg.wouldExceed('s2', 100, 200)).toBe(false); // s2 unaffected by s1's usage
    expect(eg.wouldExceed('s1', 100, 200)).toBe(true); // s1 already at 500, over any 200 budget
  });

  it('accounts the same task budget against the RUNNING per-session total (across tasks)', () => {
    // Two tasks in the same session, each budget 100: the first read of 80 leaves 20 headroom, so a
    // later 30-byte read in the same session breaches even though it fits the task's own budget.
    const eg = new EgressAccounting();
    expect(eg.wouldExceed('s1', 80, 100)).toBe(false);
    eg.add('s1', 80);
    expect(eg.wouldExceed('s1', 30, 100)).toBe(true); // 80 + 30 == 110 > 100
    expect(eg.wouldExceed('s1', 20, 100)).toBe(false); // 80 + 20 == 100 → still allowed
  });
});
