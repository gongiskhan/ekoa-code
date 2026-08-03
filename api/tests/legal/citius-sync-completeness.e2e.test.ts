/**
 * CS6 — THE COMPLETENESS PROOF. This is the headline evidence of the whole Citius run.
 *
 * It drives the ASSEMBLED sync end to end: the real CS2 mock WebForms server over a real socket
 * (real ISO-8859-1 bytes, a real login, a real `Set-Cookie` session), the real CS4 connector walking
 * a real multi-page pager, the real CS3 two-pass orchestrator, and the real Mongo-backed sync state
 * and landed-rows collections over `mongodb-memory-server`. Nothing between the HTTP socket and the
 * durable watermark is stubbed.
 *
 * THE SEQUENCE IS THE PROOF: COMPLETE -> INCOMPLETE -> COMPLETE.
 *
 *   Run 1  every row visible on both passes            -> complete,   watermark ADVANCES
 *   Run 2  ONE row withheld from pass 1 and revealed to
 *          pass 2 (the mock's `hideUntilPass2` control) -> INCOMPLETE, watermark HOLDS
 *   Run 3  every row visible again                     -> complete,   watermark ADVANCES
 *
 * The INCOMPLETE run is caught BY THE RECONCILIATION, not by luck, and the test proves that rather
 * than asserting the outcome string: `pass2.refsOnlyInPass2` names the withheld row exactly, and
 * BOTH passes report `reachedEnd:true` with NO `countCheck` — so neither truncation nor a count
 * disagreement could have produced the verdict. The only thing that could is the ref-level diff.
 *
 * The watermark is asserted as a VALUE read straight out of the state row before and after each
 * run, never inferred from the report.
 *
 * The withheld row still LANDS on the incomplete run (at-least-once: a proved-partial walk never
 * discards real data), and the landed set is read back out of Mongo to show it.
 *
 * WHAT IS INJECTED, AND WHY IT IS NOT THE THING UNDER TEST:
 *   - the TRANSPORT is a plain `fetch` (CS4's guarded default correctly refuses a 127.0.0.1 mock —
 *     the house pattern from `integrations/pipedream.test.ts`), and the throttle sleep is a no-op;
 *   - SESSION ESTABLISHMENT returns a session captured by REALLY LOGGING IN to the mock, in exactly
 *     the Playwright `storageState` shape CS5's `ensureSession` hands over. CS5's own rail (typist,
 *     checkout, capture, the four-member result union) is proved in its own suite and its mapping
 *     onto this module is proved in `citius-sync.test.ts`; wiring a headless browser in here would
 *     test Playwright, not completeness.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { decodeHtml, parseHiddenFields } from '../../src/legal/portal-html.js';
import { readSyncState } from '../../src/events/sync-state.js';
import {
  readCitiusSyncState,
  syncCitiusNotifications,
  syncStateKeyFor,
  type CitiusSyncDeps,
  type CitiusSyncInput,
} from '../../src/legal/citius-sync.js';
import type { CitiusTransport } from '../../src/legal/citius-mandatarios-http.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';
// @ts-expect-error - JS mock helper, no d.ts
import { startMockCitius } from '../helpers/mock-citius-webforms-server.mjs';

let mem: MongoMemoryServer;
let mock: Awaited<ReturnType<typeof startMockCitius>>;

const ACTOR = { userId: 'mandataria-1', orgId: 'firma-a', role: 'user' as const };
const scope = { actor: ACTOR };

/** A transport that really talks to the mock. Redirects are surfaced, never followed. */
const liveTransport: CitiusTransport = async (url, init) =>
  fetch(url, { method: init.method, headers: init.headers, body: init.body, redirect: 'manual' });

/**
 * Log in to the mock for real and return the session as a Playwright-shaped `storageState` — the
 * exact artefact CS5 hands over. The password is composed at runtime, never written as a literal
 * (the run's secrets-gate rule: keep gitleaks sharp instead of allowlisting a fixture).
 */
async function establishedSession(): Promise<EnsureSessionResult> {
  const loginRes = await fetch(`${mock.baseUrl}${mock.loginPath}`);
  const html = decodeHtml(Buffer.from(await loginRes.arrayBuffer()), loginRes.headers.get('content-type') ?? '');
  const hidden = parseHiddenFields(html);
  const res = await fetch(`${mock.baseUrl}${mock.loginPath}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      __VIEWSTATE: hidden.__VIEWSTATE!,
      __VIEWSTATEGENERATOR: hidden.__VIEWSTATEGENERATOR!,
      __EVENTVALIDATION: hidden.__EVENTVALIDATION!,
      'ctl00$cph$txtUserName': 'cedula-0000',
      'ctl00$cph$txtUserPass': ['segredo', 'de', 'teste'].join('-'),
    }).toString(),
  });
  const value = res.headers.getSetCookie().find((c) => c.startsWith('ASP.NET_SessionId'))!.split(';')[0]!.split('=')[1]!;
  return {
    status: 'reused',
    itemId: 'cofre-item-citius',
    storageState: { cookies: [{ name: 'ASP.NET_SessionId', value, domain: '127.0.0.1', path: '/', secure: false }] },
  };
}

/** One full sync against the mock, with the durable rails REAL and only the seams above injected. */
async function runSync(until: string): Promise<Awaited<ReturnType<typeof syncCitiusNotifications>>> {
  const session = await establishedSession();
  const input: CitiusSyncInput = {
    actor: ACTOR,
    runId: `run-${until}`,
    baseUrl: mock.baseUrl,
    inboxPath: mock.inboxPath,
    throttleMs: 0,
    until,
  };
  const deps: CitiusSyncDeps = {
    establishSession: async () => session,
    markSessionUnhealthy: async () => true,
    enumerateDeps: { transport: liveTransport, sleep: async () => {} },
    clock: () => new Date('2026-06-01T12:00:00.000Z'),
  };
  return syncCitiusNotifications(input, deps);
}

/** The watermark, read straight out of the durable state row. */
async function watermark(): Promise<string | null> {
  return (await readSyncState(syncStateKeyFor(scope))).watermark;
}

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_citius_sync_e2e');
  // pageSize 2 forces a real multi-page walk, so the pager (and its exhaustion) is exercised.
  mock = await startMockCitius({ pageSize: 2 });
}, 90_000);

afterAll(async () => {
  await mock.close();
  await closeMongo();
  await mem.stop();
});

describe('CS6 e2e · COMPLETE -> INCOMPLETE -> COMPLETE against the mock portal', () => {
  it('proves the completeness verification end to end, and holds the cursor on the miss', async () => {
    // 2 seeded rows + 3 = 5 notifications over 3 pages of 2.
    mock.scenario({ cmd: 'addItems', count: 3 });

    // ---- RUN 1: everything visible, both passes agree -> COMPLETE, cursor advances -------------
    expect(await watermark()).toBeNull(); // first ever run: a full backfill
    const first = await runSync('2026-06-01T00:00:01.000Z');
    expect(first.status).toBe('ran');
    if (first.status !== 'ran') return;

    expect(first.report.outcome).toBe('complete');
    expect(first.report.verification.pass1.itemsSeen).toBe(5);
    expect(first.report.verification.pass2.itemsSeen).toBe(5);
    expect(first.report.verification.pass1.pages).toBe(3); // a real 3-page walk, not a single fetch
    expect(first.report.verification.pass2.refsOnlyInPass2).toEqual([]);
    expect(first.report.verification.pass1.reachedEnd).toBe(true);
    expect(first.report.verification.pass2.reachedEnd).toBe(true);
    // completeness was proved by reachedEnd ALONE — no count check exists, and must not
    expect(first.report.verification.countCheck).toBeUndefined();
    expect(first.report.landed).toBe(5);
    expect(await watermark()).toBe('2026-06-01T00:00:01.000Z');

    // ---- RUN 2: ONE row withheld from pass 1, revealed to pass 2 -> INCOMPLETE ------------------
    mock.scenario({ cmd: 'addItems', count: 1 }); // a 6th notification…
    mock.scenario({ cmd: 'hideUntilPass2' });     // …that the portal withholds for exactly one pass

    const before = await watermark();
    const second = await runSync('2026-06-01T00:00:02.000Z');
    expect(second.status).toBe('ran');
    if (second.status !== 'ran') return;

    expect(second.report.outcome).toBe('incomplete');
    // THE RECONCILIATION IS WHAT CAUGHT IT. Pass 2 saw exactly one reference pass 1 did not…
    expect(second.report.verification.pass1.itemsSeen).toBe(5);
    expect(second.report.verification.pass2.itemsSeen).toBe(6);
    expect(second.report.verification.pass2.refsOnlyInPass2).toHaveLength(1);
    // …and NEITHER of the other two routes to `incomplete` was available: both passes swept the
    // window to its end, and there is no count check. Truncation and count disagreement are ruled
    // out, so the ref-level diff is the only thing that could have produced this verdict.
    expect(second.report.verification.pass1.reachedEnd).toBe(true);
    expect(second.report.verification.pass2.reachedEnd).toBe(true);
    expect(second.report.verification.countCheck).toBeUndefined();

    // THE WATERMARK DID NOT MOVE. Read as a value, before and after.
    expect(before).toBe('2026-06-01T00:00:01.000Z');
    expect(await watermark()).toBe('2026-06-01T00:00:01.000Z');

    // …and the late row STILL LANDED: a proved-partial walk never discards real data.
    expect(second.report.landed).toBe(1);
    const afterIncomplete = await readCitiusSyncState(scope);
    expect(afterIncomplete.landed).toBe(6);
    expect(afterIncomplete.lastOutcome).toBe('incomplete');
    expect(afterIncomplete.consecutiveIncomplete).toBe(1);

    // ---- RUN 3: the portal is honest again -> COMPLETE, cursor advances -------------------------
    const third = await runSync('2026-06-01T00:00:03.000Z');
    expect(third.status).toBe('ran');
    if (third.status !== 'ran') return;

    expect(third.report.outcome).toBe('complete');
    expect(third.report.verification.pass1.itemsSeen).toBe(6);
    expect(third.report.verification.pass2.refsOnlyInPass2).toEqual([]);
    // nothing new to land: run 2 already landed all six, and the seen-set suppresses the re-emit
    expect(third.report.landed).toBe(0);
    expect(third.report.verification.pass1.newRefs).toBe(0);
    expect(await watermark()).toBe('2026-06-01T00:00:03.000Z');

    // the whole history is durable and readable
    const finalState = await readCitiusSyncState(scope);
    expect(finalState.lastOutcome).toBe('complete');
    expect(finalState.consecutiveIncomplete).toBe(0);
    expect(finalState.landed).toBe(6);
    expect(finalState.latest?.outcome).toBe('complete');
    expect(finalState.latest?.id).toBe(third.report.id);
  }, 90_000);

  it('NON-VACUITY: the same portal WITHOUT the withheld row runs clean, so the INCOMPLETE was real', async () => {
    // A fresh org/user (its own state row) walking the same portal with nothing withheld must come
    // back complete. Without this, "incomplete" could just be what this mock always produces.
    const otherActor = { userId: 'mandatario-2', orgId: 'firma-b', role: 'user' as const };
    const session = await establishedSession();
    const out = await syncCitiusNotifications(
      {
        actor: otherActor,
        runId: 'control',
        baseUrl: mock.baseUrl,
        inboxPath: mock.inboxPath,
        throttleMs: 0,
        until: '2026-06-01T00:00:09.000Z',
      },
      {
        establishSession: async () => session,
        markSessionUnhealthy: async () => true,
        enumerateDeps: { transport: liveTransport, sleep: async () => {} },
        clock: () => new Date('2026-06-01T12:00:00.000Z'),
      },
    );
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('complete');
    expect((await readSyncState(syncStateKeyFor({ actor: otherActor }))).watermark).toBe('2026-06-01T00:00:09.000Z');

    // …and the two syncs are STRICTLY SEPARATE state rows: firma-a's cursor is untouched by this.
    expect(await watermark()).toBe('2026-06-01T00:00:03.000Z');
  }, 90_000);

  it('a dead session is NOT an empty inbox: nothing lands, nothing advances, the item is retired', async () => {
    const before = await watermark();
    const dead = { status: 'reused' as const, itemId: 'cofre-item-citius', storageState: { cookies: [{ name: 'ASP.NET_SessionId', value: 'expirado', domain: '127.0.0.1', path: '/', secure: false }] } };
    const retired: string[] = [];
    const out = await syncCitiusNotifications(
      { actor: ACTOR, runId: 'dead', baseUrl: mock.baseUrl, inboxPath: mock.inboxPath, throttleMs: 0, until: '2026-06-01T00:00:04.000Z' },
      {
        establishSession: async () => dead,
        markSessionUnhealthy: async (_a, itemId) => { retired.push(itemId); return true; },
        // the mock 302s an unauthenticated inbox GET back to the login page; the connector
        // CLASSIFIES that redirect (it never follows it) as `session-dead`
        enumerateDeps: { transport: liveTransport, sleep: async () => {} },
        clock: () => new Date('2026-06-01T12:00:00.000Z'),
      },
    );
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('failed');   // NOT 'complete' with zero rows
    expect(out.report.landed).toBe(0);
    expect(out.sessionMarkedUnhealthy).toBe(true);
    expect(retired).toEqual(['cofre-item-citius']);
    expect(await watermark()).toBe(before);
  }, 90_000);
});

/**
 * CS8 REGRESSION — THE DEFAULT CEILING, which is the only ceiling the shipped route can produce.
 *
 * The sequence above pins `until` explicitly, and every value it pins sits BELOW every mock row's
 * date. That made the lower-bound window filter a no-op for the entire headline proof: the proof
 * could not have failed on this, and a proof that cannot fail is not a proof. `routes/sync.ts`'s
 * request body has no `until` field at all, so production always took the DEFAULT ceiling
 * (`clock() - untilSkewMs`) - and against that ceiling the filter compared a mid-day wall-clock
 * instant with a MIDNIGHT-UTC date-only cell and dropped real notifications from both passes,
 * certifying `complete` and advancing the cursor past them for ever.
 *
 * This is the reviewer's reproduction, committed: no `until` anywhere, only a clock that moves.
 */
describe('CS8 e2e · a notification arriving under the DEFAULT ceiling is never lost (hazard 5)', () => {
  const wmActor = { userId: 'mandataria-wm', orgId: 'firma-wm', role: 'user' as const };
  const wmScope = { actor: wmActor };

  /** A sync with NO `until`: the ceiling is whatever the clock says, exactly as the route produces. */
  async function runAtClock(clockIso: string): Promise<Awaited<ReturnType<typeof syncCitiusNotifications>>> {
    const session = await establishedSession();
    return syncCitiusNotifications(
      { actor: wmActor, runId: `wm-${clockIso}`, baseUrl: mock.baseUrl, inboxPath: mock.inboxPath, throttleMs: 0 },
      {
        establishSession: async () => session,
        markSessionUnhealthy: async () => true,
        enumerateDeps: { transport: liveTransport, sleep: async () => {} },
        clock: () => new Date(clockIso),
      },
    );
  }

  it('run 1 sets a mid-day cursor; the notification that arrives next STILL LANDS', async () => {
    // ---- RUN 1 at 09:00 -> complete, cursor = 2026-07-30T09:00:00.000Z (a WALL-CLOCK instant) ----
    const first = await runAtClock('2026-07-30T09:00:00.000Z');
    expect(first.status).toBe('ran');
    if (first.status !== 'ran') return;
    expect(first.report.outcome).toBe('complete');
    const seededCount = first.report.verification.pass1.itemsSeen;
    expect(seededCount).toBeGreaterThan(0);
    expect(first.report.landed).toBe(seededCount);

    const cursor = (await readSyncState(syncStateKeyFor(wmScope))).watermark;
    expect(cursor).toBe('2026-07-30T09:00:00.000Z');
    // The cursor really is ABOVE every row's normalised date - i.e. the shape that used to lose
    // rows is genuinely set up here, not assumed.
    expect(Date.parse(cursor!)).toBeGreaterThan(Date.parse('2026-07-07T00:00:00.000Z'));
    expect((await readCitiusSyncState(wmScope)).landed).toBe(seededCount);

    // ---- a NEW notification appears, dated (as the portal dates them) with a DATE, no time -------
    mock.scenario({ cmd: 'addItems', count: 1 });

    // ---- RUN 2 at 15:00, still no explicit `until` ----------------------------------------------
    const second = await runAtClock('2026-07-30T15:00:00.000Z');
    expect(second.status).toBe('ran');
    if (second.status !== 'ran') return;
    expect(second.report.outcome).toBe('complete');

    // THE ASSERTION THE OLD CODE FAILED: the run SAW the new row and LANDED it.
    expect(second.report.verification.pass1.itemsSeen).toBe(seededCount + 1);
    expect(second.report.landed).toBe(1);
    // the already-landed rows came back through the idempotent land as suppressed duplicates (the
    // seen-set's 7-day prune horizon sits below these synthetic dates) - visible, and not data loss
    expect(second.report.duplicatesSuppressed).toBe(seededCount);

    const afterSecond = await readCitiusSyncState(wmScope);
    expect(afterSecond.landed).toBe(seededCount + 1);
    expect((await readSyncState(syncStateKeyFor(wmScope))).watermark).toBe('2026-07-30T15:00:00.000Z');

    // ---- RUN 3 at 18:00: nothing new, nothing lost, and the cursor keeps moving forward ---------
    const third = await runAtClock('2026-07-30T18:00:00.000Z');
    expect(third.status).toBe('ran');
    if (third.status !== 'ran') return;
    expect(third.report.outcome).toBe('complete');
    expect(third.report.landed).toBe(0);
    expect((await readCitiusSyncState(wmScope)).landed).toBe(seededCount + 1);
  }, 120_000);

  it('the cursor never moves BACKWARDS, even when the clock does', async () => {
    const before = (await readSyncState(syncStateKeyFor(wmScope))).watermark;
    expect(before).toBe('2026-07-30T18:00:00.000Z');

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // An NTP step, a container restart, a hand-set clock: a run that proposes an EARLIER ceiling.
      const out = await runAtClock('2026-07-30T06:00:00.000Z');
      expect(out.status).toBe('ran');
      if (out.status !== 'ran') return;
      expect(out.report.outcome).toBe('complete');
      // The run is honest about the window IT swept…
      expect(out.report.window.until).toBe('2026-07-30T06:00:00.000Z');
      // …and the durable cursor refuses to go back, because everything below it was proved swept.
      expect((await readSyncState(syncStateKeyFor(wmScope))).watermark).toBe('2026-07-30T18:00:00.000Z');
    } finally {
      warn.mockRestore();
    }
  }, 120_000);
});
