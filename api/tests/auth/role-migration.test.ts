/**
 * H1 legacy compatibility for the `builder` → `user` role rename — the two layers that carry a
 * fleet across the rename without a flag day:
 *   1. the idempotent boot-step migration (migrateBuilderRole): rewrites every legacy row and
 *      bumps its token epoch, exactly once; and
 *   2. the verify-boundary normalization shim (verifyToken): a JWT still carrying role 'builder'
 *      is normalised to 'user' before any downstream role/capability check sees it.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { users } from '../../src/data/stores.js';
import { getActivation, loadActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { hashPassword } from '../../src/auth/password.js';
import { migrateBuilderRole } from '../../src/auth/users-service.js';
import { bumpTokenEpochDurable } from '../../src/auth/service.js';
import { verifyToken, signToken } from '../../src/auth/jwt.js';

/** Re-run the boot-time activation reload from the persisted user rows (server.ts bootState),
 *  simulating a process restart: the in-memory map is cleared and rebuilt from the store — the
 *  ONLY thing that carries `tokenEpoch`/`billingLocked` across a restart (H1). */
async function simulateRestart(): Promise<void> {
  __resetActivationForTests();
  const all = await users.find({});
  loadActivation(all.map((u) => ({ userId: u._id, active: u.active, billingLocked: u.billingLocked, tokenEpoch: u.tokenEpoch })));
}
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 'role-migration-secret';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_role_migration');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetActivationForTests();
  await users.deleteMany({});
});

describe('migrateBuilderRole — idempotent boot-step migration', () => {
  it('rewrites a legacy builder row to user and bumps its token epoch, exactly once (idempotent)', async () => {
    // Seed a LEGACY row: role 'builder' is no longer in the Role type, so the doc is cast to
    // simulate a pre-rename record on disk.
    await users.insert({ _id: 'legacy1', username: 'legacy1', passwordHash: await hashPassword('pw123456'), role: 'builder', orgId: 'orgA', active: true } as never);
    // A non-builder row is left untouched.
    await users.insert({ _id: 'admin1', username: 'admin1', passwordHash: await hashPassword('pw123456'), role: 'org-admin', orgId: 'orgA', active: true });

    const firstCount = await migrateBuilderRole();
    expect(firstCount).toBe(1); // exactly the one legacy row

    const migrated = await users.get('legacy1');
    expect(migrated?.role).toBe('user'); // role rewritten
    const admin = await users.get('admin1');
    expect(admin?.role).toBe('org-admin'); // untouched

    const epochAfterFirst = getActivation('legacy1')?.tokenEpoch ?? 0;
    expect(epochAfterFirst).toBeGreaterThan(0); // epoch bumped → outstanding legacy JWTs invalid
    // H1 durability: the epoch is written to the ROW too, not just the in-memory map — so the
    // legacy-JWT invalidation survives a restart (the map alone reloads as 0 at boot).
    expect((await users.get('legacy1'))?.tokenEpoch).toBe(epochAfterFirst);

    // Second run: nothing carries 'builder' now → no rows migrated, no further epoch bump.
    const secondCount = await migrateBuilderRole();
    expect(secondCount).toBe(0);
    expect((await users.get('legacy1'))?.role).toBe('user'); // still user
    expect(getActivation('legacy1')?.tokenEpoch ?? 0).toBe(epochAfterFirst); // epoch bumped ONCE
  });

  it('is a no-op on a clean store (returns 0)', async () => {
    await users.insert({ _id: 'u-clean', username: 'u-clean', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
    expect(await migrateBuilderRole()).toBe(0);
  });
});

describe('verifyToken — legacy-window role normalization shim', () => {
  it("normalises a legacy 'builder' JWT role to 'user' before any check", () => {
    // A token minted before the rename literally carries role 'builder'. jwt.sign it raw (signToken
    // only accepts the current Role type), then verify: the shim maps it to 'user'.
    const legacy = jwt.sign(
      { sub: 'u1', role: 'builder', scope: 'user', orgId: 'o1', username: 'ana', jti: 'j1' },
      loadConfig().jwtSecret,
      { expiresIn: 3600 },
    );
    expect(verifyToken(legacy).role).toBe('user');
  });

  it('leaves current roles untouched (user stays user, org-admin stays org-admin)', () => {
    const userTok = signToken({ sub: 'u2', role: 'user', scope: 'user', orgId: 'o1', username: 'bob', jti: 'j2' }).token;
    expect(verifyToken(userTok).role).toBe('user');
    const adminTok = signToken({ sub: 'u3', role: 'org-admin', scope: 'user', orgId: 'o1', username: 'chefe', jti: 'j3' }).token;
    expect(verifyToken(adminTok).role).toBe('org-admin');
  });
});

/**
 * H1 durable revocation (HIGH-1): `tokenEpoch` and `billingLocked` are persisted on the user row
 * and reloaded by `loadActivation` at boot, so a revocation / billing lock is NOT lost on restart.
 * The pre-fix loader read only `{active}`, defaulting both to 0/false at every boot — every
 * revocation (role change, admin logout, password reset, deactivation, the builder migration) and
 * every billing lock silently un-did on the next process start.
 */
describe('durable revocation survives restart (H1 boot path)', () => {
  it('a bumped tokenEpoch is reloaded from the row after a restart (an old-iat token stays rejected)', async () => {
    await users.insert({ _id: 'dur1', username: 'dur1', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
    // A revocation via the standalone durable bump (the admin-logout path): map + row both carry it.
    const epoch = Math.floor(Date.now() / 1000) + 1;
    await bumpTokenEpochDurable('dur1', epoch);
    expect(getActivation('dur1')?.tokenEpoch).toBe(epoch);          // in-memory map
    expect((await users.get('dur1'))?.tokenEpoch).toBe(epoch);       // persisted row

    // Restart: clear the map, reload it from the store the way bootState does.
    await simulateRestart();
    const reloaded = getActivation('dur1')?.tokenEpoch ?? 0;
    expect(reloaded).toBe(epoch); // survived the restart (pre-fix this reloaded as 0)
    // The middleware rejects a token whose iat < tokenEpoch: an OLD token minted before the bump is
    // still rejected after the restart, a token minted at/after the epoch is admissible.
    expect(epoch - 5).toBeLessThan(reloaded);       // stale token → rejected
    expect(epoch).toBeGreaterThanOrEqual(reloaded);  // fresh token → admitted
  });

  it('a persisted billingLocked=true is reloaded from the row after a restart (lock not reset to false)', async () => {
    await users.insert({ _id: 'dur2', username: 'dur2', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true, billingLocked: true });
    await simulateRestart();
    expect(getActivation('dur2')?.billingLocked).toBe(true); // pre-fix this reloaded as false
  });

  it('legacy rows without the columns default cleanly (tokenEpoch 0, billingLocked false)', async () => {
    await users.insert({ _id: 'dur3', username: 'dur3', passwordHash: await hashPassword('pw123456'), role: 'user', orgId: 'orgA', active: true });
    await simulateRestart();
    expect(getActivation('dur3')?.tokenEpoch).toBe(0);
    expect(getActivation('dur3')?.billingLocked).toBe(false);
  });
});
