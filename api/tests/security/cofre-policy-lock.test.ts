import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  mintCofreItem,
  issueGrant,
  listCofreItems,
  unwrap,
  lockItem,
  lockAll,
  CofreLockedError,
  CofreNotFoundError,
  CredentialOriginError,
} from '../../src/cofre/index.js';

/**
 * SECURITY SUITE — the Cofre policy lock (Cofre WS-B/WS-C; invariants I4, I6, I7).
 *
 * `unwrap()` is the ONE function that turns a reference into a value, and it is fail-closed on four
 * independent grounds: tenancy, an active grant, origin binding, and existence. Every one of those
 * is asserted here, because this seam is what WS-K's KMS envelope and the parked passkey-PRF
 * crypto-lock later install behind — if it can be bypassed, both become repo-wide refactors.
 */
let mem: MongoMemoryServer;

const alice: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
const bob: Actor = { userId: 'bob', orgId: 'orgA', role: 'user' } as Actor;
const otherOrg: Actor = { userId: 'carol', orgId: 'orgB', role: 'org-admin' } as Actor;

const SECRET = 'sk-live-COFRE-TEST-0001';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_cofre');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

const mintPassword = () =>
  mintCofreItem(alice, {
    type: 'password',
    label: 'Citius',
    value: SECRET,
    boundOrigins: ['citius.tribunaisnet.mj.pt'],
  });

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
});

describe('default deny — no grant, no value', () => {
  it('REFUSES an unwrap with no grant at all', async () => {
    const item = await mintPassword();
    await expect(
      unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });

  it('ALLOWS the unwrap once a TTL grant exists', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, '10_minutes');
    const out = await unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' });
    expect(out.value).toBe(SECRET);
  });

  it('REFUSES once the TTL has passed', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, '10_minutes', {}, { now: () => 1_000_000 });
    await expect(
      unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }, { now: () => 1_000_000 + 11 * 60_000 }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });
});

describe('this_run grants are consumed by run identity, not by a clock', () => {
  it('ALLOWS the run it was issued for', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, 'this_run', { runId: 'run-1' });
    const out = await unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }, { runId: 'run-1' });
    expect(out.value).toBe(SECRET);
  });

  it('REFUSES a DIFFERENT run', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, 'this_run', { runId: 'run-1' });
    await expect(
      unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }, { runId: 'run-2' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });

  it('REFUSES when no run id is in context — a run grant cannot apply outside a run', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, 'this_run', { runId: 'run-1' });
    await expect(
      unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });
});

describe('origin binding is enforced INSIDE unwrap (I6)', () => {
  it('REFUSES an off-origin use even with a valid grant', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, '1_day');
    await expect(
      unwrap(item._id, alice, { kind: 'http', origin: 'attacker.example' }),
    ).rejects.toBeInstanceOf(CredentialOriginError);
  });

  it('ALLOWS a subdomain of the bound origin', async () => {
    const item = await mintCofreItem(alice, {
      type: 'password',
      label: 'Stripe',
      value: SECRET,
      boundOrigins: ['stripe.com'],
    });
    await issueGrant(alice, item._id, '1_day');
    const out = await unwrap(item._id, alice, { kind: 'http', origin: 'api.stripe.com' });
    expect(out.value).toBe(SECRET);
  });

  it('REFUSES an item that declares no origin at mint time (fails early, not opaquely forever)', async () => {
    await expect(
      mintCofreItem(alice, { type: 'password', label: 'x', value: SECRET, boundOrigins: [] }),
    ).rejects.toThrow(/bound origin/);
  });
});

describe('tenancy — a credential is owner-scoped, not org-visible', () => {
  it('REFUSES another user in the same org', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, '1_day');
    await expect(
      unwrap(item._id, bob, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });

  it('REFUSES an org-admin from another org', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, '1_day');
    await expect(
      unwrap(item._id, otherOrg, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreNotFoundError);
  });

  it('answers NOT_FOUND (never a distinct "forbidden") so it is not an existence oracle', async () => {
    const item = await mintPassword();
    const missing = unwrap('itm_does_not_exist', alice, { kind: 'http', origin: 'x.test' });
    const foreign = unwrap(item._id, bob, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' });
    await expect(missing).rejects.toBeInstanceOf(CofreNotFoundError);
    await expect(foreign).rejects.toBeInstanceOf(CofreNotFoundError);
  });
});

describe('I4 — nothing is stored in plaintext', () => {
  it('the stored row holds ciphertext only', async () => {
    const item = await mintPassword();
    const { cofreItems } = await import('../../src/cofre/store.js');
    const row = (await cofreItems.raw.get(item._id)) as unknown as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(SECRET);
    expect(String(row.valueCiphertext)).not.toContain(SECRET);
  });

  it('the item VIEW never exposes a value', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, '1_day');
    const view = await listCofreItems(alice);
    expect(JSON.stringify(view)).not.toContain(SECRET);
    expect(view[0]!.ref).toBe(`cofre:${item._id}`);
  });
});

describe('lock-now and lock-all', () => {
  it('lockItem revokes the live grant and the next unwrap refuses', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, 'until_locked');
    expect((await unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' })).value).toBe(SECRET);
    expect(await lockItem(alice, item._id)).toBe(1);
    await expect(
      unwrap(item._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });

  it('lockItem is idempotent', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, 'until_locked');
    expect(await lockItem(alice, item._id)).toBe(1);
    expect(await lockItem(alice, item._id)).toBe(0);
  });

  it('lockAll revokes every live grant the actor holds', async () => {
    const a = await mintPassword();
    const b = await mintCofreItem(alice, { type: 'api_key', label: 'k', value: 'v2345', boundOrigins: ['x.test'] });
    await issueGrant(alice, a._id, 'until_locked');
    await issueGrant(alice, b._id, '1_day');
    expect(await lockAll(alice)).toBe(2);
    await expect(unwrap(a._id, alice, { kind: 'http', origin: 'citius.tribunaisnet.mj.pt' })).rejects.toThrow();
    await expect(unwrap(b._id, alice, { kind: 'http', origin: 'x.test' })).rejects.toThrow();
  });

  it("lockAll does not touch another user's grants", async () => {
    const mine = await mintPassword();
    const theirs = await mintCofreItem(bob, { type: 'api_key', label: 'k', value: 'v3456', boundOrigins: ['y.test'] });
    await issueGrant(alice, mine._id, 'until_locked');
    await issueGrant(bob, theirs._id, 'until_locked');
    await lockAll(alice);
    expect((await unwrap(theirs._id, bob, { kind: 'http', origin: 'y.test' })).value).toBe('v3456');
  });
});

describe('I7 — a signature identity can only ever be granted for one run', () => {
  const mintIdentity = () =>
    mintCofreItem(alice, {
      type: 'certificate_identity',
      label: 'Cartão OA (escritório)',
      value: 'pointer-only',
      identityPointer: 'cartão OA no computador do escritório',
    });

  it.each(['10_minutes', '40_minutes', '1_day', '1_week', '1_month', 'until_locked'] as const)(
    'REFUSES a %s grant',
    async (duration) => {
      const item = await mintIdentity();
      await expect(issueGrant(alice, item._id, duration)).rejects.toThrow(/I7/);
    },
  );

  it('ALLOWS a this_run grant', async () => {
    const item = await mintIdentity();
    await expect(issueGrant(alice, item._id, 'this_run', { runId: 'run-1' })).resolves.toBeTruthy();
  });

  it('needs no bound origin — the credential never leaves the card', async () => {
    await expect(mintIdentity()).resolves.toBeTruthy();
  });
});

describe('item state as the UI renders it', () => {
  it('is locked with no grant, unlocked with a TTL, and amber for until-locked', async () => {
    const item = await mintPassword();
    expect((await listCofreItems(alice))[0]!.state).toBe('locked');

    await issueGrant(alice, item._id, '10_minutes');
    const ttlView = (await listCofreItems(alice))[0]!;
    expect(ttlView.state).toBe('unlocked');
    expect(ttlView.unlockedUntil).toBeTruthy();

    await lockItem(alice, item._id);
    await issueGrant(alice, item._id, 'until_locked');
    const amber = (await listCofreItems(alice))[0]!;
    expect(amber.state).toBe('unlocked_until_locked');
    // The indefinite state carries NO countdown — it must not look like a timed unlock.
    expect(amber.unlockedUntil).toBeUndefined();
  });

  it('a this_run grant does not present as a standing unlock', async () => {
    const item = await mintPassword();
    await issueGrant(alice, item._id, 'this_run', { runId: 'run-1' });
    expect((await listCofreItems(alice))[0]!.state).toBe('locked');
  });
});
