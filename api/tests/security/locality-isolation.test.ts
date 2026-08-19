import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings, bridgeCapabilityGrants } from '../../src/data/stores.js';
import { grantCapability } from '../../src/bridge/capability-grants.js';
import {
  registerPairing,
  revokePairing,
  egressCandidatesForOrg,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';
import {
  setEgressCandidateResolver,
  loadEgressCandidates,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { resolveLocality } from '../../src/automation/locality.js';
import {
  machineRetired,
  residentialEgressPairings,
  resolveEgress,
  type EgressCandidate,
} from '../../src/automation/egress-policy.js';
import { classifyOrigin } from '../../src/automation/origin-posture.js';

/**
 * SECURITY SUITE — LOCALITY TENANCY (Rule 5), the isolation suite P4.1 ships with.
 *
 * WHAT NEW STATE THIS SLICE READS. None of its own: locality resolves against the bridge pairing
 * registry, which is org-scoped by construction. That is exactly why it needs a suite of this class
 * rather than an argument — "org-scoped by construction" is a claim about code that changes, and
 * the thing it protects is a tenant's HOME CONNECTION. A locality decision that leaked across orgs
 * would route one company's portal traffic out of another company's house, and the failure would be
 * invisible from both sides.
 *
 * THE ATTACK, staged with real rows in the real stores: org B owns a machine that is live, granted,
 * and advertising residential egress — the ideal candidate, if only it belonged to you. Org A's run
 * must never see it, must never select it, and must halt instead. Which it must ALSO do when the
 * only thing wrong is the org field, so the assertions below deliberately make org B's machine
 * BETTER than anything org A has.
 *
 * The pairing between the seam and the registry is exercised as the composition root binds it
 * (`setEgressCandidateResolver(egressCandidatesForOrg)`), because a resolver bound org-blind would
 * defeat every filter downstream of it and no unit test of `resolveEgress` would notice.
 */
let mem: MongoMemoryServer;
const ORG_A = 'org_a';
const ORG_B = 'org_b';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_locality_isolation');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await bridgePairings.deleteMany({});
  await bridgeCapabilityGrants.deleteMany({});
  __resetLiveConnectionsForTests();
  __resetAutomationSeamsForTests();
});

/** A fully armed residential machine: paired, granted, advertising, with a tailnet endpoint. */
async function armedMachine(pairingId: string, org: string, endpoint: string): Promise<void> {
  await registerPairing({
    pairingId,
    org,
    ownerUserId: `owner_of_${pairingId}`,
    capabilities: ['egress.residential'],
    egressEndpoint: endpoint,
  });
  await grantCapability({ orgId: org, pairingId, capability: 'egress.residential', egressEndpoint: endpoint, grantedByUserId: 'admin' });
}

/** A permissive origin declaring residential egress — the only shape that can select a machine. */
const PERMISSIVE = classifyOrigin('https://portal.example.com', {
  posture: 'permissive',
  httpConfig: { baseUrl: 'https://portal.example.com' },
});

function localityFor(actorOrg: string, candidates: readonly EgressCandidate[] | null) {
  return resolveLocality({
    classification: PERMISSIVE,
    declaredTarget: { kind: 'any', capability: 'egress.residential' },
    offlinePolicy: 'fail',
    daemonConnected: false,
    candidates: candidates?.map((c) => ({ ...c, live: true })) ?? null,
    actorOrg,
    inProcessFallbackEnabled: true,
  });
}

describe('a run never leaves through another tenant\'s machine', () => {
  it('org B\'s armed machine is not even a candidate for org A', async () => {
    await armedMachine('pair_b', ORG_B, 'http://100.64.9.9:1080');
    setEgressCandidateResolver(egressCandidatesForOrg);

    const forA = await loadEgressCandidates(ORG_A);
    expect(forA).toEqual([]);
    // Not "filtered later" — absent. A foreign machine is not a candidate at all, which is the
    // only construction under which a later refactor of the filter cannot reintroduce the leak.
    const forB = await loadEgressCandidates(ORG_B);
    expect(forB?.map((c) => c.pairingId)).toEqual(['pair_b']);
  });

  it('org A HALTS rather than borrowing the perfectly good machine next door', async () => {
    await armedMachine('pair_b', ORG_B, 'http://100.64.9.9:1080');
    setEgressCandidateResolver(egressCandidatesForOrg);

    const verdict = localityFor(ORG_A, await loadEgressCandidates(ORG_A));
    expect(verdict.kind).toBe('blocked');
  });

  it('even handed the foreign candidate directly, selection refuses it', async () => {
    await armedMachine('pair_b', ORG_B, 'http://100.64.9.9:1080');
    // The seam bypassed on purpose: this is the belt to the seam's braces. If a future caller
    // resolves candidates some other way, the org filter inside selection still has to hold.
    const foreign = await egressCandidatesForOrg(ORG_B);
    expect(foreign).toHaveLength(1);

    const verdict = localityFor(ORG_A, foreign);
    expect(verdict.kind).toBe('blocked');
    expect(JSON.stringify(verdict)).not.toContain('100.64.9.9');
  });

  it('org A\'s OWN machine is selected, so the refusals above are about the org and nothing else', async () => {
    await armedMachine('pair_a', ORG_A, 'http://100.64.1.1:1080');
    await armedMachine('pair_b', ORG_B, 'http://100.64.9.9:1080');
    setEgressCandidateResolver(egressCandidatesForOrg);

    const verdict = localityFor(ORG_A, await loadEgressCandidates(ORG_A));
    expect(verdict.kind).toBe('in-process');
    expect(verdict.kind === 'in-process' && verdict.egress).toEqual({
      outcome: 'machine',
      pairingId: 'pair_a',
      proxyUrl: 'http://100.64.1.1:1080',
    });
  });

  /**
   * THE UNBOUND SEAM SAYS `null`, NOT `[]`, AND BOTH HALVES OF THAT MATTER.
   *
   * It must not widen egress: an unwired resolver cannot become "all machines", so nothing is
   * selectable and the run halts. And it must not NARROW the answer to a retirement either - `[]`
   * now means "the registry says this org has no machines", which refuses terminally and sends a
   * person to pair hardware. A process that has simply not wired its seam knows neither.
   */
  it('the unbound seam answers UNKNOWN, which refuses without claiming the org has no machines', async () => {
    await armedMachine('pair_a', ORG_A, 'http://100.64.1.1:1080');
    // No `setEgressCandidateResolver` call: the default.
    expect(await loadEgressCandidates(ORG_A)).toBeNull();
    const verdict = localityFor(ORG_A, await loadEgressCandidates(ORG_A));
    expect(verdict.kind).toBe('blocked');
    expect(verdict.kind === 'blocked' && verdict.clearedBy).toBe('start-a-machine');
  });

  /** ...and a BOUND resolver over an org with nothing in it says exactly that, terminally. */
  it('a bound resolver over an org with no pairings answers EMPTY, which is terminal', async () => {
    setEgressCandidateResolver(egressCandidatesForOrg);
    expect(await loadEgressCandidates(ORG_A)).toEqual([]);
    const verdict = localityFor(ORG_A, await loadEgressCandidates(ORG_A));
    expect(verdict.kind).toBe('blocked');
    expect(verdict.kind === 'blocked' && verdict.clearedBy).toBe('pair-a-machine');
  });
});

/**
 * THE ORG FILTER RUNS ON THE ROW, NOT ON THE ID - and this is what forces it to.
 *
 * `resolveEgress` narrows its rows with a SET OF PAIRING IDS computed by `residentialEgressPairings`
 * (which is org-scoped). Mapping that set back onto rows is only as strong as the assumption that a
 * pairing id identifies at most one row, and a tenancy boundary must not rest on an id being unique
 * across tenants: `registerPairing` is reachable by two orgs, ids arrive from clients, and nothing
 * in the store enforces global uniqueness.
 *
 * So the attack is one line long: give the foreign row THE SAME pairing id as one of ours, and put
 * it first. With the org check dropped from the row filter, the id is "available", the foreign row
 * passes, `usable[0]` picks it, and the run's proxy becomes ANOTHER TENANT'S tailnet address - one
 * company's portal traffic leaving through another company's house, invisible from both sides.
 */
describe('a colliding pairing id does not carry a run into another tenant', () => {
  const COLLIDING = 'pair_shared';
  const ours: EgressCandidate = {
    pairingId: COLLIDING, org: ORG_A, capabilities: ['egress.residential'],
    egressEndpoint: 'http://100.64.1.1:1080', live: true,
  };
  /** Identical in every way that selection looks at, except the org. Listed FIRST. */
  const theirs: EgressCandidate = { ...ours, org: ORG_B, egressEndpoint: 'http://100.64.9.9:1080' };

  it('selection takes OUR row, never the foreign one that shares its id', () => {
    const resolution = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [theirs, ours],
      ORG_A,
    );
    expect(resolution).toEqual({
      outcome: 'machine', pairingId: COLLIDING, proxyUrl: 'http://100.64.1.1:1080',
    });
  });

  it('...and with only the foreign row present it refuses rather than borrowing the address', () => {
    const resolution = resolveEgress(
      { requirement: { kind: 'residential' }, offlinePolicy: 'fail' },
      [theirs],
      ORG_A,
    );
    expect(resolution.outcome).toBe('refused');
    expect(JSON.stringify(resolution)).not.toContain('100.64.9.9');
  });

  it('the same holds through the whole locality decision, which is what production calls', () => {
    const verdict = localityFor(ORG_A, [theirs, ours]);
    expect(verdict.kind).toBe('in-process');
    expect(JSON.stringify(verdict)).not.toContain('100.64.9.9');
  });
});

/**
 * THE SAME BOUNDARY ON THE OTHER SIDE OF THE DECISION - which machines a stored SESSION may be
 * released for.
 *
 * `residentialEgressPairings` is what the run loop now hands `checkoutSession` as
 * `residentialAvailable` (`engine.ts`), and checkout releases a residential-bound session iff the
 * machine it is bound to appears in that list. So the list is an AUTHORISATION, not a hint: a
 * foreign pairing id in it would let one tenant's run unwrap a session bound to another tenant's
 * house and replay it at the portal. The org filter therefore has to hold here as well as inside
 * `resolveEgress`, and it is deliberately the same predicate so the two cannot drift apart.
 *
 * Driven off `egressCandidatesForOrg` rather than hand-built rows, so a resolver bound org-blind
 * fails this exactly as it fails the suite above.
 */
describe('a session is never released for another tenant\'s machine', () => {
  it('org B\'s armed machine never appears in the list checkout is given for org A', async () => {
    await armedMachine('pair_a', ORG_A, 'http://100.64.1.1:1080');
    await armedMachine('pair_b', ORG_B, 'http://100.64.9.9:1080');
    setEgressCandidateResolver(egressCandidatesForOrg);

    const forA = (await loadEgressCandidates(ORG_A))!.map((c) => ({ ...c, live: true }));
    expect(residentialEgressPairings(forA, ORG_A)).toEqual(['pair_a']);
  });

  it('...and refuses it even when handed the foreign candidate directly', async () => {
    await armedMachine('pair_b', ORG_B, 'http://100.64.9.9:1080');
    // Seam bypassed on purpose: the filter inside the predicate is the belt to the seam's braces.
    const foreign = (await egressCandidatesForOrg(ORG_B)).map((c) => ({ ...c, live: true }));
    expect(foreign).toHaveLength(1);
    expect(residentialEgressPairings(foreign, ORG_A)).toEqual([]);
  });

  /**
   * The three ways a machine of your OWN is still not releasable, each closed by default. A session
   * bound to a machine in any of these states stays locked in the Cofre.
   */
  it('an own machine that is asleep, ungranted, or has no endpoint is not releasable either', async () => {
    await armedMachine('pair_a', ORG_A, 'http://100.64.1.1:1080');
    setEgressCandidateResolver(egressCandidatesForOrg);
    const own = (await loadEgressCandidates(ORG_A))!.map((c) => ({ ...c, live: true }))[0]!;

    expect(residentialEgressPairings([{ ...own, live: false }], ORG_A)).toEqual([]);
    // I-3: a candidate's capability list is advertised INTERSECT granted, so an empty one means the
    // org granted this machine nothing - and a machine's own self-assertion cannot put it back.
    expect(residentialEgressPairings([{ ...own, capabilities: [] }], ORG_A)).toEqual([]);
    const noEndpoint: EgressCandidate = { ...own };
    delete noEndpoint.egressEndpoint;
    expect(residentialEgressPairings([noEndpoint], ORG_A)).toEqual([]);
    // ...and fully armed it IS releasable, so the three refusals are about those conditions rather
    // than about this fixture being unusable.
    expect(residentialEgressPairings([own], ORG_A)).toEqual(['pair_a']);
  });

  /**
   * `machineRetired` decides whether a machine halt is a WAIT or a terminal ask, and the two EMPTY
   * answers are the ones that matter - they used to be one value.
   *
   *   - `null`: an unbound seam, or nothing asked. It must never read as "your machine was removed",
   *     which would send a person to repeat a ceremony they do not need, precisely when this process
   *     knows least.
   *   - `[]`: the registry ANSWERED and the org has no pairings. Reading THAT as ignorance is what
   *     let a solo tenant who revoked their only laptop retry a neutral halt forever.
   */
  it('an UNKNOWN fleet listing is never read as a retirement, and an EMPTY one always is', async () => {
    expect(machineRetired('pair_a', null)).toBe(false);
    expect(machineRetired('pair_a', [])).toBe(true);
    expect(machineRetired('pair_a', ['pair_other'])).toBe(true);
    expect(machineRetired('pair_a', ['pair_a', 'pair_other'])).toBe(false);
  });

  /**
   * THE EMPTY LISTING IS A REAL PRODUCTION SHAPE, and this proves it from the store rather than
   * asserting it: revoking an org's only pairing is an ordinary admin action
   * (`bridge/registry.ts` `revokePairing`), and `egressCandidatesForOrg` filters revoked rows out.
   */
  it('revoking an org\'s only pairing really does produce an empty listing', async () => {
    await armedMachine('pair_a', ORG_A, 'http://100.64.1.1:1080');
    setEgressCandidateResolver(egressCandidatesForOrg);
    expect((await loadEgressCandidates(ORG_A))?.map((c) => c.pairingId)).toEqual(['pair_a']);

    await revokePairing('pair_a');
    expect(await loadEgressCandidates(ORG_A)).toEqual([]);
    expect(machineRetired('pair_a', [])).toBe(true);
  });
});
