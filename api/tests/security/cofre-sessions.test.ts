import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  captureSessionToCofre,
  originsFromStorageState,
  sessionIsExpired,
  issueGrant,
  unwrap,
  listCofreItems,
  CofreLockedError,
} from '../../src/cofre/index.js';

/**
 * SECURITY SUITE — session items (Cofre WS-G).
 *
 * A captured storageState walks past the password AND the MFA prompt, so it is
 * CREDENTIAL-EQUIVALENT and I1-I4 apply to it exactly as to a password. Before this, the product
 * answered `available:false` for capture while a shipped CITIUS asset promised the user the session
 * would be "guardada cifrada" — both true, and the combination was the finding.
 */
let mem: MongoMemoryServer;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;

const STORAGE = {
  cookies: [
    { name: 'sid', value: 'SESSION-SECRET-VALUE', domain: '.citius.tribunaisnet.mj.pt', path: '/' },
    { name: 'x', value: 'y', domain: 'portal.oa.pt', path: '/' },
  ],
  origins: [{ origin: 'https://citius.tribunaisnet.mj.pt', localStorage: [] }],
};

const metadata: SessionMetadata = {
  establishedBy: { kind: 'machine', pairingId: 'p1' },
  boundEgress: { kind: 'residential', pairingId: 'p1' },
  establishedAt: '2026-07-28T00:00:00.000Z',
  healthy: true,
};

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_cofre_sessions');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
});

const capture = () =>
  captureSessionToCofre(actor, {
    label: 'Citius',
    boundOrigins: originsFromStorageState(STORAGE),
    storageState: STORAGE,
    metadata,
  });

describe('a captured session is a Cofre item, with everything that implies', () => {
  it('stores the blob as ciphertext — never in the clear', async () => {
    const item = await capture();
    const { cofreItems } = await import('../../src/cofre/store.js');
    const row = (await cofreItems.raw.get(item._id)) as unknown as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain('SESSION-SECRET-VALUE');
  });

  it('is LOCKED by default — a capture does not grant use', async () => {
    const item = await capture();
    await expect(
      unwrap(item._id, actor, { kind: 'browser', origin: 'citius.tribunaisnet.mj.pt' }),
    ).rejects.toBeInstanceOf(CofreLockedError);
  });

  it('unwraps to the original blob once granted', async () => {
    const item = await capture();
    await issueGrant(actor, item._id, '1_day');
    const out = await unwrap(item._id, actor, { kind: 'browser', origin: 'citius.tribunaisnet.mj.pt' });
    expect(JSON.parse(out.value)).toEqual(STORAGE);
  });

  it('is origin-bound — it cannot be replayed against another host', async () => {
    const item = await capture();
    await issueGrant(actor, item._id, '1_day');
    await expect(unwrap(item._id, actor, { kind: 'browser', origin: 'attacker.example' })).rejects.toThrow();
  });

  it('never exposes the blob in the item VIEW', async () => {
    await capture();
    const view = await listCofreItems(actor);
    expect(JSON.stringify(view)).not.toContain('SESSION-SECRET-VALUE');
    expect(view[0]!.type).toBe('session');
    expect(view[0]!.expiresAt).toBeTruthy();
  });
});

describe('origins are DERIVED from the cookies, not guessed by the caller', () => {
  it('takes every cookie domain and origin host, stripping the leading dot', () => {
    expect(originsFromStorageState(STORAGE).sort()).toEqual(
      ['citius.tribunaisnet.mj.pt', 'portal.oa.pt'].sort(),
    );
  });

  it('skips an unparseable origin rather than binding to it', () => {
    expect(originsFromStorageState({ origins: [{ origin: 'not a url' }] })).toEqual([]);
  });

  it('REFUSES a capture that would be replayable anywhere', async () => {
    await expect(
      captureSessionToCofre(actor, { label: 'x', boundOrigins: [], storageState: {}, metadata }),
    ).rejects.toThrow(/origins it may be replayed against/);
  });
});

describe('expiry drives re-establishment', () => {
  it('reports an expired session', () => {
    expect(sessionIsExpired({ expiresAt: '2020-01-01T00:00:00.000Z' })).toBe(true);
    expect(sessionIsExpired({ expiresAt: '2999-01-01T00:00:00.000Z' })).toBe(false);
    expect(sessionIsExpired({})).toBe(false);
  });

  it('stamps an expiry at capture', async () => {
    const item = await capture();
    expect(item.expiresAt).toBeTruthy();
  });
});
