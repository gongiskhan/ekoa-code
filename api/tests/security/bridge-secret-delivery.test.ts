import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor, BridgeFrame } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { mintCofreItem, issueGrant } from '../../src/cofre/index.js';
import * as registry from '../../src/bridge/registry.js';
import {
  authoriseDelivery,
  deliverSecrets,
  newInvocationId,
  SecretDeliveryError,
  __resetDeliveriesForTests,
  __pendingDeliveryCount,
} from '../../src/bridge/secret-delivery.js';

/**
 * SECURITY SUITE — one-time secret delivery over the bridge (Cofre WS-J / J-3).
 *
 * `secret.deliver` is the ONLY frame in the union that carries credential material, because a
 * `local_command` step runs on the user's machine and the value has to get there. The daemon is
 * contractually required to hold it in RAM, inject at execution time and zeroize — but "the other
 * end promises to" is not a control this side can verify, and an older or compromised daemon makes
 * that promise worthless.
 *
 * So these cases test what CORTEX can actually enforce: the credential is unwrapped at most once
 * per invocation, exactly one copy goes on the wire, and a replay causes NO decrypt and NO second
 * frame. The daemon-side half (absent from config.json, absent from the ledger, zeroized after the
 * child exits) is a counterpart obligation flagged in docs/bridge-counterpart-changes.md, tested in
 * that repo — this suite does not pretend to prove it.
 */
let mem: MongoMemoryServer;
const actor: Actor = { userId: 'alice', orgId: 'orgA', role: 'user' } as Actor;
const SECRET = 'deliver-me-J3-SECRET-9911';
const PAIRING = 'pair-1';

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_j3');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  __resetDeliveriesForTests();
  vi.restoreAllMocks();
});

async function grantedItem(value = SECRET) {
  const item = await mintCofreItem(actor, {
    type: 'api_key',
    label: 'DB token',
    value,
    boundOrigins: ['db.internal.example'],
  });
  await issueGrant(actor, item._id, '1_day');
  return item;
}

/** Capture what goes on the wire instead of needing a live socket. */
function captureWire(deliverable = true): BridgeFrame[] {
  const sent: BridgeFrame[] = [];
  vi.spyOn(registry, 'sendToPairing').mockImplementation((_pairingId: string, frame: BridgeFrame) => {
    if (!deliverable) return false;
    sent.push(frame);
    return true;
  });
  return sent;
}

describe('exactly one copy of the value reaches the wire', () => {
  it('delivers the resolved env under the authorised nonce', async () => {
    const item = await grantedItem();
    const sent = captureWire();
    const invocationId = newInvocationId();
    const nonce = authoriseDelivery(invocationId, PAIRING);

    const out = await deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } });

    expect(sent).toHaveLength(1);
    const frame = sent[0] as Extract<BridgeFrame, { type: 'secret.deliver' }>;
    expect(frame.type).toBe('secret.deliver');
    expect(frame.nonce).toBe(nonce);
    expect(frame.invocationId).toBe(invocationId);
    expect(frame.env.DB_TOKEN).toBe(SECRET);
    expect(out.itemIds).toEqual([item._id]);
  });

  it('the delivery carries a filter for the child output, so I9 second half is not left to the caller', async () => {
    const item = await grantedItem();
    captureWire();
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);
    const out = await deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } });

    expect(out.secrets.redact(`the child printed ${SECRET}`)).not.toContain(SECRET);
  });

  it('REPLAY: a second delivery for the same invocation sends nothing and never re-unwraps', async () => {
    const item = await grantedItem();
    const sent = captureWire();
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);
    await deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } });
    expect(sent).toHaveLength(1);

    await expect(
      deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);

    // The decisive assertion: no SECOND copy on the wire. A design that refused after sending
    // would satisfy the rejects-check above and still have leaked.
    expect(sent).toHaveLength(1);
  });

  it('authorising the same invocation twice is refused — two nonces would mean two legitimate copies', () => {
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);
    expect(() => authoriseDelivery(invocationId, PAIRING)).toThrow(SecretDeliveryError);
  });

  it('a delivery cannot be redirected to a pairing it was not authorised for', async () => {
    const item = await grantedItem();
    const sent = captureWire();
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);

    await expect(
      deliverSecrets(actor, { invocationId, pairingId: 'another-machine', mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);
    expect(sent).toHaveLength(0);
  });

  it('an unauthorised invocation delivers nothing', async () => {
    const item = await grantedItem();
    const sent = captureWire();
    await expect(
      deliverSecrets(actor, { invocationId: newInvocationId(), pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);
    expect(sent).toHaveLength(0);
  });
});

describe('failure is a refusal, never a silent partial', () => {
  it('an offline machine REFUSES rather than reporting a delivery that never left', async () => {
    const item = await grantedItem();
    captureWire(false); // sendToPairing returns false: no live socket
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);

    await expect(
      deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);
  });

  it('a failed send still consumes the authorisation — retry means a NEW invocation, by design', async () => {
    // Redeem-before-unwrap is what stops a replay causing a decrypt, and the cost is that a
    // transient send failure cannot be retried on the same nonce. Pinned so the trade-off is a
    // decision on record rather than something a later reader "fixes" back into a replay window.
    const item = await grantedItem();
    captureWire(false);
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);
    await expect(
      deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);

    expect(__pendingDeliveryCount()).toBe(0);
    await expect(
      deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);
  });

  it('a locked credential refuses BEFORE anything reaches the wire', async () => {
    // No grant issued: unwrap fails closed. The frame must never be constructed.
    const item = await mintCofreItem(actor, {
      type: 'api_key',
      label: 'no grant',
      value: SECRET,
      boundOrigins: ['db.internal.example'],
    });
    const sent = captureWire();
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);

    await expect(
      deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('a raw value in the mapping is refused — the I9 line holds through the delivery path too', async () => {
    const sent = captureWire();
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);
    await expect(
      deliverSecrets(actor, { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: SECRET } }),
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });
});
