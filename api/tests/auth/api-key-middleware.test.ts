import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { ErrorEnvelope } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users, orgs } from '../../src/data/stores.js';
import { setActivation } from '../../src/data/activation.js';
import { login } from '../../src/auth/service.js';
import { hashPassword } from '../../src/auth/password.js';
import { __resetConfigForTests, loadConfig } from '../../src/config.js';
import { mintGatewayKey, revokeGatewayKey, GATEWAY_KEY_PREFIX, __resetGatewayKeysServiceForTests } from '../../src/auth/gateway-keys-service.js';
import { requireUserOrApiKey } from '../../src/auth/api-key-middleware.js';
import { __resetCapabilityRateForTests } from '../../src/auth/api-key-rate.js';
import { requireAuth, type AuthedRequest } from '../../src/auth/middleware.js';
import { actorOf } from '../../src/routes/helpers.js';

/**
 * E1 `user-or-key` admission: real middleware on a tiny express app over mongodb-memory-server,
 * real minted keys through the real service. Fail-closed verdict mapping (unknown/revoked/
 * inactive → 401, billing_locked → 402), the LIVE-role store read (no role snapshot in the key),
 * the audit principal marker, JWT-path byte-parity with requireAuth, the per-key capability
 * 429 (JWT sessions never counted), and every non-2xx body against the shared error envelope.
 */
let mem: MongoMemoryServer;
let server: Server;
let port: number;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const OWNER = { userId: 'owner1', username: 'owner-one', orgId: 'o1' };

const probe = (path: string, auth?: string, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${port}${path}`, { headers: { ...(auth ? { authorization: auth } : {}), ...headers } });
const keyCall = (secret: string, headers: Record<string, string> = {}) => probe('/probe', `Bearer ${secret}`, headers);

const expectEnvelope = async (res: Response, code: string): Promise<void> => {
  const body = await res.json();
  expect(ErrorEnvelope.safeParse(body).success, JSON.stringify(body)).toBe(true);
  expect((body as { error: { code: string } }).error.code).toBe(code);
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_auth_api_key_mw');
  await orgs.insert({ _id: 'o1', name: 'orgA' } as never);
  await users.insert({ _id: 'owner1', username: 'owner-one', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true } as never);
  await users.insert({ _id: 'admin1', username: 'admin1', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'o1', active: true } as never);
  await users.insert({ _id: 'cap1', username: 'cap-one', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true } as never);
  await users.insert({ _id: 'drift1', username: 'drift-one', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'o1', active: true } as never);

  const app = express();
  app.use(express.json());
  // Identical handlers so the JWT path can be asserted BYTE-identical to plain requireAuth.
  const handler = (req: express.Request, res: express.Response): void => {
    res.json({
      actor: actorOf(req as AuthedRequest),
      principal: res.locals.apiKeyPrincipal ?? null,
      username: (req as AuthedRequest).user.username,
    });
  };
  app.get('/probe', requireUserOrApiKey, handler);
  app.get('/probe-jwt', requireAuth, handler);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  port = (server.address() as { port: number }).port;
}, 60_000);

afterAll(async () => {
  delete process.env.EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY;
  server.close();
  await closeMongo();
  await mem.stop();
});

beforeEach(() => {
  __resetGatewayKeysServiceForTests();
  __resetCapabilityRateForTests();
  for (const id of ['owner1', 'admin1', 'cap1', 'drift1']) setActivation(id, { active: true, billingLocked: false });
});

describe('gateway-key admission (fail-closed)', () => {
  it('a live key admits with the CURRENT store role and marks the audit principal', async () => {
    const minted = await mintGatewayKey(OWNER, 'laptop', deps);
    const res = await keyCall(minted.key, { 'X-Client': 'claude-code' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { actor: Record<string, string>; principal: Record<string, string> };
    expect(body.actor).toEqual({ userId: 'owner1', orgId: 'o1', role: 'user' });
    expect(body.principal).toEqual({ keyId: minted.id, xClient: 'claude-code' });

    // Role AND username flips in the store are effective on the NEXT call — the LIVE doc is
    // authoritative over the key doc's mint-time snapshot (a renamed/recycled username must
    // never misattribute audit lines).
    await users.update('owner1', (d) => ({ ...d, role: 'org-admin', username: 'owner1-renamed' }));
    const promoted = (await (await keyCall(minted.key)).json()) as { actor: { role: string }; principal: Record<string, string>; username: string };
    expect(promoted.actor.role).toBe('org-admin');
    expect(promoted.username).toBe('owner1-renamed');
    expect(promoted.principal).toEqual({ keyId: minted.id }); // no X-Client header → no xClient field
    await users.update('owner1', (d) => ({ ...d, role: 'user', username: 'owner1' }));
  });

  it('unknown key → 401 envelope', async () => {
    const res = await keyCall(GATEWAY_KEY_PREFIX + 'not-a-real-secret');
    expect(res.status).toBe(401);
    await expectEnvelope(res, 'UNAUTHENTICATED');
  });

  it('revoked key → 401 envelope', async () => {
    const minted = await mintGatewayKey(OWNER, 'to-revoke', deps);
    await revokeGatewayKey(OWNER, minted.id, deps);
    const res = await keyCall(minted.key);
    expect(res.status).toBe(401);
    await expectEnvelope(res, 'UNAUTHENTICATED');
  });

  it('inactive owner (activation cache) → 401 envelope', async () => {
    const minted = await mintGatewayKey(OWNER, 'inactive-owner', deps);
    setActivation('owner1', { active: false, billingLocked: false });
    const res = await keyCall(minted.key);
    expect(res.status).toBe(401);
    await expectEnvelope(res, 'UNAUTHENTICATED');
  });

  it('store drift fails closed: owner doc inactive → 401; owner doc GONE → 401', async () => {
    const drifter = { userId: 'drift1', username: 'drift-one', orgId: 'o1' };
    const minted = await mintGatewayKey(drifter, 'drift', deps);
    // Activation cache still says active — the live users read is the second gate.
    await users.update('drift1', (d) => ({ ...d, active: false }));
    const inactive = await keyCall(minted.key);
    expect(inactive.status).toBe(401);
    await expectEnvelope(inactive, 'UNAUTHENTICATED');

    await users.update('drift1', (d) => ({ ...d, active: true }));
    await users.delete('drift1');
    const gone = await keyCall(minted.key);
    expect(gone.status).toBe(401);
    await expectEnvelope(gone, 'UNAUTHENTICATED');
    await users.insert({ _id: 'drift1', username: 'drift-one', passwordHash: 'x', role: 'user', orgId: 'o1', active: true } as never);
  });

  it('billing-locked owner → 402 BILLING_LOCKED envelope', async () => {
    const minted = await mintGatewayKey(OWNER, 'locked', deps);
    setActivation('owner1', { active: true, billingLocked: true });
    const res = await keyCall(minted.key);
    expect(res.status).toBe(402);
    await expectEnvelope(res, 'BILLING_LOCKED');
  });
});

describe('JWT path (delegated, byte-identical to requireAuth)', () => {
  it('valid JWT, missing header, garbage bearer, non-bearer: same status AND body as requireAuth', async () => {
    const t = (await login('admin1', 'pw123456', false, deps)).token;
    for (const auth of [`Bearer ${t}`, undefined, 'Bearer garbage', 'Token abc']) {
      const [a, b] = await Promise.all([probe('/probe', auth), probe('/probe-jwt', auth)]);
      expect(a.status, `auth: ${auth}`).toBe(b.status);
      const [aBody, bBody] = await Promise.all([a.text(), b.text()]);
      expect(aBody, `auth: ${auth}`).toBe(bBody);
      if (a.status !== 200) expect(ErrorEnvelope.safeParse(JSON.parse(aBody)).success).toBe(true);
      else expect((JSON.parse(aBody) as { principal: unknown }).principal).toBeNull(); // JWT is never a key principal
    }
  });
});

describe('per-key capability rate caps', () => {
  it('over-cap key → 429 envelope; JWT sessions are NEVER counted by this instance', async () => {
    __resetCapabilityRateForTests({ maxCallsPerKey: 2 });
    const t = (await login('admin1', 'pw123456', false, deps)).token;
    for (let i = 0; i < 4; i++) expect((await probe('/probe', `Bearer ${t}`)).status).toBe(200); // above the key cap, untouched
    const minted = await mintGatewayKey({ userId: 'cap1', username: 'cap-one', orgId: 'o1' }, 'capped', deps);
    expect((await keyCall(minted.key)).status).toBe(200);
    expect((await keyCall(minted.key)).status).toBe(200);
    const over = await keyCall(minted.key);
    expect(over.status).toBe(429);
    await expectEnvelope(over, 'RATE_LIMITED');
    // Windows are per keyId: a different key for the SAME user is not throttled by this one.
    const other = await mintGatewayKey({ userId: 'cap1', username: 'cap-one', orgId: 'o1' }, 'fresh', deps);
    expect((await keyCall(other.key)).status).toBe(200);
  });

  it('EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY is read on (re)build of the limiter', async () => {
    process.env.EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY = '1';
    __resetCapabilityRateForTests();
    const minted = await mintGatewayKey({ userId: 'cap1', username: 'cap-one', orgId: 'o1' }, 'env-capped', deps);
    expect((await keyCall(minted.key)).status).toBe(200);
    const over = await keyCall(minted.key);
    expect(over.status).toBe(429);
    await expectEnvelope(over, 'RATE_LIMITED');
    delete process.env.EKOA_RATECAP_CAPABILITY_CALLS_PER_KEY;
  });
});
