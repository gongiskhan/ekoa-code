import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { WebSocket } from 'ws';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import {
  registerPairing,
  getPairingById,
  attachLiveConnection,
  getConnectionByOwner,
  getLiveConnection,
  isLive,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';

/**
 * Org-scoped pairing registry (ch18 §18.3.4, §18.5 S2). Resolution can never return a pairing from
 * another org; getConnectionByOwner returns the most-recently-registered LIVE connection (multi-
 * device aware). The live-socket map is exercised with fake sockets (resolution never calls ws).
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_bridge_registry_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetLiveConnectionsForTests();
  await bridgePairings.deleteMany({});
});

/** A minimal stand-in socket — resolution reads identity only, never touches the ws. */
function fakeWs(): WebSocket {
  return { send: () => undefined, close: () => undefined } as unknown as WebSocket;
}

describe('durable rows (§18.3.4)', () => {
  it('registers a row carrying pairingId, org, owner, createdAt, revokedAt=null', async () => {
    const row = await registerPairing({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A' });
    expect(row.org).toBe('org-A');
    expect(row.ownerUserId).toBe('owner-A');
    expect(row.revokedAt).toBeNull();
    expect(typeof row.createdAt).toBe('string');
    const read = await getPairingById('p1');
    expect(read?.org).toBe('org-A');
  });

  it('resolution never crosses org: each pairing resolves to its OWN org', async () => {
    await registerPairing({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A' });
    await registerPairing({ pairingId: 'p2', org: 'org-B', ownerUserId: 'owner-B' });
    expect((await getPairingById('p1'))?.org).toBe('org-A');
    expect((await getPairingById('p2'))?.org).toBe('org-B');
  });

  it('redial preserves createdAt and clears any revocation', async () => {
    const first = await registerPairing({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A' }, { now: () => 1000 });
    await bridgePairings.update('p1', (cur) => ({ ...cur, revokedAt: 'someday' }));
    const again = await registerPairing({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A' }, { now: () => 9999 });
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.revokedAt).toBeNull();
  });
});

describe('live-connection resolution (§18.3.4)', () => {
  it('getConnectionByOwner returns only the owner’s connection, never another org’s', () => {
    attachLiveConnection({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A', ws: fakeWs() });
    attachLiveConnection({ pairingId: 'p2', org: 'org-B', ownerUserId: 'owner-B', ws: fakeWs() });

    const a = getConnectionByOwner('owner-A');
    expect(a?.pairingId).toBe('p1');
    expect(a?.org).toBe('org-A');

    const b = getConnectionByOwner('owner-B');
    expect(b?.pairingId).toBe('p2');
    expect(b?.org).toBe('org-B');

    expect(getConnectionByOwner('owner-C')).toBeUndefined();
  });

  it('is multi-device aware: returns the most-recently-registered live connection', () => {
    attachLiveConnection({ pairingId: 'laptop', org: 'org-A', ownerUserId: 'owner-A', ws: fakeWs() });
    attachLiveConnection({ pairingId: 'desktop', org: 'org-A', ownerUserId: 'owner-A', ws: fakeWs() });
    expect(getConnectionByOwner('owner-A')?.pairingId).toBe('desktop');
  });

  it('redial on the same pairingId retires the stale socket', () => {
    const stale = fakeWs();
    let closed = false;
    (stale as unknown as { close: () => void }).close = () => {
      closed = true;
    };
    attachLiveConnection({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A', ws: stale });
    const fresh = fakeWs();
    attachLiveConnection({ pairingId: 'p1', org: 'org-A', ownerUserId: 'owner-A', ws: fresh });
    expect(closed).toBe(true);
    expect(getLiveConnection('p1')?.ws).toBe(fresh);
    expect(isLive('p1')).toBe(true);
  });
});
