/**
 * CS6 — the JOIN POINT, unit level: the translation between CS5's session union, CS4's walk union
 * and CS3's enumerate/land contract.
 *
 * This suite is deliberately Mongo-free and portal-free: every seam is injected, so what is under
 * test is the MAPPING and nothing else. The end-to-end proof (COMPLETE -> INCOMPLETE -> COMPLETE
 * against the real CS2 mock, over real sockets and a real Mongo) lives in
 * `citius-sync-completeness.e2e.test.ts`; the metadata-only proof lives in
 * `../security/citius-sync-metadata-only.test.ts`.
 *
 * What it protects, in order of what it would cost to get wrong:
 *   1. `pageTotal` IS NEVER EMITTED. CS1's is a PAGE count, CS3's is an ITEM total compared against
 *      `items.length`; a match OVERRIDES `reachedEnd` and advances the watermark. Either passing
 *      CS4's `advertisedPageCount` through or synthesising one from `rows.length` certifies a
 *      truncated sweep as complete. Asserted as an absent property AND as source text.
 *   2. `incomplete` MAPS TO `reachedEnd:false` AND THE ROWS STILL LAND — a proved-partial walk
 *      never discards real data and never advances the cursor.
 *   3. `session-dead` IS `ok:false` PLUS a Cofre retirement, and `failed` is `ok:false` WITHOUT
 *      one: an ambiguous refusal must never retire a session that was fine.
 *   4. The window's `maxPages` is FORWARDED to the connector, and `pagesWalked` (a number) is what
 *      reaches `EnumerateResult.result.pages` (also a number) — the two other name collisions.
 *   5. A session outcome that is not a session is not a failed sync: `needs-human` / `needs-egress`
 *      run NOTHING and write NOTHING.
 *   6. Identity fails closed, and one org is not one inbox.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SyncRunReport } from '@ekoa/shared';
import type { CitiusNotificacaoMeta } from '../../src/legal/citius-mandatarios.js';
import type { CitiusInboxEnumeration, EnumerateInboxInput } from '../../src/legal/citius-mandatarios-http.js';
import {
  CITIUS_SYNC_ACTION_KEY,
  CitiusSyncError,
  citiusItemDate,
  notificationRowId,
  syncCitiusNotifications,
  syncStateKeyFor,
  toEnumerateResult,
  type CitiusSyncDeps,
  type CitiusSyncInput,
} from '../../src/legal/citius-sync.js';
import type { EnumeratedItem, SeenRef, SyncStateSnapshot, SyncStateStore } from '../../src/events/verified-sync.js';
import type { SyncLessonContext, SyncLessonInput } from '../../src/events/sync-lessons.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';

const MODULE_PATH = fileURLToPath(new URL('../../src/legal/citius-sync.ts', import.meta.url));
const MODULE_SRC = readFileSync(MODULE_PATH, 'utf-8');
/** MODULE_SRC with block + line comments stripped: the docblock legitimately DISCUSSES `pageTotal`. */
const MODULE_CODE = MODULE_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const ACTOR = { userId: 'u1', orgId: 'o1', role: 'user' as const };

// ---------------------------------------------------------------------------
// fixtures + fakes
// ---------------------------------------------------------------------------

function row(n: number, over: Partial<CitiusNotificacaoMeta> = {}): CitiusNotificacaoMeta {
  return {
    ref: `r${n}`,
    processo: `${1000 + n}/26.0T8LSB`,
    data: `2026-06-${String(10 + n).padStart(2, '0')}`,
    tribunal: 'Tribunal Judicial da Comarca de Lisboa',
    ato: 'Citação',
    temDocumento: true,
    ...over,
  };
}

const complete = (rows: CitiusNotificacaoMeta[], pagesWalked = 1): CitiusInboxEnumeration => ({
  status: 'complete', rows, pagesWalked, pages: pageOutcomes(pagesWalked, rows.length),
});
const incomplete = (rows: CitiusNotificacaoMeta[], pagesWalked = 1): CitiusInboxEnumeration => ({
  status: 'incomplete', reason: 'max-pages', rows, pagesWalked, pages: pageOutcomes(pagesWalked, rows.length),
  advertisedPageCount: 9,
});
const sessionDead = (): CitiusInboxEnumeration => ({
  status: 'session-dead', detectedBy: 'login-page', atPage: 2, rows: [row(1)], pagesWalked: 1, pages: pageOutcomes(1, 1),
});
const failedWalk = (error = 'erro de transporte (TypeError)'): CitiusInboxEnumeration => ({
  status: 'failed', error, atPage: 1, rows: [], pagesWalked: 0, pages: [],
});

function pageOutcomes(pages: number, rows: number): CitiusInboxEnumeration['pages'] {
  return Array.from({ length: pages }, (_, i) => ({ page: i + 1, outcome: 'ok' as const, rows }));
}

/** An in-memory `SyncStateStore` that records every mutation, so "the watermark did not move" is
 *  observable as a fact rather than inferred from an outcome string. */
function fakeStore(initial: Partial<SyncStateSnapshot> = {}): SyncStateStore & {
  snapshot: SyncStateSnapshot;
  calls: string[];
  reports: SyncRunReport[];
} {
  const snapshot: SyncStateSnapshot = {
    watermark: null, seenRefs: [], consecutiveIncomplete: 0, consecutiveFailures: 0, ...initial,
  };
  const calls: string[] = [];
  const reports: SyncRunReport[] = [];
  return {
    snapshot, calls, reports,
    read: async () => ({ ...snapshot, seenRefs: [...snapshot.seenRefs] }),
    advanceWatermark: async (watermark: string, newSeen: SeenRef[]) => {
      calls.push('advanceWatermark');
      snapshot.watermark = watermark;
      snapshot.seenRefs = [...snapshot.seenRefs, ...newSeen];
    },
    absorbRefs: async (refs: SeenRef[]) => {
      calls.push('absorbRefs');
      snapshot.seenRefs = [...snapshot.seenRefs, ...refs];
    },
    bumpIncomplete: async () => { calls.push('bumpIncomplete'); snapshot.consecutiveIncomplete += 1; },
    bumpFailure: async () => { calls.push('bumpFailure'); snapshot.consecutiveFailures += 1; },
    saveReport: async (r: SyncRunReport) => { calls.push('saveReport'); reports.push(r); },
  };
}

const reused = (itemId = 'item1'): EnsureSessionResult => ({
  status: 'reused', itemId, storageState: { cookies: [] },
});

/** Wire a sync with every seam injected. `walks` is consumed one per enumeration pass. */
function harness(
  walks: CitiusInboxEnumeration[],
  over: {
    session?: EnsureSessionResult;
    store?: ReturnType<typeof fakeStore>;
    input?: Partial<CitiusSyncInput>;
    land?: CitiusSyncDeps['land'];
  } = {},
): {
  run: () => ReturnType<typeof syncCitiusNotifications>;
  store: ReturnType<typeof fakeStore>;
  landed: EnumeratedItem[];
  enumerateInputs: EnumerateInboxInput[];
  establish: ReturnType<typeof vi.fn>;
  markUnhealthy: ReturnType<typeof vi.fn>;
  lessons: SyncLessonInput[];
  lessonCalls: SyncLessonContext[];
} {
  const store = over.store ?? fakeStore();
  const landed: EnumeratedItem[] = [];
  const enumerateInputs: EnumerateInboxInput[] = [];
  const establish = vi.fn(async () => over.session ?? reused());
  const markUnhealthy = vi.fn(async () => true);
  // The lessons SEAM, injected: this suite stays Mongo-free, and what a run claims to have learned
  // is observable as a value rather than inferred from a store.
  const lessons: SyncLessonInput[] = [];
  const lessonCalls: SyncLessonContext[] = [];
  let pass = 0;
  const deps: CitiusSyncDeps = {
    establishSession: establish,
    markSessionUnhealthy: markUnhealthy,
    recordLesson: async (batch, ctx) => {
      lessons.push(...batch);
      lessonCalls.push(ctx);
      return [];
    },
    enumerate: async (input: EnumerateInboxInput) => {
      enumerateInputs.push(input);
      const w = walks[Math.min(pass, walks.length - 1)]!;
      pass += 1;
      return w;
    },
    land: over.land ?? (async (item: EnumeratedItem) => { landed.push(item); return { landed: true }; }),
    store,
    clock: () => new Date('2026-07-01T00:00:00.000Z'),
  };
  const input: CitiusSyncInput = {
    actor: ACTOR, runId: 'run1', baseUrl: 'https://portal.example', ...over.input,
  };
  return {
    run: () => syncCitiusNotifications(input, deps),
    store, landed, enumerateInputs, establish, markUnhealthy, lessons, lessonCalls,
  };
}

// ---------------------------------------------------------------------------
// 1. HAZARD 1 — pageTotal is never emitted, in either direction
// ---------------------------------------------------------------------------

describe('citius-sync · the pageTotal collision stays closed (CS4 finding, CS3 contract)', () => {
  it('a COMPLETE walk maps to reachedEnd:true with NO pageTotal property at all', () => {
    const out = toEnumerateResult(complete([row(1), row(2)], 3));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.reachedEnd).toBe(true);
    expect('pageTotal' in out.result).toBe(false);
    expect(Object.keys(out.result)).not.toContain('pageTotal');
  });

  it('an INCOMPLETE walk that ADVERTISES a page count still emits no pageTotal', () => {
    // the walk carries advertisedPageCount: 9 — a PAGE count. Leaking it as CS3's ITEM total is the
    // exact move that would certify a truncated sweep as complete.
    const walk = incomplete([row(1)], 1);
    expect(walk.advertisedPageCount).toBe(9);
    const out = toEnumerateResult(walk);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect('pageTotal' in out.result).toBe(false);
  });

  it('the module SOURCE never names pageTotal or advertisedPageCount outside comments', () => {
    expect(MODULE_CODE).not.toMatch(/pageTotal/);
    expect(MODULE_CODE).not.toMatch(/advertisedPageCount/);
  });

  it('…and a full run therefore produces a report with NO countCheck (reachedEnd is the only proof)', async () => {
    const h = harness([complete([row(1)]), complete([row(1)])]);
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('complete');
    expect(out.report.verification.countCheck).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2. HAZARDS 2 + 3 — the two other name collisions across the same seam
// ---------------------------------------------------------------------------

describe('citius-sync · pages is a NUMBER and maxPages is the WINDOW\'s', () => {
  it('maps pagesWalked (not the per-page outcome array, not a row count) into result.pages', () => {
    const out = toEnumerateResult(complete([row(1), row(2), row(3)], 7));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.pages).toBe(7);
    expect(out.result.items).toHaveLength(3);
  });

  it('forwards the verification window\'s maxPages into the connector on EVERY pass', async () => {
    const h = harness([complete([row(1)]), complete([row(1)])], { input: { maxPages: 4 } });
    const out = await h.run();
    expect(h.enumerateInputs.map((i) => i.maxPages)).toEqual([4, 4]);
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    // …and the report's truncation evidence names the bound that was really applied
    expect(out.report.verification.maxPages).toBe(4);
  });

  it('with no explicit bound, the connector is handed CS3\'s default — never left on its own', async () => {
    const h = harness([complete([row(1)]), complete([row(1)])]);
    await h.run();
    expect(h.enumerateInputs[0]!.maxPages).toBe(50);
    expect(h.enumerateInputs[1]!.maxPages).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// 3. THE OUTCOME MAPPING
// ---------------------------------------------------------------------------

describe('citius-sync · CS4 outcome union -> CS3 verified sync', () => {
  it('COMPLETE + COMPLETE advances the watermark', async () => {
    const store = fakeStore();
    const h = harness([complete([row(1), row(2)]), complete([row(1), row(2)])], { store });
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('complete');
    expect(store.calls).toContain('advanceWatermark');
    expect(store.snapshot.watermark).toBe(out.report.window.until);
    expect(h.landed.map((i) => i.ref)).toEqual(['r1', 'r2']);
  });

  it('INCOMPLETE keeps the rows, lands them, and leaves the watermark exactly where it was', async () => {
    const store = fakeStore({ watermark: '2026-05-01T00:00:00.000Z' });
    const before = store.snapshot.watermark;
    const h = harness([incomplete([row(1), row(2)]), incomplete([row(1), row(2)])], { store });
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('incomplete');
    expect(out.report.verification.pass1.reachedEnd).toBe(false);
    expect(out.report.verification.pass2.reachedEnd).toBe(false);
    // the rows a proved-partial walk DID capture still land — at-least-once, never discarded
    expect(h.landed.map((i) => i.ref)).toEqual(['r1', 'r2']);
    expect(out.report.landed).toBe(2);
    // …and the cursor did not move one millisecond
    expect(store.snapshot.watermark).toBe(before);
    expect(store.calls).not.toContain('advanceWatermark');
    expect(store.calls).toContain('bumpIncomplete');
  });

  it('SESSION-DEAD is ok:false AND retires the Cofre item so the NEXT run re-establishes', async () => {
    const store = fakeStore({ watermark: '2026-05-01T00:00:00.000Z' });
    const h = harness([sessionDead()], { store });
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('failed');
    expect(out.report.error).toContain('sessão terminada');
    expect(out.sessionMarkedUnhealthy).toBe(true);
    expect(h.markUnhealthy).toHaveBeenCalledTimes(1);
    expect(h.markUnhealthy).toHaveBeenCalledWith(ACTOR, 'item1');
    expect(store.snapshot.watermark).toBe('2026-05-01T00:00:00.000Z');
    expect(store.calls).toEqual(['bumpFailure', 'saveReport']);
  });

  it('FAILED is ok:false and does NOT retire the session — an ambiguous refusal costs no credential', async () => {
    const h = harness([failedWalk()]);
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('failed');
    expect(out.report.error).toBe('erro de transporte (TypeError)');
    expect(out.sessionMarkedUnhealthy).toBe(false);
    expect(h.markUnhealthy).not.toHaveBeenCalled();
  });

  it('a session that dies on the SECOND pass is retired exactly once, and pass 1\'s rows stay landed', async () => {
    const h = harness([complete([row(1), row(2)]), sessionDead()]);
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('failed');
    expect(out.report.landed).toBe(2); // reported honestly: they really are durable
    expect(h.markUnhealthy).toHaveBeenCalledTimes(1);
  });

  it('the run reports the session lifecycle ONCE, not once per pass', async () => {
    const h = harness([complete([row(1)]), complete([row(1)])]);
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.sessionEvents).toEqual(['reused']);
  });
});

// ---------------------------------------------------------------------------
// 4. SESSION ESTABLISHMENT — the states that are not failures
// ---------------------------------------------------------------------------

describe('citius-sync · a session outcome that is not a session is not a failed sync', () => {
  it('needs-human runs NOTHING and writes NOTHING, and carries `attempted` verbatim', async () => {
    const store = fakeStore({ watermark: '2026-05-01T00:00:00.000Z' });
    const h = harness([complete([row(1)])], {
      store,
      session: { status: 'needs-human', route: 'attended', reason: 'cartão de advogado', attempted: true },
    });
    const out = await h.run();
    expect(out.status).toBe('needs-human');
    if (out.status !== 'needs-human') return;
    expect(out.route).toBe('attended');
    expect(out.attempted).toBe(true); // a login WAS spent — the caller must not retry
    expect(h.enumerateInputs).toEqual([]);
    expect(store.calls).toEqual([]); // no report, no streak, no watermark
    expect(store.snapshot.watermark).toBe('2026-05-01T00:00:00.000Z');
  });

  it('needs-egress is its OWN outcome — the session is fine and no human can help', async () => {
    const store = fakeStore();
    const h = harness([complete([row(1)])], {
      store,
      session: { status: 'needs-egress', itemId: 'item1', required: { kind: 'residential', pairingId: 'p9' } },
    });
    const out = await h.run();
    expect(out.status).toBe('needs-egress');
    if (out.status !== 'needs-egress') return;
    expect(out.required).toEqual({ kind: 'residential', pairingId: 'p9' });
    expect(h.enumerateInputs).toEqual([]);
    expect(store.calls).toEqual([]);
  });

  it('establishment happens EXACTLY ONCE per sync, even when the session dies mid-walk', async () => {
    const h = harness([sessionDead(), sessionDead()]);
    await h.run();
    expect(h.establish).toHaveBeenCalledTimes(1); // no mid-run re-login, ever (CS5 caller contract)
  });

  it('a re-established session is reported as such', async () => {
    const h = harness([complete([row(1)]), complete([row(1)])], {
      session: { status: 'reestablished', itemId: 'itemZ', storageState: {}, secrets: { redact: (s: string) => s } as never },
    });
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.session).toBe('reestablished');
    expect(out.sessionItemId).toBe('itemZ');
    expect(out.report.sessionEvents).toEqual(['reestablished']);
  });
});

// ---------------------------------------------------------------------------
// 5. IDENTITY — fail closed, and one org is not one inbox
// ---------------------------------------------------------------------------

describe('citius-sync · identity fails closed and never widens', () => {
  it.each([
    ['orgId', { userId: 'u1', orgId: '', role: 'user' as const }],
    ['userId', { userId: '  ', orgId: 'o1', role: 'user' as const }],
  ])('refuses an empty %s rather than sharing one state row', (_what, actor) => {
    expect(() => syncStateKeyFor({ actor })).toThrow(CitiusSyncError);
  });

  it('refuses an empty integration or action key', () => {
    expect(() => syncStateKeyFor({ actor: ACTOR, integrationKey: ' ' })).toThrow(CitiusSyncError);
    expect(() => syncStateKeyFor({ actor: ACTOR, actionKey: '' })).toThrow(CitiusSyncError);
  });

  it('the sync is refused before ANY seam is touched when the actor is unscoped', async () => {
    const h = harness([complete([row(1)])], { input: { actor: { userId: 'u1', orgId: '', role: 'user' } } });
    await expect(h.run()).rejects.toBeInstanceOf(CitiusSyncError);
    expect(h.establish).not.toHaveBeenCalled(); // no session is established for an unscopeable run
  });

  it('TWO LAWYERS IN ONE ORG DO NOT SHARE A WATERMARK — the action key carries the actor', () => {
    const a = syncStateKeyFor({ actor: { userId: 'u1', orgId: 'o1', role: 'user' } });
    const b = syncStateKeyFor({ actor: { userId: 'u2', orgId: 'o1', role: 'user' } });
    expect(a.orgId).toBe(b.orgId);
    expect(a.actionKey).not.toBe(b.actionKey);
    expect(a.actionKey).toContain(CITIUS_SYNC_ACTION_KEY);
  });

  it('…and the action-key encoding is INJECTIVE: a separator inside a component cannot collide', () => {
    const a = syncStateKeyFor({ actor: { userId: 'b', orgId: 'o1', role: 'user' }, actionKey: 'a::' });
    const b = syncStateKeyFor({ actor: { userId: '::b', orgId: 'o1', role: 'user' }, actionKey: 'a' });
    expect(a.actionKey).not.toBe(b.actionKey);
  });

  it('landed row ids are scoped by the whole tuple, so the same ref in two orgs is two rows', () => {
    const a = notificationRowId(syncStateKeyFor({ actor: { userId: 'u1', orgId: 'oA', role: 'user' } }), 'ref1');
    const b = notificationRowId(syncStateKeyFor({ actor: { userId: 'u1', orgId: 'oB', role: 'user' } }), 'ref1');
    const c = notificationRowId(syncStateKeyFor({ actor: { userId: 'u2', orgId: 'oA', role: 'user' } }), 'ref1');
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 6. THE DATE CELL, and hazard 5: NO date comparison survives in this module
// ---------------------------------------------------------------------------

describe('citius-sync · date normalisation', () => {
  it.each([
    ['2026-06-15', '2026-06-15T00:00:00.000Z'],
    ['2026-06-15 14:03', '2026-06-15T14:03:00.000Z'],
    ['15-06-2026', '2026-06-15T00:00:00.000Z'],
    ['15/06/2026 09:30:05', '2026-06-15T09:30:05.000Z'],
  ])('normalises %s to an ISO instant', (raw, iso) => {
    expect(citiusItemDate(raw)).toBe(iso);
  });

  it.each([['15 de Junho de 2026'], ['ontem'], ['31-02-2026'], ['']])(
    'passes an unrecognised date (%s) through VERBATIM rather than inventing one',
    (raw) => { expect(citiusItemDate(raw)).toBe(raw); },
  );

  // An EXPLICIT offset used to be discarded, so a portal rendering local time was recorded (and
  // shown to a lawyer) an hour or more away from the instant it stated.
  it.each([
    ['2026-08-03T14:03:00+01:00', '2026-08-03T13:03:00.000Z'],
    ['2026-08-03T14:03:00-03:00', '2026-08-03T17:03:00.000Z'],
    ['2026-08-03T14:03:00+0100', '2026-08-03T13:03:00.000Z'],
    ['2026-08-03T14:03:00Z', '2026-08-03T14:03:00.000Z'],
    ['03-08-2026 00:30+01:00', '2026-08-02T23:30:00.000Z'],
  ])('honours an explicit timezone offset: %s -> %s', (raw, iso) => {
    expect(citiusItemDate(raw)).toBe(iso);
  });

  it('a cell with NO offset is still read as UTC (the documented, unobserved assumption)', () => {
    expect(citiusItemDate('2026-08-03 14:03')).toBe('2026-08-03T14:03:00.000Z');
  });
});

/**
 * HAZARD 5. CS6 filtered rows by `itemDate >= watermark`, comparing a MIDNIGHT-UTC date-only cell
 * against a mid-day wall-clock cursor. A notification dated the same day as the last complete run
 * was dropped from BOTH passes, so the passes agreed, the run was certified `complete`, and the
 * watermark advanced past a row that had never landed and never could. The fix is that no date
 * comparison exists here at all: dedup is by REFERENCE, which is exact.
 */
describe('citius-sync · hazard 5 — every captured row is handed over, whatever the cursor says', () => {
  it('a row dated BELOW the watermark is still enumerated (the coordinate systems no longer meet)', () => {
    const out = toEnumerateResult(
      complete([
        row(1, { ref: 'ancient', data: '2020-01-01' }),
        row(2, { ref: 'today-midnight', data: '2026-06-01' }),
        row(3, { ref: 'newer', data: '2026-07-01' }),
      ]),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.items.map((i) => i.ref)).toEqual(['ancient', 'today-midnight', 'newer']);
  });

  it('THE EXACT LOST-NOTIFICATION SHAPE: a same-day row survives a mid-day cursor', async () => {
    // watermark 09:00 on 15 June; a notification whose cell is the DATE 15 June normalises to
    // 00:00Z that day. Under the old filter it vanished from both passes and was never landed.
    const store = fakeStore({ watermark: '2026-06-15T09:00:00.000Z' });
    const sameDay = complete([row(1, { ref: 'same-day', data: '15-06-2026' })]);
    const h = harness([sameDay, sameDay], { store });
    const out = await h.run();

    expect(h.landed.map((i) => i.ref)).toEqual(['same-day']);
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.landed).toBe(1);
    expect(out.report.verification.pass1.itemsSeen).toBe(1);
  });

  it('the module SOURCE holds no date comparison against the cursor any more', () => {
    expect(MODULE_CODE).not.toMatch(/withinWindow/);
    expect(MODULE_CODE).not.toMatch(/sinceIso/);
  });

  it('a row NEWER than the ceiling is enumerated too: there is no upper bound either', () => {
    const out = toEnumerateResult(complete([row(1, { ref: 'future', data: '2099-01-01' })]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.items.map((i) => i.ref)).toEqual(['future']);
  });

  it('a row whose date is UNREADABLE is enumerated with its cell verbatim, never dropped', () => {
    const out = toEnumerateResult(complete([row(1, { ref: 'weird', data: 'terça-feira' })]));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.items.map((i) => [i.ref, i.itemDate])).toEqual([['weird', 'terça-feira']]);
  });
});

// ---------------------------------------------------------------------------
// 7. THE LAND SEAM — CS3's #land-throws-or-duplicate honoured through the wiring
// ---------------------------------------------------------------------------

describe('citius-sync · the land seam contract', () => {
  it('a duplicate is suppressed, not counted as landed, and does not block a complete run', async () => {
    const h = harness([complete([row(1), row(2)]), complete([row(1), row(2)])], {
      land: async (item: EnumeratedItem) => ({ landed: item.ref !== 'r2' }),
    });
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.landed).toBe(1);
    expect(out.report.duplicatesSuppressed).toBe(1);
    expect(out.report.outcome).toBe('complete');
  });

  it('a land that THROWS propagates: nothing is certified and the watermark does not move', async () => {
    const store = fakeStore({ watermark: '2026-05-01T00:00:00.000Z' });
    const h = harness([complete([row(1)]), complete([row(1)])], {
      store,
      land: async () => { throw new Error('mongo down'); },
    });
    await expect(h.run()).rejects.toThrow('mongo down');
    expect(store.snapshot.watermark).toBe('2026-05-01T00:00:00.000Z');
    expect(store.calls).not.toContain('advanceWatermark');
  });

  it('a row already in the seen-set is neither re-landed nor re-counted', async () => {
    const store = fakeStore({
      watermark: '2026-05-01T00:00:00.000Z',
      seenRefs: [{ ref: 'r1', itemDate: '2026-06-11T00:00:00.000Z' }],
    });
    const h = harness([complete([row(1), row(2)]), complete([row(1), row(2)])], { store });
    const out = await h.run();
    expect(h.landed.map((i) => i.ref)).toEqual(['r2']);
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.verification.pass1.newRefs).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 8. RECONCILIATION at the unit level (the e2e proves it over a real portal)
// ---------------------------------------------------------------------------

describe('citius-sync · the two-pass reconciliation reaches through the mapping', () => {
  it('a row only pass 2 can see makes the run INCOMPLETE and holds the cursor', async () => {
    const store = fakeStore({ watermark: '2026-05-01T00:00:00.000Z' });
    const h = harness([complete([row(1)]), complete([row(1), row(2)])], { store });
    const out = await h.run();
    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('incomplete');
    expect(out.report.verification.pass2.refsOnlyInPass2).toEqual(['r2']);
    // BOTH passes reached the end — so truncation is NOT what caught this. Reconciliation is.
    expect(out.report.verification.pass1.reachedEnd).toBe(true);
    expect(out.report.verification.pass2.reachedEnd).toBe(true);
    expect(store.snapshot.watermark).toBe('2026-05-01T00:00:00.000Z');
    // the late row still lands
    expect(h.landed.map((i) => i.ref)).toEqual(['r1', 'r2']);
  });
});
