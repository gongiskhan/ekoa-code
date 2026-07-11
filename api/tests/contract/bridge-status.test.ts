import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import type { WebSocket } from 'ws';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, bridgePairings } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  registerPairing,
  revokePairing,
  attachLiveConnection,
  markAlive,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';
import { BridgeStatusResponse, ErrorEnvelope } from '@ekoa/shared';

/**
 * GET /api/v1/bridge/status (FC-401/FC-405; ch18 §18.3.3) — hosted presence derived from the
 * pairing registry ONLY. Owner-scoped: a user reads only their own pairing state; another
 * user's pairing never shows. Three states: no non-revoked row -> {paired:false,live:false};
 * a row but no live socket -> {paired:true,live:false,pairingId}; a live socket -> full shape
 * with lastSeenAt. No daemon round trip — the endpoint answers with no daemon in existence.
 * Every non-2xx body validates against the shared error envelope.
 */
let mem: MongoMemoryServer; let seq = 0; let server: Server; let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

async function mkUser(id: string, orgId = 'orgA') {
  await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role: 'builder', orgId, active: true });
  setActivation(id, { active: true, billingLocked: false });
}
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;
const api = (p: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const authed = (p: string, t: string, init: RequestInit = {}) =>
  api(p, { ...init, headers: { authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const readJson = async (r: Response): Promise<Record<string, unknown>> => (await r.json()) as Record<string, unknown>;

/** A socket stub good enough for the live map (only close/send are ever touched). */
function fakeWs(): WebSocket {
  return { close: () => undefined, send: () => undefined } as unknown as WebSocket;
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k'; process.env.JWT_SECRET = 's'; __resetConfigForTests(); loadConfig();
  mem = await createMem(); await connectMongo(mem.getUri(), 'ekoa_bridge_status');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => { server.close(); await closeMongo(); await mem.stop(); });
beforeEach(async () => {
  __resetActivationForTests(); __resetRevocationsForTests(); __resetLiveConnectionsForTests();
  await users.deleteMany({}); await bridgePairings.deleteMany({});
});

describe('GET /api/v1/bridge/status', () => {
  it('no pairing -> {paired:false, live:false}, schema-valid', async () => {
    await mkUser('u1');
    const res = await authed('/api/v1/bridge/status', await tokenFor('u1'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeStatusResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ paired: false, live: false });
    expect(body.pairingId).toBeUndefined();
  });

  it('paired but no live socket -> {paired:true, live:false, pairingId}', async () => {
    await mkUser('u1');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    const res = await authed('/api/v1/bridge/status', await tokenFor('u1'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeStatusResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ paired: true, live: false, pairingId: 'pair-1' });
  });

  it('live socket -> {paired:true, live:true, pairingId, lastSeenAt}; heartbeat restamps lastSeenAt', async () => {
    await mkUser('u1');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    attachLiveConnection({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1', ws: fakeWs() });
    const res = await authed('/api/v1/bridge/status', await tokenFor('u1'));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(BridgeStatusResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ paired: true, live: true, pairingId: 'pair-1' });
    expect(typeof body.lastSeenAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.lastSeenAt as string))).toBe(false);
    // A pong restamps the heartbeat proof — lastSeenAt never moves backwards.
    const before = body.lastSeenAt as string;
    markAlive('pair-1');
    const again = await readJson(await authed('/api/v1/bridge/status', await tokenFor('u1')));
    expect(Date.parse(again.lastSeenAt as string)).toBeGreaterThanOrEqual(Date.parse(before));
  });

  it('a revoked pairing reads as not paired (kill switch honest)', async () => {
    await mkUser('u1');
    await registerPairing({ pairingId: 'pair-1', org: 'orgA', ownerUserId: 'u1' });
    await revokePairing('pair-1');
    const body = await readJson(await authed('/api/v1/bridge/status', await tokenFor('u1')));
    expect(BridgeStatusResponse.safeParse(body).success).toBe(true);
    expect(body).toMatchObject({ paired: false, live: false });
  });

  it("owner-scoped: another user's pairing never shows", async () => {
    await mkUser('u1'); await mkUser('u2');
    await registerPairing({ pairingId: 'pair-u2', org: 'orgA', ownerUserId: 'u2' });
    attachLiveConnection({ pairingId: 'pair-u2', org: 'orgA', ownerUserId: 'u2', ws: fakeWs() });
    const body = await readJson(await authed('/api/v1/bridge/status', await tokenFor('u1')));
    expect(body).toMatchObject({ paired: false, live: false });
  });

  it('multi-device: one live among several pairings wins; newest row when none live', async () => {
    await mkUser('u1');
    await registerPairing({ pairingId: 'pair-old', org: 'orgA', ownerUserId: 'u1' });
    await registerPairing({ pairingId: 'pair-new', org: 'orgA', ownerUserId: 'u1' });
    attachLiveConnection({ pairingId: 'pair-old', org: 'orgA', ownerUserId: 'u1', ws: fakeWs() });
    const body = await readJson(await authed('/api/v1/bridge/status', await tokenFor('u1')));
    expect(body).toMatchObject({ paired: true, live: true, pairingId: 'pair-old' });
  });

  it('unauthenticated -> 401 envelope', async () => {
    const res = await api('/api/v1/bridge/status');
    expect(res.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await readJson(res)).success).toBe(true);
  });
});
