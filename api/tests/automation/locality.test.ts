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
    // The refusal DESCRIBES the machine and names the way out. It does NOT print the pairing id:
    // that is an internal UUID no surface in this product ever shows a user, so echoing it names
    // nothing and reads as a fault code. (An AUTHOR's explicit `pinned` target is different - see
    // the pinned case below - because there the id is a literal they typed themselves.)
    const reason = v.kind === 'blocked' ? v.reason : '';
    expect(reason).not.toMatch(/pair_home|pair_office/);
    expect(reason).toMatch(/where its session was established/);
    expect(reason).toMatch(/establish this session again/);
  });

  it('...and an author-PINNED target does name its machine, because the author wrote that id', () => {
    const v = resolveLocality(input({
      declaredTarget: { kind: 'pinned', pairingId: 'pair_declared' },
      daemonConnected: true,
      daemonPairingId: 'pair_office',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/pair_declared/);
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

  it('a preferred machine that is REGISTERED BUT ASLEEP waits, never borrowing a colleague’s', () => {
    const v = resolveLocality(input({
      preferredPairingId: 'pair_home',
      offlinePolicy: 'queue',
      // The ceremony machine is still the org's - registered, simply not live. A DIFFERENT machine
      // in the same org IS live and advertising residential egress, and it must not be substituted:
      // another household on another ASN is as foreign to the portal as a datacenter, and more
      // confusing when it fails.
      candidates: [machine({ pairingId: 'pair_home', live: false }), machine({ pairingId: 'pair_colleague' })],
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).not.toMatch(/pair_colleague/);
    expect(v.kind === 'blocked' && v.reason).toMatch(/not connected/);
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

/**
 * THE RETIRED CEREMONY MACHINE - the halt that used to have no exit.
 *
 * `preferredPairingId` comes off a stored session and is never revised, so retiring the laptop that
 * established it left the preference pointing at hardware nobody owns: every later fire blocked,
 * forever, and no owner action cleared it. The registry can tell "asleep" from "gone" (its listing
 * carries every non-revoked pairing, live or not), so this refuses differently and names the act
 * that fixes it.
 */
describe('a ceremony machine that was retired', () => {
  const retired = (over: Partial<LocalityInput> = {}) =>
    resolveLocality(input({
      preferredPairingId: 'pair_gone',
      // The fleet listing knows the org and does not contain `pair_gone`: it was revoked.
      candidates: [machine({ pairingId: 'pair_now' })],
      ...over,
    }));

  it('refuses with the act that fixes it, instead of waiting for hardware nobody owns', () => {
    const v = retired();
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/has been removed from your account/);
    expect(v.kind === 'blocked' && v.reason).toMatch(/establish this session again/);
    expect(v.kind === 'blocked' && v.reason).not.toMatch(/pair_gone/);
  });

  it('does NOT quietly fall through to another machine - a homeless session is not a portable one', () => {
    // The available machine is live, granted and advertising residential egress. Retiring the
    // ceremony machine does not make running there any less of a substitution.
    const v = retired({ daemonConnected: true, daemonPairingId: 'pair_now' });
    expect(v.kind).toBe('blocked');
  });

  it('an EMPTY listing is not a retirement - not knowing may never move a session', () => {
    // The seam answered nothing (unbound, or a store that returned no rows). That is ignorance, not
    // a statement that anything was revoked, so the ordinary preference refusal stands.
    const v = resolveLocality(input({
      preferredPairingId: 'pair_gone',
      candidates: [],
      daemonConnected: true,
      daemonPairingId: 'pair_now',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/where its session was established/);
    expect(v.kind === 'blocked' && v.reason).not.toMatch(/removed from your account/);
  });

  it('a PERMISSIVE origin is untouched by it - its credential never asked for a machine', () => {
    const v = retired({ classification: PERMISSIVE });
    expect(v.kind).toBe('in-process');
  });

  it('an author PIN is the author\'s business, retired or not', () => {
    const v = retired({ declaredTarget: { kind: 'pinned', pairingId: 'pair_gone' } });
    expect(v.kind).toBe('blocked');
    // Their literal, echoed back; not the re-establish instruction, which is about a preference
    // this module inferred rather than a target they chose.
    expect(v.kind === 'blocked' && v.reason).toMatch(/pair_gone/);
    expect(v.kind === 'blocked' && v.reason).not.toMatch(/removed from your account/);
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

/**
 * P4.2 - WHO CLEARS THE BLOCK, on every refusal this module can produce.
 *
 * WHY THIS SUITE EXISTS. `blocked` used to carry a reason and nothing else, so every refusal was
 * routed to the same halt - `awaiting_daemon`, which the schedule rail treats as NEUTRAL against
 * the failure ceiling because opening a laptop clears it. That is true of a machine being OFF and
 * false of a machine being GONE, and the retired-ceremony-machine refusal inherited the neutrality
 * anyway: a schedule re-firing nightly, forever, against a condition nothing could resolve, with
 * the ceiling never counting one attempt.
 *
 * `clearedBy` is REQUIRED on the verdict, so a new refusal cannot inherit "retry forever" by saying
 * nothing. This suite is the census that keeps the answers honest: the retirement case is the ONLY
 * `human` one, and every environment refusal stays `machine` - because making them all terminal
 * would auto-pause schedules for owners whose only sin is a shut laptop.
 */
describe('every locality refusal says who can clear it', () => {
  const RETIRED = 'pair_ceremony_gone';

  it('a RETIRED ceremony machine is cleared by a person, never by waiting', () => {
    const v = resolveLocality(input({
      preferredPairingId: RETIRED,
      // A NON-EMPTY listing without the pairing is the registry stating the machine is gone.
      candidates: [machine({ pairingId: 'pair_other' })],
      daemonConnected: true,
      daemonPairingId: 'pair_other',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('human');
    // The act that fixes it, in words - and never the opaque pairing id, which names nothing a
    // person can act on and reads as a fault code.
    expect(v.kind === 'blocked' && v.reason).toMatch(/establish this session again/);
    expect(v.kind === 'blocked' && v.reason).not.toContain(RETIRED);
  });

  it('a ceremony machine that is merely ASLEEP is cleared by the machine', () => {
    // Same preference, but the fleet still lists it: registered and switched off, not retired.
    const v = resolveLocality(input({
      preferredPairingId: RETIRED,
      candidates: [machine({ pairingId: RETIRED, live: false }), machine({ pairingId: 'pair_other' })],
      daemonConnected: true,
      daemonPairingId: 'pair_other',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('machine');
  });

  it('an EMPTY fleet listing is not a statement that anything was retired', () => {
    // "This process does not know what this org has" - an unbound seam, a store that answered
    // nothing. Not-knowing may never turn a preference into a terminal halt.
    const v = resolveLocality(input({
      preferredPairingId: RETIRED,
      candidates: [],
      daemonConnected: true,
      daemonPairingId: 'pair_other',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('machine');
  });

  it('every ENVIRONMENT refusal stays neutral - a shut laptop must not auto-pause a schedule', () => {
    const environmentRefusals = [
      // Adversarial origin, nothing connected.
      input({ candidates: [] }),
      // The env kill switch, with a permissive origin that would otherwise run hosted.
      input({ classification: PERMISSIVE, inProcessFallbackEnabled: false }),
      // An author's explicit pin, to a machine that is not the one connected.
      input({
        declaredTarget: { kind: 'pinned', pairingId: 'pair_pinned' } as StepTarget,
        daemonConnected: true,
        daemonPairingId: 'pair_other',
        candidates: [machine({ pairingId: 'pair_pinned' }), machine({ pairingId: 'pair_other' })],
      }),
      // A residential requirement the fleet cannot meet right now.
      input({ classification: PERMISSIVE, declaredTarget: { kind: 'any', capability: 'egress.residential' }, candidates: [] }),
      // ...and the same, with the run asking to queue rather than fail.
      input({
        classification: PERMISSIVE,
        declaredTarget: { kind: 'any', capability: 'egress.residential' },
        offlinePolicy: 'queue',
        candidates: [],
      }),
    ];
    for (const [i, args] of environmentRefusals.entries()) {
      const v = resolveLocality(args);
      expect(v.kind, `case ${i}`).toBe('blocked');
      expect(v.kind === 'blocked' && v.clearedBy, `case ${i}`).toBe('machine');
    }
  });
});
