import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor, BridgeFrame } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { mintCofreItem, issueGrant } from '../../src/cofre/index.js';
import * as registry from '../../src/bridge/registry.js';
import {
  authoriseDelivery,
  deliverSecrets,
  dropPendingDeliveriesForPairing,
  newInvocationId,
  SecretDeliveryError,
  __resetDeliveriesForTests,
  __pendingDeliveryCount,
  __pendingSweepTimerForTests,
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

/**
 * THE AUTHORISATION EXPIRES ON ITS OWN.
 *
 * A pending entry is not a credential - `deliverSecrets` redeems it before it unwraps anything, so
 * nothing in this map is ever plaintext. It is something else worth bounding: a live, single-use
 * permission to unwrap a Cofre item and put its value on a machine's socket. `PENDING_TTL_MS`
 * exists to bound it, and it did not: `sweep()` was reachable only from `authoriseDelivery`, so an
 * orphaned authorisation expired only if ANOTHER delivery happened to be authorised afterwards. On
 * a quiet fleet that is never, and `deliverSecrets` never looked at `createdAt` at all - so a
 * days-old authorisation redeemed exactly like a fresh one.
 *
 * An orphan is reachable without contriving anything: the redirect refusal below throws BEFORE the
 * redeem, and every failure between authorising and delivering leaves one behind.
 */
describe('an orphaned authorisation expires without a second delivery', () => {
  it('THE SWEEP HAS A TRIGGER: an unredeemed authorisation is dropped on its own timer', async () => {
    vi.useFakeTimers();
    try {
      __resetDeliveriesForTests();
      authoriseDelivery(newInvocationId(), PAIRING);
      expect(__pendingDeliveryCount()).toBe(1);

      // No second `authoriseDelivery`, no delivery, no socket event. Just time passing.
      await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000);

      expect(__pendingDeliveryCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an EXPIRED authorisation cannot be redeemed - no unwrap, no frame', async () => {
    const item = await grantedItem();
    const sent = captureWire();
    const invocationId = newInvocationId();
    const t0 = 1_000_000;
    authoriseDelivery(invocationId, PAIRING, t0);

    await expect(
      deliverSecrets(
        actor,
        { invocationId, pairingId: PAIRING, mapping: { DB_TOKEN: `cofre:${item._id}` } },
        t0 + 5 * 60_000 + 1,
      ),
    ).rejects.toBeInstanceOf(SecretDeliveryError);
    expect(sent).toHaveLength(0);
    expect(__pendingDeliveryCount()).toBe(0);
  });

  it('a REDIRECT refusal leaves nothing behind - it used to leave the authorisation live forever', async () => {
    const item = await grantedItem();
    captureWire();
    const invocationId = newInvocationId();
    authoriseDelivery(invocationId, PAIRING);
    await expect(
      deliverSecrets(actor, { invocationId, pairingId: 'another-machine', mapping: { DB_TOKEN: `cofre:${item._id}` } }),
    ).rejects.toBeInstanceOf(SecretDeliveryError);

    expect(__pendingDeliveryCount()).toBe(0);
  });

  it("a dropped socket drops that machine's authorisations, and only that machine's", () => {
    const mine = newInvocationId();
    const other = newInvocationId();
    authoriseDelivery(mine, PAIRING);
    authoriseDelivery(other, 'another-machine');
    expect(__pendingDeliveryCount()).toBe(2);

    dropPendingDeliveriesForPairing(PAIRING);

    expect(__pendingDeliveryCount()).toBe(1);
  });

  it('THE DROP IS WIRED INTO THE SOCKET, not merely available', async () => {
    // The cases above prove `dropPendingDeliveriesForPairing` works. They say nothing about the
    // bridge server calling it - and a cleanup nobody calls is the exact failure mode the ingress
    // filter's own suite exists to prevent. So this drives a REAL socket and closes it.
    const { createServer } = await import('node:http');
    const { WebSocket: WsClient } = await import('ws');
    const { setActivation } = await import('../../src/data/activation.js');
    const { __resetConfigForTests, loadConfig } = await import('../../src/config.js');
    const { mintBridgeToken } = await import('../../src/bridge/token.js');
    const { attachBridgeServer } = await import('../../src/bridge/server.js');
    const { drainBridgeAudit } = await import('../../src/bridge/audit.js');

    process.env.JWT_SECRET = 'test-jwt-secret';
    __resetConfigForTests();
    loadConfig();
    const server = createServer();
    const handle = attachBridgeServer(server, { resolveUserOrg: async () => 'orgA' });
    await new Promise<void>((r) => server.listen(0, () => r()));
    const port = (server.address() as { port: number }).port;
    try {
      const owner = 'owner-j3-wire';
      const pairing = 'pair-j3-wire';
      setActivation(owner, { active: true, billingLocked: false });
      const { token } = mintBridgeToken({ sub: owner }, pairing);
      const ws = new WsClient(`ws://127.0.0.1:${port}/api/v1/bridge/connect/${pairing}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      ws.on('error', () => undefined);
      await new Promise<void>((r) => ws.on('open', () => r()));

      authoriseDelivery(newInvocationId(), pairing);
      expect(__pendingDeliveryCount()).toBe(1);

      ws.close();
      for (let i = 0; i < 200 && __pendingDeliveryCount() > 0; i++) await new Promise((r) => setTimeout(r, 5));
      expect(__pendingDeliveryCount()).toBe(0);
    } finally {
      await handle.close();
      await new Promise<void>((r) => server.close(() => r()));
      await drainBridgeAudit();
    }
  });

  it('the sweep timer never holds the process open', () => {
    // An unref\'d timer is the only kind this module may schedule: a five-minute handle that keeps
    // Node alive would turn an idle authorisation into a hung shutdown.
    authoriseDelivery(newInvocationId(), PAIRING);
    const timer = __pendingSweepTimerForTests();
    expect(timer).not.toBeNull();
    expect(timer && typeof timer === 'object' && 'hasRef' in timer ? timer.hasRef() : false).toBe(false);
  });
});
