import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import { registerPairing, revokePairing, getPairingSigningSecret, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import { BridgeTokenResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * POST /api/v1/bridge/token (Cofre R-8; ch18 §18.3.2) - the owner-bound pre-dial exchange that
 * hands a daemon the two things it needs to ACCEPT a delegated task: the pairing's per-pairing
 * signing secret and the org that pairing is scoped to.
 *
 * The org half is the regression this suite pins. The daemon verifier checks the signature first
 * and cross-org addressing second, so a response carrying the secret and no org denies every real
 * task on a check the signature failure had been masking. Both halves are gated identically: only
 * the OWNER of a live, non-revoked pairing gets either, and an unknown/revoked/foreign pairing
 * omits both so the daemon fails closed rather than falling back to anything.
 *
 * Every non-2xx body validates against the shared error envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, orgId = 'orgA') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'user', orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const mint = (t: string, pairingId: string) =>
  api('/api/v1/bridge/token', { method: 'POST', headers: { authorization: `Bearer ${t}` }, body: JSON.stringify({ pairingId }) });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bridge_token');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetLiveConnectionsForTests();
  await users.deleteMany({}); await bridgePairings.deleteMany({});
});

describe('BridgeTokenResponse schema (Rule 7 - the org field is additive)', () => {
  it('validates WITHOUT org (a pre-R-8 daemon response, and the fail-closed shape)', () => {
    expect(BridgeTokenResponse.safeParse({ token: 't', expiresIn: 600 }).success).toBe(true);
    expect(BridgeTokenResponse.safeParse({ token: 't', expiresIn: 600, signingSecret: 's' }).success).toBe(true);
  });

  it('validates WITH org, and still rejects a non-string org', () => {
    expect(BridgeTokenResponse.safeParse({ token: 't', expiresIn: 600, signingSecret: 's', org: 'orgA' }).success).toBe(true);
    expect(BridgeTokenResponse.safeParse({ token: 't', expiresIn: 600, org: 7 }).success).toBe(false);
  });
});

describe('POST /api/v1/bridge/token', () => {
  it('the OWNER of a live pairing gets the signing secret AND the org, schema-valid', async () => {
    await mkUser('u1');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    const res = await mint(await tokenFor('u1'), 'pair-1');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeTokenResponse.safeParse(body).success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.org).toBe('orgA');
    // It is the pairing's OWN secret that is handed over, never the platform-wide jwtSecret.
    expect(body.signingSecret).toBe(await getPairingSigningSecret('pair-1', 'orgA'));
    expect(body.signingSecret).not.toBe(cfg.jwtSecret);
  });

  it('the org is the pairing owner\'s own org, so a second org\'s daemon never learns it', async () => {
    await mkUser('u1', 'orgB');
    await registerPairing({ pairingId: 'pair-b', org: 'orgB', ownerUserId: 'u1' });
    const body = await readJson(await mint(await tokenFor('u1'), 'pair-b'));
    expect(body.org).toBe('orgB');
  });

  it('a NON-OWNER in the same org gets a token but neither the secret nor the org', async () => {
    await mkUser('u1'); await mkUser('u2');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    const res = await mint(await tokenFor('u2'), 'pair-1');
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeTokenResponse.safeParse(body).success).toBe(true);
    expect(body.signingSecret).toBeUndefined();
    expect(body.org).toBeUndefined();
  });

  it('a user in ANOTHER org gets neither (org-scoped lookup, never an existence oracle)', async () => {
    await mkUser('u1'); await mkUser('u2', 'orgB');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    const body = await readJson(await mint(await tokenFor('u2'), 'pair-1'));
    expect(body.signingSecret).toBeUndefined();
    expect(body.org).toBeUndefined();
  });

  it('a REVOKED pairing omits both halves - the daemon fails closed, it does not fall back', async () => {
    await mkUser('u1');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    await revokePairing('pair-1');
    const body = await readJson(await mint(await tokenFor('u1'), 'pair-1'));
    expect(BridgeTokenResponse.safeParse(body).success).toBe(true);
    expect(body.signingSecret).toBeUndefined();
    expect(body.org).toBeUndefined();
  });

  it('an UNKNOWN pairing omits both halves', async () => {
    await mkUser('u1');
    const body = await readJson(await mint(await tokenFor('u1'), 'never-registered'));
    expect(body.signingSecret).toBeUndefined();
    expect(body.org).toBeUndefined();
  });

  it('an invalid pairing id -> 400 envelope', async () => {
    await mkUser('u1');
    const res = await mint(await tokenFor('u1'), 'not a valid id!');
    expect(res.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/bridge/token', { method: 'POST', body: JSON.stringify({ pairingId: 'pair-1' }) });
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});
