import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server } from 'node:http';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, userSettings, gatewayKeys } from '../../src/data/stores.js';
import { setActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { __resetRevocationsForTests } from '../../src/auth/revocation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { buildApp } from '../../src/server.js';
import { loadConfig, __resetConfigForTests, defaultLlmConfig, type Config } from '../../src/config.js';
import {
  GatewayKeyMintResponse,
  GatewayKeyListResponse,
  GatewayKeyRevokeResponse,
  gatewayKeysEndpoints,
  ErrorEnvelope,
} from '@ekoa/shared';

/**
 * S4a gateway-keys CONTRACT test (run 20260717-071930-d1244839): the mint/list/revoke wire
 * shapes validate against the shared schemas through the REAL app; the secret appears exactly
 * once (mint) and never again; cross-user revoke is a uniform 404.
 */
let mem: MongoMemoryServer;
let seq = 0;
let server: Server;
let port: number;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const cfg: Config = { port: 0, jwtSecret: 's', encryptionKey: 'k', nodeEnv: 'test', llmChokepointBaseUrl: 'x', llm: defaultLlmConfig() };

const authed = (p: string, t: string, init: RequestInit = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, ...(init.headers ?? {}) } });
const tokenFor = async (u: string) => (await login(u, 'pw123456', false, deps)).token;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_gateway_keys_contract');
  const app = buildApp(cfg, deps);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);
afterAll(async () => {
  server.close();
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  __resetActivationForTests();
  __resetRevocationsForTests();
  await users.deleteMany({});
  await userSettings.deleteMany({});
  await gatewayKeys.deleteMany({});
  for (const [id, role] of [['usr', 'user'], ['usr2', 'user']] as const) {
    await users.insert({ _id: id, username: id, passwordHash: await hashPassword('pw123456'), role, orgId: 'orgA', active: true });
    setActivation(id, { active: true, billingLocked: false });
    await userSettings.put({ _id: id, memory: { autoExtract: false }, build: { verifyBuilds: false } } as never);
  }
});

describe('gateway-keys contract', () => {
  it('descriptors: self-service auth class on all three ops', () => {
    expect(gatewayKeysEndpoints.gatewayKeysMint.auth).toBe('user');
    expect(gatewayKeysEndpoints.gatewayKeysList.auth).toBe('user');
    expect(gatewayKeysEndpoints.gatewayKeysRevoke.auth).toBe('user');
    expect(gatewayKeysEndpoints.gatewayKeysMint.path).toBe('/api/v1/gateway-keys');
  });

  it('mint -> GatewayKeyMintResponse (secret ONCE); list -> GatewayKeyListResponse (no secret); revoke -> ok + revokedAt', async () => {
    const t = await tokenFor('usr');
    const mintRes = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: 'laptop' }) });
    expect(mintRes.status).toBe(201);
    const minted: unknown = await mintRes.json();
    expect(GatewayKeyMintResponse.safeParse(minted), JSON.stringify(minted)).toMatchObject({ success: true });
    const key = (minted as { key: string; id: string }).key;
    expect(key.startsWith('ekoa_gk_')).toBe(true);

    const listRes = await authed('/api/v1/gateway-keys', t);
    expect(listRes.status).toBe(200);
    const list: unknown = await listRes.json();
    expect(GatewayKeyListResponse.safeParse(list), JSON.stringify(list)).toMatchObject({ success: true });
    expect(JSON.stringify(list)).not.toContain(key); // the secret never appears again

    const revokeRes = await authed(`/api/v1/gateway-keys/${(minted as { id: string }).id}/revoke`, t, { method: 'POST' });
    expect(revokeRes.status).toBe(200);
    expect(GatewayKeyRevokeResponse.safeParse(await revokeRes.json()).success).toBe(true);

    const after = (await (await authed('/api/v1/gateway-keys', t)).json()) as { items: Array<{ revokedAt?: string }> };
    expect(after.items[0]!.revokedAt).toBeTruthy();
  });

  it('cross-user isolation: user B revoking A\'s key gets a uniform 404 envelope; B\'s list is empty', async () => {
    const ta = await tokenFor('usr');
    const minted = (await (await authed('/api/v1/gateway-keys', ta, { method: 'POST', body: JSON.stringify({ label: 'a' }) })).json()) as { id: string };

    const tb = await tokenFor('usr2');
    const res = await authed(`/api/v1/gateway-keys/${minted.id}/revoke`, tb, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(ErrorEnvelope.safeParse(await res.json()).success).toBe(true);
    const listB = (await (await authed('/api/v1/gateway-keys', tb)).json()) as { items: unknown[] };
    expect(listB.items).toHaveLength(0);
  });

  it('unauthenticated -> 401 envelope; invalid label -> 400 envelope', async () => {
    const anon = await fetch(`http://127.0.0.1:${port}/api/v1/gateway-keys`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'x' }) });
    expect(anon.status).toBe(401);
    expect(ErrorEnvelope.safeParse(await anon.json()).success).toBe(true);

    const t = await tokenFor('usr');
    const bad = await authed('/api/v1/gateway-keys', t, { method: 'POST', body: JSON.stringify({ label: '' }) });
    expect(bad.status).toBe(400);
    expect(ErrorEnvelope.safeParse(await bad.json()).success).toBe(true);
  });
});
