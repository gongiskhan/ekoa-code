/**
 * Layer 1 — platform event source (2A-S1; ported from ekoa-dev event-sourcing/platform-poll.test.ts).
 *
 * Drives `pollPlatformSource` against a STUBBED `callPlatformIntegration` and the REAL ekoa-code
 * event queue + listener-state store (mongodb-memory-server), proving the brief's acceptance:
 *   - one event enqueued per message
 *   - a repeat (same msg id) dedupes (UNIQUE trigger+dedupKey) and still counts as full success
 *   - the high-water cursor advances ONLY on full success
 *   - a missing dedup key stalls the cursor (no silent drop)
 *   - the first poll initialises the cursor to "now" without backfilling history
 *   - a >cap same-timestamp burst drains across consecutive ticks (no starvation) and the cursor
 *     advances rather than reverts after an exactly-cap newer burst
 *
 * The dev test's synchronous SQLite deps become ekoa-code's async store calls; the enqueue path is
 * the production `enqueueListenerEvent` bridge, so the test exercises the real queue insert.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { eventQueue, listenerState } from '../../src/data/stores.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { claimNext, type QueuedEvent } from '../../src/events/queue.js';
import { readListenerCursor, writeListenerCursor } from '../../src/events/listener-state.js';
import { enqueueListenerEvent } from '../../src/events/listener-supervisor.js';
import {
  pollPlatformSource,
  type PlatformCallResult,
  type PlatformPollDeps,
} from '../../src/integrations/event-sources/platform-poll.js';

let mem: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'k';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_platform_poll');
}, 60_000);
afterAll(async () => {
  await closeMongo();
  await mem.stop();
});
beforeEach(async () => {
  for (const s of [eventQueue, listenerState]) await s.deleteMany({});
});

const TRIGGER = { id: 'trg-1', integrationKey: 'microsoft-365' as const };

/** Build a Graph-shaped list_emails response. */
function graphResponse(messages: Array<{ id: string; receivedDateTime: string }>): PlatformCallResult {
  return { success: true, status: 200, data: { value: messages } };
}

function realDeps(call: (args: Record<string, unknown>) => Promise<PlatformCallResult>, now = '2026-06-19T09:00:00Z'): PlatformPollDeps {
  return {
    call,
    readCursor: (id) => readListenerCursor(id),
    writeCursor: (id, cursor) => writeListenerCursor(id, cursor, now),
    enqueue: (input) => enqueueListenerEvent(input, now),
    now: () => now,
  };
}

/**
 * Every enqueued row's dedupKey, for the burst-completeness assertion.
 *
 * READS the queue rather than DRAINING it, deliberately. The assertion is "all 700 messages were
 * enqueued, none starved" is a statement about what is IN the queue, not about the claim protocol
 * (which line ~110 tests directly, on two rows). Draining was the expensive way to ask: `claimNext`
 * re-runs `find({status:'pending'})` and sorts it on EVERY call, so claiming a 700-row burst one at
 * a time is quadratic: ~245k document reads plus 700 updates. That is what made this spec time out
 * at 30 s under full-suite load while passing in isolation: a load-sensitive flake with a real
 * cause, not an unlucky machine. One read instead.
 */
async function enqueuedDedupKeys(): Promise<Set<string>> {
  const rows = (await eventQueue.find({})) as QueuedEvent[];
  return new Set(rows.map((r) => r.dedupKey));
}

describe('pollPlatformSource — first poll initialises cursor without backfill', () => {
  it('writes a now-cursor and enqueues nothing on the very first tick', async () => {
    let called = false;
    const res = await pollPlatformSource(TRIGGER, realDeps(async () => { called = true; return graphResponse([]); }, '2026-06-19T09:00:00Z'));
    expect(called).toBe(false); // no Graph call — we only set the high-water mark
    expect(res.initialized).toBe(true);
    expect(res.polled).toBe(false);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:00:00Z');
  });
});

describe('pollPlatformSource — enqueue + dedup + cursor advance', () => {
  beforeEach(async () => {
    // Seed an existing cursor so polls actually fetch.
    await writeListenerCursor(TRIGGER.id, '2026-06-19T09:00:00Z', '2026-06-19T09:00:00Z');
  });

  it('enqueues one event per message and advances the cursor to the newest receivedDateTime', async () => {
    const res = await pollPlatformSource(
      TRIGGER,
      realDeps(async () =>
        graphResponse([
          { id: 'AAA', receivedDateTime: '2026-06-19T09:01:00Z' },
          { id: 'BBB', receivedDateTime: '2026-06-19T09:02:00Z' },
        ]),
      ),
    );
    expect(res.enqueued).toBe(2);
    expect(res.cursorAdvanced).toBe(true);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:02:00Z');

    // Both rows are claimable from the durable queue.
    const a = await claimNext('2026-06-19T09:05:00Z');
    const b = await claimNext('2026-06-19T09:05:00Z');
    expect([a?.dedupKey, b?.dedupKey].sort()).toEqual(['AAA', 'BBB']);
  });

  it('dedupes a repeated message id (UNIQUE) and still treats the tick as full success', async () => {
    // First poll lands AAA.
    await pollPlatformSource(TRIGGER, realDeps(async () => graphResponse([{ id: 'AAA', receivedDateTime: '2026-06-19T09:01:00Z' }])));
    // Second poll returns AAA again (ge is inclusive) plus a new CCC.
    const res = await pollPlatformSource(
      TRIGGER,
      realDeps(async () =>
        graphResponse([
          { id: 'AAA', receivedDateTime: '2026-06-19T09:01:00Z' },
          { id: 'CCC', receivedDateTime: '2026-06-19T09:03:00Z' },
        ]),
      ),
    );
    expect(res.enqueued).toBe(1); // only CCC is new
    expect(res.cursorAdvanced).toBe(true);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:03:00Z');
  });

  it('passes the cursor into the list query as an OData $filter, oldest-first', async () => {
    let seenArgs: Record<string, unknown> | undefined;
    await pollPlatformSource(
      TRIGGER,
      realDeps(async (args) => {
        seenArgs = args.args as Record<string, unknown>;
        return graphResponse([]);
      }),
    );
    expect((seenArgs as { $filter: string }).$filter).toBe('receivedDateTime ge 2026-06-19T09:00:00Z');
    expect((seenArgs as { $orderby: string }).$orderby).toBe('receivedDateTime asc');
  });
});

describe('pollPlatformSource — in-tick paging (same-timestamp burst)', () => {
  beforeEach(async () => { await writeListenerCursor(TRIGGER.id, '2026-06-19T09:00:00Z', '2026-06-19T09:00:00Z'); });

  it('pages through $skip pages and enqueues all, advancing the cursor', async () => {
    const page0 = Array.from({ length: 100 }, (_, i) => ({ id: `p0-${i}`, receivedDateTime: '2026-06-19T09:01:00Z' }));
    const page1 = Array.from({ length: 30 }, (_, i) => ({ id: `p1-${i}`, receivedDateTime: '2026-06-19T09:02:00Z' }));
    const call = async (args: Record<string, unknown>): Promise<PlatformCallResult> => {
      const skip = Number((args.args as Record<string, unknown>).$skip ?? 0);
      return graphResponse(skip === 0 ? page0 : page1);
    };
    const res = await pollPlatformSource(TRIGGER, realDeps(call));
    expect(res.pages).toBe(2);
    expect(res.enqueued).toBe(130);
    expect(res.cursorAdvanced).toBe(true);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:02:00Z');
  });

  it('reports stalled (observable, not silent) when the per-tick item cap is hit', async () => {
    let n = 0;
    // Always a full page of NEW ids at the cursor timestamp → never short → cap hit.
    const call = async (): Promise<PlatformCallResult> => graphResponse(Array.from({ length: 100 }, () => ({ id: `x-${n++}`, receivedDateTime: '2026-06-19T09:00:00Z' })));
    const res = await pollPlatformSource(TRIGGER, realDeps(call));
    expect(res.stalled).toBe(true);
    expect(res.pages).toBeGreaterThanOrEqual(5);
    expect(res.enqueued).toBeGreaterThanOrEqual(500);
  });

  it('drains a >cap same-timestamp burst across consecutive ticks (no starvation)', async () => {
    const TOTAL = 700; // all at the EXACT same receivedDateTime → cannot advance the cursor
    const all = Array.from({ length: TOTAL }, (_, i) => ({ id: `b-${i}`, receivedDateTime: '2026-06-19T09:00:00Z' }));
    const call = async (args: Record<string, unknown>): Promise<PlatformCallResult> => {
      const skip = Number((args.args as Record<string, unknown>).$skip ?? 0);
      return graphResponse(all.slice(skip, skip + 100));
    };
    // Tick 1: drains the first cap's worth, persists a {ts, skip} continuation.
    const t1 = await pollPlatformSource(TRIGGER, realDeps(call));
    expect(t1.stalled).toBe(true);
    expect(t1.enqueued).toBe(500);
    // Tick 2: RESUMES from the continuation (skip 500) and finishes the burst.
    const t2 = await pollPlatformSource(TRIGGER, realDeps(call));
    expect(t2.enqueued).toBe(200);
    // Every message was eventually enqueued - nothing beyond the cap was starved.
    const ids = await enqueuedDedupKeys();
    expect(ids.size).toBe(TOTAL);
  });

  it('advances the cursor (not reverts) after an exactly-cap burst NEWER than the stored cursor', async () => {
    await writeListenerCursor(TRIGGER.id, '2026-06-19T08:00:00Z', '2026-06-19T09:00:00Z'); // older than the burst below
    const burst = Array.from({ length: 500 }, (_, i) => ({ id: `c-${i}`, receivedDateTime: '2026-06-19T09:00:00Z' }));
    const call = async (args: Record<string, unknown>): Promise<PlatformCallResult> => {
      const skip = Number((args.args as Record<string, unknown>).$skip ?? 0);
      return graphResponse(burst.slice(skip, skip + 100));
    };
    // Tick 1: exactly the cap (500) → stalled, continuation must carry maxSeen=09:00.
    const t1 = await pollPlatformSource(TRIGGER, realDeps(call));
    expect(t1.stalled).toBe(true);
    expect(t1.enqueued).toBe(500);
    expect(await readListenerCursor(TRIGGER.id)).not.toBe('2026-06-19T08:00:00Z'); // a continuation, not the old base
    // Tick 2: follow-up finds nothing new but MUST advance to 09:00, not revert to 08:00.
    const t2 = await pollPlatformSource(TRIGGER, realDeps(call));
    expect(t2.cursorAdvanced).toBe(true);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:00:00Z');
  });
});

describe('pollPlatformSource — cursor stalls on partial failure', () => {
  beforeEach(async () => { await writeListenerCursor(TRIGGER.id, '2026-06-19T09:00:00Z', '2026-06-19T09:00:00Z'); });

  it('does NOT advance the cursor when an item has no extractable id', async () => {
    const res = await pollPlatformSource(
      TRIGGER,
      realDeps(async () =>
        graphResponse([
          { id: 'AAA', receivedDateTime: '2026-06-19T09:01:00Z' },
          // missing id — simulate by casting
          ({ receivedDateTime: '2026-06-19T09:05:00Z' } as unknown) as { id: string; receivedDateTime: string },
        ]),
      ),
    );
    expect(res.enqueued).toBe(1); // AAA still enqueued
    expect(res.cursorAdvanced).toBe(false); // cursor stalls — the bad item retried next tick
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:00:00Z');
  });

  it('throws (so the supervisor backs off) when the platform call fails', async () => {
    await expect(
      pollPlatformSource(TRIGGER, realDeps(async () => ({ success: false, status: 503, error: 'graph down' }))),
    ).rejects.toThrow(/platform poll failed \(503\)/);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:00:00Z'); // unchanged
  });

  it('does not write a cursor (or advance) when cancelled mid-await', async () => {
    let cancelled = false;
    const res = await pollPlatformSource(TRIGGER, {
      ...realDeps(async () => { cancelled = true; return graphResponse([{ id: 'ZZZ', receivedDateTime: '2026-06-19T09:09:00Z' }]); }),
      isCancelled: () => cancelled,
    });
    expect(res.cursorAdvanced).toBe(false);
    expect(await readListenerCursor(TRIGGER.id)).toBe('2026-06-19T09:00:00Z');
  });
});
