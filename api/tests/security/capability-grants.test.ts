import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings, bridgeCapabilityGrants } from '../../src/data/stores.js';
import {
  grantCapability,
  revokeCapability,
  isCapabilityGranted,
  grantedCapabilities,
  usableCapabilities,
} from '../../src/bridge/capability-grants.js';
import { registerPairing, egressCandidatesForOrg, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { resolveEgress } from '../../src/automation/egress-policy.js';

/**
 * SECURITY SUITE — per-tenant-per-machine capability grants (Cofre WS-I / I-3).
 *
 * THE GAP. A machine ADVERTISES what it can do in its `hello` frame, and selection read that list
 * as if it were an authorisation: a pairing claiming `egress.residential` became a candidate to
 * route a tenant's traffic through. But advertisement is a SELF-ASSERTION by the machine — the same
 * category of control as J-7's model-set `confirmed` flag, and wrong for the same reason. A daemon
 * that is compromised, misconfigured, or simply running a newer build than its owner expected could
 * widen its own privileges by claiming more.
 *
 * Advertisement answers "what can this machine do". It was never an answer to "what may this
 * tenant's work be routed through it for", and only the tenant can answer that.
 */
let mem: MongoMemoryServer;
const ORG = 'orgA';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_i3');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await bridgePairings.deleteMany({});
  await bridgeCapabilityGrants.deleteMany({});
  __resetLiveConnectionsForTests();
});

async function machine(pairingId: string, advertised: string[], org = ORG) {
  await registerPairing({ pairingId, org, ownerUserId: 'u1', capabilities: advertised, egressEndpoint: 'http://100.64.0.5:8888' });
}

describe('default deny', () => {
  it('a freshly paired machine can do NOTHING, whatever it advertises', async () => {
    await machine('p1', ['egress.residential', 'local.bash', 'attended.card_login']);
    expect(await grantedCapabilities(ORG, 'p1')).toEqual([]);
    expect(await isCapabilityGranted(ORG, 'p1', 'egress.residential')).toBe(false);
    // The direction that fails safe: inheriting whatever the machine claims until an admin says
    // otherwise would make a newly paired machine maximally privileged exactly while nobody is
    // watching it.
  });

  it('a granted capability becomes usable; a revoked one stops', async () => {
    await machine('p1', ['egress.residential']);
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });
    expect(await isCapabilityGranted(ORG, 'p1', 'egress.residential')).toBe(true);

    expect(await revokeCapability(ORG, 'p1', 'egress.residential')).toBe(true);
    expect(await isCapabilityGranted(ORG, 'p1', 'egress.residential')).toBe(false);
    // Revoking twice is not an error, but it reports that nothing was live to turn off.
    expect(await revokeCapability(ORG, 'p1', 'egress.residential')).toBe(false);
  });

  it('a grant is per CAPABILITY, not a blanket pass for the machine', async () => {
    await machine('p1', ['egress.residential', 'local.bash']);
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });
    expect(await isCapabilityGranted(ORG, 'p1', 'local.bash')).toBe(false);
  });

  it('a grant does not cross tenants — org is part of the KEY, not a filter applied after', async () => {
    await machine('p1', ['egress.residential']);
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });
    expect(await isCapabilityGranted('orgB', 'p1', 'egress.residential')).toBe(false);
  });

  it('re-granting a revoked capability revives it — an ordinary admin act, unlike a PAIRING revoke', async () => {
    // A pairing revoke is a terminal tombstone (a revoked pairingId must never reconnect). Turning
    // a capability back on for a machine is not that, and treating it as terminal would push admins
    // toward re-pairing the machine, which is strictly worse.
    await machine('p1', ['local.bash']);
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'local.bash', grantedByUserId: 'admin1' });
    await revokeCapability(ORG, 'p1', 'local.bash');
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'local.bash', grantedByUserId: 'admin1' });
    expect(await isCapabilityGranted(ORG, 'p1', 'local.bash')).toBe(true);
  });
});

describe('usable = advertised INTERSECT granted', () => {
  it('a grant for something the machine does not advertise does not make it usable', async () => {
    // The machine may have lost the hardware, or the operator removed the feature. A stale grant
    // must not resurrect a capability the machine is no longer offering.
    expect(await usableCapabilities(ORG, 'p1', [])).toEqual([]);
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });
    expect(await usableCapabilities(ORG, 'p1', [])).toEqual([]);
  });

  it('an advertisement with no grant does not make it usable either', async () => {
    expect(await usableCapabilities(ORG, 'p1', ['egress.residential'])).toEqual([]);
  });

  it('both sides present → usable', async () => {
    await grantCapability({ orgId: ORG, pairingId: 'p1', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });
    expect(await usableCapabilities(ORG, 'p1', ['egress.residential', 'local.bash'])).toEqual(['egress.residential']);
  });
});

describe('THE CONSEQUENCE: selection cannot be steered by a machine advertising more', () => {
  it('an ungranted machine is not an egress candidate, however loudly it advertises', async () => {
    await machine('rogue', ['egress.residential']);
    const candidates = await egressCandidatesForOrg(ORG);
    expect(candidates).toHaveLength(1);
    // The row still exists and still advertises — but it carries no usable capability, so egress
    // resolution has nothing to select.
    expect(candidates[0]!.capabilities).toEqual([]);

    const r = resolveEgress({ requirement: { kind: 'residential' }, offlinePolicy: 'fail' }, candidates, ORG);
    expect(r.outcome).toBe('refused');
  });

  it('the same machine IS selected once the org grants it', async () => {
    await machine('trusted', ['egress.residential']);
    await grantCapability({ orgId: ORG, pairingId: 'trusted', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });

    const candidates = (await egressCandidatesForOrg(ORG)).map((c) => ({ ...c, live: true }));
    expect(candidates[0]!.capabilities).toEqual(['egress.residential']);
    const r = resolveEgress({ requirement: { kind: 'residential' }, offlinePolicy: 'fail' }, candidates, ORG);
    expect(r.outcome).toBe('machine');
  });

  it('revoking the grant takes the machine out of selection without touching the pairing', async () => {
    await machine('trusted', ['egress.residential']);
    await grantCapability({ orgId: ORG, pairingId: 'trusted', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'admin1' });
    await revokeCapability(ORG, 'trusted', 'egress.residential');

    const candidates = (await egressCandidatesForOrg(ORG)).map((c) => ({ ...c, live: true }));
    expect(candidates[0]!.capabilities).toEqual([]);
    expect(resolveEgress({ requirement: { kind: 'residential' }, offlinePolicy: 'fail' }, candidates, ORG).outcome).toBe(
      'refused',
    );
    // The machine is still paired and still reachable — only its authorisation changed.
    expect(await bridgePairings.get('trusted')).not.toBeNull();
  });

  it('another org\'s grant does not make the machine usable here', async () => {
    await machine('p1', ['egress.residential']);
    await grantCapability({ orgId: 'orgB', pairingId: 'p1', capability: 'egress.residential', egressEndpoint: 'http://100.64.0.5:8888', grantedByUserId: 'other' });
    const candidates = await egressCandidatesForOrg(ORG);
    expect(candidates[0]!.capabilities).toEqual([]);
  });
});
