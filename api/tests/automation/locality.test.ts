import { describe, it, expect } from 'vitest';
import {
  resolveLocality,
  narrowLocalityForRun,
  egressRequirementFor,
  hostedTypistPermitFor,
  refusalIsNeutral,
  CLEARING_ACTS,
  type ClearingAct,
  type LocalityInput,
  type LocalityVerdict,
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

/**
 * `candidates: null` IS THE DEFAULT, and it is not the same as `[]`.
 *
 * `null` means this process has no fleet listing (an unbound seam) - ignorance, which changes
 * nothing about how a refusal is cleared. `[]` means the registry answered and the org HAS NO
 * MACHINES, which is a dead end no laptop can clear and refuses terminally. Cases that are not about
 * the fleet take the ignorant default, so that a refusal they assert on is the one they meant.
 */
function input(over: Partial<LocalityInput> = {}): LocalityInput {
  return {
    classification: ADVERSARIAL,
    declaredTarget: CLOUD,
    offlinePolicy: 'fail',
    daemonConnected: false,
    candidates: null,
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
 * A CEREMONY PREFERENCE POINTING AT A MACHINE THE FLEET NO LONGER LISTS.
 *
 * THE REFUSAL FOR THAT IS NOT MADE HERE, and this module used to carry a copy of it that nothing in
 * production could reach. A preference is only ever LEARNED from a session checkout that SUCCEEDED,
 * and a ceremony session is bound to its machine's residential line (`bridge/attended.ts` is the one
 * writer of `establishedBy: machine`, and it stamps `boundEgress: residential` from the same id), so
 * a checkout that succeeded is itself proof the machine is still listed. The dead end is caught one
 * step earlier, at the checkout that REFUSES - `engine.ts` `credentialGateRecord`, against
 * `machineRetired` - and `tests/automation/engine-locality.test.ts` drives it there.
 *
 * What remains here is what this module really does with a preference, and it is worth pinning: it
 * never substitutes another household's machine for the one a session was made on.
 */
describe('a ceremony preference the connected fleet cannot satisfy', () => {
  const preferring = (over: Partial<LocalityInput> = {}) =>
    resolveLocality(input({
      preferredPairingId: 'pair_gone',
      candidates: [machine({ pairingId: 'pair_now' })],
      ...over,
    }));

  it('does NOT quietly fall through to another machine - a homeless session is not a portable one', () => {
    // The available machine is live, granted and advertising residential egress. That the preferred
    // one is missing from the listing does not make running here any less of a substitution.
    const v = preferring({ daemonConnected: true, daemonPairingId: 'pair_now' });
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/where its session was established/);
  });

  it('a CONNECTED daemon keeps the refusal neutral even against an empty listing', () => {
    // A live connection is itself proof this account has hardware, whatever the listing says, so the
    // "you have no machines" terminal refusal must not fire here.
    const v = resolveLocality(input({
      preferredPairingId: 'pair_gone',
      candidates: [],
      daemonConnected: true,
      daemonPairingId: 'pair_now',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('start-a-machine');
    expect(v.kind === 'blocked' && v.reason).toMatch(/where its session was established/);
  });

  it('a PERMISSIVE origin is untouched by it - its credential never asked for a machine', () => {
    const v = preferring({ classification: PERMISSIVE });
    expect(v.kind).toBe('in-process');
  });

  it('an author PIN names its own machine, because the author wrote that id', () => {
    const v = preferring({ declaredTarget: { kind: 'pinned', pairingId: 'pair_gone' } });
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.reason).toMatch(/pair_gone/);
  });
});

/**
 * AN ACCOUNT WITH NO MACHINE IN IT - the regression this branch had to be stopped from shipping.
 *
 * A solo tenant pairs one laptop, holds an attended ceremony on it, then revokes the pairing without
 * replacing it. `egressCandidatesForOrg` filters out revoked rows, so the org's listing is genuinely
 * `[]`. Every refusal in this module that names a machine is an instruction to go and start one, and
 * the halt carrying it is NEUTRAL against the failure ceiling because opening a laptop clears it -
 * so with no laptop to open, the schedule re-fired nightly forever, uncounted, telling the owner to
 * connect hardware that no longer existed. A bounded dead end turned into an unbounded one.
 *
 * The fix is that `[]` and `null` stopped being the same value: `[]` is the registry saying THIS ORG
 * HAS NO MACHINES, which refuses terminally, and `null` is this process not knowing, which does not.
 */
describe('an account whose fleet listing is empty', () => {
  const emptyFleet = (over: Partial<LocalityInput> = {}) => resolveLocality(input({ candidates: [], ...over }));

  it('refuses TERMINALLY instead of telling the owner to start a machine they do not have', () => {
    const v = emptyFleet();
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('pair-a-machine');
    expect(v.kind === 'blocked' && v.reason).toMatch(/no machine is paired to your account/);
  });

  it('...where NOT KNOWING the fleet keeps the neutral wait - ignorance may never escalate', () => {
    const v = resolveLocality(input({ candidates: null }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('start-a-machine');
    expect(v.kind === 'blocked' && v.reason).toMatch(/none is connected/);
  });

  it('holds for a step that only needs a machine because of its DECLARATION, not its posture', () => {
    // Permissive origin, hosted browser allowed - but the author asked to leave by a residential
    // line, and there is no machine to provide one. Waiting cannot produce hardware either.
    const v = emptyFleet({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
    });
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('pair-a-machine');
  });

  it('...and for `queue`, which has nothing to queue behind', () => {
    const v = emptyFleet({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      offlinePolicy: 'queue',
    });
    expect(v.kind === 'blocked' && v.clearedBy).toBe('pair-a-machine');
  });

  it('...and when the hosted browser is switched off, which a machine would have made moot', () => {
    const v = emptyFleet({ classification: PERMISSIVE, inProcessFallbackEnabled: false });
    expect(v.kind === 'blocked' && v.clearedBy).toBe('pair-a-machine');
  });

  it('does NOT block a step that never needed a machine at all', () => {
    // The whole hazard of a fleet-shaped rule is that it stops work the fleet has nothing to do
    // with. A permissive origin on the hosted browser runs, empty account or not.
    const v = emptyFleet({ classification: PERMISSIVE });
    expect(v.kind).toBe('in-process');
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

  /**
   * THE FLEET HERE IS NON-EMPTY AND MERELY ASLEEP, on purpose. These cases are about the ROUTE
   * refusal, and an EMPTY listing is a different fact with a different answer (an account with no
   * machine refuses terminally - see that suite). Using `[]` as shorthand for "no usable machine"
   * would silently move these two off the branches they are named for.
   */
  const asleep = [machine({ live: false })];

  it('a declared residential requirement with no LIVE machine REFUSES rather than using the datacenter', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      candidates: asleep,
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('start-a-machine');
  });

  it('offlinePolicy queue on a permissive residential step halts as "waiting", not as a datacenter run', () => {
    const v = resolveLocality(input({
      classification: PERMISSIVE,
      declaredTarget: { kind: 'any', capability: 'egress.residential' },
      offlinePolicy: 'queue',
      candidates: asleep,
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

  /**
   * REAL REFUSALS, not literals - and they have to be, which is itself the point.
   *
   * A `blocked` verdict carries a module-private brand (`REFUSAL_SITE`), so this file CANNOT write
   * one: the two literals that used to stand here stopped compiling the day the brand landed. Every
   * refusal in the product is therefore built inside `locality.ts`, which is what makes the census
   * below a census of the product rather than of one exported function.
   */
  it('a refused step gets no password typed for it', () => {
    const neutral = resolveLocality(input({ candidates: null }));            // start-a-machine
    const terminal = resolveLocality(input({ candidates: [] }));             // pair-a-machine
    const authored = narrowLocalityForRun(                                   // edit-the-automation
      resolveLocality(input({ classification: PERMISSIVE })),
      { liveUrl: 'https://bank.example.pt/x', declaredOrigin: 'portal.example.com', openedRoute: null },
    );
    for (const v of [neutral, terminal, authored]) {
      expect(v.kind).toBe('blocked');
      expect(hostedTypistPermitFor(v)).toBeUndefined();
    }
    // ...and they really are the three distinct acts, so this is not three copies of one case.
    const acts = [neutral, terminal, authored].map((v) => (v.kind === 'blocked' ? v.clearedBy : null));
    expect(acts).toEqual(['start-a-machine', 'pair-a-machine', 'edit-the-automation']);
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

/**
 * THE ROUTE SWITCH - a context launched for one route is not reused for another.
 *
 * DRIVEN THROUGH THE DECISION, NOT ITS PREDICATE. This block used to call an exported `sameRoute`
 * on four hand-built `EgressResolution` literals, which proved a comparison and left the refusal
 * that uses it untested from this file - and while the refusal itself lived in `engine.ts` there
 * was no way to reach it here at all. `sameRoute` is private again; every case below resolves a
 * REAL verdict and asks `narrowLocalityForRun` what happens when this run's context is already open
 * on a given route.
 */
describe('a context launched for one route is not reused for another', () => {
  const DC: EgressResolution = { outcome: 'datacenter', reason: 'no-requirement' };
  /** A PERMISSIVE origin with no route requirement: the hosted browser, no proxy. */
  const hostedOnDatacenter = (): LocalityVerdict => resolveLocality(input({ classification: PERMISSIVE }));
  /** A PERMISSIVE origin pinned to one machine: the hosted browser, proxied through its line. */
  const hostedThrough = (pairingId: string, endpoint: string): LocalityVerdict => resolveLocality(input({
    classification: PERMISSIVE,
    declaredTarget: { kind: 'pinned', pairingId },
    candidates: [machine({ pairingId, egressEndpoint: endpoint })],
  }));
  /** What the run does with a verdict, given the route its context is already open on. */
  const against = (v: LocalityVerdict, openedRoute: EgressResolution | null): LocalityVerdict =>
    narrowLocalityForRun(v, { liveUrl: null, declaredOrigin: null, openedRoute });

  const M1 = hostedThrough('pair_home', 'http://100.64.0.7:1080');
  const M2 = hostedThrough('pair_other', 'http://100.64.0.8:1080');
  const routeOf = (v: LocalityVerdict): EgressResolution =>
    v.kind === 'in-process' ? v.egress : ((): never => { throw new Error(`expected in-process, got ${v.kind}`); })();

  it('the fixtures really are the three distinct routes a run can open', () => {
    // Guards the cases below against passing for the wrong reason: if a fixture silently stopped
    // resolving to the hosted browser, `routeOf` throws rather than comparing two refusals.
    expect(routeOf(hostedOnDatacenter())).toEqual(DC);
    expect(routeOf(M1)).toEqual({ outcome: 'machine', pairingId: 'pair_home', proxyUrl: 'http://100.64.0.7:1080' });
    expect(routeOf(M2)).toEqual({ outcome: 'machine', pairingId: 'pair_other', proxyUrl: 'http://100.64.0.8:1080' });
  });

  it('a run with no context open yet is never refused for its route', () => {
    for (const v of [hostedOnDatacenter(), M1, M2]) expect(against(v, null)).toBe(v);
  });

  it('two datacenter routes interchange, so the refusal is not a blanket one', () => {
    const v = hostedOnDatacenter();
    expect(against(v, DC)).toBe(v);
  });

  it('the same machine is the same route', () => {
    expect(against(M1, routeOf(M1))).toBe(M1);
  });

  it('a machine route is not a datacenter route, in either direction', () => {
    expect(against(M1, DC).kind).toBe('blocked');
    expect(against(hostedOnDatacenter(), routeOf(M1)).kind).toBe('blocked');
  });

  it('two different machines are different routes, and the refusal names the AUTHOR as the fix', () => {
    const refused = against(M1, routeOf(M2));
    expect(refused.kind).toBe('blocked');
    // NOT `start-a-machine`. A route switch is a property of the step list: the next fire resolves
    // the same declarations and blocks at the same index, so the neutral halt would be an unbounded
    // retry against a condition only the automation's author can change.
    expect(refused.kind === 'blocked' && refused.clearedBy).toBe('edit-the-automation');
    expect(refused.kind === 'blocked' && refused.reason).toMatch(/different route out of the network/);
  });

  it('a BRIDGE verdict is untouched - there is no launch option to be stuck with', () => {
    const bridge = resolveLocality(input({ classification: PERMISSIVE, daemonConnected: true, daemonPairingId: 'pair_home' }));
    expect(bridge.kind).toBe('bridge');
    expect(against(bridge, routeOf(M1))).toBe(bridge);
  });
});

/**
 * P4.2 - WHAT ACT CLEARS THE BLOCK, on every refusal this module can produce.
 *
 * WHY THIS SUITE EXISTS. `blocked` used to carry a reason and nothing else, so every refusal was
 * routed to the same halt - `awaiting_daemon`, which the schedule rail treats as NEUTRAL against
 * the failure ceiling because opening a laptop clears it. That is true of a machine being OFF and
 * false of an account having no machine at all, and the second inherited the neutrality anyway: a
 * schedule re-firing nightly, forever, against a condition nothing could resolve, with the ceiling
 * never counting one attempt.
 *
 * `clearedBy` is REQUIRED on the verdict, so a new refusal cannot inherit "retry forever" by saying
 * nothing, and it names the ACT rather than the actor because the consumer has to pick a halt with
 * it. This suite is the census that keeps the answers honest: `pair-a-machine` is reachable only
 * from a KNOWN-EMPTY listing, and every environment refusal stays `start-a-machine` - because making
 * them all terminal would auto-pause schedules for owners whose only sin is a shut laptop.
 */
describe('every locality refusal says which act can clear it', () => {
  const RETIRED = 'pair_ceremony_gone';

  it('a ceremony machine that is merely ASLEEP is cleared by starting it', () => {
    // The fleet still lists it: registered and switched off. A machine of theirs IS dialled in.
    const v = resolveLocality(input({
      preferredPairingId: RETIRED,
      candidates: [machine({ pairingId: RETIRED, live: false }), machine({ pairingId: 'pair_other' })],
      daemonConnected: true,
      daemonPairingId: 'pair_other',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('start-a-machine');
  });

  it('an UNKNOWN fleet listing is not a statement that anything was retired', () => {
    // `null` - "this process does not know what this org has", an unbound seam. Not-knowing may
    // never turn a preference into a terminal halt.
    const v = resolveLocality(input({
      preferredPairingId: RETIRED,
      candidates: null,
      daemonConnected: true,
      daemonPairingId: 'pair_other',
    }));
    expect(v.kind).toBe('blocked');
    expect(v.kind === 'blocked' && v.clearedBy).toBe('start-a-machine');
  });

  /**
   * THE CENSUS ITSELF - and it is one, which the thing it replaces was not.
   *
   * WHAT WAS WRONG WITH THE OLD SHAPE. It was five hand-written inputs under a docblock claiming to
   * cover "every refusal this module can produce". Nothing connected the claim to the code: a new
   * terminal branch - the exact mistake that made this suite necessary in the first place - could be
   * added, reached in production, and leave these assertions green, because the list simply would
   * not mention it. A list of examples cannot be a census of a function.
   *
   * WHAT THIS DOES INSTEAD. It walks the CROSS PRODUCT of the whole input space (postures, declared
   * targets, offline policies, ceremony preferences, daemon states, fleet listings, the kill switch
   * - several thousand combinations), collects every distinct refusal the module actually emits,
   * and asserts against the collected set:
   *
   *   1. the TERMINAL refusals are exactly the ones enumerated, so a new terminal branch is red the
   *      moment any input reaches it - and so is an existing neutral one that quietly becomes
   *      terminal, which is how a schedule starts auto-pausing on a shut laptop;
   *   2. the FULL set of refusals is exactly the one enumerated here, so a new refusal of either
   *      kind is red as well - it cannot slip in as "one more machine one";
   *   3. no refusal answers BOTH ways, which would mean the same condition sometimes auto-pauses a
   *      schedule and sometimes does not.
   *
   * WHY IT NOW WALKS TWO ENTRY POINTS. Because a census of ONE FUNCTION is not a census of the
   * product, and the gap was not hypothetical: for six rounds `engine.ts` built a posture-drift
   * refusal of its own, carrying the NEUTRAL act for a condition that is a property of the step list,
   * and this block sailed past it green - it enumerated only what `resolveLocality` returns, and that
   * refusal was assembled next door. The blocked member is now BRANDED, so `locality.ts` is the only
   * module that can construct one at all, and every entry point that can return one is driven here:
   * `resolveLocality` for the step list, `narrowLocalityForRun` for what the run has already done. A
   * third entry point cannot appear without either failing to compile or failing this block.
   *
   * Pairing ids are normalised out of the strings (they are inputs, not branches); everything else
   * is compared literally, so re-wording a refusal is a deliberate edit here rather than a silent
   * drift away from what the product tells people.
   */
  describe('a census over the whole input space, not a list of remembered cases', () => {
    /** The refusal no amount of waiting clears, because there is no machine to wait for. */
    const NO_MACHINE =
      'no machine is paired to your account, and this step runs only on one - ' +
      'pair a machine, then establish this session from it';

    /** The run's hosted session has navigated off the origin its posture was declared for. */
    const DRIFTED =
      "this run's hosted browser is on bank.example.pt, which is not the origin this step's posture " +
      'was declared for (portal.example.com) - it will not carry a step onto an undeclared site. ' +
      'Declare the origin this automation actually reaches, or keep the run on the declared one.';

    /** A second route out, for a context whose proxy was fixed at launch. */
    const ROUTE_SWITCH =
      'this step needs a different route out of the network than the one this run already opened, ' +
      'and the proxy is a launch option that cannot be re-pointed - declare one route for the ' +
      'whole run, or split these steps into separate automations';

    /** Every refusal this module can emit, with the act that clears it. Pairing ids normalised. */
    const EXPECTED: ReadonlyArray<readonly [string, ClearingAct]> = [
      [NO_MACHINE, 'pair-a-machine'],
      [DRIFTED, 'edit-the-automation'],
      [ROUTE_SWITCH, 'edit-the-automation'],
      ['this step is pinned to machine <pairing>; the machine currently connected is a different one', 'start-a-machine'],
      [
        'this step must run on the machine where its session was established, and a different machine ' +
          'of yours is connected - start that machine, or establish this session again from the one you want to use',
        'start-a-machine',
      ],
      [
        'this origin is adversarial: the step is pinned to machine <pairing>, and that machine is not connected',
        'start-a-machine',
      ],
      [
        'this origin is adversarial: the step runs only on the machine where its session was established, ' +
          'and that machine is not connected',
        'start-a-machine',
      ],
      [
        'this origin is adversarial, so its browser steps run only on one of your machines, and none is connected',
        'start-a-machine',
      ],
      ['no machine is connected and the in-process browser fallback is disabled', 'start-a-machine'],
      ['waiting for a machine: no machine in this org is advertising residential egress', 'start-a-machine'],
      ['waiting for a machine: the pinned machine <pairing> is not available with residential egress', 'start-a-machine'],
      ['no machine in this org is advertising residential egress', 'start-a-machine'],
      ['the pinned machine <pairing> is not available with residential egress', 'start-a-machine'],
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
      const fleets: Array<EgressCandidate[] | null> = [
        // "This process does not know what this org has" - ignorance, which changes nothing.
        null,
        // The registry answered: this org HAS NO MACHINES. A different fact, and a terminal one.
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

      /**
       * WHAT THE RUN HAS ALREADY DONE, crossed with every verdict above.
       *
       * `narrowLocalityForRun` is the SECOND entry point that can return a refusal, and it is the
       * one the drift halt hid behind for six rounds while it lived in `engine.ts`. Its inputs are
       * the run's live facts, so the space is small and stated exhaustively: a browser that has not
       * navigated, one that is on the declared origin, one that has drifted, one on a URL that does
       * not parse; a step whose origin never resolved; and a context already open on each route a
       * run can have opened.
       */
      const liveUrls = [
        null,                                  // no observation yet
        'about:blank',                         // observed, but nowhere
        'not a url at all',                    // unparseable - "nothing to compare", not a mismatch
        'https://portal.example.com/inbox',    // still on the declared origin
        'https://PORTAL.example.com/inbox',    // ...and the comparison is case-folded
        'https://bank.example.pt/transfers',   // DRIFTED - a click, an OAuth hop, a 302
      ];
      const declaredOrigins = [null, 'portal.example.com'];
      const openedRoutes: Array<EgressResolution | null> = [
        null,                                                                        // nothing open
        { outcome: 'datacenter', reason: 'no-requirement' },                          // open, no proxy
        { outcome: 'machine', pairingId: 'pair_home', proxyUrl: 'http://100.64.0.7:1080' },
        { outcome: 'machine', pairingId: 'pair_other', proxyUrl: 'http://100.64.0.8:1080' },
      ];

      const seen = new Map<string, Set<string>>();
      const record = (v: LocalityVerdict): void => {
        if (v.kind !== 'blocked') return;
        const key = normalise(v.reason);
        (seen.get(key) ?? seen.set(key, new Set()).get(key)!).add(v.clearedBy);
      };
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
                    record(v);
                    // ...and the same verdict again, once per thing this run might already have
                    // done. Every verdict is narrowed, not only the refusals: a verdict that is
                    // fine against the step list is exactly the one the run's own history can turn
                    // into a refusal.
                    for (const liveUrl of liveUrls) {
                      for (const declaredOrigin of declaredOrigins) {
                        for (const openedRoute of openedRoutes) {
                          record(narrowLocalityForRun(v, { liveUrl, declaredOrigin, openedRoute }));
                        }
                      }
                    }
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

    /**
     * THE RULE, APPLIED TO THE WHOLE CENSUS: a refusal may be waited out only when it will clear
     * WITHOUT ANYBODY BEING TOLD.
     *
     * A neutral fire leaves no durable trace - no counter movement, no auto-pause, only a toast on a
     * page the owner may never have open - so the test is not "can a person fix this" (a person can
     * fix all three) but whether it clears in the ordinary course. A shut laptop does; an account
     * with no machine paired does not, because nobody pairs hardware they were never told was
     * needed; and a cause that is a property of the STEP LIST cannot, because the next fire resolves
     * the same declarations and halts at the same index. The three terminal refusals below are
     * exactly the ones that fail that test. See `CLEARING_ACTS` for the clauses.
     */
    it('a refusal is neutral only when it will clear without anybody being told', () => {
      const seen = censusOfRefusals();
      const terminal = [...seen.entries()]
        .filter(([, answers]) => [...answers].some((a) => a !== 'start-a-machine'))
        .map(([reason]) => reason)
        .sort();
      expect(terminal).toEqual([NO_MACHINE, DRIFTED, ROUTE_SWITCH].sort());
      // ...and the complement is exactly "a machine of yours is off", which a schedule must be free
      // to wait out: making those terminal would auto-pause schedules over a shut lid.
      const neutral = [...seen.entries()].filter(([, a]) => [...a].every((x) => x === 'start-a-machine'));
      expect(neutral.length).toBe(EXPECTED.length - 3);
    });

    /**
     * THE PROPERTY BEHIND THE TABLE, checked against the collected refusals rather than restated.
     * Whatever act a refusal names, `refusalIsNeutral` must answer from `CLEARING_ACTS` - so a new
     * act that forgets to justify itself cannot compile, and one that justifies itself wrongly is
     * visible here as a refusal that is neutral while nothing environmental is missing.
     */
    it('every act the census produced is one CLEARING_ACTS justifies out loud', () => {
      const seen = censusOfRefusals();
      const acts = new Set([...seen.values()].flatMap((s) => [...s]));
      // Every act reachable in production is in the table...
      for (const act of acts) expect(Object.keys(CLEARING_ACTS)).toContain(act);
      // ...every act in the table is reachable in production (a justification for a refusal nothing
      // can emit is documentation of a branch that does not exist)...
      expect([...acts].sort()).toEqual(Object.keys(CLEARING_ACTS).sort());
      // ...exactly one of them is neutral, and it is the environmental one...
      const neutralActs = (Object.keys(CLEARING_ACTS) as ClearingAct[]).filter(refusalIsNeutral);
      expect(neutralActs).toEqual(['start-a-machine']);
      // ...and each carries a written reason, because "neutral: true" with no argument beside it is
      // how this defaulted for six rounds.
      for (const [act, facts] of Object.entries(CLEARING_ACTS)) {
        expect(facts.because.length, act).toBeGreaterThan(80);
      }
    });

    it('every refusal answers the way this file says it does', () => {
      const seen = censusOfRefusals();
      for (const [reason, clearedBy] of EXPECTED) {
        expect([...(seen.get(reason) ?? [])], reason).toEqual([clearedBy]);
      }
    });
  });
});
