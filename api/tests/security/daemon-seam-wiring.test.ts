import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { Actor, BridgeFrame } from '@ekoa/shared';
import type { WebSocket } from 'ws';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { orgs, bridgeCapabilityGrants } from '../../src/data/stores.js';
import { grantCapability, revokeCapability, isCapabilityGranted } from '../../src/bridge/capability-grants.js';
import * as registry from '../../src/bridge/registry.js';
import { attachLiveConnection, __resetLiveConnectionsForTests } from '../../src/bridge/registry.js';
import {
  invokeTool,
  resolveToolResult,
  failInvocationsForPairing,
  ToolInvocationRefused,
  __resetInvocationsForTests,
  __pendingInvocationCount,
} from '../../src/bridge/tool-invocation.js';
import { createDaemonStepConnection } from '../../src/bridge/daemon-step-seam.js';
import { deliverSession } from '../../src/bridge/session-delivery.js';
import {
  authoriseDelivery,
  deliverSecrets,
  newInvocationId,
  __resetDeliveriesForTests,
  __pendingDeliveryCount,
} from '../../src/bridge/secret-delivery.js';
import { __resetIngressRedactionForTests } from '../../src/bridge/ingress-redaction.js';
import { mintCofreItem, issueGrant } from '../../src/cofre/index.js';

/**
 * SECURITY SUITE — the daemon seam is wired, and wiring it grants nothing (Cofre J-1 wiring).
 *
 * THE PLAN CALLS THIS "the single most dangerous ordering mistake available", and it is right: the
 * moment `setDaemonConnectionResolver` is wired, `local_command` and daemon-driven browser steps
 * become reachable end to end, and every latent I5/I9 defect in that path goes live. Its gate was
 * H-1, H-4, J-4 and J-7, all of which are now in.
 *
 * THE PROPERTY THIS SUITE EXISTS FOR. Wiring the seam must not, by itself, authorise anything. A
 * fleet with no capability grants stays exactly as inert as it was before the resolver existed —
 * the difference is that granting one now works. That is what makes the ordering safe rather than
 * merely sequenced: the dangerous step is gated by a control that is checked per invocation, not by
 * the fact that nobody had written the line yet.
 */
let mem: MongoMemoryServer;
const ORG = 'orgA';
const OWNER = 'owner-1';
const PAIRING = 'p1';

const fakeWs = () => ({ send() {}, close() {}, terminate() {} }) as unknown as WebSocket;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_seam');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  const { cofreItems, cofreGrants } = await import('../../src/cofre/store.js');
  await orgs.deleteMany({});
  await bridgeCapabilityGrants.deleteMany({});
  await cofreItems.raw.deleteMany({});
  await cofreGrants.raw.deleteMany({});
  await orgs.insert({ _id: ORG, name: 'Org A' } as never);
  __resetLiveConnectionsForTests();
  __resetInvocationsForTests();
  __resetDeliveriesForTests();
  __resetIngressRedactionForTests();
  vi.restoreAllMocks();
});

/** Capture what goes on the wire and let a test answer as the daemon would. */
function wire(answer?: (frame: BridgeFrame) => void) {
  const sent: BridgeFrame[] = [];
  vi.spyOn(registry, 'sendToPairing').mockImplementation((_p: string, frame: BridgeFrame) => {
    sent.push(frame);
    answer?.(frame);
    return true;
  });
  return sent;
}

function connect() {
  attachLiveConnection({ pairingId: PAIRING, org: ORG, ownerUserId: OWNER, ws: fakeWs() });
}

describe('wiring the seam grants NOTHING on its own', () => {
  it('an UNGRANTED capability is refused before a frame is sent', async () => {
    connect();
    const sent = wire();
    await expect(
      invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {} }),
    ).rejects.toBeInstanceOf(ToolInvocationRefused);
    // The decisive part: nothing reached the machine. A refusal after dispatch would already have
    // asked a user's computer to run something.
    expect(sent).toHaveLength(0);
  });

  it('a granted capability dispatches and resolves', async () => {
    connect();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    const sent = wire((frame) => {
      if (frame.type === 'tool.invoke') resolveToolResult(frame.invocationId, { ok: true, output: { exitCode: 0 } });
    });

    const res = await invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: { argv: ['ls'] } });
    expect(res.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe('tool.invoke');
  });

  it('THE MID-RUN CASE: revoking a grant stops the NEXT invocation', async () => {
    // The grant is re-read per invocation on purpose. A check done once at placement would let the
    // rest of a run continue on an authorisation that no longer exists.
    connect();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    wire((frame) => {
      if (frame.type === 'tool.invoke') resolveToolResult(frame.invocationId, { ok: true });
    });
    expect((await invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {} })).ok).toBe(true);

    await revokeCapability(ORG, PAIRING, 'local.bash');
    await expect(
      invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {} }),
    ).rejects.toBeInstanceOf(ToolInvocationRefused);
  });

  it('a grant in ANOTHER org does not authorise this one', async () => {
    connect();
    await grantCapability({ orgId: 'orgB', pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'other' });
    await expect(
      invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {} }),
    ).rejects.toBeInstanceOf(ToolInvocationRefused);
  });
});

describe('an invocation always settles — a run never hangs on a machine', () => {
  it('an unreachable machine fails cleanly instead of waiting', async () => {
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    vi.spyOn(registry, 'sendToPairing').mockImplementation(() => false); // offline
    const res = await invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not reachable/i);
    expect(__pendingInvocationCount()).toBe(0);
  });

  it('a timeout settles rather than hanging forever', async () => {
    connect();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    wire(); // the daemon never answers
    const res = await invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {}, timeoutMs: 40 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/did not answer/i);
  });

  it('a DISCONNECT fails every in-flight invocation for that pairing', async () => {
    connect();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    wire(); // no answer — leave it in flight
    const inflight = invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {}, timeoutMs: 30_000 });
    // invokeTool awaits the capability grant BEFORE registering the pending entry, so poll for it
    // rather than reading the count on the next tick — a fixed tick would be a race dressed up as
    // an assertion.
    for (let i = 0; i < 100 && __pendingInvocationCount() === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(__pendingInvocationCount()).toBe(1);

    failInvocationsForPairing(PAIRING);
    const res = await inflight;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disconnected/i);
  });

  it('a LATE result for a settled invocation is dropped, never resolved twice', async () => {
    connect();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    let captured = '';
    wire((frame) => {
      if (frame.type === 'tool.invoke') captured = frame.invocationId;
    });
    const res = await invokeTool({ pairingId: PAIRING, orgId: ORG, capability: 'local.bash', payload: {}, timeoutMs: 30 });
    expect(res.ok).toBe(false); // timed out

    // The daemon answers after the timeout. Must be a no-op, not a second settle.
    expect(() => resolveToolResult(captured, { ok: true })).not.toThrow();
    expect(__pendingInvocationCount()).toBe(0);
  });
});

/**
 * THE SAME PROPERTY, FOR THE CREDENTIAL - through the REAL seam the composition root wires.
 *
 * The cases above prove `invokeTool` refuses before a frame is sent. They say nothing about what
 * `bridge/daemon-step-seam.ts` does BEFORE it calls `invokeTool`, and that turned out to be
 * everything that matters: `authoriseDelivery` -> `deliverSecrets` ran first, so an ungranted
 * machine got the nonce redeemed, the Cofre item unwrapped through `unwrap()`, the plaintext put on
 * its socket and a Registo "use" row written - and was refused only afterwards. The daemon then held
 * that plaintext in RAM for the delivery TTL. "Nothing reached the machine" has to mean the
 * credential too.
 *
 * So this block wires the seam with the REAL collaborators (`isCapabilityGranted`, the real
 * delivery pair, the real `invokeTool`), against a REAL Cofre item, and asserts on the frames that
 * actually reach the wire.
 */
describe('an ungranted machine never receives a DECRYPTED CREDENTIAL either', () => {
  const actor: Actor = { userId: OWNER, orgId: ORG, role: 'user' } as Actor;
  const SECRET = 'cofre-value-P1-SEAM-7731';

  /** Exactly the dependencies `server.ts` supplies at the composition root - the REAL ones, the
   *  S-inject session channel included, so what these cases observe is what production does. */
  function seam() {
    return createDaemonStepConnection(
      { pairingId: PAIRING, org: ORG },
      {
        isCapabilityGranted,
        invoke: (input) => invokeTool(input),
        newInvocationId,
        authoriseDelivery,
        deliverSecrets: (a, i) => deliverSecrets(a, i),
        deliverSession,
      },
    );
  }

  async function grantedItem() {
    const item = await mintCofreItem(actor, {
      type: 'api_key',
      label: 'DB token',
      value: SECRET,
      boundOrigins: ['db.internal.example'],
    });
    await issueGrant(actor, item._id, '1_day');
    return item;
  }

  async function itemRow(id: string) {
    const { cofreItems } = await import('../../src/cofre/store.js');
    return (await cofreItems.raw.get(id)) as { lastUsedAt?: string } | null;
  }

  /** Capture the wire and answer any `tool.invoke` as a daemon would. */
  function liveWire(): BridgeFrame[] {
    connect();
    return wire((frame) => {
      if (frame.type === 'tool.invoke') resolveToolResult(frame.invocationId, { ok: true, output: { exitCode: 0 } });
    });
  }

  const step = (item: string) => ({
    capability: 'bash' as const,
    input: { argv: ['env'] },
    runId: 'r1',
    secretEnv: { DB_TOKEN: `cofre:${item}` },
    actor,
  });

  it('THE LEAK: no grant means no secret.deliver frame, no unwrap, no Registo row', async () => {
    const item = await grantedItem();
    const sent = liveWire(); // NO capability grant issued for this machine

    const env = await seam().runStep(step(item._id));

    expect(env.ok).toBe(false);
    // Not one frame of any kind. `secret.deliver` is the only frame in the union that carries
    // credential material, so its absence is the proof the plaintext never left this process.
    expect(sent).toHaveLength(0);
    // And nothing was staged for a later redemption either.
    expect(__pendingDeliveryCount()).toBe(0);
    // The Registo said the credential was USED. It never was - the step was refused.
    expect((await itemRow(item._id))?.lastUsedAt).toBeUndefined();
  });

  it('with the grant, the credential IS delivered - and under the invoking id', async () => {
    const item = await grantedItem();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    const sent = liveWire();

    const env = await seam().runStep(step(item._id));

    expect(env.ok).toBe(true);
    expect(sent.map((f) => f.type)).toEqual(['secret.deliver', 'tool.invoke']);
    const deliver = sent[0] as Extract<BridgeFrame, { type: 'secret.deliver' }>;
    const invoke = sent[1] as Extract<BridgeFrame, { type: 'tool.invoke' }>;
    expect(deliver.env.DB_TOKEN).toBe(SECRET);
    expect(deliver.invocationId).toBe(invoke.invocationId);
    expect((await itemRow(item._id))?.lastUsedAt).toBeTruthy();
  });

  it('REVOCATION closes the credential path, not just the dispatch path', async () => {
    // Revoking does not close the socket, so the only thing standing between a de-authorised
    // machine and the next credential is this check being re-read per step.
    const item = await grantedItem();
    await grantCapability({ orgId: ORG, pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'admin' });
    const sent = liveWire();
    const c = seam();
    expect((await c.runStep(step(item._id))).ok).toBe(true);
    expect(sent).toHaveLength(2);

    await revokeCapability(ORG, PAIRING, 'local.bash');
    const after = await c.runStep(step(item._id));

    expect(after.ok).toBe(false);
    expect(sent).toHaveLength(2); // nothing more went out
    expect(__pendingDeliveryCount()).toBe(0);
  });

  it('a grant in ANOTHER org does not release this org\'s credential', async () => {
    const item = await grantedItem();
    await grantCapability({ orgId: 'orgB', pairingId: PAIRING, capability: 'local.bash', grantedByUserId: 'other' });
    const sent = liveWire();

    expect((await seam().runStep(step(item._id))).ok).toBe(false);
    expect(sent).toHaveLength(0);
  });
});
