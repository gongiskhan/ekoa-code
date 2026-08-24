import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, bridgePairings, bridgeCapabilityGrants, activityLogs } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { registerPairing, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { isCapabilityGranted } from '../../src/bridge/capability-grants.js';
import {
  BridgeMachinesResponse,
  BridgeGrantCapabilityResponse,
  BridgeRevokeCapabilityResponse,
  ErrorEnvelope,
  ekoaLocalEndpoints,
} from '@ekoa/shared';

/**
 * THE CAPABILITY-GRANT SURFACE (I-3) - `GET /bridge/machines`,
 * `POST /bridge/pairings/:pairingId/capabilities`, `DELETE .../capabilities/:capability`.
 *
 * WHY THIS SUITE EXISTS AT ALL. `grantCapability`/`revokeCapability` were built, security-tested,
 * and had no caller outside those tests: no route, no UI. The enforcement half was real and correct
 * (`daemon-step-seam.ts` refuses a step from a machine the org has not granted, default-deny), so
 * with nothing able to WRITE a grant, every browser and bash step refused forever. The finding
 * `capability-grants-have-no-route-or-ui...` is that gap; this suite is the proof it is closed.
 *
 * So the first assertion below is not a wire shape - it is that a grant made THROUGH THE ROUTE is
 * the grant the enforcement reads. A suite that only checked JSON could pass over a route that
 * wrote a row nothing consults.
 *
 * Every 2xx body validates against its shared schema; every non-2xx against the shared error
 * envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, role: 'user' | 'org-admin' | 'super-admin' = 'user', orgId = 'orgA') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const authed = (t: string, p: string, init: RequestInit = {}) =>
  api(p, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

const listMachines = (t: string) => authed(t, '/api/v1/bridge/machines');
const grant = (t: string, pairingId: string, body: Record<string, unknown>) =>
  authed(t, `/api/v1/bridge/pairings/${pairingId}/capabilities`, { method: 'POST', body: JSON.stringify(body) });
const revoke = (t: string, pairingId: string, capability: string) =>
  authed(t, `/api/v1/bridge/pairings/${pairingId}/capabilities/${capability}`, { method: 'DELETE' });

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bridge_capabilities');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetLiveConnectionsForTests();
  await users.deleteMany({}); await bridgePairings.deleteMany({});
  await bridgeCapabilityGrants.deleteMany({}); await activityLogs.deleteMany({});
});

/**
 * REVIEW ROUND. The declared TIER is part of the contract, not a comment about middleware:
 * `docs/api-contract.md` CONV-1 lists `super-admin` / `org-admin` as "marked per endpoint", and a
 * consumer reads an endpoint's tier off its descriptor. Declaring `user` on a PRIVILEGE-WIDENING
 * surface would tell every reader that an ordinary member may grant `local.bash` on a machine.
 *
 * Asserted the way `knowledge.test.ts` asserts `crawlSource.auth`, so a later edit that quietly
 * relaxes the tier fails here rather than only in a behaviour test someone might delete.
 */
describe('the declared auth tier', () => {
  it('marks all three capability endpoints org-admin', () => {
    for (const name of ['bridgeListMachines', 'bridgeGrantCapability', 'bridgeRevokeCapability'] as const) {
      expect(ekoaLocalEndpoints[name].auth, name).toBe('org-admin');
    }
  });

  it('leaves the sibling bridge endpoints on their own tiers, so the change is scoped', () => {
    expect(ekoaLocalEndpoints.bridgeToken.auth).toBe('user');
    expect(ekoaLocalEndpoints.bridgeStatus.auth).toBe('user');
  });

  /** No capability request or param field can even SPELL an org: the tenant is the caller's. */
  it('no descriptor lets a caller name a tenant', () => {
    type Shaped = { request?: { shape?: Record<string, unknown> }; params?: { shape?: Record<string, unknown> } };
    for (const name of ['bridgeListMachines', 'bridgeGrantCapability', 'bridgeRevokeCapability'] as const) {
      const d = ekoaLocalEndpoints[name] as Shaped;
      const keys = [...Object.keys(d.request?.shape ?? {}), ...Object.keys(d.params?.shape ?? {})];
      expect(keys.filter((k) => /^org(Id)?$/i.test(k)), name).toEqual([]);
    }
  });
});

describe('the grant a route writes is the grant the enforcement reads', () => {
  it('a machine refuses desktop.automation before the grant and is authorised after it', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['desktop.automation'] });

    // `isCapabilityGranted` is the exact function the composition root hands the daemon step seam
    // (`server.ts` -> `createDaemonStepConnection`), so this is the production predicate and not a
    // restatement of the route's own write.
    expect(await isCapabilityGranted('orgA', 'pair-1', 'desktop.automation')).toBe(false);

    const res = await grant(await tokenFor('admin'), 'pair-1', { capability: 'desktop.automation' });
    expect(res.status).toBe(200);

    expect(await isCapabilityGranted('orgA', 'pair-1', 'desktop.automation')).toBe(true);
  });

  it('...and the revoke turns it back off', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['local.bash'] });
    const t = await tokenFor('admin');

    await grant(t, 'pair-1', { capability: 'local.bash' });
    expect(await isCapabilityGranted('orgA', 'pair-1', 'local.bash')).toBe(true);
    await revoke(t, 'pair-1', 'local.bash');
    expect(await isCapabilityGranted('orgA', 'pair-1', 'local.bash')).toBe(false);
  });
});

describe('GET /api/v1/bridge/machines', () => {
  it('lists the org\'s machines with advertised and granted side by side, schema-valid', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({
      pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin',
      capabilities: ['desktop.automation', 'local.bash'],
    });
    const t = await tokenFor('admin');
    await grant(t, 'pair-1', { capability: 'local.bash' });

    const res = await listMachines(t);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeMachinesResponse.safeParse(body).success).toBe(true);

    const parsed = BridgeMachinesResponse.parse(body);
    expect(parsed.items).toHaveLength(1);
    const machine = parsed.items[0]!;
    expect(machine.pairingId).toBe('pair-1');
    // The two lists are DIFFERENT, which is the whole of I-3: the machine says it can do both, the
    // org has authorised one. A surface that returned a single list could not show that.
    expect(machine.advertisedCapabilities).toEqual(['desktop.automation', 'local.bash']);
    expect(machine.grantedCapabilities).toEqual(['local.bash']);
    expect(machine.live).toBe(false);
  });

  it('a machine that has never sent hello advertises nothing (the fail-closed reading)', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-quiet', org: 'orgA', ownerUserId: 'admin' });
    const parsed = BridgeMachinesResponse.parse(await readJson(await listMachines(await tokenFor('admin'))));
    expect(parsed.items[0]!.advertisedCapabilities).toEqual([]);
    expect(parsed.items[0]!.grantedCapabilities).toEqual([]);
  });

  it('a revoked pairing is not listed', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin' });
    const t = await tokenFor('admin');
    const before = BridgeMachinesResponse.parse(await readJson(await listMachines(t)));
    expect(before.items).toHaveLength(1);

    await authed(t, '/api/v1/bridge/pairings/pair-1', { method: 'DELETE' });
    const after = BridgeMachinesResponse.parse(await readJson(await listMachines(t)));
    expect(after.items).toEqual([]);
  });

  it('a plain user is refused, with the shared envelope', async () => {
    await mkUser('plain', 'user');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'plain', capabilities: ['local.bash'] });
    const res = await listMachines(await tokenFor('plain'));
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/bridge/machines');
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});

describe('POST /api/v1/bridge/pairings/:pairingId/capabilities', () => {
  it('an org-admin grants, and the answer is the machine as it now stands', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['desktop.automation'] });

    const res = await grant(await tokenFor('admin'), 'pair-1', { capability: 'desktop.automation' });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeGrantCapabilityResponse.safeParse(body).success).toBe(true);
    const parsed = BridgeGrantCapabilityResponse.parse(body);
    expect(parsed.machine.grantedCapabilities).toEqual(['desktop.automation']);
    expect(parsed.machine.advertisedCapabilities).toEqual(['desktop.automation']);
  });

  it('a super-admin may grant too', async () => {
    await mkUser('root', 'super-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'root', capabilities: ['local.bash'] });
    const res = await grant(await tokenFor('root'), 'pair-1', { capability: 'local.bash' });
    expect(res.status).toBe(200);
  });

  /**
   * THE OWNER OF THE MACHINE IS NOT ENOUGH, and this is the rule that separates this route from
   * `DELETE /pairings/:pairingId` beside it. Revoking a pairing is an emergency anyone must be able
   * to perform on their own hardware; granting WIDENS what the org's work may run on. A user who
   * could grant their own laptop `local.bash` would be authorising their own computer to execute
   * the organisation's automations.
   */
  it('a plain user is refused even on the machine they own, and nothing is written', async () => {
    await mkUser('plain', 'user');
    await registerPairing({ pairingId: 'pair-own', org: 'orgA', ownerUserId: 'plain', capabilities: ['local.bash'] });

    const res = await grant(await tokenFor('plain'), 'pair-own', { capability: 'local.bash' });
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(await isCapabilityGranted('orgA', 'pair-own', 'local.bash')).toBe(false);
  });

  /**
   * A residential-egress grant authorises a DESTINATION, not merely an ability. Without the address
   * the grant authorised the MACHINE and the machine then chose where the org's traffic went - the
   * self-assertion sitting exactly where an authorisation was supposed to be. The service raises
   * `CapabilityGrantError`; the route must answer it as a 400 rather than a 500, and must not
   * store a grant that authorises no route.
   */
  it('egress.residential with NO endpoint -> 400 envelope, and no grant is stored', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['egress.residential'] });

    const res = await grant(await tokenFor('admin'), 'pair-1', { capability: 'egress.residential' });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(ErrorEnvelope.safeParse(body).success).toBe(true);
    expect((body.error as { code: string }).code).toBe('VALIDATION_FAILED');
    expect(await isCapabilityGranted('orgA', 'pair-1', 'egress.residential')).toBe(false);
  });

  it('egress.residential with an UNUSABLE endpoint -> 400, same refusal', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['egress.residential'] });
    const res = await grant(await tokenFor('admin'), 'pair-1', { capability: 'egress.residential', egressEndpoint: 'not a url' });
    expect(res.status).toBe(400);
    expect(await isCapabilityGranted('orgA', 'pair-1', 'egress.residential')).toBe(false);
  });

  it('egress.residential WITH an endpoint records the address the org authorised', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({
      pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin',
      capabilities: ['egress.residential'], egressEndpoint: 'http://100.64.1.1:1080',
    });
    const res = await grant(await tokenFor('admin'), 'pair-1', {
      capability: 'egress.residential', egressEndpoint: 'http://100.64.1.1:1080',
    });
    expect(res.status).toBe(200);
    const parsed = BridgeGrantCapabilityResponse.parse(await readJson(res));
    expect(parsed.machine.grantedCapabilities).toEqual(['egress.residential']);
    // Both addresses travel, so a surface can show that the authorised one IS the advertised one.
    expect(parsed.machine.grantedEgressEndpoint).toBe('http://100.64.1.1:1080');
    expect(parsed.machine.egressEndpoint).toBe('http://100.64.1.1:1080');
  });

  it('a capability outside the closed vocabulary -> 400 at the schema', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin' });
    const res = await grant(await tokenFor('admin'), 'pair-1', { capability: 'local.rootkit' });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('a malformed pairing id -> 400 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const res = await grant(await tokenFor('admin'), 'not%20a%20valid%20id!', { capability: 'local.bash' });
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('an UNKNOWN machine -> 404 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const res = await grant(await tokenFor('admin'), 'never-registered', { capability: 'local.bash' });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/bridge/pairings/pair-1/capabilities', { method: 'POST', body: JSON.stringify({ capability: 'local.bash' }) });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('the grant lands in the Registo, with the ids and no credential material', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['local.bash'] });
    await grant(await tokenFor('admin'), 'pair-1', { capability: 'local.bash' });

    const rows = (await activityLogs.find({ type: 'bridge_capability_granted' })) as Array<{
      orgId: string; userId: string; metadata?: Record<string, unknown>;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.orgId).toBe('orgA');
    expect(rows[0]!.userId).toBe('admin');
    expect(rows[0]!.metadata).toMatchObject({ pairingId: 'pair-1', capability: 'local.bash' });
  });

  /** Granting a capability the machine does not advertise is PERMITTED (grant now, upgrade the
   *  daemon later) and produces nothing usable, because usable is the INTERSECTION. The response
   *  carries both lists so a surface can say so rather than implying it took effect. */
  it('a grant for an unadvertised capability is recorded but makes nothing usable', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['local.bash'] });
    const parsed = BridgeGrantCapabilityResponse.parse(
      await readJson(await grant(await tokenFor('admin'), 'pair-1', { capability: 'desktop.automation' })),
    );
    expect(parsed.machine.grantedCapabilities).toContain('desktop.automation');
    expect(parsed.machine.advertisedCapabilities).not.toContain('desktop.automation');
  });

  it('re-granting is idempotent rather than an error', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['local.bash'] });
    const t = await tokenFor('admin');
    expect((await grant(t, 'pair-1', { capability: 'local.bash' })).status).toBe(200);
    const second = await grant(t, 'pair-1', { capability: 'local.bash' });
    expect(second.status).toBe(200);
    expect(BridgeGrantCapabilityResponse.parse(await readJson(second)).machine.grantedCapabilities).toEqual(['local.bash']);
  });
});

describe('DELETE /api/v1/bridge/pairings/:pairingId/capabilities/:capability', () => {
  it('revokes, schema-valid, and reports that something was actually turned off', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['local.bash'] });
    const t = await tokenFor('admin');
    await grant(t, 'pair-1', { capability: 'local.bash' });

    const res = await revoke(t, 'pair-1', 'local.bash');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeRevokeCapabilityResponse.safeParse(body).success).toBe(true);
    const parsed = BridgeRevokeCapabilityResponse.parse(body);
    expect(parsed.revoked).toBe(true);
    expect(parsed.machine.grantedCapabilities).toEqual([]);
  });

  /** Idempotent, and a 200 rather than a 404: the state the caller asked for holds either way, and
   *  a 404 would answer a different question from the one asked. */
  it('a second revoke answers the same shape with revoked:false', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin', capabilities: ['local.bash'] });
    const t = await tokenFor('admin');
    await grant(t, 'pair-1', { capability: 'local.bash' });
    await revoke(t, 'pair-1', 'local.bash');

    const res = await revoke(t, 'pair-1', 'local.bash');
    expect(res.status).toBe(200);
    expect(BridgeRevokeCapabilityResponse.parse(await readJson(res)).revoked).toBe(false);
  });

  it('revoking a capability that was never granted is the same benign 200', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin' });
    const res = await revoke(await tokenFor('admin'), 'pair-1', 'local.bash');
    expect(res.status).toBe(200);
    expect(BridgeRevokeCapabilityResponse.parse(await readJson(res)).revoked).toBe(false);
  });

  it('a plain user is refused, and the grant survives', async () => {
    await mkUser('admin', 'org-admin'); await mkUser('plain', 'user');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'plain', capabilities: ['local.bash'] });
    await grant(await tokenFor('admin'), 'pair-1', { capability: 'local.bash' });

    const res = await revoke(await tokenFor('plain'), 'pair-1', 'local.bash');
    expect(res.status).toBe(403);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
    expect(await isCapabilityGranted('orgA', 'pair-1', 'local.bash')).toBe(true);
  });

  it('a malformed capability segment -> 400 envelope', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin' });
    const res = await revoke(await tokenFor('admin'), 'pair-1', 'not%20a%20capability!');
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('an UNKNOWN machine -> 404 envelope', async () => {
    await mkUser('admin', 'org-admin');
    const res = await revoke(await tokenFor('admin'), 'never-registered', 'local.bash');
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/bridge/pairings/pair-1/capabilities/local.bash', { method: 'DELETE' });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('the revoke lands in the Registo too, including the ineffective one', async () => {
    await mkUser('admin', 'org-admin');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'admin' });
    await revoke(await tokenFor('admin'), 'pair-1', 'local.bash');
    const rows = (await activityLogs.find({ type: 'bridge_capability_revoked' })) as Array<{ metadata?: Record<string, unknown> }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ pairingId: 'pair-1', capability: 'local.bash', revoked: false });
  });
});
