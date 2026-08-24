import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, bridgePairings, bridgeCapabilityGrants } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { registerPairing, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { isCapabilityGranted, grantedCapabilities } from '../../src/bridge/capability-grants.js';
import { BridgeMachinesResponse } from '@ekoa/shared';

/**
 * SECURITY SUITE - CAPABILITY-GRANT TENANCY (Rule 5), the isolation suite the grant ROUTES ship
 * with. Sibling of `security/locality-isolation.test.ts`, which drives `grantCapability` directly;
 * this one drives the HTTP surface, because that is the half a route can get wrong on its own.
 *
 * WHAT A LEAK WOULD MEAN. A grant is the authorisation that lets one org's automations execute on a
 * particular computer and route traffic out of a particular house. A route that read or wrote a
 * grant across the tenant boundary would let org A turn on `local.bash` on org B's laptop - remote
 * code execution on a stranger's machine, authorised by the product, invisible from both sides.
 *
 * THE ATTACK, staged with real rows through the REAL APP: org B owns a machine advertising
 * everything worth having. Org A's own administrator - a legitimate org-admin, not an impostor -
 * must not see it, must not grant on it, must not revoke on it, and must not be able to tell
 * whether it exists at all.
 *
 * The refusals are deliberately compared against an org-A CONTROL machine in the same assertions,
 * so a suite that passes because the fixture is broken cannot look like a suite that passes because
 * the boundary holds.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const ORG_A = 'org_a';
const ORG_B = 'org_b';

async function mkUser(id: string, role: 'user' | 'org-admin' | 'super-admin', orgId: string) {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const authed = (t: string, p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) },
  });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

const listMachines = (t: string) => authed(t, '/api/v1/bridge/machines');
const grant = (t: string, pairingId: string, body: Record<string, unknown>) =>
  authed(t, `/api/v1/bridge/pairings/${pairingId}/capabilities`, { method: 'POST', body: JSON.stringify(body) });
const revoke = (t: string, pairingId: string, capability: string) =>
  authed(t, `/api/v1/bridge/pairings/${pairingId}/capabilities/${capability}`, { method: 'DELETE' });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_sec_capability_grant_isolation');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetLiveConnectionsForTests();
  await users.deleteMany({}); await bridgePairings.deleteMany({}); await bridgeCapabilityGrants.deleteMany({});
});

/** Two orgs, an admin in each, and a machine in each advertising the same tempting capabilities. */
async function stageTwoOrgs(): Promise<{ adminA: string; adminB: string }> {
  await mkUser('admin_a', 'org-admin', ORG_A);
  await mkUser('admin_b', 'org-admin', ORG_B);
  await registerPairing({
    pairingId: 'pair_a', org: ORG_A, ownerUserId: 'admin_a',
    capabilities: ['desktop.automation', 'local.bash', 'egress.residential'],
    egressEndpoint: 'http://100.64.1.1:1080',
  });
  await registerPairing({
    pairingId: 'pair_b', org: ORG_B, ownerUserId: 'admin_b',
    capabilities: ['desktop.automation', 'local.bash', 'egress.residential'],
    egressEndpoint: 'http://100.64.9.9:1080',
  });
  return { adminA: await tokenFor('admin_a'), adminB: await tokenFor('admin_b') };
}

describe('an org-admin never sees another tenant\'s machines', () => {
  it('the listing carries this org\'s machines and nothing else', async () => {
    const { adminA, adminB } = await stageTwoOrgs();

    const forA = BridgeMachinesResponse.parse(await readJson(await listMachines(adminA)));
    expect(forA.items.map((m) => m.pairingId)).toEqual(['pair_a']);
    // The control: org B's admin really can see pair_b, so the absence above is about the org
    // boundary and not about the fixture failing to register anything.
    const forB = BridgeMachinesResponse.parse(await readJson(await listMachines(adminB)));
    expect(forB.items.map((m) => m.pairingId)).toEqual(['pair_b']);
  });

  it('the foreign machine\'s advertised address never appears in the response body', async () => {
    const { adminA } = await stageTwoOrgs();
    const raw = JSON.stringify(await readJson(await listMachines(adminA)));
    expect(raw).not.toContain('100.64.9.9');
    expect(raw).toContain('100.64.1.1');
  });
});

describe('an org-admin cannot grant on another tenant\'s machine', () => {
  it('the grant is a 404 - the same answer a machine that does not exist gets', async () => {
    const { adminA } = await stageTwoOrgs();

    const foreign = await grant(adminA, 'pair_b', { capability: 'local.bash' });
    const missing = await grant(adminA, 'pair_does_not_exist', { capability: 'local.bash' });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    // BYTE-IDENTICAL, so the route is not an existence oracle: an attacker cannot map another
    // tenant's fleet by watching which pairing ids answer differently.
    expect(await foreign.text()).toBe(await missing.text());
  });

  it('...and nothing is written, in EITHER org\'s scope', async () => {
    const { adminA } = await stageTwoOrgs();
    await grant(adminA, 'pair_b', { capability: 'local.bash' });

    // Not granted for org B (the obvious leak) ...
    expect(await isCapabilityGranted(ORG_B, 'pair_b', 'local.bash')).toBe(false);
    // ... and not granted under org A's key either, which would be the subtler bug: a row keyed
    // {org_a, pair_b} authorises org A's work on a machine org A does not own, and `pair_b` is
    // exactly the pairingId org B's daemon connects with.
    expect(await isCapabilityGranted(ORG_A, 'pair_b', 'local.bash')).toBe(false);
    expect(await grantedCapabilities(ORG_A, 'pair_b')).toEqual([]);
  });

  it('the org is the CALLER\'S, never a value the caller supplies', async () => {
    const { adminA } = await stageTwoOrgs();
    // Body fields that name a tenant are ignored rather than honoured: there is no orgId input on
    // this route at all, so the only org in play is the authenticated one.
    const res = await grant(adminA, 'pair_a', { capability: 'local.bash', orgId: ORG_B, org: ORG_B });
    expect(res.status).toBe(200);
    expect(await isCapabilityGranted(ORG_A, 'pair_a', 'local.bash')).toBe(true);
    expect(await isCapabilityGranted(ORG_B, 'pair_a', 'local.bash')).toBe(false);
  });

  it('a grantedByUserId in the body cannot forge the attribution', async () => {
    const { adminA } = await stageTwoOrgs();
    await grant(adminA, 'pair_a', { capability: 'local.bash', grantedByUserId: 'admin_b' });
    const row = (await bridgeCapabilityGrants.get(`${ORG_A}::pair_a::local.bash`)) as { grantedByUserId: string } | null;
    expect(row?.grantedByUserId).toBe('admin_a');
  });
});

describe('an org-admin cannot revoke another tenant\'s grant', () => {
  it('the revoke is a 404 and org B\'s grant survives untouched', async () => {
    const { adminA, adminB } = await stageTwoOrgs();
    await grant(adminB, 'pair_b', { capability: 'local.bash' });
    expect(await isCapabilityGranted(ORG_B, 'pair_b', 'local.bash')).toBe(true);

    const res = await revoke(adminA, 'pair_b', 'local.bash');
    expect(res.status).toBe(404);
    // The kill switch next door is not org A's to pull. Turning OFF another tenant's capability is
    // a denial of service on their automations, so it is refused exactly as turning one on is.
    expect(await isCapabilityGranted(ORG_B, 'pair_b', 'local.bash')).toBe(true);
  });

  it('a colliding pairing id does not carry a revoke across the boundary', async () => {
    await mkUser('admin_a', 'org-admin', ORG_A);
    await mkUser('admin_b', 'org-admin', ORG_B);
    // The SAME pairingId cannot exist twice (the row is keyed by it), so the collision that matters
    // is org A holding a grant under a pairing id that belongs to org B's machine. Org A revoking
    // its own row must not reach into org B's - the grant key carries the org for this reason.
    await registerPairing({ pairingId: 'pair_shared', org: ORG_B, ownerUserId: 'admin_b', capabilities: ['local.bash'] });
    await bridgeCapabilityGrants.insert({
      _id: `${ORG_A}::pair_shared::local.bash`, orgId: ORG_A, pairingId: 'pair_shared',
      capability: 'local.bash', grantedByUserId: 'admin_a', createdAt: new Date().toISOString(), revokedAt: null,
    } as never);
    await bridgeCapabilityGrants.insert({
      _id: `${ORG_B}::pair_shared::local.bash`, orgId: ORG_B, pairingId: 'pair_shared',
      capability: 'local.bash', grantedByUserId: 'admin_b', createdAt: new Date().toISOString(), revokedAt: null,
    } as never);

    // Org A cannot even reach the route for that machine: the pairing belongs to org B.
    const res = await revoke(await tokenFor('admin_a'), 'pair_shared', 'local.bash');
    expect(res.status).toBe(404);
    expect(await isCapabilityGranted(ORG_B, 'pair_shared', 'local.bash')).toBe(true);
  });
});

describe('the admin gate refuses before it reads, so a plain user learns nothing', () => {
  /**
   * The refusal for a non-admin is identical for a machine in their org, a machine in another org
   * and a machine that does not exist - because the role check runs BEFORE any store read. If it
   * ran after the lookup, the 403/404 split would itself be the oracle: 403 would mean "this exists
   * in your org", 404 would mean "it does not", and a plain user could map the fleet they were just
   * refused access to.
   */
  it('a plain user gets the same 403 for their own, a foreign, and a non-existent machine', async () => {
    await stageTwoOrgs();
    await mkUser('plain_a', 'user', ORG_A);
    const t = await tokenFor('plain_a');

    const own = await grant(t, 'pair_a', { capability: 'local.bash' });
    const foreign = await grant(t, 'pair_b', { capability: 'local.bash' });
    const missing = await grant(t, 'pair_nowhere', { capability: 'local.bash' });

    expect([own.status, foreign.status, missing.status]).toEqual([403, 403, 403]);
    const bodies = await Promise.all([own.text(), foreign.text(), missing.text()]);
    expect(new Set(bodies).size).toBe(1);
  });

  it('the same holds on revoke and on the listing', async () => {
    await stageTwoOrgs();
    await mkUser('plain_a', 'user', ORG_A);
    const t = await tokenFor('plain_a');

    expect((await revoke(t, 'pair_a', 'local.bash')).status).toBe(403);
    expect((await revoke(t, 'pair_b', 'local.bash')).status).toBe(403);
    expect((await listMachines(t)).status).toBe(403);
  });
});
