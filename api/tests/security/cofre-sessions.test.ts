import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import {
  captureSessionToCofre,
  boundOriginsForEstablishedHost,
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

describe('binding covers the login\'s OWN auth family, not the whole jar (multi-domain logins)', () => {
  // Uber Eats authenticates across two registrable domains: the app session on `.ubereats.com` and
  // the SSO session on `.uber.com`. A real jar also carries analytics cookies (`_ga`), JS-set and so
  // never httpOnly. This is the shape that broke: a session bound to `www.ubereats.com` alone re-hit
  // the login wall the moment a step resolved to `auth.uber.com`.
  const UBER_JAR = {
    cookies: [
      { name: 'sid', value: 'app-session', domain: '.ubereats.com', path: '/', httpOnly: true },
      { name: 'sso', value: 'idp-session', domain: '.uber.com', path: '/', httpOnly: true },
      { name: '_ga', value: 'GA1.2.tracking', domain: '.google-analytics.com', path: '/', httpOnly: false },
    ],
    origins: [],
  };

  it('binds to every domain the SERVER set an httpOnly session cookie on', () => {
    expect(boundOriginsForEstablishedHost(UBER_JAR, 'www.ubereats.com').sort()).toEqual(
      ['uber.com', 'ubereats.com'].sort(),
    );
  });

  it('never binds to an analytics domain — its cookie is not httpOnly', () => {
    expect(boundOriginsForEstablishedHost(UBER_JAR, 'www.ubereats.com')).not.toContain('google-analytics.com');
  });

  it('makes the session discoverable across the family it was bound to', async () => {
    const { findSessionItemsForOrigin } = await import('../../src/cofre/index.js');
    const item = await captureSessionToCofre(actor, {
      label: 'Uber Eats',
      boundOrigins: boundOriginsForEstablishedHost(UBER_JAR, 'www.ubereats.com'),
      storageState: UBER_JAR,
      metadata,
    });
    // The SSO redirect host, a different registrable domain than the one established against.
    const found = await findSessionItemsForOrigin(actor, 'auth.uber.com');
    expect(found.map((i) => i._id)).toContain(item._id);
    await issueGrant(actor, item._id, '1_day');
    await expect(unwrap(item._id, actor, { kind: 'browser', origin: 'https://auth.uber.com' })).resolves.toBeDefined();
    // ...but still NOT under the analytics domain the login merely touched.
    expect((await findSessionItemsForOrigin(actor, 'www.google-analytics.com')).map((i) => i._id)).not.toContain(
      item._id,
    );
  });

  it('collapses a specific established host into the parent domain that covers it', () => {
    // Established against `auth.uber.com`, cookie scoped to `.uber.com`: the broad binding subsumes
    // the specific host, so the result is the single `uber.com`.
    expect(
      boundOriginsForEstablishedHost(
        { cookies: [{ name: 'sso', value: 'x', domain: '.uber.com', path: '/', httpOnly: true }], origins: [] },
        'auth.uber.com',
      ),
    ).toEqual(['uber.com']);
  });

  it('falls back to the established host when the login left no httpOnly cookie', () => {
    // A jar whose only cookie is JS-set (no httpOnly) still binds to the host it covers, so a
    // single-domain SPA login is not left unbindable — it just does not widen.
    expect(
      boundOriginsForEstablishedHost(
        { cookies: [{ name: 'token', value: 'x', domain: 'app.example', path: '/', httpOnly: false }], origins: [] },
        'app.example',
      ),
    ).toEqual(['app.example']);
  });

  it('still refuses when the jar covers no cookie for the host at all', () => {
    expect(boundOriginsForEstablishedHost(UBER_JAR, 'unrelated.example')).toEqual([]);
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
