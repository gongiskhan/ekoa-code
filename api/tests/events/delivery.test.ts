import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { triggers, eventQueue } from '../../src/data/stores.js';
import { createTrigger } from '../../src/events/service.js';
import {
  enqueue,
  claimNext,
  markFailed,
  recoverStuck,
  retryDelayMs,
  MAX_DELIVERY_ATTEMPTS,
  type QueuedEvent,
} from '../../src/events/queue.js';
import {
  setDeliveryTargets,
  startDelivery,
  stopDelivery,
  wakeDelivery,
  __resetDeliveryForTests,
  type DeliveryEvent,
} from '../../src/events/delivery.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';

/**
 * Trigger delivery pipeline (ch05 §5.6.7 retry boundary; invisible-behaviors §12.3): claim
 * pending→dispatching, dispatch to injected targets, retry 30s/2m/10m/1h/6h ±30% then dead
 * after 5, boot recovery of stuck rows, non-completed automation run = delivery failure.
 */
let mem: MongoMemoryServer;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq++, genId: () => `id_${seq++}` };
const actor = { userId: 'owner-1', orgId: 'orgA', role: 'builder' as const };

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_delivery');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [triggers, eventQueue]) await s.deleteMany({});
});
afterEach(async () => {
  await stopDelivery(0);
  __resetDeliveryForTests();
});

async function mkAutomationTrigger(automationId = 'auto-1') {
  const { trigger } = await createTrigger(
    actor,
    { targetKind: 'automation', integrationKey: 'wa', eventName: 'message', automationId, secret: 'shh' },
    deps,
  );
  return trigger;
}

const drainTick = () => new Promise((r) => setTimeout(r, 25));

/** Poll until the single queue row has been ATTEMPTED and settled out of dispatching (bounded). */
async function settledRow(): Promise<QueuedEvent> {
  for (let i = 0; i < 80; i++) {
    const row = (await eventQueue.find({}))[0] as QueuedEvent | undefined;
    if (row && row.attempts > 0 && row.status !== 'dispatching') return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return (await eventQueue.find({}))[0] as QueuedEvent;
}

describe('retry schedule (§12.3)', () => {
  it('follows 30s/2m/10m/1h/6h with ±30% jitter and exhausts after 5', () => {
    const bases = [30_000, 120_000, 600_000, 3_600_000, 21_600_000];
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
      const lo = retryDelayMs(attempt, () => 0)!;
      const hi = retryDelayMs(attempt, () => 1)!;
      expect(lo).toBe(Math.round(bases[attempt - 1]! * 0.7));
      expect(hi).toBe(Math.round(bases[attempt - 1]! * 1.3));
    }
    expect(retryDelayMs(MAX_DELIVERY_ATTEMPTS + 1)).toBeNull();
  });
});

describe('queue claim/fail/recover', () => {
  it('claims pending→dispatching once, honours nextAttemptAt, and dead-letters after 5 attempts', async () => {
    const t = await mkAutomationTrigger();
    await enqueue(t._id, 'k1', '{"x":1}', new Date(deps.now()).toISOString());
    const nowIso = new Date(deps.now()).toISOString();
    const claimed = await claimNext(nowIso);
    expect(claimed).toBeTruthy();
    expect(claimed!.status).toBe('dispatching');
    expect(claimed!.attempts).toBe(1);
    expect(await claimNext(nowIso)).toBeNull(); // no double-claim

    // Fail it: re-armed with a FUTURE nextAttemptAt → not due now.
    const verdict = await markFailed(claimed!._id, 'boom', deps.now());
    expect(verdict).toBe('retry');
    expect(await claimNext(new Date(deps.now()).toISOString())).toBeNull();
    const row = (await eventQueue.get(claimed!._id)) as QueuedEvent;
    expect(row.status).toBe('pending');
    expect(row.lastError).toBe('boom');

    // Old-code semantics (event-queue.ts scheduleRetry, carried verbatim): failures 1..5 each
    // re-arm with schedule[N-1]; the 6th attempt's failure is past the schedule → dead.
    let cur = row;
    for (let i = 2; i <= MAX_DELIVERY_ATTEMPTS + 1; i++) {
      const due = new Date(Date.parse(cur.nextAttemptAt!) + 1).toISOString();
      const c = await claimNext(due);
      expect(c, `claim attempt ${i}`).toBeTruthy();
      const v = await markFailed(c!._id, `boom ${i}`, Date.parse(due));
      cur = (await eventQueue.get(c!._id)) as QueuedEvent;
      if (i <= MAX_DELIVERY_ATTEMPTS) expect(v).toBe('retry');
      else expect(v).toBe('dead');
    }
    expect(cur.status).toBe('dead');
  });

  it('boot recovery flips rows stuck dispatching >10min back to pending', async () => {
    const t = await mkAutomationTrigger();
    await enqueue(t._id, 'k1', '{}', new Date(deps.now()).toISOString());
    const claimed = await claimNext(new Date(deps.now()).toISOString());
    expect(claimed).toBeTruthy();
    // Not yet stuck.
    expect(await recoverStuck(Date.parse(claimed!.claimedAt!) + 60_000)).toBe(0);
    // Stuck past the 10-minute threshold.
    expect(await recoverStuck(Date.parse(claimed!.claimedAt!) + 11 * 60_000)).toBe(1);
    const row = (await eventQueue.get(claimed!._id)) as QueuedEvent;
    expect(row.status).toBe('pending');
  });
});

describe('delivery pipeline dispatch', () => {
  it('delivers an automation event under the TRIGGER OWNER identity and marks delivered', async () => {
    const t = await mkAutomationTrigger('auto-42');
    const seen: Array<{ automationId: string; owner: string; payload: unknown }> = [];
    setDeliveryTargets({
      async startAutomationRun(automationId, event: DeliveryEvent) {
        // The owner MUST come from the server-trusted trigger row, never the payload (B7).
        seen.push({ automationId, owner: event.trigger.ownerUserId, payload: event.payload });
        return { ok: true };
      },
      async invokeArtifactBackend() {
        throw new Error('wrong target');
      },
    });
    await enqueue(t._id, 'k1', '{"from":"attacker","ownerUserId":"evil"}', new Date(deps.now()).toISOString());
    await startDelivery();
    wakeDelivery();
    await settledRow();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.automationId).toBe('auto-42');
    expect(seen[0]!.owner).toBe('owner-1');
    const rows = (await eventQueue.find({})) as QueuedEvent[];
    expect(rows[0]!.status).toBe('delivered');
  });

  it('a non-completed automation run re-enters the retry schedule; a missing trigger dead-letters', async () => {
    const t = await mkAutomationTrigger();
    setDeliveryTargets({
      async startAutomationRun() {
        return { ok: false, reason: 'run ended failed' };
      },
      async invokeArtifactBackend() {
        return { ok: true };
      },
    });
    await enqueue(t._id, 'k1', '{}', new Date(deps.now()).toISOString());
    await startDelivery();
    wakeDelivery();
    const row = await settledRow();
    expect(row.status).toBe('pending'); // re-armed, not dead, not delivered
    expect(row.nextAttemptAt).toBeTruthy();
    expect(row.lastError).toBe('run ended failed');

    // A row whose trigger vanished dead-letters immediately.
    await eventQueue.deleteMany({});
    await enqueue('ghost-trigger', 'k2', '{}', new Date(deps.now()).toISOString());
    wakeDelivery();
    const ghost = await settledRow();
    expect(ghost.status).toBe('dead');
  });

  it('a permanent target outcome dead-letters without retries (unknown automation)', async () => {
    const t = await mkAutomationTrigger('missing-auto');
    setDeliveryTargets({
      async startAutomationRun() {
        return { ok: false, reason: 'automation não encontrada', permanent: true };
      },
      async invokeArtifactBackend() {
        return { ok: true };
      },
    });
    await enqueue(t._id, 'k1', '{}', new Date(deps.now()).toISOString());
    await startDelivery();
    wakeDelivery();
    const row = await settledRow();
    expect(row.status).toBe('dead');
    expect(row.lastError).toBe('automation não encontrada');
  });

  it('unwired targets fail honestly into the retry schedule (never a silent swallow)', async () => {
    const t = await mkAutomationTrigger();
    await enqueue(t._id, 'k1', '{}', new Date(deps.now()).toISOString());
    await startDelivery();
    wakeDelivery();
    const row = await settledRow();
    expect(row.status).toBe('pending');
    expect(row.lastError).toContain('not wired');
  });
});
