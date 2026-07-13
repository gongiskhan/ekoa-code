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
import { getActivation, __resetActivationForTests } from '../../src/data/activation.js';
import { hashPassword } from '../../src/auth/password.js';
import { migrateBuilderRole } from '../../src/auth/users-service.js';
import { verifyToken, signToken } from '../../src/auth/jwt.js';
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
