import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BridgeRegistoMetadata } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { activityLogs } from '../../src/data/stores.js';
import { delegateToLocal, type DelegationDeps, __resetPendingDelegationsForTests } from '../../src/bridge/delegation.js';
import { recordBridgeEvent, toolsUsedIn, BRIDGE_REGISTO_CATEGORY } from '../../src/bridge/audit.js';
import { approveWrite, __resetWriteApprovalsForTests } from '../../src/bridge/write-approval.js';

/**
 * SECURITY SUITE — the bridge plane gets a durable audit trail (Cofre J-6).
 *
 * Cortex persisted NOTHING about bridge invocations: only `kind==='read'` ledger rows left the
 * machine, into a 15-minute in-memory Map built to render a trust chip. So the plane with the most
 * physical access to a user's data — the one reading their files and running commands on their
 * computer — was the only one with no durable record, and "what did Ekoa do on my machine last
 * month" had no answer.
 *
 * The other half of this suite matters just as much: WHAT MUST NEVER BE WRITTEN. `EgressLedgerRow`
 * carries `path`, and the standing §18.2 / FC-407 invariant is that those rows are never persisted
 * hosted-side, because a path is itself sensitive — client names live in folder names, and for a
 * legal practice a directory listing is privileged. J-6 makes the FACT of an invocation durable
 * while leaving WHAT WAS READ exactly as un-persisted as before, and the cases below pin both
 * directions so a later "just add the path, it's useful for support" is caught by a test rather
 * than by whoever happens to review it.
 */
let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= 'test-encryption-key';
  process.env.JWT_SECRET ??= 'test-jwt-secret';
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sec_j6');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await activityLogs.deleteMany({});
  __resetPendingDelegationsForTests();
  __resetWriteApprovalsForTests();
});

const actor = { userId: 'u1', orgId: 'o1', sessionId: 's1', username: 'Ana' };

function harness(): DelegationDeps {
  return {
    getActivation: () => ({ active: true, billingLocked: false }),
    getConnectionByOwner: () =>
      ({ pairingId: 'p1', org: 'o1', ownerUserId: 'u1', registeredAt: 1, alive: true, lastSeenAt: '' }) as never,
    getPairingSigningSecret: async () => 'pairing-secret',
    send: () => true,
    timeoutMs: 40,
  };
}

const rows = async () => (await activityLogs.find({ category: BRIDGE_REGISTO_CATEGORY })) as unknown as Array<{
  type: string;
  userId: string;
  orgId: string;
  metadata?: Record<string, unknown>;
}>;

/**
 * The audit write is fire-and-forget, so the row lands shortly AFTER the delegation returns. Poll
 * for it rather than sleeping a fixed interval: a sleep tuned to one machine is a flake on a slower
 * one, and this suite asserts on absence too, where a too-short sleep would read as a pass.
 */
async function waitForRows(count: number, budgetMs = 3000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if ((await rows()).length >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('a delegation leaves a durable record', () => {
  it('writes a dispatch row and, separately, a settlement row', async () => {
    // Times out to `unreachable` (nothing answers) — which is itself an outcome worth recording.
    await delegateToLocal(actor, { task: JSON.stringify({ v: 1, steps: [{ tool: 'read', grantRef: 'g-1', relPath: 'a.txt' }] }), grantRefs: ['g-1'], budget: { egressBytes: 1000, modelSpend: { userId: 'u1' } } }, harness());
    await waitForRows(2);

    const all = await rows();
    const dispatched = all.find((r) => r.type === 'bridge_delegation_dispatched');
    const settled = all.find((r) => r.type === 'bridge_delegation_settled');

    expect(dispatched).toBeDefined();
    expect(settled).toBeDefined();
    // Two rows, not one written at the end: a dispatch with no matching settlement is exactly what
    // a machine that went dark mid-task looks like, and one combined row would erase that.
    expect(dispatched!.metadata?.pairingId).toBe('p1');
    expect(dispatched!.metadata?.tools).toEqual(['read']);
    expect(dispatched!.metadata?.grantRefCount).toBe(1);
    expect(settled!.metadata?.outcome).toBe('unreachable');
    expect(settled!.metadata?.taskId).toBe(dispatched!.metadata?.taskId);
  });

  it('rows are attributed to the owner and the org', async () => {
    await delegateToLocal(actor, { task: '{"v":1,"steps":[]}', grantRefs: [], budget: { egressBytes: 1, modelSpend: { userId: 'u1' } } }, harness());
    await waitForRows(2);
    for (const r of await rows()) {
      expect(r.userId).toBe('u1');
      expect(r.orgId).toBe('o1');
    }
  });

  it('a REFUSED dispatch is recorded too — a run of them is what a bypass attempt looks like', async () => {
    const t = JSON.stringify({ v: 1, steps: [{ tool: 'write', grantRef: 'g-1', relPath: 'x.txt', confirmed: true }] });
    await delegateToLocal(actor, { task: t, grantRefs: ['g-1'], budget: { egressBytes: 1, modelSpend: { userId: 'u1' } } }, harness());
    await waitForRows(1);

    const refused = (await rows()).find((r) => r.metadata?.refusal !== undefined);
    expect(refused).toBeDefined();
    expect(refused!.metadata?.refusal).toBe('write_not_approved');
    expect(refused!.metadata?.tools).toEqual(['write']);
  });

  it('an approved write records the write, not a refusal', async () => {
    approveWrite({ userId: 'u1', pairingId: 'p1', grantRef: 'g-1', relPath: 'x.txt' });
    const t = JSON.stringify({ v: 1, steps: [{ tool: 'write', grantRef: 'g-1', relPath: 'x.txt', confirmed: true }] });
    await delegateToLocal(actor, { task: t, grantRefs: ['g-1'], budget: { egressBytes: 1, modelSpend: { userId: 'u1' } } }, harness());
    await waitForRows(2);

    const all = await rows();
    expect(all.some((r) => r.metadata?.refusal !== undefined)).toBe(false);
    expect(all.some((r) => r.type === 'bridge_delegation_dispatched')).toBe(true);
  });
});

describe('what the audit must never carry', () => {
  it('NO PATH can be written, even by a caller that tries', async () => {
    // The §18.2 / FC-407 invariant, enforced by the contract rather than by memory. A future
    // "just add the path, support needs it" change fails here.
    await recordBridgeEvent(
      { userId: 'u1', orgId: 'o1', username: 'Ana' },
      'bridge_delegation_settled',
      { pairingId: 'p1', path: '/Users/ana/Clientes/Silva-divorcio/acordo.docx' },
      { now: Date.now },
    );
    const row = (await rows())[0];
    expect(row).toBeDefined();
    // The ROW survives (losing the fact is worse than losing the detail) but the metadata is
    // dropped wholesale rather than written with the offending field stripped out.
    expect(JSON.stringify(row!.metadata ?? {})).not.toContain('Silva-divorcio');
    expect(row!.metadata?.path).toBeUndefined();
  });

  it('the metadata schema rejects a path field outright', () => {
    expect(BridgeRegistoMetadata.safeParse({ pairingId: 'p1' }).success).toBe(true);
    expect(BridgeRegistoMetadata.safeParse({ pairingId: 'p1', path: '/x/y' }).success).toBe(false);
    expect(BridgeRegistoMetadata.safeParse({ relPath: 'a.txt' }).success).toBe(false);
    expect(BridgeRegistoMetadata.safeParse({ pattern: 'senha' }).success).toBe(false);
  });

  it('tool extraction records NAMES from a closed set, never arguments', () => {
    const t = JSON.stringify({
      v: 1,
      steps: [
        { tool: 'grep', grantRef: 'g', pattern: 'palavra-passe do cliente Silva' },
        { tool: 'read', grantRef: 'g', relPath: '/Users/ana/Clientes/Silva/x.txt' },
        { tool: 'rm -rf /', grantRef: 'g' }, // not a known tool: ignored, never echoed
      ],
    });
    const tools = toolsUsedIn(t);
    expect(tools).toEqual(['grep', 'read']);
    // A grep pattern is user or model text that can embed anything; it must not reach the Registo.
    expect(JSON.stringify(tools)).not.toContain('Silva');
    expect(JSON.stringify(tools)).not.toContain('rm -rf');
  });

  it('a malformed task yields no tools rather than a guess', () => {
    expect(toolsUsedIn('not json')).toEqual([]);
    expect(toolsUsedIn(JSON.stringify({ steps: 'no' }))).toEqual([]);
  });
});
