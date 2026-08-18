import { describe, it, expect } from 'vitest';
import { signDelegatedTask } from '../../src/wire/index.js';
import type { DelegatedTask } from '../../src/wire/index.js';
import { verifyDelegatedTask } from '../../src/verify/index.js';
import type { Denial, VerifyContext } from '../../src/verify/index.js';
import { GrantTable, NonceCache } from '../../src/session/index.js';

/**
 * Harness-parity for the ordered S2 task-binding verification. Mirrors the `S2 — task binding
 * verification (§18.5.1)` describe block of `ekoa-code/api/tests/fake-daemon/adversarial.test.ts`
 * case-for-case, with the SAME mkTask/sign pattern (fixed NOW, shared SECRET) and the SAME
 * denial-reason regexes. This file is the executable definition of the daemon-side binding contract
 * for the bridge; a divergence here is a wire/verification bug, not a test to relax.
 *
 * Grant roots below are arbitrary strings — verification is filesystem-free (it resolves grants by
 * session ownership only), so no temp tree is needed. The S1 (containment) and S5 (egress) blocks of
 * the harness exercise `read()`, which belongs to the tool/engine slice, not to S3.
 */
const SECRET = 'shared-signing-secret';
const NOW = 1_700_000_000_000;

function mkTask(over: Partial<Omit<DelegatedTask, 'sig'>> = {}): DelegatedTask {
  const base: Omit<DelegatedTask, 'sig'> = {
    taskId: 't1', org: 'orgA', user: 'u1', session: 's1', pairingId: 'p1',
    grantRefs: ['g1'], task: 'summarise the contract',
    budget: { egressBytes: 10_000, modelSpend: { userId: 'u1' } },
    expiry: new Date(NOW + 60_000).toISOString(), nonce: `n-${Math.random()}`,
    ...over,
  };
  return { ...base, sig: signDelegatedTask(base, SECRET) };
}

/** A verification context mirroring `daemon()`: this pairing/org, the shared secret, one grant. */
function mkCtx(over: Partial<VerifyContext> = {}): VerifyContext {
  return {
    pairingId: 'p1', org: 'orgA', signingSecret: SECRET,
    nonces: new NonceCache(),
    grants: new GrantTable([{ grantRef: 'g1', root: '/granted', session: 's1' }]),
    now: () => NOW,
    ...over,
  };
}

/** A sink that collects every denial, so tests can assert taskId + principle were recorded. */
function collector(): { sink: (d: Denial) => void; denials: Denial[] } {
  const denials: Denial[] = [];
  return { sink: (d) => denials.push(d), denials };
}

describe('S2 — task binding verification (§18.5.1)', () => {
  it('accepts a well-formed task', () => {
    expect(verifyDelegatedTask(mkTask(), mkCtx())).toBeNull();
  });

  it('rejects a FORGED task (bad signature)', () => {
    const t = { ...mkTask(), sig: 'forged' };
    const { sink, denials } = collector();
    expect(verifyDelegatedTask(t, mkCtx(), sink)?.principle).toBe('S2');
    expect(denials.at(-1)?.reason).toMatch(/signature/);
  });

  it('rejects a task forged for ANOTHER pairing', () => {
    expect(verifyDelegatedTask(mkTask({ pairingId: 'p-other' }), mkCtx())?.reason).toMatch(/pairing/);
  });

  it('rejects CROSS-ORG addressing (task org != daemon org)', () => {
    expect(verifyDelegatedTask(mkTask({ org: 'orgB' }), mkCtx())?.reason).toMatch(/cross-org/);
  });

  it('rejects an EXPIRED task', () => {
    expect(verifyDelegatedTask(mkTask({ expiry: new Date(NOW - 1).toISOString() }), mkCtx())?.reason).toMatch(/expired/);
  });

  it('rejects a REPLAYED task (nonce already seen)', () => {
    const ctx = mkCtx();
    const t = mkTask();
    expect(verifyDelegatedTask(t, ctx)).toBeNull();
    expect(verifyDelegatedTask(t, ctx)?.reason).toMatch(/replay/); // same nonce → rejected
  });

  it('rejects a grant_ref from ANOTHER session', () => {
    // The daemon holds g1 for session s2, but the task claims session s1.
    const ctx = mkCtx({ grants: new GrantTable([{ grantRef: 'g1', root: '/granted', session: 's2' }]) });
    expect(verifyDelegatedTask(mkTask({ session: 's1', grantRefs: ['g1'] }), ctx)?.reason).toMatch(/foreign-session|unknown/);
  });

  it('every denial is recorded via the sink with taskId + principle', () => {
    const { sink, denials } = collector();
    verifyDelegatedTask(mkTask({ org: 'orgB' }), mkCtx(), sink);
    expect(denials).toHaveLength(1);
    expect(denials[0]).toMatchObject({ taskId: 't1', principle: 'S2' });
  });
});

describe('S2 boundary — structural parse (bridge addition to the harness sequence)', () => {
  it('rejects a structurally MALFORMED task at the boundary before any binding check', () => {
    const { sink, denials } = collector();
    // Missing required fields (nonce/sig/budget/...): DelegatedTask.safeParse fails.
    const d = verifyDelegatedTask({ taskId: 't-bad', org: 'orgA' }, mkCtx(), sink);
    expect(d?.reason).toMatch(/malformed/);
    expect(d?.principle).toBe('S2');
    // Best-effort taskId is recovered from the raw payload for the ledgered denial.
    expect(denials.at(-1)).toMatchObject({ taskId: 't-bad', principle: 'S2' });
  });

  it('records no taskId when the malformed payload has none', () => {
    const d = verifyDelegatedTask({ not: 'a task' }, mkCtx());
    expect(d?.reason).toMatch(/malformed/);
    expect(d?.taskId).toBeUndefined();
  });
});
