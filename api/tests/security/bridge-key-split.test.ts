import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { bridgePairings } from '../../src/data/stores.js';
import {
  registerPairing,
  getPairingSigningSecret,
  revokePairing,
  attachLiveConnection,
  __resetLiveConnectionsForTests,
} from '../../src/bridge/registry.js';
import { signDelegatedTask, verifyDelegatedTaskSig } from '../../src/bridge/signing.js';
import { delegateToLocal } from '../../src/bridge/delegation.js';
import type { WebSocket } from 'ws';
import type { DelegatedTask } from '@ekoa/shared';

/**
 * SECURITY SUITE — bridge key split, kill switch, and org check (Cofre R-8, R-9, E-1).
 *
 * Delegated tasks were HMAC'd with `loadConfig().jwtSecret` — the platform-wide key that signs every
 * user's session token. Making delegation WORK therefore required copying that key onto every paired
 * laptop, where the daemon stores it in a plaintext `config.json`. One secret signing platform
 * sessions, minting bridge tokens AND keying task HMACs means one compromised laptop compromises
 * every session in the deployment.
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_bridge_keys');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  __resetLiveConnectionsForTests();
  await bridgePairings.deleteMany({});
});

const fakeWs = (): WebSocket => ({ send: () => undefined, close: () => undefined }) as unknown as WebSocket;

const baseTask = (over: Partial<DelegatedTask> = {}): Omit<DelegatedTask, 'sig'> => ({
  taskId: 't1',
  org: 'orgA',
  user: 'u1',
  session: 's1',
  pairingId: 'p1',
  grantRefs: ['g1'],
  task: 'do the thing',
  budget: { egressBytes: 1000, modelSpend: { userId: 'u1' } },
  expiry: '2030-01-01T00:00:00.000Z',
  nonce: 'n1',
  ...over,
});

describe('R-8 — per-pairing signing secrets', () => {
  it('mints a secret per pairing, and two pairings never share one', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    await registerPairing({ pairingId: 'p2', org: 'orgA', ownerUserId: 'u1' });
    const a = await getPairingSigningSecret('p1');
    const b = await getPairingSigningSecret('p2');
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('the secret is NOT the platform JWT secret (the monoculture this replaces)', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    expect(await getPairingSigningSecret('p1')).not.toBe(process.env.JWT_SECRET);
  });

  it('stores the secret ENCRYPTED at rest, never in cleartext', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    const plain = (await getPairingSigningSecret('p1'))!;
    const row = (await bridgePairings.get('p1')) as unknown as { signingSecretCiphertext?: string };
    expect(row.signingSecretCiphertext).toBeTruthy();
    expect(row.signingSecretCiphertext).not.toContain(plain);
    expect(JSON.stringify(row)).not.toContain(plain);
  });

  it('a task signed for one pairing does NOT verify under another pairing key', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    await registerPairing({ pairingId: 'p2', org: 'orgA', ownerUserId: 'u1' });
    const a = (await getPairingSigningSecret('p1'))!;
    const b = (await getPairingSigningSecret('p2'))!;
    const task: DelegatedTask = { ...baseTask(), sig: signDelegatedTask(baseTask(), a) };
    expect(verifyDelegatedTaskSig(task, a)).toBe(true);
    // The blast radius of a stolen daemon config is now ONE machine.
    expect(verifyDelegatedTaskSig(task, b)).toBe(false);
  });

  it('preserves the secret across a redial — rotating would silently break a paired daemon', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    const first = await getPairingSigningSecret('p1');
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    expect(await getPairingSigningSecret('p1')).toBe(first);
  });

  it('yields NO secret for a revoked pairing', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    await revokePairing('p1');
    expect(await getPairingSigningSecret('p1')).toBeNull();
  });

  it('yields no secret across orgs', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    expect(await getPairingSigningSecret('p1', 'orgB')).toBeNull();
    expect(await getPairingSigningSecret('p1', 'orgA')).toBeTruthy();
  });

  it('REFUSES to sign or verify with an empty secret (an empty HMAC key is publicly computable)', () => {
    expect(() => signDelegatedTask(baseTask(), '')).toThrow(/empty signing secret/);
    expect(verifyDelegatedTaskSig({ ...baseTask(), sig: 'deadbeef' }, '')).toBe(false);
  });
});

describe('E-1 — the org is CHECKED at delegation dispatch, not adopted', () => {
  it('refuses a delegation whose actor org differs from the pairing org', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    attachLiveConnection({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1', ws: fakeWs() });
    const res = await delegateToLocal(
      { userId: 'u1', orgId: 'orgB', sessionId: 's1' },
      { task: 't', grantRefs: [], budget: { egressBytes: 100, modelSpend: { userId: 'u1' } } },
      { getActivation: () => ({ active: true, billingLocked: false }), timeoutMs: 50 },
    );
    expect(res.status).toBe('unreachable');
  });
});

describe('R-8 — delegation refuses rather than falling back when a pairing has no secret', () => {
  it('denies (does not sign with anything else) when the pairing secret is missing', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    attachLiveConnection({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1', ws: fakeWs() });
    const res = await delegateToLocal(
      { userId: 'u1', orgId: 'orgA', sessionId: 's1' },
      { task: 't', grantRefs: [], budget: { egressBytes: 100, modelSpend: { userId: 'u1' } } },
      {
        getActivation: () => ({ active: true, billingLocked: false }),
        getPairingSigningSecret: async () => null, // e.g. a pre-R-8 row
        timeoutMs: 50,
      },
    );
    // `denied`, not `unreachable`: the machine is reachable, the binding is not mintable.
    expect(res.status).toBe('denied');
  });
});

describe('R-9 — revocation is terminal and reachable', () => {
  it('revokePairing tombstones the row and a redial never resurrects it', async () => {
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    expect(await revokePairing('p1')).toBe(true);
    await registerPairing({ pairingId: 'p1', org: 'orgA', ownerUserId: 'u1' });
    // Still revoked, and therefore still unable to mint a binding.
    expect(await getPairingSigningSecret('p1')).toBeNull();
  });
});
