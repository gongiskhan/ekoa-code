import { describe, it, expect } from 'vitest';
import {
  resolveEgress,
  proxyOptionFor,
  DEFAULT_EGRESS,
  type EgressCandidate,
} from '../../src/automation/egress-policy.js';

/**
 * SECURITY SUITE — per-run egress policy (Cofre E-3 / WS-I).
 *
 * The gate first read the global `localBrowserEnabled` flag as a "silent datacenter fallback"; its
 * verifier corrected that (production halts honestly in `awaiting_daemon`). The real defect is
 * narrower and still real: the choice is GLOBAL and UNDECLARABLE, so a run that must leave from a
 * residential IP and a run that does not care are governed by one environment variable.
 *
 * The property these cases protect: a run NEVER silently leaves by a route it did not ask for, and
 * a machine in another org is never a candidate.
 */
const machine = (over: Partial<EgressCandidate> = {}): EgressCandidate => ({
  pairingId: 'p1',
  org: 'orgA',
  capabilities: ['egress.residential'],
  egressEndpoint: 'http://100.64.0.1:8080',
  live: true,
  ...over,
});

describe('the default is fail — the safe option is the one you get by not choosing', () => {
  it('DEFAULT_EGRESS refuses rather than falling back', () => {
    expect(DEFAULT_EGRESS.offlinePolicy).toBe('fail');
  });

  it('a residential requirement with no machine REFUSES under the default policy', () => {
    const r = resolveEgress({ requirement: { kind: 'residential' }, offlinePolicy: 'fail' }, [], 'orgA');
    expect(r.outcome).toBe('refused');
  });
});

describe('residential selection', () => {
  it('routes through a live machine advertising residential egress', () => {
    const r = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [machine()],
      'orgA',
    );
    expect(r).toMatchObject({ outcome: 'machine', pairingId: 'p1', proxyUrl: 'http://100.64.0.1:8080' });
    expect(proxyOptionFor(r)).toEqual({ server: 'http://100.64.0.1:8080' });
  });

  it('NEVER routes through another org — a foreign machine is not a candidate', () => {
    const r = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [machine({ org: 'orgB' })],
      'orgA',
    );
    expect(r.outcome).toBe('refused');
  });

  it('ignores an offline machine', () => {
    const r = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [machine({ live: false })],
      'orgA',
    );
    expect(r.outcome).toBe('refused');
  });

  it('ignores a machine that does not advertise the capability', () => {
    const r = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [machine({ capabilities: ['local.bash'] })],
      'orgA',
    );
    expect(r.outcome).toBe('refused');
  });

  it('ignores a machine with no advertised endpoint (it cannot be a proxy target)', () => {
    const withoutEndpoint = machine();
    delete (withoutEndpoint as { egressEndpoint?: string }).egressEndpoint;
    const r = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [withoutEndpoint],
      'orgA',
    );
    expect(r.outcome).toBe('refused');
  });

  it('honours a PINNED machine and refuses when that specific one is unavailable', () => {
    const ok = resolveEgress(
      { requirement: { kind: 'residential', pairingId: 'p2' }, offlinePolicy: 'fail' },
      [machine(), machine({ pairingId: 'p2', egressEndpoint: 'http://100.64.0.2:8080' })],
      'orgA',
    );
    expect(ok).toMatchObject({ outcome: 'machine', pairingId: 'p2' });

    const missing = resolveEgress(
      { requirement: { kind: 'residential', pairingId: 'p9' }, offlinePolicy: 'fail' },
      [machine()],
      'orgA',
    );
    expect(missing.outcome).toBe('refused');
    if (missing.outcome === 'refused') expect(missing.reason).toContain('p9');
  });
});

describe('the offline policy decides the RESPONSE, not the resolution', () => {
  const unmeetable = { requirement: { kind: 'residential' } as const };

  it('queue waits', () => {
    expect(resolveEgress({ ...unmeetable, offlinePolicy: 'queue' }, [], 'orgA').outcome).toBe('queue');
  });

  it('datacenter falls back ONLY because the run said so', () => {
    const r = resolveEgress({ ...unmeetable, offlinePolicy: 'datacenter' }, [], 'orgA');
    expect(r.outcome).toBe('datacenter-fallback');
    // Distinct from a plain 'datacenter' outcome, so a reader of a run record can tell an explicit
    // choice from a degraded one.
    expect(r.outcome).not.toBe('datacenter');
  });

  it('fail refuses', () => {
    expect(resolveEgress({ ...unmeetable, offlinePolicy: 'fail' }, [], 'orgA').outcome).toBe('refused');
  });
});

describe('explicit non-residential requirements', () => {
  it('datacenter is an explicit choice, distinguishable from a fallback', () => {
    const r = resolveEgress({ requirement: { kind: 'datacenter' }, offlinePolicy: 'fail' }, [], 'orgA');
    expect(r).toEqual({ outcome: 'datacenter', reason: 'declared' });
    expect(proxyOptionFor(r)).toBeUndefined();
  });

  it('any takes the datacenter without a machine and without complaint', () => {
    const r = resolveEgress({ requirement: { kind: 'any' }, offlinePolicy: 'fail' }, [machine()], 'orgA');
    expect(r).toEqual({ outcome: 'datacenter', reason: 'no-requirement' });
  });
});
