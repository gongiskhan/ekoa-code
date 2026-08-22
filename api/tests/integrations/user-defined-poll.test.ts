/**
 * Layer 1 — generic USER-DEFINED event source (2A-S4).
 *
 * Drives `pollUserDefinedSource` through the WIRED path, not a mock of it: the injected `call` is
 * the REAL `executeUserIntegrationAction` (the exact lambda server.ts binds into the listener
 * supervisor) with only the HTTP transport faked, the definitions registry is the REAL on-disk
 * registry (a fixture copy of api/assets/integrations plus one synthetic `poll-demo` package), and
 * the cursor/queue deps are the REAL listener-state + event-queue stores over
 * mongodb-memory-server. So the assertions see what production sees — including the queue's
 * payload being JSON *TEXT*, which a pre-parsed fixture would have hidden.
 *
 * Proves the slice's acceptance:
 *   - the poll goes through the executor, driven by the package's `listenerConfig`
 *     (pollAction / eventArrayField / dedupKeyField / cursorField) + the trigger's actionName override
 *   - AUTOMATION-BACKED poll actions (the citius shape) run through the executor's automation seam —
 *     which the composition root must inject (a static guard pins every call site) — and their
 *     response is unwrapped from the automation run envelope before the field paths are applied
 *   - NO BACKFILL pinned at INITIALIZATION, not at the first successful poll: the review's exact
 *     event-losing sequence is a committed regression test
 *   - CURSOR AFTER ENQUEUE: every item is durable before the cursor moves; an enqueue that throws,
 *     or an item with no dedup key, leaves the cursor exactly where it was
 *   - DETERMINISTIC dedup key: the same item re-polled (even re-serialised with its keys in a
 *     different order) collides on the queue's UNIQUE(trigger, dedupKey) and inserts nothing new
 *   - CANCEL-SAFE: a listener cancelled mid-tick enqueues nothing further and writes no cursor
 *   - HONEST DEGRADE: the shipped `imap` package's poll action declares a transport the executor
 *     does not implement, so the tick throws "not available in this version" — no HTTP call, no
 *     enqueue, no cursor, and never a fabricated empty mailbox.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { eventQueue, listenerState, integrationConfigs, automations, automationRuns } from '../../src/data/stores.js';
import { automationBackedActionHandler, type ActionRunDeps } from '../../src/automation/service.js';
import type { StepOutput } from '../../src/automation/types.js';
import { loadConfig, __resetConfigForTests } from '../../src/config.js';
import { encrypt } from '../../src/data/crypto.js';
import { refreshDefinitions } from '../../src/integrations/definitions.js';
import { claimNext, type QueuedEvent } from '../../src/events/queue.js';
import { readListenerCursor, writeListenerCursor } from '../../src/events/listener-state.js';
import { enqueueListenerEvent } from '../../src/events/listener-supervisor.js';
import { executeUserIntegrationAction, type FetchLike } from '../../src/integrations/action-executor.js';
import {
  pollUserDefinedSource,
  type UserDefinedPollDeps,
} from '../../src/integrations/event-sources/user-defined-poll.js';
import type { EnqueueInput, EnqueueResult } from '../../src/integrations/event-sources/platform-poll.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_INTEGRATIONS = join(__dirname, '..', '..', 'assets', 'integrations');

const NOW = '2026-07-27T10:00:00.000Z';
const ORG = 'orgA';
const OWNER = 'user-owner';
// A2: a listener trigger resolves its integration package TENANT-SCOPED, so a real TriggerDoc's
// orgId/ownerUserId (both REQUIRED fields on it) travel with the poll. A trigger without an org is
// refused outright rather than resolved against the process-wide runtime tier, so the fixture
// carries what production always has.
const TRIGGER = { id: 'trg-ud-1', integrationKey: 'poll-demo', orgId: ORG, ownerUserId: OWNER };
const API_KEY = 'demo-secret-key-value';

let mem: MongoMemoryServer;
let fixtureRoot: string;

// --- fake HTTP transport (the ONLY thing stubbed on the executor path) ----------------------
interface FakeResponse {
  ok: boolean; status: number; statusText?: string;
  headers: { forEach: (cb: (v: string, k: string) => void) => void };
  text: () => Promise<string>;
}
function mkResponse(status: number, body: string): FakeResponse {
  return { ok: status >= 200 && status < 300, status, statusText: '', headers: { forEach: () => undefined }, text: async () => body };
}
function fakeFetch(handler: (url: string) => FakeResponse): { fn: FetchLike; urls: string[] } {
  const urls: string[] = [];
  const fn: FetchLike = async (url) => {
    urls.push(url);
    return handler(url) as unknown as Response;
  };
  return { fn, urls };
}
/** A transport that always answers with the given poll body, whatever the query. */
function respondWith(body: unknown) {
  return fakeFetch(() => mkResponse(200, JSON.stringify(body)));
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32-characters!';
  process.env.JWT_SECRET = 's';
  __resetConfigForTests();
  loadConfig();

  // REAL registry, fixture root: the shipped packages (so `imap` is the real shipped one) plus a
  // synthetic HTTP-backed listener package standing in for any user-defined integration.
  fixtureRoot = mkdtempSync(join(tmpdir(), 'ekoa-udpoll-'));
  cpSync(REAL_INTEGRATIONS, fixtureRoot, { recursive: true });
  mkdirSync(join(fixtureRoot, 'poll-demo'), { recursive: true });
  writeFileSync(
    join(fixtureRoot, 'poll-demo', 'config.json'),
    JSON.stringify({
      version: '1.0',
      integrationKey: 'poll-demo',
      displayName: 'Poll Demo',
      authType: 'api_key',
      provider: 'demo',
      category: 'test',
      configSchema: [],
      actions: [
        {
          actionName: 'fetch_items',
          description: 'poll items',
          mutates: false,
          httpConfig: {
            method: 'GET',
            baseUrl: 'https://poll.demo.example',
            path: '/items',
            headers: { Authorization: 'Bearer {{api_key}}' },
            queryParams: { since: '{{since}}' },
          },
        },
        {
          actionName: 'fetch_items_alt',
          description: 'poll items (alternate action, for the trigger-level override)',
          mutates: false,
          httpConfig: { method: 'GET', baseUrl: 'https://poll.demo.example', path: '/alt-items', queryParams: { since: '{{since}}' } },
        },
        {
          // The citius shape: a poll action backed by an automation, not by HTTP.
          actionName: 'fetch_items_automation',
          description: 'poll items via a bound automation',
          mutates: false,
          automationBinding: { automationId: 'demo-poll-automation', passCredentials: true },
        },
      ],
      listenerConfig: {
        pollAction: 'fetch_items',
        intervalMs: 60_000,
        cursorField: 'next',
        eventArrayField: 'items',
        dedupKeyField: 'id',
        events: [{ name: 'item.created', labelPt: 'Quando chega um item novo' }],
      },
    }),
    'utf-8',
  );
  process.env.EKOA_INTEGRATIONS_DIR = fixtureRoot;
  refreshDefinitions();

  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_ud_poll');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
  delete process.env.EKOA_INTEGRATIONS_DIR;
  refreshDefinitions();
  rmSync(fixtureRoot, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const s of [eventQueue, listenerState, integrationConfigs, automations, automationRuns]) await s.deleteMany({});
  // The automation the fixture package's `fetch_items_automation` binds to. `runAutomationForAction`
  // resolves it and refuses one it does not own, so the automation-backed cases need a real row -
  // the price of driving the REAL handler instead of a hardcoded answer.
  await automations.insert({
    _id: 'demo-poll-automation', id: 'demo-poll-automation', name: 'poll', description: 'poll',
    ownerUserId: OWNER, orgId: ORG, steps: [],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as never);
  // The owner's CONNECTED credential rows (real crypto), so the executor takes the live path for
  // both packages — an `imap` failure below can only ever be the transport, never `not_connected`.
  await integrationConfigs.insert({
    _id: 'cfg-poll-demo', orgId: ORG, ownerUserId: OWNER, integrationKey: 'poll-demo',
    enabled: true, credentialsCiphertext: encrypt(JSON.stringify({ api_key: API_KEY })),
  });
  await integrationConfigs.insert({
    _id: 'cfg-imap', orgId: ORG, ownerUserId: OWNER, integrationKey: 'imap',
    enabled: true, credentialsCiphertext: encrypt(JSON.stringify({ host: 'imap.example.com', username: 'u', password: 'pw-value-1' })),
  });
});

/**
 * The production dep bundle: `call` is EXACTLY what server.ts binds into the supervisor
 * (executeUserIntegrationAction closed over the trigger's org + owner), with only the HTTP
 * transport injected. Cursor + enqueue are the real stores.
 */
function realDeps(fetchImpl: FetchLike, over: Partial<UserDefinedPollDeps> = {}): UserDefinedPollDeps {
  return {
    call: (input) =>
      executeUserIntegrationAction(
        { orgId: ORG, ownerUserId: OWNER, integrationKey: input.integrationKey, actionName: input.actionName, args: input.args },
        { fetchImpl },
      ),
    readCursor: (id) => readListenerCursor(id),
    writeCursor: (id, cursor) => writeListenerCursor(id, cursor, NOW),
    enqueue: (input) => enqueueListenerEvent(input, NOW),
    now: () => NOW,
    ...over,
  };
}

/** Every queued row, oldest first. */
async function queuedRows(): Promise<QueuedEvent[]> {
  const rows = (await eventQueue.find({})) as QueuedEvent[];
  return rows.sort((a, b) => a._id.localeCompare(b._id));
}

/** Initialise the listener the way the very first tick does, so a test can start "steady state". */
async function initialiseCursor(cursor: string): Promise<void> {
  const t = respondWith({ items: [{ id: 'seed', name: 'seeded' }], next: cursor });
  const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn));
  expect(res.initialized).toBe(true);
  expect(await queuedRows()).toHaveLength(0);
}

// ---------------------------------------------------------------------------------------------

describe('pollUserDefinedSource — first poll initialises the cursor without backfilling', () => {
  it('adopts the provider cursor and enqueues NOTHING, even when the response is full of history', async () => {
    const t = respondWith({
      items: [{ id: 'old-1' }, { id: 'old-2' }, { id: 'old-3' }],
      next: '1042',
    });
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn));

    expect(res).toMatchObject({ polled: false, enqueued: 0, initialized: true, cursorAdvanced: true });
    expect(await queuedRows()).toHaveLength(0);          // no backfill of the mailbox history
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042');
    // The initialising call carries no `since` (there is no cursor yet) — the empty template is
    // dropped rather than sent as `since=`.
    expect(t.urls).toHaveLength(1);
    expect(t.urls[0]).toBe('https://poll.demo.example/items');
  });

  it('refuses to start (throws) when the provider returns ITEMS but no cursorField — rather than backfilling', async () => {
    const t = respondWith({ items: [{ id: 'a' }] }); // no `next`
    await expect(pollUserDefinedSource(TRIGGER, realDeps(t.fn))).rejects.toThrow(/item\(s\) but no "next"/);
    expect(await queuedRows()).toHaveLength(0);
    // Nothing delivered AND nothing discarded: the items are still at the provider.
    expect(await readListenerCursor(TRIGGER.id)).toBeUndefined();
  });
});

describe('pollUserDefinedSource — the no-backfill boundary is INITIALIZATION, not the first success', () => {
  /**
   * REGRESSION (review finding, 2A-S4): pinning "first poll" on the first SUCCESSFUL poll loses
   * real events. With the boundary at first-success, an empty-and-cursorless first response threw,
   * the listener stayed "never polled", and the NEXT attempt — by then holding a message that had
   * arrived in the meantime — treated that message as history and silently discarded it.
   */
  it("an empty first response ARMS the listener, so a message arriving before the next tick is DELIVERED", async () => {
    // Tick 1: the provider is observably empty and returns no cursor.
    const t1 = respondWith({ items: [] });
    const first = await pollUserDefinedSource(TRIGGER, realDeps(t1.fn));
    expect(first).toMatchObject({ polled: false, enqueued: 0, initialized: true, stalled: true });
    expect(first.stallReason).toMatch(/armed/);
    expect(await queuedRows()).toHaveLength(0);
    // The listener is initialised (armed), NOT "never polled".
    expect(await readListenerCursor(TRIGGER.id)).toEqual({ initializedAt: NOW, cursor: null });

    // …a real message arrives, and the very next tick must DELIVER it (this is the event the old
    // shape swallowed), adopting the cursor that finally came with it.
    const t2 = respondWith({ items: [{ id: 'REAL-1', subject: 'urgente' }], next: '9001' });
    const second = await pollUserDefinedSource(TRIGGER, realDeps(t2.fn));

    expect(second).toMatchObject({ polled: true, enqueued: 1, cursorAdvanced: true });
    const rows = await queuedRows();
    expect(rows.map((r) => r.dedupKey)).toEqual(['REAL-1']);
    expect(JSON.parse(rows[0]!.payload as string)).toEqual({ id: 'REAL-1', subject: 'urgente' });
    expect(await readListenerCursor(TRIGGER.id)).toBe('9001');
  });

  it('stays ARMED (delivering, never re-discarding) while the provider still returns no cursor', async () => {
    await pollUserDefinedSource(TRIGGER, realDeps(respondWith({ items: [] }).fn));
    const t = respondWith({ items: [{ id: 'A' }] }); // still no `next`
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn));
    expect(res).toMatchObject({ enqueued: 1, cursorAdvanced: false, stalled: true });
    expect((await queuedRows()).map((r) => r.dedupKey)).toEqual(['A']);
    // Marker preserved: a later tick is still ARMED, never re-entering the discarding phase.
    expect(await readListenerCursor(TRIGGER.id)).toEqual({ initializedAt: NOW, cursor: null });
    expect(t.urls[0]).toBe('https://poll.demo.example/items'); // no `since` — none exists yet
  });

  it('refuses to resume from an unrecognised persisted cursor rather than re-running the discard', async () => {
    await writeListenerCursor(TRIGGER.id, { something: 'else' }, NOW);
    const t = respondWith({ items: [{ id: 'A' }], next: '2' });
    await expect(pollUserDefinedSource(TRIGGER, realDeps(t.fn))).rejects.toThrow(/unrecognised object/);
    expect(t.urls).toHaveLength(0);
    expect(await queuedRows()).toHaveLength(0);
  });
});

describe('pollUserDefinedSource — automation-backed poll actions (the citius shape)', () => {
  /**
   * citius — the one SHIPPED non-deferred user-defined listener source — polls an
   * `automationBinding` action, not an HTTP one. Two things must hold, and the review found the
   * first one broken: the composition root MUST inject the automation seam into the executor it
   * hands the supervisor, and the automation run envelope { runId, status, summary, output } must
   * be unwrapped before the package's listenerConfig paths are applied (they are written against
   * the action's OWN output).
   */
  const AUTOMATION_TRIGGER = { ...TRIGGER, pollActionName: 'fetch_items_automation' };
  const AUTOMATION_ID = 'demo-poll-automation'; // what the fixture package's binding names

  /**
   * The production dep bundle WITH the automation seam - `automationBackedActionHandler`, the SAME
   * function `server.ts` binds, so the ENVELOPE these tests read is the one production produces.
   *
   * WHY THAT MATTERS, AND WHAT IT REPLACED. This helper used to HARDCODE the seam's answer as
   * `{runId:'run-1', status:'completed', summary:'ok', output}` - a literal of the automation leg's
   * envelope. So the one test in this repo named for "resolve the paths against the OUTPUT, not the
   * envelope" could not observe the envelope at all: it was reading back the constant beside it.
   * The REPLAY leg answered a different shape entirely (`{replayed, recipeVersion, output}`), which
   * `pollBody` does not unwrap, and this file stayed green while a replayed listener silently
   * delivered nothing forever.
   *
   * `leg` selects which half of `runAutomationForAction` produces the answer:
   *
   *  - `'automation'` runs the real mapping over a real automation row and a real run record, with
   *    the ENGINE injected (`deps.run` - the seam that exists for exactly this) and the replay left
   *    alone: there is no recipe in the store for this action, so the real replay module honestly
   *    answers `no-recipe` and falls through.
   *  - `'replay'` supplies the replay's OUTCOME through the handler's own `replay` dep, typed as the
   *    real `ReplayResult`. The envelope is still built by production code. That a real replay of a
   *    real recipe reaches this leg with this shape is proved end to end, against a real server and
   *    a real machine boundary, in `automation/discovery-replay-acceptance.test.ts`; what is proved
   *    HERE is that the listener rail reads what that leg answers.
   */
  function autoDeps(
    leg: 'automation' | 'replay',
    output: (args: Record<string, unknown>) => unknown,
  ) {
    const seen: Array<{ args: Record<string, unknown>; credentialFields: Record<string, unknown> }> = [];
    let runSeq = 0;
    const deps = realDeps(respondWith({}).fn, {
      call: (input) =>
        executeUserIntegrationAction(
          { orgId: ORG, ownerUserId: OWNER, integrationKey: input.integrationKey, actionName: input.actionName, args: input.args },
          {
            runAutomationBackedAction: automationBackedActionHandler({
              ...(leg === 'replay'
                ? {
                  replay: (async (i) => {
                    seen.push({ args: i.args, credentialFields: {} });
                    return { outcome: 'ok', calls: [], data: output(i.args), recipeVersion: 4 };
                  }) as ActionRunDeps['replay'],
                }
                : {
                  run: (async (automationId, _ctx, opts) => {
                    const runId = opts?.runId ?? `run-${++runSeq}`;
                    // What the AUTOMATION was actually given, taken apart the way the binding puts
                    // it together (`passCredentials` nests the decrypted fields under
                    // `inputs.credentials`; the args pass through beside them).
                    const { credentials, ...args } = (opts?.inputs ?? {}) as Record<string, unknown>;
                    seen.push({ args, credentialFields: (credentials ?? {}) as Record<string, unknown> });
                    // A REAL RUN RECORD, because `extractActionRunOutput` reads one - and its step
                    // output is typed as the engine's own `StepOutput`, so a fixture that drifts
                    // from what the engine writes is a compile error rather than a green test.
                    const stepOutput: StepOutput = {
                      kind: 'api_call',
                      status: 200,
                      responseHeaders: {},
                      responseBody: JSON.stringify(output((opts?.inputs ?? {}) as Record<string, unknown>)),
                      responseBodyIsJson: true,
                      truncated: false,
                      durationMs: 1,
                    };
                    await automationRuns.insert({
                      _id: runId, id: runId, automationId, status: 'completed',
                      steps: [{ stepId: 's1', index: 0, description: 'poll', status: 'completed', output: stepOutput }],
                    } as never);
                    return { runId, status: 'completed', summary: 'ok' };
                  }) as ActionRunDeps['run'],
                }),
            }) as never,
          },
        ),
    });
    return { deps, seen };
  }

  it('fails LOUDLY (automation_required) when the composition root omits the automation seam', async () => {
    // This is the regression the review caught: the listener wiring called the executor without
    // `runAutomationBackedAction`, so citius' poll could never run.
    const t = respondWith({});
    await expect(pollUserDefinedSource(AUTOMATION_TRIGGER, realDeps(t.fn)))
      .rejects.toThrow(/\(automation_required\)/);
    expect(await queuedRows()).toHaveLength(0);
    expect(await readListenerCursor(AUTOMATION_TRIGGER.id)).toBeUndefined();
  });

  it('runs through the seam and resolves the listenerConfig paths against the run OUTPUT, not the envelope', async () => {
    const { deps, seen } = autoDeps('automation', (args) =>
      args.since === undefined ? { items: [], next: '54' } : { items: [{ id: 'N1', assunto: 'notificação' }], next: '55' },
    );

    const first = await pollUserDefinedSource(AUTOMATION_TRIGGER, deps);
    expect(first).toMatchObject({ initialized: true, enqueued: 0 });
    expect(await readListenerCursor(AUTOMATION_TRIGGER.id)).toBe('54');

    const second = await pollUserDefinedSource(AUTOMATION_TRIGGER, deps);
    expect(second).toMatchObject({ enqueued: 1, cursorAdvanced: true });
    expect((await queuedRows()).map((r) => r.dedupKey)).toEqual(['N1']);
    expect(await readListenerCursor(AUTOMATION_TRIGGER.id)).toBe('55');
    // The bound automation received the poll's `since` and the owner's decrypted credentials.
    expect(seen[1]!.args).toEqual({ since: '54' });
    expect(seen[1]!.credentialFields).toMatchObject({ api_key: API_KEY });
  });

  /**
   * THE SAME TICK, ANSWERED BY THE REPLAY LEG. This is the case the file could not have.
   *
   * A replayed action used to answer a DIFFERENT ENVELOPE - `{replayed, recipeVersion, output}` -
   * and `pollBody` unwraps only when it sees both a string `runId` and a string `status`. So the
   * package's field paths resolved against the envelope, `cursorField` and `eventArrayField` both
   * read `undefined`, and the tick reported a quiet provider. Permanently: the replay keeps
   * SUCCEEDING, so no drift ever fires, `putRecipe` refuses to overwrite, and nothing clears the
   * recipe - the listener delivers nothing again for the life of the row, and the only signal is a
   * `stalled` flag that also appears for ordinary empty polls.
   *
   * Everything here is the same as the case above except which leg answers, which is the point: a
   * replay must be indistinguishable from the run it replaces.
   */
  it('a REPLAYED tick behaves exactly like the automation tick - the envelope is one shape', async () => {
    const { deps, seen } = autoDeps('replay', (args) =>
      args.since === undefined ? { items: [], next: '54' } : { items: [{ id: 'N1', assunto: 'notificação' }], next: '55' },
    );

    const first = await pollUserDefinedSource(AUTOMATION_TRIGGER, deps);
    expect(first).toMatchObject({ initialized: true, enqueued: 0 });
    // THE ESTABLISHING TICK ADOPTS THE PROVIDER'S CURSOR. Against the old envelope it adopted
    // nothing (`readPath(envelope, 'next')` is `undefined`), armed the listener instead, and every
    // later tick answered `{polled:true, enqueued:0, cursorAdvanced:false, stalled:true}`.
    expect(await readListenerCursor(AUTOMATION_TRIGGER.id)).toBe('54');

    const second = await pollUserDefinedSource(AUTOMATION_TRIGGER, deps);
    expect(second).toMatchObject({ enqueued: 1, cursorAdvanced: true });
    expect((await queuedRows()).map((r) => r.dedupKey)).toEqual(['N1']);
    expect(await readListenerCursor(AUTOMATION_TRIGGER.id)).toBe('55');
    expect(seen[1]!.args).toEqual({ since: '54' });
  });

  it('GUARD: every composition-root call of the executor passes the automation seam', async () => {
    // The bug class, made machine-caught: the listener wiring called executeUserIntegrationAction
    // without `runAutomationBackedAction`, silently disabling every automation-backed action of
    // every user-defined integration (citius' poll among them).
    //
    // WHAT THIS GUARD CAN AND CANNOT CATCH, because it read as more than it is. It is a TEXT scan,
    // so it catches a call site that stops passing the seam - which is the failure it was written
    // for, and which is otherwise unreachable from a test: the supervisor's dep bundle is private
    // to the composition root. It does NOT catch a rebinding of that identifier to something else,
    // and the identifier was in fact rebindable to the pre-P2 inline mapping - dropping the action
    // identity, the write assent and `mutates` - with the whole lane green. THAT is pinned at
    // runtime, against the real `buildApp`, by `automation/composition-root-action-seam.test.ts`.
    // SLICE S1 WIDENED WHAT "THE SEAM" MEANS HERE. The composition root now binds ONE `executorDeps`
    // bundle - the automation handler plus the two evidence seams - and every call site spreads it,
    // precisely because this guard's own comment predicted the failure: a second seam with the same
    // silent-omission property doubles the chance of a half-landed wiring. A call site therefore
    // satisfies this scan by passing the BUNDLE or the bare handler, and the bundle's own contents
    // are asserted separately below. Without that second half, a bundle that quietly stopped
    // carrying a seam would satisfy a scan that only ever looks at call sites - i.e. the widening
    // would have WEAKENED the guard.
    const src = await readFile(join(__dirname, '..', '..', 'src', 'server.ts'), 'utf8');
    const sites = src.split('executeUserIntegrationAction(').slice(1);
    expect(sites.length).toBeGreaterThanOrEqual(2); // automation `integration` step + listener poll
    for (const [i, site] of sites.entries()) {
      const head = site.slice(0, 900);
      expect.soft(
        head.includes('runAutomationBackedAction') || head.includes('executorDeps'),
        `server.ts executor call site #${i + 1} must pass the executor seams (the bundle, or the bare handler)`,
      ).toBe(true);
    }

    // THE BUNDLE ITSELF, seam by seam. Dropping any one from the binding is the exact failure this
    // guard exists for, and it is invisible to a call-site scan once the call sites spread an object.
    //
    // THE WINDOW IS THE LITERAL, NOT A CHARACTER COUNT (slice S9). This used to read the first 600
    // characters of the declaration, which made the guard's reach depend on how much PROSE the
    // binding carried: adding the tenant-read seam with its comment pushed `collectRunEvidence` past
    // 600 and reddened the case for a reason that had nothing to do with the wiring. Worse in the
    // other direction - a future comment could have pushed a seam out of the window and the guard
    // would have gone on passing while the seam it was watching had been deleted. The window now
    // ends where the object literal ends, so it covers every member however the file is commented.
    const bundle = src.split('const executorDeps: ExecutorDeps = {')[1];
    expect(bundle, 'server.ts must bind ONE executorDeps bundle').toBeTruthy();
    const end = (bundle ?? '').indexOf('\n  };');
    expect(end, 'the executorDeps literal must close at its own indentation').toBeGreaterThan(0);
    const decl = (bundle ?? '').slice(0, end);
    for (const seam of [
      'runAutomationBackedAction',
      // SLICE S9. Unbound, the shipped `citius processos` action answers `unsupported_backing_type`
      // on every rail - the same silent-omission class as the evidence seams below.
      'readTenantDataset',
      'recordActionEvidence',
      'collectRunEvidence',
    ]) {
      expect.soft(decl, `executorDeps must bind ${seam}`).toContain(seam);
    }
  });

  it('does NOT unwrap a plain provider body that merely has an `output` key', async () => {
    const body = { output: 'ignored', items: [{ id: 'P1' }], next: '2' };
    await pollUserDefinedSource(TRIGGER, realDeps(respondWith({ items: [], next: '1' }).fn));
    const res = await pollUserDefinedSource(TRIGGER, realDeps(respondWith(body).fn));
    expect(res).toMatchObject({ enqueued: 1, cursorAdvanced: true });
  });
});

describe('pollUserDefinedSource — steady state through the REAL executor', () => {
  it('sends the stored cursor as `since`, enqueues one durable JSON-TEXT event per item, then advances', async () => {
    await initialiseCursor('1042');

    const item1 = { id: 'M1', subject: 'hello', flags: ['seen'], meta: { folder: 'INBOX' } };
    const item2 = { id: 'M2', subject: 'world', flags: [], meta: { folder: 'INBOX' } };
    const t = respondWith({ items: [item1, item2], next: '1044' });
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn));

    expect(res).toMatchObject({ polled: true, enqueued: 2, cursorAdvanced: true });
    expect(res.stalled).toBeFalsy();
    // The executor built the real request from the package's httpConfig + the poll's `since` arg.
    expect(t.urls[0]).toBe('https://poll.demo.example/items?since=1042');

    const rows = await queuedRows();
    expect(rows.map((r) => r._id)).toEqual(['trg-ud-1::M1', 'trg-ud-1::M2']);
    // THE REAL SHAPE: the queue stores the payload as JSON *text*, not an object.
    expect(typeof rows[0]!.payload).toBe('string');
    expect(JSON.parse(rows[0]!.payload as string)).toEqual(item1);
    expect(JSON.parse(rows[1]!.payload as string)).toEqual(item2);
    // …and the row is claimable by the ordinary dispatcher (nothing special about a listener row).
    const claimed = await claimNext('2026-07-27T23:59:59Z');
    expect(claimed?.dedupKey).toBe('M1');

    expect(await readListenerCursor(TRIGGER.id)).toBe('1044');
  });

  it('honours the trigger-level pollConfig.actionName override', async () => {
    await initialiseCursor('7');
    const t = respondWith({ items: [], next: '7' });
    await pollUserDefinedSource({ ...TRIGGER, pollActionName: 'fetch_items_alt' }, realDeps(t.fn));
    expect(t.urls[0]).toBe('https://poll.demo.example/alt-items?since=7');
  });

  it('turns a failed poll action into a throw carrying the executor code (backoff + audit, never silent)', async () => {
    await initialiseCursor('1042');
    const t = fakeFetch(() => mkResponse(503, JSON.stringify({ message: 'upstream down' })));
    await expect(pollUserDefinedSource(TRIGGER, realDeps(t.fn))).rejects.toThrow(/\(transient_5xx\)/);
    expect(await queuedRows()).toHaveLength(0);
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042'); // unchanged
  });
});

describe('pollUserDefinedSource — the cursor advances ONLY after the item is durably enqueued', () => {
  it('writes every enqueue BEFORE the cursor write (observed ordering, not inferred)', async () => {
    await initialiseCursor('1042');
    const order: string[] = [];
    const t = respondWith({ items: [{ id: 'A' }, { id: 'B' }], next: '1050' });
    await pollUserDefinedSource(TRIGGER, realDeps(t.fn, {
      enqueue: async (input: EnqueueInput): Promise<EnqueueResult> => {
        order.push(`enqueue:${input.dedupKey}`);
        return enqueueListenerEvent(input, NOW);
      },
      writeCursor: async (id, cursor) => {
        order.push(`cursor:${String(cursor)}`);
        await writeListenerCursor(id, cursor, NOW);
      },
    }));
    expect(order).toEqual(['enqueue:A', 'enqueue:B', 'cursor:1050']);
  });

  it('leaves the cursor untouched when an enqueue throws (the item is retried, never skipped)', async () => {
    await initialiseCursor('1042');
    const t = respondWith({ items: [{ id: 'A' }, { id: 'B' }], next: '1050' });
    await expect(pollUserDefinedSource(TRIGGER, realDeps(t.fn, {
      enqueue: async (input: EnqueueInput): Promise<EnqueueResult> => {
        if (input.dedupKey === 'B') throw new Error('queue write failed');
        return enqueueListenerEvent(input, NOW);
      },
    }))).rejects.toThrow(/queue write failed/);
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042');
    // A survived the tick durably; the retry re-fetches the window and dedupes it.
    expect((await queuedRows()).map((r) => r.dedupKey)).toEqual(['A']);
  });

  it('STALLS the cursor (observably) when an item has no extractable dedup key — never a silent drop', async () => {
    await initialiseCursor('1042');
    const t = respondWith({ items: [{ id: 'A' }, { subject: 'no id here' }, { id: 'C' }], next: '1050' });
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn));

    expect(res).toMatchObject({ polled: true, enqueued: 2, cursorAdvanced: false, stalled: true });
    expect(res.stallReason).toMatch(/dedup key/);
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042');
    expect((await queuedRows()).map((r) => r.dedupKey)).toEqual(['A', 'C']);
  });

  it('STALLS observably when the response carries items but no cursorField', async () => {
    await initialiseCursor('1042');
    const t = respondWith({ items: [{ id: 'A' }] });
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn));
    expect(res).toMatchObject({ cursorAdvanced: false, stalled: true, enqueued: 1 });
    expect(res.stallReason).toMatch(/no "next" cursor/);
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042');
  });
});

describe('pollUserDefinedSource — deterministic dedup key', () => {
  it('re-polling the same window inserts nothing new, even when the item is re-serialised differently', async () => {
    await initialiseCursor('1042');
    const t1 = respondWith({ items: [{ id: 'M1', subject: 'hello', tags: ['a', 'b'] }], next: '1043' });
    const first = await pollUserDefinedSource(TRIGGER, realDeps(t1.fn));
    expect(first.enqueued).toBe(1);

    // Same logical item, keys emitted in a different order + an extra field: the dedup key is the
    // item's `id`, a pure function of the item — NOT a hash of the serialisation.
    const t2 = respondWith({ items: [{ tags: ['a', 'b'], subject: 'hello', id: 'M1', etag: 'W/"9"' }], next: '1044' });
    const second = await pollUserDefinedSource(TRIGGER, realDeps(t2.fn));

    expect(second.enqueued).toBe(0);           // UNIQUE(trigger, dedupKey) absorbed it
    expect(second.cursorAdvanced).toBe(true);  // a duplicate still counts as full success
    const rows = await queuedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!._id).toBe('trg-ud-1::M1');
    // The stored payload is the FIRST delivery's body (the queue never rewrites a durable row).
    expect(JSON.parse(rows[0]!.payload as string)).toEqual({ id: 'M1', subject: 'hello', tags: ['a', 'b'] });
  });

  it('stringifies a non-string id deterministically (numeric UIDs dedupe against themselves)', async () => {
    await initialiseCursor('1042');
    const body = { items: [{ id: 1043 }], next: '1043' };
    expect((await pollUserDefinedSource(TRIGGER, realDeps(respondWith(body).fn))).enqueued).toBe(1);
    expect((await pollUserDefinedSource(TRIGGER, realDeps(respondWith(body).fn))).enqueued).toBe(0);
    expect((await queuedRows()).map((r) => r._id)).toEqual(['trg-ud-1::1043']);
  });
});

describe('pollUserDefinedSource — cancel-safety (no work after stop)', () => {
  it('a listener cancelled while the poll was in flight enqueues nothing and writes no cursor', async () => {
    await initialiseCursor('1042');
    let cancelled = false;
    const t = fakeFetch(() => {
      cancelled = true; // the trigger is deleted while the HTTP call is in flight
      return mkResponse(200, JSON.stringify({ items: [{ id: 'A' }, { id: 'B' }], next: '1050' }));
    });
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn, { isCancelled: () => cancelled }));

    expect(res).toMatchObject({ enqueued: 0, cursorAdvanced: false });
    expect(await queuedRows()).toHaveLength(0);
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042');
  });

  it('a cancel mid-batch stops enqueuing immediately and still writes no cursor', async () => {
    await initialiseCursor('1042');
    let cancelled = false;
    const t = respondWith({ items: [{ id: 'A' }, { id: 'B' }, { id: 'C' }], next: '1050' });
    const res = await pollUserDefinedSource(TRIGGER, realDeps(t.fn, {
      isCancelled: () => cancelled,
      enqueue: async (input: EnqueueInput): Promise<EnqueueResult> => {
        const r = await enqueueListenerEvent(input, NOW);
        cancelled = true; // stop() lands right after the first item is durable
        return r;
      },
    }));

    expect(res).toMatchObject({ enqueued: 1, cursorAdvanced: false });
    expect((await queuedRows()).map((r) => r.dedupKey)).toEqual(['A']); // B and C never attempted
    expect(await readListenerCursor(TRIGGER.id)).toBe('1042');
  });
});

describe('user-defined poll — honest degrade when the transport does not exist (IMAP, deferred)', () => {
  it('the executor refuses an action whose declared transport it does not implement', async () => {
    const t = fakeFetch(() => mkResponse(200, '{}'));
    const r = await executeUserIntegrationAction(
      { orgId: ORG, ownerUserId: OWNER, integrationKey: 'imap', actionName: 'fetch_messages', args: {} },
      { fetchImpl: t.fn },
    );
    expect(r.success).toBe(false);
    expect(r.code).toBe('unsupported_transport');
    expect(r.error).toMatch(/not available in this version/);
    expect(r.error).toMatch(/"imap" transport/);
    // The wording must state what this executor ACTUALLY runs (it also runs automation-backed
    // actions — citius polls through one), not "HTTP only".
    expect(r.error).toMatch(/HTTP-backed and automation-backed actions only/);
    expect(r.data).toBeUndefined();     // never a fabricated empty result
    expect(t.urls).toHaveLength(0);     // and never dialled at a placeholder URL
  });

  it('an IMAP listener tick THROWS the honest reason: nothing enqueued, no cursor, no HTTP call', async () => {
    const t = fakeFetch(() => mkResponse(200, JSON.stringify({ messages: [], next_uid: '1' })));
    const imapTrigger = { id: 'trg-imap', integrationKey: 'imap', orgId: ORG, ownerUserId: OWNER };

    await expect(pollUserDefinedSource(imapTrigger, realDeps(t.fn)))
      .rejects.toThrow(/not available in this version/);

    expect(t.urls).toHaveLength(0);
    expect(await queuedRows()).toHaveLength(0);
    expect(await readListenerCursor(imapTrigger.id)).toBeUndefined();
  });

  it('the shipped imap package still declares the full listener contract (only the transport is missing)', async () => {
    // Guards the defer: the rail is wired for IMAP the moment a transport exists. If someone
    // deletes listenerConfig instead of shipping the transport, this fails.
    const { getDefinition } = await import('../../src/integrations/definitions.js');
    const def = getDefinition('imap');
    expect(def?.listenerConfig).toMatchObject({ pollAction: 'fetch_messages', cursorField: 'next_uid', eventArrayField: 'messages', dedupKeyField: 'uid' });
    expect(def?.actions.find((a) => a.actionName === 'fetch_messages')?.transport).toBe('imap');
  });
});

describe('pollUserDefinedSource — package/listenerConfig validation', () => {
  it('REFUSES a trigger with no org rather than resolving a package unscoped (A2/F5)', async () => {
    // The pre-A2 behaviour here was a fall-through to the sync disk registry, which reads the MERGED
    // cache — baseline PLUS the process-wide runtime tier any tenant can write. An org-less trigger
    // is a broken row (TriggerDoc.orgId is required), so it must fail loudly into the supervisor's
    // backoff rather than quietly poll whatever package happens to be on the box.
    const t = respondWith({});
    await expect(pollUserDefinedSource({ id: 'trg-noorg', integrationKey: 'poll-demo' }, realDeps(t.fn)))
      .rejects.toThrow(/carries no orgId/);
    expect(await queuedRows()).toHaveLength(0);
  });

  it('names the missing piece when the integration is not a pollable listener source', async () => {
    const t = respondWith({});
    await expect(pollUserDefinedSource({ id: 'trg-x', integrationKey: 'slack', orgId: ORG, ownerUserId: OWNER }, realDeps(t.fn)))
      .rejects.toThrow(/has no listenerConfig/);
    await expect(pollUserDefinedSource({ id: 'trg-x', integrationKey: 'nope-not-installed', orgId: ORG, ownerUserId: OWNER }, realDeps(t.fn)))
      .rejects.toThrow(/has no installed package/);
    expect(await queuedRows()).toHaveLength(0);
  });
});
