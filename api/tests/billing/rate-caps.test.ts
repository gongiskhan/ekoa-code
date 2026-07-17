import { describe, it, expect } from 'vitest';
import { RateLimiter, type RateCapConfig } from '../../src/billing/rate-caps.js';

/** ch06 §6.6.4 chokepoint rate limits + spend caps: per-user AND per-org sliding-window rate +
 *  metered-spend caps, clock-injectable, config-overridable, with a burn alert. */
const T0 = 1_700_000_000_000;
const cfg = (over: Partial<RateCapConfig> = {}): Partial<RateCapConfig> => ({
  windowMs: 1000, maxCallsPerUser: 3, maxCallsPerOrg: 5, maxSpendPerUser: 1000, maxSpendPerOrg: 3000,
  burnAlertFraction: 0.8, ...over,
});
const key = (u: string, o: string, now: number) => ({ billeeUserId: u, orgId: o, now });

describe('per-user rate limit (sliding window)', () => {
  it('trips on the Nth call, and the window slides so an old call frees a slot', () => {
    const rl = new RateLimiter(cfg());
    for (let i = 0; i < 3; i++) {
      expect(rl.check(key('u1', 'orgA', T0 + i)).ok).toBe(true);
      rl.recordSpend({ ...key('u1', 'orgA', T0 + i), metered: 1 });
    }
    // 3 calls already in the window → the 4th is blocked
    const v = rl.check(key('u1', 'orgA', T0 + 3));
    expect(v).toMatchObject({ ok: false, scope: 'user', kind: 'rate' });
    // slide past the window (all 3 older than windowMs) → admitted again
    expect(rl.check(key('u1', 'orgA', T0 + 2000)).ok).toBe(true);
  });
});

describe('per-org rate limit', () => {
  it('trips across users of the same org (org counter is independent of the user counter)', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerUser: 100, maxCallsPerOrg: 3 }));
    for (let i = 0; i < 3; i++) rl.recordSpend({ ...key(`u${i}`, 'orgA', T0 + i), metered: 1 });
    const v = rl.check(key('u9', 'orgA', T0 + 4));
    expect(v).toMatchObject({ ok: false, scope: 'org', kind: 'rate' });
  });
});

describe('spend caps', () => {
  it('per-user spend cap trips once accumulated metered ≥ cap', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerUser: 100, maxSpendPerUser: 1000 }));
    rl.recordSpend({ ...key('u1', 'orgA', T0), metered: 999 });
    expect(rl.check(key('u1', 'orgA', T0 + 1)).ok).toBe(true);
    rl.recordSpend({ ...key('u1', 'orgA', T0 + 1), metered: 1 }); // now at 1000
    expect(rl.check(key('u1', 'orgA', T0 + 2))).toMatchObject({ ok: false, scope: 'user', kind: 'spend' });
  });

  it('per-org spend cap trips independently', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerUser: 100, maxCallsPerOrg: 100, maxSpendPerUser: 1e9, maxSpendPerOrg: 3000 }));
    rl.recordSpend({ ...key('u1', 'orgA', T0), metered: 2000 });
    rl.recordSpend({ ...key('u2', 'orgA', T0 + 1), metered: 1000 });
    expect(rl.check(key('u3', 'orgA', T0 + 2))).toMatchObject({ ok: false, scope: 'org', kind: 'spend' });
  });
});

describe('blocked calls are not recorded (check does not mutate the window)', () => {
  it('a blocked check leaves the counters unchanged — only recordSpend advances them', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerUser: 1 }));
    rl.recordSpend({ ...key('u1', 'orgA', T0), metered: 1 });
    expect(rl.check(key('u1', 'orgA', T0 + 1)).ok).toBe(false);
    // re-checking many times never pushes the window further; a slide still frees it exactly at windowMs
    for (let i = 0; i < 5; i++) expect(rl.check(key('u1', 'orgA', T0 + 1)).ok).toBe(false);
    expect(rl.check(key('u1', 'orgA', T0 + 1001)).ok).toBe(true);
  });
});

describe('anomalous-burn alert', () => {
  it('fires once when spend crosses the burn fraction of a cap', () => {
    const alerts: Array<{ scope: string; kind: string }> = [];
    const rl = new RateLimiter(cfg({ maxCallsPerUser: 1000, maxSpendPerUser: 1000, burnAlertFraction: 0.8 }), (i) => alerts.push({ scope: i.scope, kind: i.kind }));
    rl.recordSpend({ ...key('u1', 'orgA', T0), metered: 700 }); // 70% < 80% → no alert
    expect(alerts).toHaveLength(0);
    rl.recordSpend({ ...key('u1', 'orgA', T0 + 1), metered: 200 }); // 90% ≥ 80% → alert
    rl.recordSpend({ ...key('u1', 'orgA', T0 + 2), metered: 50 }); // still ≥ 80% → not re-fired
    expect(alerts.filter((a) => a.scope === 'user' && a.kind === 'spend')).toHaveLength(1);
  });
});

describe('per-KEY caps (S4a gateway keys, run 20260717)', () => {
  const keyed = (u: string, o: string, keyId: string, now: number, keyCaps?: { maxCallsPerWindow?: number; maxSpendPerWindow?: number }) =>
    ({ billeeUserId: u, orgId: o, keyId, now, ...(keyCaps ? { keyCaps } : {}) });

  it('trips the key window independently of the (untouched) user/org windows', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerUser: 100, maxCallsPerOrg: 100, maxCallsPerKey: 2 }));
    rl.recordSpend({ ...keyed('u1', 'orgA', 'k1', T0), metered: 1 });
    rl.recordSpend({ ...keyed('u1', 'orgA', 'k1', T0 + 1), metered: 1 });
    expect(rl.check(keyed('u1', 'orgA', 'k1', T0 + 2))).toMatchObject({ ok: false, scope: 'key', kind: 'rate' });
    // A DIFFERENT key of the same user is free; a keyless call is free.
    expect(rl.check(keyed('u1', 'orgA', 'k2', T0 + 3)).ok).toBe(true);
    expect(rl.check(key('u1', 'orgA', T0 + 4)).ok).toBe(true);
  });

  it('per-key spend cap trips; doc-level keyCaps overrides beat the config defaults', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerKey: 100, maxSpendPerKey: 500 }));
    rl.recordSpend({ ...keyed('u1', 'orgA', 'k1', T0), metered: 500 });
    expect(rl.check(keyed('u1', 'orgA', 'k1', T0 + 1))).toMatchObject({ ok: false, scope: 'key', kind: 'spend' });

    // Override: this key allows only 1 call/window although the config default is 100.
    const rl2 = new RateLimiter(cfg({ maxCallsPerKey: 100 }));
    rl2.recordSpend({ ...keyed('u1', 'orgA', 'k1', T0), metered: 1 });
    expect(rl2.check(keyed('u1', 'orgA', 'k1', T0 + 1, { maxCallsPerWindow: 1 }))).toMatchObject({ ok: false, scope: 'key', kind: 'rate' });
    expect(rl2.check(keyed('u1', 'orgA', 'k1', T0 + 2)).ok).toBe(true); // default cap: still fine
  });

  it('the key window slides like the others', () => {
    const rl = new RateLimiter(cfg({ maxCallsPerKey: 1 }));
    rl.recordSpend({ ...keyed('u1', 'orgA', 'k1', T0), metered: 1 });
    expect(rl.check(keyed('u1', 'orgA', 'k1', T0 + 1)).ok).toBe(false);
    expect(rl.check(keyed('u1', 'orgA', 'k1', T0 + 1001)).ok).toBe(true);
  });
});
