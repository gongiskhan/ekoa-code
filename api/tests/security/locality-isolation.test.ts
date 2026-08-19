import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings, bridgeCapabilityGrants } from '../../src/data/stores.js';
import { grantCapability } from '../../src/bridge/capability-grants.js';
import {
  registerPairing,
  egressCandidatesForOrg,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';
import {
  setEgressCandidateResolver,
  loadEgressCandidates,
  __resetAutomationSeamsForTests,
} from '../../src/automation/seams.js';
import { resolveLocality } from '../../src/automation/locality.js';
import type { EgressCandidate } from '../../src/automation/egress-policy.js';
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
  await grantCapability({ orgId: org, pairingId, capability: 'egress.residential', grantedByUserId: 'admin' });
}

/** A permissive origin declaring residential egress — the only shape that can select a machine. */
const PERMISSIVE = classifyOrigin('https://portal.example.com', {
  posture: 'permissive',
  httpConfig: { baseUrl: 'https://portal.example.com' },
});

function localityFor(actorOrg: string, candidates: readonly EgressCandidate[]) {
  return resolveLocality({
    classification: PERMISSIVE,
    declaredTarget: { kind: 'any', capability: 'egress.residential' },
    offlinePolicy: 'fail',
    daemonConnected: false,
    candidates: candidates.map((c) => ({ ...c, live: true })),
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
    expect(forB.map((c) => c.pairingId)).toEqual(['pair_b']);
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

  it('the unbound seam answers EMPTY, which refuses — an unwired resolver cannot widen egress', async () => {
    await armedMachine('pair_a', ORG_A, 'http://100.64.1.1:1080');
    // No `setEgressCandidateResolver` call: the default. It must not fall back to "all machines".
    expect(await loadEgressCandidates(ORG_A)).toEqual([]);
    expect(localityFor(ORG_A, await loadEgressCandidates(ORG_A)).kind).toBe('blocked');
  });
});
