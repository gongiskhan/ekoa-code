import { describe, it, expect } from 'vitest';
import {
  resolveLocality,
  egressRequirementFor,
  hostedTypistPermitFor,
  sameRoute,
  type LocalityInput,
} from '../../src/automation/locality.js';
import { classifyOrigin } from '../../src/automation/origin-posture.js';
import type { EgressCandidate, EgressResolution } from '../../src/automation/egress-policy.js';
import type { OfflinePolicy, StepTarget } from '@ekoa/shared';

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

/**
 * P4.1 - A BRIDGE VERDICT DESCRIBES THE MACHINE THE BRIDGE WILL ACTUALLY RUN ON.
 *
 * THE DEFECT. `resolveEgress` answers "which machine should the HOSTED browser proxy through", and
 * given a residential requirement with no pairing it takes `usable[0]` - the first live candidate.
 * The bridge verdict carried that answer verbatim, so with `pair_office` listed first and
 * `pair_home` dialled in, the verdict named `pair_office` while every byte of work left from
 * `pair_home`. The one consumer of that field routes the hosted typist's LOGIN through it
 * (`hostedTypistPermitFor`), so the password left one household's line and the session it produced
 * was then used from another's - the same "two different doors" hazard the permit exists to close,
 * performed by the one act in a run that hands over a secret.
 *
 * The fleets below are deliberately ordered so that `usable[0]` is NOT the connected machine: a
 * one-machine fleet passes identically either way, which is exactly how this went unnoticed.
 */
describe('the route a bridge verdict carries is the CONNECTED machine, not the first in the fleet', () => {
  const HOME = machine({ pairingId: 'pair_home', egressEndpoint: 'http://100.64.0.7:1080' });
  const OFFICE = machine({ pairingId: 'pair_office', egressEndpoint: 'http://100.64.0.8:1080' });
  /** `pair_office` FIRST: `resolveEgress`'s independent pick and the connected machine differ. */
  const FLEET = [OFFICE, HOME];

  it('an adversarial origin on the bridge leaves by the connected machine’s line', () => {
    const v = resolveLocality(input({ daemonConnected: true, daemonPairingId: 'pair_home', candidates: FLEET }));
    expect(v.kind).toBe('bridge');
    expect(v.kind === 'bridge' && v.egress).toEqual({
      outcome: 'machine',
      pairingId: 'pair_home',
      proxyUrl: 'http://100.64.0.7:1080',
    });
  });

  it('a permissive step DECLARING residential egress does too', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      daemonConnected: true,
      daemonPairingId: 'pair_home',
      candidates: FLEET,
    }));
    expect(v.kind).toBe('bridge');
    expect(v.kind === 'bridge' && v.egress).toEqual({
      outcome: 'machine',
      pairingId: 'pair_home',
      proxyUrl: 'http://100.64.0.7:1080',
    });
  });

  it('a permissive origin that asked for nothing keeps the "no requirement" datacenter answer', () => {
    // Nothing was required of the route out, so there is no door to match and none is invented.
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      daemonConnected: true,
      daemonPairingId: 'pair_home',
      candidates: FLEET,
    }));
    expect(v.kind).toBe('bridge');
    expect(v.kind === 'bridge' && v.egress).toEqual({ outcome: 'datacenter', reason: 'no-requirement' });
  });

  it('a connected machine with no residential egress of its own names no route at all', () => {
    // The work still runs there - the verdict is `bridge` - but there is no line that can be
    // NAMED, and the datacenter is not a substitute for one (`hostedTypistPermitFor` below).
    const v = resolveLocality(input({
      declaredTarget: { kind: 'pinned', pairingId: 'pair_home' },
      daemonConnected: true,
      daemonPairingId: 'pair_home',
      candidates: [machine({ pairingId: 'pair_home', capabilities: [] }), OFFICE],
    }));
    expect(v.kind).toBe('bridge');
    expect(v.kind === 'bridge' && v.egress.outcome).toBe('refused');
    // ...and emphatically NOT the office's proxy, which is what `usable[0]` would have handed back.
    expect(JSON.stringify(v)).not.toContain('100.64.0.8');
  });

  it('a daemon that cannot say which machine it is names no route either', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      daemonConnected: true,
      candidates: FLEET,
    }));
    expect(v.kind).toBe('bridge');
    expect(v.kind === 'bridge' && v.egress.outcome).toBe('refused');
    expect(v.kind === 'bridge' && v.egress.outcome === 'refused' && v.egress.reason).toMatch(/does not identify itself/);
  });

  it('the offline policy cannot buy the bridge a datacenter door', () => {
    // `offlinePolicy: 'datacenter'` is the RUN saying "the datacenter is acceptable when the machine
    // I wanted is missing". Applied here it would hand the typist a datacenter route while the work
    // runs on a machine - the exact divergence - so this question does not consult it at all.
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      offlinePolicy: 'datacenter',
      daemonConnected: true,
      daemonPairingId: 'pair_home',
      candidates: [machine({ pairingId: 'pair_home', capabilities: [] })],
    }));
    expect(v.kind).toBe('bridge');
    expect(v.kind === 'bridge' && v.egress.outcome).toBe('refused');
  });
});

/**
 * P4.1 - THE HOSTED TYPIST'S PERMIT: may this step's password be typed, and through which door?
 *
 * ONE RULE - the login leaves by the same door as the work - and the interesting half is what
 * happens when no such door exists. Withholding the permit halts the run asking for a person, which
 * is a state the product already has and a person can act on; typing the password through a
 * different door is not, and is what the previous shape did (`proxyOptionFor` answers undefined for
 * a `refused` resolution, so the login silently left from the datacenter).
 */
describe('the hosted typist gets the work’s own door, or no door at all', () => {
  const MACHINE_ROUTE: EgressResolution = { outcome: 'machine', pairingId: 'pair_home', proxyUrl: 'http://100.64.0.7:1080' };
  const DATACENTER: EgressResolution = { outcome: 'datacenter', reason: 'no-requirement' };

  it('an in-process step types through the very route its work will take', () => {
    expect(hostedTypistPermitFor({ kind: 'in-process', egress: MACHINE_ROUTE })).toEqual({ egress: MACHINE_ROUTE });
    expect(hostedTypistPermitFor({ kind: 'in-process', egress: DATACENTER })).toEqual({ egress: DATACENTER });
  });

  it('a bridge step on a named machine types through THAT machine', () => {
    expect(hostedTypistPermitFor({ kind: 'bridge', egress: MACHINE_ROUTE })).toEqual({ egress: MACHINE_ROUTE });
  });

  it('a bridge step that required nothing of its route gets the ordinary hosted browser', () => {
    // The origin is permissive - posture is what let the typist be considered at all - which is
    // precisely the declaration that a datacenter IP is acceptable against this site.
    expect(hostedTypistPermitFor({ kind: 'bridge', egress: DATACENTER })).toEqual({});
  });

  it('a bridge step whose machine has no line to lend gets NO PERMIT - not the datacenter', () => {
    // This is the whole point. `proxyOptionFor({outcome:'refused'})` is undefined, so carrying the
    // resolution through would have opened a plain datacenter context and typed the password into
    // it, while the work ran on the owner's machine.
    expect(hostedTypistPermitFor({ kind: 'bridge', egress: { outcome: 'refused', reason: 'no line' } })).toBeUndefined();
    expect(hostedTypistPermitFor({ kind: 'bridge', egress: { outcome: 'queue', reason: 'no line' } })).toBeUndefined();
    expect(hostedTypistPermitFor({ kind: 'bridge', egress: { outcome: 'datacenter-fallback', reason: 'no line' } })).toBeUndefined();
  });

  it('a step with no locality of its own is unchanged - there is no door to diverge from', () => {
    // An `integration` or `api_call` step. Nothing resolved a route for the work, so the typist
    // behaves exactly as it did before locality existed.
    expect(hostedTypistPermitFor(null)).toEqual({});
  });

  it('a refused step gets no password typed for it', () => {
    expect(hostedTypistPermitFor({ kind: 'blocked', clearedBy: 'machine', reason: 'x' })).toBeUndefined();
  });

  /**
   * THE TWO HALVES, COMPOSED. Whatever `resolveLocality` answers for a step, the permit either
   * names the same machine the work will run on or names nothing - never a third machine, and never
   * the datacenter while the work is on a line.
   */
  it('never hands the typist a machine other than the one the work runs on', () => {
    const fleet = [
      machine({ pairingId: 'pair_office', egressEndpoint: 'http://100.64.0.8:1080' }),
      machine({ pairingId: 'pair_home', egressEndpoint: 'http://100.64.0.7:1080' }),
    ];
    const targets: StepTarget[] = [
      { kind: 'cloud' },
      { kind: 'any', capability: 'egress.residential' },
      { kind: 'pinned', pairingId: 'pair_home' },
    ];
    let sawMachineRoute = false;
    for (const classification of [ADVERSARIAL, PERMISSIVE]) {
      for (const declaredTarget of targets) {
        for (const preferredPairingId of [undefined, 'pair_home']) {
          const v = resolveLocality(input({
            classification,
            declaredTarget,
            daemonConnected: true,
            daemonPairingId: 'pair_home',
            candidates: fleet,
            ...(preferredPairingId ? { preferredPairingId } : {}),
          }));
          const permit = hostedTypistPermitFor(v);
          const route = permit?.egress;
          if (route?.outcome === 'machine') {
            sawMachineRoute = true;
            // `pair_home` is dialled in; `pair_office` is what `usable[0]` would have picked.
            expect(route.pairingId).toBe('pair_home');
          }
        }
      }
    }
    expect(sawMachineRoute).toBe(true);
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

  /**
   * THE CENSUS ITSELF - and it is one, which the thing it replaces was not.
   *
   * WHAT WAS WRONG WITH THE OLD SHAPE. It was five hand-written inputs under a docblock claiming to
   * cover "every refusal this module can produce". Nothing connected the claim to the code: a new
   * `clearedBy: 'human'` branch - the exact mistake that made this suite necessary in the first
   * place - could be added, reached in production, and leave these assertions green, because the
   * list simply would not mention it. A list of examples cannot be a census of a function.
   *
   * WHAT THIS DOES INSTEAD. It walks the CROSS PRODUCT of the whole input space (postures, declared
   * targets, offline policies, ceremony preferences, daemon states, fleet listings, the kill switch
   * - several thousand combinations), collects every distinct refusal the module actually emits,
   * and asserts against the collected set:
   *
   *   1. the `human` refusals are EXACTLY the retired ceremony machine, so a new terminal branch is
   *      red the moment any input reaches it;
   *   2. the FULL set of refusals is exactly the one enumerated here, so a new refusal of either
   *      kind is red as well - it cannot slip in as "one more machine one";
   *   3. no refusal answers BOTH ways, which would mean the same condition sometimes auto-pauses a
   *      schedule and sometimes does not.
   *
   * Pairing ids are normalised out of the strings (they are inputs, not branches); everything else
   * is compared literally, so re-wording a refusal is a deliberate edit here rather than a silent
   * drift away from what the product tells people.
   */
  describe('a census over the whole input space, not a list of remembered cases', () => {
    /** The one refusal a person must act on. Everything else is the environment. */
    const RETIREMENT =
      'the machine where this session was established has been removed from your account - ' +
      'establish this session again, from a machine you still have';

    /** Every refusal `resolveLocality` can emit, with who clears it. Pairing ids normalised. */
    const EXPECTED: ReadonlyArray<readonly [string, 'machine' | 'human']> = [
      [RETIREMENT, 'human'],
      ['this step is pinned to machine <pairing>; the machine currently connected is a different one', 'machine'],
      [
        'this step must run on the machine where its session was established, and a different machine ' +
          'of yours is connected - start that machine, or establish this session again from the one you want to use',
        'machine',
      ],
      [
        'this origin is adversarial: the step is pinned to machine <pairing>, and that machine is not connected',
        'machine',
      ],
      [
        'this origin is adversarial: the step runs only on the machine where its session was established, ' +
          'and that machine is not connected',
        'machine',
      ],
      [
        'this origin is adversarial, so its browser steps run only on one of your machines, and none is connected',
        'machine',
      ],
      ['no machine is connected and the in-process browser fallback is disabled', 'machine'],
      ['waiting for a machine: no machine in this org is advertising residential egress', 'machine'],
      ['waiting for a machine: the pinned machine <pairing> is not available with residential egress', 'machine'],
      ['no machine in this org is advertising residential egress', 'machine'],
      ['the pinned machine <pairing> is not available with residential egress', 'machine'],
    ];

    /** A pairing id is an INPUT, not a branch; the branch is the sentence around it. */
    const normalise = (reason: string): string => reason.replace(/pair_[a-z_]+/g, '<pairing>');

    /** Every refusal the module emitted across the space, and the answers it gave for each. */
    function censusOfRefusals(): Map<string, Set<string>> {
      const classifications = [ADVERSARIAL, PERMISSIVE];
      const declaredTargets: StepTarget[] = [
        { kind: 'cloud' },
        { kind: 'any', capability: 'egress.residential' },
        { kind: 'any', capability: 'local.bash' },
        { kind: 'pinned', pairingId: 'pair_pinned' },
        { kind: 'pinned', pairingId: 'pair_gone' },
      ];
      const offlinePolicies: OfflinePolicy[] = ['fail', 'queue', 'datacenter'];
      const preferences = [undefined, 'pair_home', 'pair_gone'];
      const daemons: Array<Partial<LocalityInput>> = [
        { daemonConnected: false },
        // A connection that cannot prove which machine it is (`pairingId` is optional on the seam).
        { daemonConnected: true },
        { daemonConnected: true, daemonPairingId: 'pair_home' },
        { daemonConnected: true, daemonPairingId: 'pair_other' },
      ];
      const fleets: EgressCandidate[][] = [
        // "This process does not know what this org has" - ignorance, never a retirement.
        [],
        [machine({ pairingId: 'pair_home' })],
        [machine({ pairingId: 'pair_home' }), machine({ pairingId: 'pair_other' })],
        // Registered and asleep, beside a live one: the "merely switched off" shape.
        [machine({ pairingId: 'pair_home', live: false }), machine({ pairingId: 'pair_other' })],
        // Live, listed, and NOT granted residential egress (advertised INTERSECT granted is empty).
        [machine({ pairingId: 'pair_home', capabilities: [] }), machine({ pairingId: 'pair_other', capabilities: [] })],
        // Another tenant's machine - a candidate `resolveEgress` must filter out entirely (Rule 5).
        [machine({ pairingId: 'pair_home', org: 'org_b' })],
        // Listed but never advertised an endpoint.
        [machine({ pairingId: 'pair_home', egressEndpoint: '' })],
        // A LARGER fleet. Not redundant: a refusal branch that only triggers with several machines
        // to choose between is outside the space of the two-machine listings above, and a census
        // only catches what it can reach - verified by adding exactly such a branch and watching
        // the smaller space miss it.
        [
          machine({ pairingId: 'pair_home' }),
          machine({ pairingId: 'pair_other' }),
          machine({ pairingId: 'pair_pinned' }),
          machine({ pairingId: 'pair_asleep', live: false }),
        ],
      ];

      const seen = new Map<string, Set<string>>();
      for (const classification of classifications) {
        for (const declaredTarget of declaredTargets) {
          for (const offlinePolicy of offlinePolicies) {
            for (const preferredPairingId of preferences) {
              for (const daemon of daemons) {
                for (const candidates of fleets) {
                  for (const inProcessFallbackEnabled of [true, false]) {
                    const v = resolveLocality(input({
                      classification,
                      declaredTarget,
                      offlinePolicy,
                      candidates,
                      inProcessFallbackEnabled,
                      ...daemon,
                      ...(preferredPairingId ? { preferredPairingId } : {}),
                    }));
                    if (v.kind !== 'blocked') continue;
                    const key = normalise(v.reason);
                    (seen.get(key) ?? seen.set(key, new Set()).get(key)!).add(v.clearedBy);
                  }
                }
              }
            }
          }
        }
      }
      return seen;
    }

    it('emits exactly the refusals enumerated here, and no others', () => {
      const seen = censusOfRefusals();
      // A NEW refusal branch reachable from this space adds a key and fails here; a refusal that
      // stops being reachable at all drops one and fails here too, which is the point - a branch no
      // input can reach is a branch no test can pin.
      expect([...seen.keys()].sort()).toEqual(EXPECTED.map(([reason]) => reason).sort());
    });

    it('answers each refusal ONE way - a condition cannot sometimes auto-pause a schedule', () => {
      const seen = censusOfRefusals();
      const ambiguous = [...seen.entries()].filter(([, answers]) => answers.size !== 1);
      expect(ambiguous).toEqual([]);
    });

    it('the ONLY refusal a person must clear is the retired ceremony machine', () => {
      const seen = censusOfRefusals();
      const human = [...seen.entries()].filter(([, answers]) => answers.has('human')).map(([reason]) => reason);
      // Everything else is "a machine of yours is off", which a schedule must be free to wait out:
      // making them terminal would auto-pause schedules for owners whose only sin is a shut laptop.
      expect(human).toEqual([RETIREMENT]);
    });

    it('every refusal answers the way this file says it does', () => {
      const seen = censusOfRefusals();
      for (const [reason, clearedBy] of EXPECTED) {
        expect([...(seen.get(reason) ?? [])], reason).toEqual([clearedBy]);
      }
    });
  });
});
