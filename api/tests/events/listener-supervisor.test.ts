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
 *   - ROUTING (2A-S4): a NON-platform listener goes down the user-defined branch — the
 *     `callUserIntegration` seam, driven by the SHIPPED integration package's listenerConfig (the
 *     real `imap` one: fetch_messages / messages / uid / next_uid), first tick initialising the
 *     cursor without backfilling. The generic poller's own contract has its own suite
 *     (tests/integrations/user-defined-poll.test.ts, over the real executor + stores).
 */

import { describe, it, expect } from 'vitest';
import { ListenerSupervisor, type SupervisorTrigger } from '../../src/events/listener-supervisor.js';
import type { EnqueueInput, EnqueueResult, PlatformCallResult } from '../../src/integrations/event-sources/platform-poll.js';
import type { UserIntegrationCallResult } from '../../src/integrations/event-sources/user-defined-poll.js';

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
function harness(
  listeners: SupervisorTrigger[],
  callPlatform: (t: SupervisorTrigger, call: Record<string, unknown>) => Promise<PlatformCallResult>,
  callUserIntegration?: (t: SupervisorTrigger, call: { integrationKey: string; actionName: string; args: Record<string, unknown> }) => Promise<UserIntegrationCallResult>,
) {
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
    // Unless a test supplies one, every trigger here is a PLATFORM listener and the user-defined
    // branch must never be reached: a call is a ROUTING bug, so it fails loudly rather than
    // returning a benign empty result.
    callUserIntegration: callUserIntegration ?? (async () => {
      throw new Error('callUserIntegration must not be reached for a platform listener');
    }),
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

describe('listener supervisor — user-defined branch routing (2A-S4)', () => {
  it('routes a non-platform listener through callUserIntegration using the SHIPPED package listenerConfig', async () => {
    const calls: Array<{ actionName: string; args: Record<string, unknown> }> = [];
    // The real `imap` package's listenerConfig drives the field paths; only the transport-less
    // executor call is stubbed here (its honest refusal is proven in user-defined-poll.test.ts).
    const callUser = async (_t: SupervisorTrigger, call: { integrationKey: string; actionName: string; args: Record<string, unknown> }): Promise<UserIntegrationCallResult> => {
      calls.push({ actionName: call.actionName, args: call.args });
      return { success: true, status: 200, data: { messages: [{ uid: '77', subject: 'olá' }], next_uid: '78' } };
    };
    const trigger = mkTrigger('trg-ud', {
      integrationKey: 'imap',
      eventName: 'message.received',
      pollConfig: { actionName: 'fetch_messages', intervalMs: 15 },
    });
    const { sup, cursors, inserted } = harness([trigger], async () => {
      throw new Error('callPlatform must not be reached for a user-defined listener');
    }, callUser);

    await sup.start();
    // Tick 1 initialises the cursor from next_uid WITHOUT backfilling; tick 2 enqueues.
    expect(await waitUntil(() => inserted.has('trg-ud::77'))).toBe(true);
    await sup.stop();

    expect(cursors.get('trg-ud')).toBe('78');
    expect(calls[0]).toEqual({ actionName: 'fetch_messages', args: {} });          // no `since` yet
    expect(calls[1]).toEqual({ actionName: 'fetch_messages', args: { since: '78' } });
    // The enqueued body is the item as JSON text (what the queue actually persists).
    expect(JSON.parse(inserted.get('trg-ud::77')!.rawBody.toString('utf8'))).toEqual({ uid: '77', subject: 'olá' });
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
