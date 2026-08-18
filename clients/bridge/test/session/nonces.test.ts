import { describe, it, expect } from 'vitest';
import { NonceCache } from '../../src/session/index.js';

/**
 * Replay cache (S2, §18.5.1 step 5). The verification contract is CHECK-then-RECORD: `has` is asked
 * before `record`, so a nonce is accepted at most once. Harness parity: daemon.ts `seenNonces`.
 */
describe('NonceCache — check-then-record replay protection (S2)', () => {
  it('reports an unseen nonce as absent, then present once recorded', () => {
    const c = new NonceCache();
    expect(c.has('n1')).toBe(false);
    c.record('n1');
    expect(c.has('n1')).toBe(true);
  });

  it('keeps distinct nonces independent', () => {
    const c = new NonceCache();
    c.record('n1');
    expect(c.has('n1')).toBe(true);
    expect(c.has('n2')).toBe(false);
  });

  it('recording the same nonce twice is idempotent (still seen)', () => {
    const c = new NonceCache();
    c.record('n1');
    c.record('n1');
    expect(c.has('n1')).toBe(true);
  });
});
