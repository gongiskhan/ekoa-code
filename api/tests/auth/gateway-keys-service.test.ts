import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo, getDb } from '../../src/data/mongo.js';
import { gatewayKeys, activityLogs } from '../../src/data/stores.js';
import { loadActivation, __resetActivationForTests } from '../../src/data/activation.js';
import {
  mintGatewayKey,
  listGatewayKeys,
  revokeGatewayKey,
  verifyGatewayKey,
  GATEWAY_KEY_PREFIX,
  __resetGatewayKeysServiceForTests,
} from '../../src/auth/gateway-keys-service.js';

/**
 * S4a gateway-keys service (run 20260717-071930-d1244839): mint (show-once, sha256-at-rest,
 * _id = hash), verify (fail-closed through the activation cache), revoke (owner-only, uniform
 * not-found), list (sanitized), throttled lastUsedAt, Registo rows for mint/revoke.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `act_${seq++}` };
const OWNER = { userId: 'u1', username: 'user-one', orgId: 'orgA' };

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_gateway_keys_service');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  __resetActivationForTests();
  __resetGatewayKeysServiceForTests();
  await getDb().collection('gateway_keys').deleteMany({});
  await getDb().collection('activity_logs').deleteMany({});
  loadActivation([{ userId: 'u1', active: true }, { userId: 'u2', active: true }]);
});

describe('mint', () => {
  it('returns the secret ONCE; stores only the sha256 (as _id) + the hint; writes a Registo row', async () => {
    const minted = await mintGatewayKey(OWNER, 'laptop', deps);
    expect(minted.key.startsWith(GATEWAY_KEY_PREFIX)).toBe(true);
    expect(minted.key.length).toBeGreaterThan(GATEWAY_KEY_PREFIX.length + 40); // 32B base64url
    expect(minted.secretHint).toBe(minted.key.slice(-4));
    expect(minted.id).toBe(createHash('sha256').update(minted.key).digest('hex'));

    const doc = await gatewayKeys.get(minted.id);
    expect(doc).toBeTruthy();
    expect(JSON.stringify(doc)).not.toContain(minted.key); // plaintext NEVER stored
    expect(doc!.ownerUserId).toBe('u1');
    expect(doc!.orgId).toBe('orgA');

    const rows = await activityLogs.find({ type: 'gateway_key_minted' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'u1', orgId: 'orgA', category: 'security' });
    expect(JSON.stringify(rows[0])).not.toContain(minted.key);
  });
});

describe('verify (fail-closed admission)', () => {
  it('verifies a live key to its owner; wrong or unprefixed secrets are unknown', async () => {
    const minted = await mintGatewayKey(OWNER, 'k', deps);
    const ok = await verifyGatewayKey(minted.key);
    expect(ok).toMatchObject({ ok: true, userId: 'u1', orgId: 'orgA', keyId: minted.id, username: 'user-one' });
    expect(await verifyGatewayKey(GATEWAY_KEY_PREFIX + 'nope')).toEqual({ ok: false, reason: 'unknown' });
    expect(await verifyGatewayKey('sk-ant-whatever')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('revoked -> revoked; inactive owner -> inactive; activation MISS (deleted owner) -> inactive; locked -> billing_locked', async () => {
    const minted = await mintGatewayKey(OWNER, 'k', deps);
    await revokeGatewayKey(OWNER, minted.id, deps);
    expect(await verifyGatewayKey(minted.key)).toEqual({ ok: false, reason: 'revoked' });

    const m2 = await mintGatewayKey(OWNER, 'k2', deps);
    loadActivation([{ userId: 'u1', active: false }]);
    expect(await verifyGatewayKey(m2.key)).toEqual({ ok: false, reason: 'inactive' });

    loadActivation([]); // owner gone from the cache entirely
    expect(await verifyGatewayKey(m2.key)).toEqual({ ok: false, reason: 'inactive' });

    loadActivation([{ userId: 'u1', active: true, billingLocked: true }]);
    expect(await verifyGatewayKey(m2.key)).toEqual({ ok: false, reason: 'billing_locked' });
  });

  it('stamps lastUsedAt at most once per interval (throttled anomaly surface)', async () => {
    const minted = await mintGatewayKey(OWNER, 'k', deps);
    await verifyGatewayKey(minted.key);
    await new Promise((r) => setTimeout(r, 25)); // let the fire-and-forget write land
    const first = (await gatewayKeys.get(minted.id))!.lastUsedAt;
    expect(first).toBeTruthy();
    await new Promise((r) => setTimeout(r, 10));
    await verifyGatewayKey(minted.key);
    await new Promise((r) => setTimeout(r, 25));
    expect((await gatewayKeys.get(minted.id))!.lastUsedAt).toBe(first); // throttled: no second write
  });
});

describe('revoke + list', () => {
  it('owner-only: a foreign actor gets false (uniform not-found upstream); idempotent on re-revoke', async () => {
    const minted = await mintGatewayKey(OWNER, 'k', deps);
    expect(await revokeGatewayKey({ userId: 'u2', username: 'other', orgId: 'orgA' }, minted.id, deps)).toBe(false);
    expect(await revokeGatewayKey(OWNER, 'no-such-key', deps)).toBe(false);
    expect(await revokeGatewayKey(OWNER, minted.id, deps)).toBe(true);
    expect(await revokeGatewayKey(OWNER, minted.id, deps)).toBe(true); // idempotent
    expect(await activityLogs.find({ type: 'gateway_key_revoked' })).toHaveLength(1); // one row, not two
  });

  it('list returns sanitized rows newest first and never any secret material', async () => {
    const a = await mintGatewayKey(OWNER, 'first', deps);
    const b = await mintGatewayKey(OWNER, 'second', deps);
    await mintGatewayKey({ userId: 'u2', username: 'other', orgId: 'orgA' }, 'foreign', deps);
    const rows = await listGatewayKeys('u1');
    expect(rows.map((r) => r.label)).toEqual(['second', 'first']);
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain(a.key);
    expect(serialized).not.toContain(b.key);
    expect(rows[0]).not.toHaveProperty('key');
  });
});
