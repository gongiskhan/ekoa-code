import { describe, it, expect } from 'vitest';
import {
  resolveLocality,
  egressRequirementFor,
  sameRoute,
  type LocalityInput,
} from '../../src/automation/locality.js';
import { classifyOrigin } from '../../src/automation/origin-posture.js';
import type { EgressCandidate, EgressResolution } from '../../src/automation/egress-policy.js';
import type { StepTarget } from '@ekoa/shared';

/**
 * LOCALITY (P4.1 / P4.2) — where a browser step runs and where its traffic leaves.
 *
 * The decision table is pure, so every case here is the real function with real arguments; nothing
 * is stubbed and nothing is asserted about an internal. The cases that matter most are the ones
 * nobody can check by inspection later:
 *   - an undeclared origin is adversarial, so it NEVER falls into the hosted browser, in ANY
 *     environment (the D-4 divergence: `localBrowserEnabled` used to default to `!isProd`);
 *   - an adversarial session prefers the machine its ceremony happened on, and when that machine is
 *     not the one connected it WAITS rather than borrowing a foreign one;
 *   - a permissive credential carries no preference at all.
 */

const PERMISSIVE = classifyOrigin('https://portal.example.com', {
  posture: 'permissive',
  httpConfig: { baseUrl: 'https://portal.example.com' },
});
/** Nothing declared. The closed answer, and what every pre-posture automation gets. */
const ADVERSARIAL = classifyOrigin('https://portal.example.com');

const CLOUD: StepTarget = { kind: 'cloud' };
const ORG = 'org_a';

function machine(over: Partial<EgressCandidate> = {}): EgressCandidate {
  return {
    pairingId: 'pair_home',
    org: ORG,
    capabilities: ['egress.residential'],
    egressEndpoint: 'http://100.64.0.7:1080',
    live: true,
    ...over,
  };
}

function input(over: Partial<LocalityInput> = {}): LocalityInput {
  return {
    classification: ADVERSARIAL,
    declaredTarget: CLOUD,
    offlinePolicy: 'fail',
    daemonConnected: false,
    candidates: [],
    actorOrg: ORG,
    inProcessFallbackEnabled: true,
    ...over,
  };
}

describe('the in-process fallback is gated by POSTURE, not by the environment (D-4)', () => {
  it('an undeclared (adversarial) origin never runs in the hosted browser, even with the fallback on', () => {
    const v = resolveLocality(input({ inProcessFallbackEnabled: true }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/adversarial/);
  });

  it('a permissive origin DOES run in the hosted browser when no machine is connected', () => {
    const v = resolveLocality(input({ classification: PERMISSIVE }));
    expect(v.kind).toBe('in-process');
    // `any` requirement ⇒ the datacenter route ⇒ no proxy at the launch seam.
    expect(v.kind === 'in-process' && v.egress.outcome).toBe('datacenter');
  });

  it('the env kill switch still closes the fallback for a permissive origin', () => {
    const v = resolveLocality(input({ classification: PERMISSIVE, inProcessFallbackEnabled: false }));
    expect(v.kind).toBe('blocked');
  });

  it('a connected machine carries a browser step whatever the posture (the bridge is the default)', () => {
    for (const classification of [ADVERSARIAL, PERMISSIVE]) {
      const v = resolveLocality(input({ classification, daemonConnected: true, daemonPairingId: 'pair_home' }));
      expect(v.kind).toBe('bridge');
    }
  });
});

describe('preferential bridge — adversarial sessions only (P4.2)', () => {
  it('prefers the pairing where the ceremony happened, and refuses a different connected machine', () => {
    const v = resolveLocality(input({
      preferredPairingId: 'pair_home',
      daemonConnected: true,
      daemonPairingId: 'pair_office',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/pair_home/);
  });

  it('runs on the bridge when the connected machine IS the ceremony machine', () => {
    const v = resolveLocality(input({
      preferredPairingId: 'pair_home',
      daemonConnected: true,
      daemonPairingId: 'pair_home',
    }));
    expect(v.kind).toBe('bridge');
  });

  it('a daemon that cannot prove which machine it is does not satisfy a preference', () => {
    // `DaemonConnection.pairingId` is optional (the seam predates it). Unprovable reads as no.
    const v = resolveLocality(input({ preferredPairingId: 'pair_home', daemonConnected: true }));
    expect(v.kind).toBe('blocked');
  });

  it('a preferred machine that is offline WAITS and names it, never borrowing a colleague’s', () => {
    const v = resolveLocality(input({
      preferredPairingId: 'pair_home',
      offlinePolicy: 'queue',
      // A DIFFERENT machine in the same org IS live and advertising residential egress. It must
      // not be substituted: another household on another ASN is as foreign to the portal as a
      // datacenter, and more confusing when it fails.
      candidates: [machine({ pairingId: 'pair_colleague' })],
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/pair_home/);
    expect(v.kind === 'blocked' && v.reason).not.toMatch(/pair_colleague/);
  });

  it('a PERMISSIVE credential carries no preference at all (kind: any)', () => {
    const req = egressRequirementFor({
      declaredTarget: CLOUD,
      classification: PERMISSIVE,
      preferredPairingId: 'pair_home',
    });
    expect(req).toEqual({ kind: 'any' });
  });

  it('an ADVERSARIAL origin turns the preference into a pinned residential requirement', () => {
    const req = egressRequirementFor({
      declaredTarget: CLOUD,
      classification: ADVERSARIAL,
      preferredPairingId: 'pair_home',
    });
    expect(req).toEqual({ kind: 'residential', pairingId: 'pair_home' });
  });

  it('an explicitly PINNED target outranks the ceremony preference (the author was specific)', () => {
    const req = egressRequirementFor({
      declaredTarget: { kind: 'pinned', pairingId: 'pair_declared' },
      classification: PERMISSIVE,
      preferredPairingId: 'pair_home',
    });
    expect(req).toEqual({ kind: 'residential', pairingId: 'pair_declared' });
  });
});

describe('the route out reaches the launch seam', () => {
  it('a permissive step declaring residential egress resolves to a machine proxy', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      candidates: [machine()],
    }));
    expect(v.kind).toBe('in-process');
    expect(v.kind === 'in-process' && v.egress).toEqual({
      outcome: 'machine',
      pairingId: 'pair_home',
      proxyUrl: 'http://100.64.0.7:1080',
    });
  });

  it('a declared residential requirement with no machine REFUSES rather than using the datacenter', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      candidates: [],
    }));
    expect(v.kind).toBe('blocked');
  });

  it('offlinePolicy queue on a permissive residential step halts as "waiting", not as a datacenter run', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      offlinePolicy: 'queue',
      candidates: [],
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/waiting for a machine/);
  });

  it('offlinePolicy datacenter is honoured for a PERMISSIVE origin (a declared choice, not a fallback)', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      offlinePolicy: 'datacenter',
      candidates: [],
    }));
    expect(v.kind).toBe('in-process');
    expect(v.kind === 'in-process' && v.egress.outcome).toBe('datacenter-fallback');
  });

  it('offlinePolicy datacenter can NOT buy an adversarial origin a datacenter route', () => {
    // The posture clamp is structural: an adversarial classification cannot reach the hosted
    // browser at all, so the run halts before the offline policy could be honoured.
    const v = resolveLocality(input({ offlinePolicy: 'datacenter', candidates: [] }));
    expect(v.kind).toBe('blocked');
  });
});

describe('sameRoute — a context launched for one route is not reused for another', () => {
  const dc: EgressResolution = { outcome: 'datacenter', reason: 'no-requirement' };
  const m1: EgressResolution = { outcome: 'machine', pairingId: 'p1', proxyUrl: 'http://a:1' };
  const m2: EgressResolution = { outcome: 'machine', pairingId: 'p2', proxyUrl: 'http://b:1' };
  it('two datacenter routes interchange', () => expect(sameRoute(dc, dc)).toBe(true));
  it('a machine route is not a datacenter route', () => expect(sameRoute(dc, m1)).toBe(false));
  it('two different machines are different routes', () => expect(sameRoute(m1, m2)).toBe(false));
  it('the same machine is the same route', () => expect(sameRoute(m1, { ...m1 })).toBe(true));
});
