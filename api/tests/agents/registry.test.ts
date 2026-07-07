import { describe, it, expect, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import {
  registerRun,
  getRun,
  cancelRun,
  finalizeOnce,
  reserveFirstBuild,
  bindReservation,
  releaseReservation,
  hasLiveJobForArtifact,
  __resetRegistryForTests,
} from '../../src/agents/registry.js';

/** Run registry guards (ch05 §5.2.2, §5.3.1, §5.3.3, §5.3.4). Acceptance criterion 1. */

const owner: Actor = { userId: 'u1', orgId: 'o1', role: 'builder' };
const other: Actor = { userId: 'u2', orgId: 'o1', role: 'builder' };
const orgAdmin: Actor = { userId: 'a1', orgId: 'o1', role: 'org-admin' };

beforeEach(() => __resetRegistryForTests());

function makeChat(id: string) {
  return registerRun({ id, ownerUserId: 'u1', orgId: 'o1', kind: 'chat', abort: new AbortController(), startedAt: 0 });
}

describe('owner-scoped idempotent cancel (§5.3.1)', () => {
  it('sets cancelled BEFORE firing the abort so the abort path stays quiet', () => {
    const entry = makeChat('r1');
    let cancelledStateAtAbort: boolean | undefined;
    entry.abort.signal.addEventListener('abort', () => { cancelledStateAtAbort = entry.cancelled; });
    expect(cancelRun('r1', owner)).toEqual({ cancelled: true });
    expect(cancelledStateAtAbort).toBe(true); // ordering: cancelled was already set when abort fired
    expect(entry.abort.signal.aborted).toBe(true);
  });

  it('is idempotent — a second cancel or an unknown run returns { cancelled: false }', () => {
    makeChat('r2');
    expect(cancelRun('r2', owner)).toEqual({ cancelled: true });
    expect(cancelRun('r2', owner)).toEqual({ cancelled: false });
    expect(cancelRun('nope', owner)).toEqual({ cancelled: false });
  });

  it('rejects a non-owner but allows super-admin and org-admin (build jobs in-org)', () => {
    makeChat('r3');
    expect(cancelRun('r3', other)).toEqual({ cancelled: false });
    __resetRegistryForTests();
    registerRun({ id: 'b1', ownerUserId: 'u1', orgId: 'o1', kind: 'build', abort: new AbortController(), startedAt: 0, artifactId: 'art1' });
    expect(cancelRun('b1', orgAdmin)).toEqual({ cancelled: true });
  });
});

describe('dual-fire finalized guard (§5.3.4)', () => {
  it('lets exactly one caller finalize', () => {
    makeChat('r4');
    expect(finalizeOnce('r4')).toBe(true);
    expect(finalizeOnce('r4')).toBe(false); // the second complete/error arrival is a no-op
  });
});

describe('first-build reservation (§5.3.3)', () => {
  it('a second reservation while one is live returns the existing job id', () => {
    const first = reserveFirstBuild('sess1', 1000);
    expect(first.ok).toBe(true);
    bindReservation('sess1', 'job-A');
    const second = reserveFirstBuild('sess1', 1000);
    expect(second).toEqual({ ok: false, jobId: 'job-A' });
  });

  it('release is guarded by job id — a late release cannot free a newer reservation', () => {
    reserveFirstBuild('sess2', 0);
    bindReservation('sess2', 'job-old');
    releaseReservation('sess2', 'job-stale'); // wrong id → no-op
    expect(reserveFirstBuild('sess2', 0)).toEqual({ ok: false, jobId: 'job-old' });
    releaseReservation('sess2', 'job-old'); // correct id → frees it
    expect(reserveFirstBuild('sess2', 0).ok).toBe(true);
  });
});

describe('live-job-for-artifact query (§5.3.5)', () => {
  it('reports a live non-finalized build targeting the artifact', () => {
    registerRun({ id: 'b2', ownerUserId: 'u1', kind: 'build', abort: new AbortController(), startedAt: 0, artifactId: 'artX' });
    expect(hasLiveJobForArtifact('artX')).toBe(true);
    finalizeOnce('b2');
    expect(hasLiveJobForArtifact('artX')).toBe(false);
    expect(getRun('b2')?.finalized).toBe(true);
  });
});
