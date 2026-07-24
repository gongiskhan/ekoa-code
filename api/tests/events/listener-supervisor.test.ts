/**
 * Listener supervisor (2A-S1; ported + extended from ekoa-dev listener-supervisor.test.ts).
 *
 * The supervisor is DEPS-INJECTED, so this test drives it entirely with in-memory stubs (no
 * Mongo/Express): a fake listener set, an in-memory cursor store + enqueue with UNIQUE dedup, and a
 * stubbed platform call. It proves:
 *   - start()/stop() against an empty listener set is a no-op (does not throw) — dev parity;
 *   - a platform listener polls across ticks and enqueues into the injected queue, and stop()
 *     halts all further work (cancel-safe: no enqueue after stop);
 *   - ISOLATION: a listener whose poll always fails backs off (bumpFailure) without throwing to the
 *     caller and without starving a healthy sibling, which keeps enqueuing.
 */

import { describe, it, expect } from 'vitest';
import { ListenerSupervisor, type SupervisorTrigger } from '../../src/events/listener-supervisor.js';
import type { EnqueueInput, EnqueueResult, PlatformCallResult } from '../../src/integrations/event-sources/platform-poll.js';

const NOW = '2026-06-19T09:00:00Z';

function graphResponse(messages: Array<{ id: string; receivedDateTime: string }>): PlatformCallResult {
  return { success: true, status: 200, data: { value: messages } };
}

function mkTrigger(id: string, over: Partial<SupervisorTrigger> = {}): SupervisorTrigger {
  return {
    _id: id,
    orgId: 'orgA',
    ownerUserId: 'owner-1',
    integrationKey: 'microsoft-365',
    eventName: 'email.received',
    pollConfig: { actionName: 'list_emails', intervalMs: 15 },
    disabled: false,
    ...over,
  };
}

/** In-memory injected stores shared by a test. */
function harness(listeners: SupervisorTrigger[], callPlatform: (t: SupervisorTrigger, call: Record<string, unknown>) => Promise<PlatformCallResult>) {
  const cursors = new Map<string, unknown>();
  const inserted = new Map<string, EnqueueInput>(); // key = triggerId::dedupKey (UNIQUE dedup)
  const failures: Array<{ id: string; error: string }> = [];
  const enqueue = async (input: EnqueueInput): Promise<EnqueueResult> => {
    const k = `${input.triggerId}::${input.dedupKey}`;
    if (inserted.has(k)) return { kind: 'duplicate' };
    inserted.set(k, input);
    return { kind: 'inserted' };
  };
  const sup = new ListenerSupervisor({
    listListeners: async () => listeners,
    readCursor: async (id) => cursors.get(id),
    writeCursor: async (id, c) => { cursors.set(id, c); },
    bumpFailure: async (id, error) => { failures.push({ id, error }); },
    enqueue,
    callPlatform,
    now: () => NOW,
    reconcileIntervalMs: 10_000, // large: reconcile must not interfere with the timing assertions
  });
  return { sup, cursors, inserted, failures };
}

async function waitUntil(cond: () => boolean, timeoutMs = 2_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return cond();
}

describe('listener supervisor lifecycle', () => {
  it('start/stop against an empty listener set is a no-op (does not throw)', async () => {
    const { sup } = harness([], async () => graphResponse([]));
    await expect(sup.start()).resolves.toBeUndefined();
    await expect(sup.stop()).resolves.toBeUndefined();
  });
});

describe('listener supervisor — platform poll enqueues + cancel-safety', () => {
  it('polls a platform listener across ticks, enqueues, and stops all work on stop()', async () => {
    const { sup, inserted } = harness([mkTrigger('trg-ok')], async () =>
      graphResponse([{ id: 'M1', receivedDateTime: '2026-06-19T09:05:00Z' }]),
    );
    await sup.start();
    // First tick only initialises the cursor (no backfill); the enqueue lands on a later tick.
    const got = await waitUntil(() => inserted.has('trg-ok::M1'));
    expect(got).toBe(true);

    await sup.stop();
    const sizeAtStop = inserted.size;
    // No work after stop: give the loop ample time to (not) fire again.
    await new Promise((r) => setTimeout(r, 120));
    expect(inserted.size).toBe(sizeAtStop);
  });
});

describe('listener supervisor — isolation (a failing listener never starves a healthy one)', () => {
  it('a poll that always fails backs off (bumpFailure) without throwing or blocking a sibling', async () => {
    const call = async (t: SupervisorTrigger): Promise<PlatformCallResult> =>
      t._id === 'trg-bad'
        ? { success: false, status: 500, error: 'boom' }
        : graphResponse([{ id: 'OK1', receivedDateTime: '2026-06-19T09:05:00Z' }]);
    const { sup, inserted, failures } = harness([mkTrigger('trg-bad'), mkTrigger('trg-ok')], call);

    await expect(sup.start()).resolves.toBeUndefined(); // start never rejects on a bad listener

    // The healthy sibling still delivers…
    expect(await waitUntil(() => inserted.has('trg-ok::OK1'))).toBe(true);
    // …while the bad one records failures (and never enqueues).
    expect(await waitUntil(() => failures.some((f) => f.id === 'trg-bad'))).toBe(true);
    expect([...inserted.keys()].some((k) => k.startsWith('trg-bad::'))).toBe(false);

    await sup.stop();
  });
});
