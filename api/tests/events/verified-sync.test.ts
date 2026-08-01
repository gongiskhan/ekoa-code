import { describe, it, expect } from 'vitest';
// `SyncRunReport` is exported from the contract as BOTH a zod schema (value) and its inferred type
// under one name — used here as a type for the fakes AND as `.parse(...)` to prove every report
// this pure orchestrator emits validates against the shared contract (QA regression layer).
import { SyncRunReport } from '@ekoa/shared';
import {
  runVerifiedSync,
  type SeenRef,
  type SyncStateSnapshot,
  type SyncStateStore,
  type EnumerateResult,
  type EnumeratedItem,
  type RunVerifiedSyncInput,
} from '../../src/events/verified-sync.js';

/**
 * The PURE two-pass completeness orchestrator (slice CS3), exercised with in-memory fakes for
 * `enumerate` / `land` / the sync-state store. No Mongo, no transport. The invariants proved:
 * complete advances the watermark; a pass-1 miss revealed in pass 2 is `incomplete` with the
 * watermark UNCHANGED and the missed item still landed; a machinery `ok:false` is `failed` (distinct
 * from incomplete) and moves nothing; land is emit-first (before any ref is persisted) and idempotent
 * (a duplicate land increments `duplicatesSuppressed`); the seen-set dedups across runs.
 */

// --- fakes --------------------------------------------------------------------------------------

function mergeSeen(existing: SeenRef[], incoming: SeenRef[]): SeenRef[] {
  const m = new Map<string, SeenRef>();
  for (const r of existing) m.set(r.ref, r);
  for (const r of incoming) m.set(r.ref, r);
  return [...m.values()];
}

interface FakeStore extends SyncStateStore {
  state: SyncStateSnapshot;
  reports: SyncRunReport[];
}

/** An in-memory `SyncStateStore`. Every durable mutation appends a `persist:*` entry to `log`, so a
 *  test can assert land-before-persist ordering on a single shared log. */
function makeFakeStore(initial: Partial<SyncStateSnapshot> = {}, log: string[] = []): FakeStore {
  const state: SyncStateSnapshot = {
    watermark: initial.watermark ?? null,
    seenRefs: initial.seenRefs ? [...initial.seenRefs] : [],
    consecutiveIncomplete: initial.consecutiveIncomplete ?? 0,
    consecutiveFailures: initial.consecutiveFailures ?? 0,
  };
  const reports: SyncRunReport[] = [];
  return {
    state,
    reports,
    async read() {
      return { ...state, seenRefs: [...state.seenRefs] };
    },
    async advanceWatermark(watermark, newSeen) {
      log.push('persist:advanceWatermark');
      state.watermark = watermark;
      state.seenRefs = mergeSeen(state.seenRefs, newSeen);
      state.consecutiveIncomplete = 0;
      state.consecutiveFailures = 0;
    },
    async absorbRefs(refs) {
      log.push('persist:absorbRefs');
      state.seenRefs = mergeSeen(state.seenRefs, refs);
    },
    async bumpIncomplete() {
      log.push('persist:bumpIncomplete');
      state.consecutiveIncomplete += 1;
      state.consecutiveFailures = 0;
    },
    async bumpFailure() {
      log.push('persist:bumpFailure');
      state.consecutiveFailures += 1;
    },
    async saveReport(r) {
      log.push('persist:saveReport');
      reports.push(r);
    },
  };
}

const CLOCK_ISO = '2026-07-30T12:00:00.000Z';

function items(...refs: Array<[ref: string, itemDate: string]>): EnumeratedItem[] {
  return refs.map(([ref, itemDate]) => ({ ref, itemDate, payload: { ref } }));
}

function okResult(list: EnumeratedItem[], extra: Partial<Extract<EnumerateResult, { ok: true }>['result']> = {}): EnumerateResult {
  return { ok: true, result: { items: list, pages: 1, reachedEnd: true, ...extra } };
}

function baseInput(over: Partial<RunVerifiedSyncInput> & Pick<RunVerifiedSyncInput, 'store'>): RunVerifiedSyncInput {
  return {
    syncKey: 'org1::citius::consulta',
    orgId: 'org1',
    until: CLOCK_ISO,
    reportId: 'r1',
    enumerate: async () => okResult([]),
    land: async () => ({ landed: true }),
    clock: () => new Date(CLOCK_ISO),
    ...over,
  };
}

const A: [string, string] = ['A', '2026-07-29T00:00:00.000Z'];
const B: [string, string] = ['B', '2026-07-29T02:00:00.000Z'];
const C: [string, string] = ['C', '2026-07-30T00:00:00.000Z'];

// --- tests --------------------------------------------------------------------------------------

describe('runVerifiedSync — complete', () => {
  it('advances the watermark to `until`, absorbs all refs, and lands each new item once', async () => {
    const store = makeFakeStore();
    const landed: string[] = [];
    const both = okResult(items(A, B));
    const report = await runVerifiedSync(
      baseInput({
        store,
        enumerate: async () => both, // identical window on both passes → no miss
        land: async (it) => {
          landed.push(it.ref);
          return { landed: true };
        },
      }),
    );

    expect(report.outcome).toBe('complete');
    expect(store.state.watermark).toBe(CLOCK_ISO);
    expect(new Set(store.state.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B']));
    expect(report.landed).toBe(2);
    expect(report.duplicatesSuppressed).toBe(0);
    expect(report.verification.pass1.newRefs).toBe(2);
    expect(report.verification.pass2.refsOnlyInPass2).toEqual([]);
    expect(landed.sort()).toEqual(['A', 'B']);
    expect(() => SyncRunReport.parse(report)).not.toThrow();
  });

  it('records a passing countCheck when the source advertises a matching total', async () => {
    const store = makeFakeStore();
    const report = await runVerifiedSync(
      baseInput({ store, enumerate: async () => okResult(items(A, B), { pageTotal: 2 }) }),
    );
    expect(report.outcome).toBe('complete');
    expect(report.verification.countCheck).toEqual({ pageTotal: 2, enumerated: 2, match: true });
  });

  it('a count-check MISMATCH blocks complete → incomplete even with no ref-level miss', async () => {
    const store = makeFakeStore();
    const report = await runVerifiedSync(
      baseInput({ store, enumerate: async () => okResult(items(A, B), { pageTotal: 3 }) }),
    );
    expect(report.outcome).toBe('incomplete');
    expect(report.verification.countCheck).toEqual({ pageTotal: 3, enumerated: 2, match: false });
    expect(store.state.watermark).toBeNull(); // did NOT advance
  });
});

describe('runVerifiedSync — truncation / reachedEnd gate (Finding 1: silent-miss vector)', () => {
  it('(a) both passes reachedEnd:false, no pageTotal, no new pass-2 refs → INCOMPLETE, watermark UNCHANGED, items still landed', async () => {
    const store = makeFakeStore(); // watermark null
    const landed: string[] = [];
    // Both passes truncate identically at maxPages and the source advertises no total: the ref-level
    // diff is empty, but the window was NOT proved swept — the pre-fix silent-miss vector.
    const truncated = okResult(items(A, B), { reachedEnd: false, pages: 50 });
    const report = await runVerifiedSync(
      baseInput({
        store,
        maxPages: 50,
        enumerate: async () => truncated,
        land: async (it) => {
          landed.push(it.ref);
          return { landed: true };
        },
      }),
    );

    expect(report.outcome).toBe('incomplete'); // NOT complete, despite the clean ref-level diff
    expect(store.state.watermark).toBeNull(); // watermark did NOT advance past the unpaged tail
    expect(report.verification.pass2.refsOnlyInPass2).toEqual([]); // clean at the ref level...
    expect(report.verification.pass1.reachedEnd).toBe(false); // ...but truncated — the evidence
    expect(report.verification.pass2.reachedEnd).toBe(false);
    expect(report.verification.maxPages).toBe(50);
    expect(landed.sort()).toEqual(['A', 'B']); // items still landed (at-least-once)
    expect(store.state.consecutiveIncomplete).toBe(1);
    expect(new Set(store.state.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B'])); // absorbed
    expect(() => SyncRunReport.parse(report)).not.toThrow();
  });

  it('(b) reachedEnd:false BUT a matching countCheck independently proves the sweep → COMPLETE, watermark advances', async () => {
    const store = makeFakeStore();
    const report = await runVerifiedSync(
      baseInput({
        store,
        enumerate: async () => okResult(items(A, B), { reachedEnd: false, pageTotal: 2 }),
      }),
    );

    expect(report.outcome).toBe('complete'); // the count proves completeness even though truncated
    expect(report.verification.countCheck).toEqual({ pageTotal: 2, enumerated: 2, match: true });
    expect(report.verification.pass1.reachedEnd).toBe(false);
    expect(store.state.watermark).toBe(CLOCK_ISO); // advanced
    expect(() => SyncRunReport.parse(report)).not.toThrow();
  });

  it('(c) reachedEnd:true on both passes (the normal case) → COMPLETE, watermark advances', async () => {
    const store = makeFakeStore();
    const report = await runVerifiedSync(
      baseInput({ store, enumerate: async () => okResult(items(A, B)) }), // reachedEnd:true default
    );

    expect(report.outcome).toBe('complete');
    expect(report.verification.pass1.reachedEnd).toBe(true);
    expect(report.verification.pass2.reachedEnd).toBe(true);
    expect(report.verification.maxPages).toBeGreaterThan(0);
    expect(store.state.watermark).toBe(CLOCK_ISO);
  });
});

describe('runVerifiedSync — untilSkewMs (publish-lag ceiling, Finding 2)', () => {
  it('derives `until` as clock() - untilSkewMs when `until` is not set explicitly', async () => {
    const store = makeFakeStore();
    const report = await runVerifiedSync(
      baseInput({
        store,
        until: undefined, // force derivation from the clock
        untilSkewMs: 60_000, // hold the ceiling 1 minute behind `now`
        enumerate: async () => okResult(items(A)),
      }),
    );

    expect(report.window.until).toBe('2026-07-30T11:59:00.000Z'); // CLOCK_ISO (12:00:00) minus 60s
    expect(report.outcome).toBe('complete');
    expect(store.state.watermark).toBe('2026-07-30T11:59:00.000Z'); // advances to the held-back ceiling
  });

  it('an explicit `until` overrides the skew (skew only affects the derived default)', async () => {
    const store = makeFakeStore();
    const report = await runVerifiedSync(
      baseInput({
        store,
        until: '2026-07-30T09:00:00.000Z',
        untilSkewMs: 60_000,
        enumerate: async () => okResult(items(A)),
      }),
    );
    expect(report.window.until).toBe('2026-07-30T09:00:00.000Z');
  });
});

describe('runVerifiedSync — incomplete (a proved miss)', () => {
  it('pass-1 miss revealed in pass 2: outcome incomplete, watermark UNCHANGED, missed item still landed', async () => {
    const store = makeFakeStore(); // watermark null
    const landed: string[] = [];
    let call = 0;
    const report = await runVerifiedSync(
      baseInput({
        store,
        enumerate: async () => {
          call += 1;
          return call === 1 ? okResult(items(A)) : okResult(items(A, B)); // B only surfaces in pass 2
        },
        land: async (it) => {
          landed.push(it.ref);
          return { landed: true };
        },
      }),
    );

    expect(report.outcome).toBe('incomplete');
    expect(store.state.watermark).toBeNull(); // the whole point: cursor does NOT move on a proved miss
    expect(report.verification.pass2.refsOnlyInPass2).toEqual(['B']);
    expect(landed).toContain('B'); // the missed item is landed anyway (at-least-once)
    expect(store.state.consecutiveIncomplete).toBe(1);
    expect(new Set(store.state.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B'])); // seen absorbs both
    expect(() => SyncRunReport.parse(report)).not.toThrow();
  });
});

describe('runVerifiedSync — failed (machinery error, distinct from incomplete)', () => {
  it('pass-1 enumerate ok:false → failed, watermark unchanged, consecutiveFailures bumped, nothing landed', async () => {
    const store = makeFakeStore({ watermark: 'W0' });
    const landed: string[] = [];
    const report = await runVerifiedSync(
      baseInput({
        store,
        enumerate: async () => ({ ok: false, error: 'boom' }),
        land: async (it) => {
          landed.push(it.ref);
          return { landed: true };
        },
      }),
    );

    expect(report.outcome).toBe('failed');
    expect(report.error).toBe('boom');
    expect(store.state.watermark).toBe('W0'); // unchanged
    expect(store.state.consecutiveFailures).toBe(1);
    expect(landed).toEqual([]); // nothing enumerated → nothing landed
    expect(() => SyncRunReport.parse(report)).not.toThrow();
  });

  it('pass-2 enumerate ok:false → failed: pass-1 items ARE landed, but watermark + seen-set stay put', async () => {
    const store = makeFakeStore({ watermark: 'W0' });
    const landed: string[] = [];
    let call = 0;
    const report = await runVerifiedSync(
      baseInput({
        store,
        until: 'U1',
        enumerate: async () => {
          call += 1;
          return call === 1 ? okResult(items(A)) : { ok: false, error: 'pass2 boom' };
        },
        land: async (it) => {
          landed.push(it.ref);
          return { landed: true };
        },
      }),
    );

    expect(report.outcome).toBe('failed');
    expect(landed).toEqual(['A']); // pass 1 landed durably
    expect(report.landed).toBe(1); // reported honestly
    expect(store.state.watermark).toBe('W0'); // nothing moves
    expect(store.state.seenRefs).toEqual([]); // nothing absorbed
    expect(store.state.consecutiveFailures).toBe(1);
  });
});

describe('runVerifiedSync — at-least-once + idempotent land', () => {
  it('lands every item BEFORE any ref is persisted, and a duplicate land increments duplicatesSuppressed', async () => {
    const log: string[] = [];
    const store = makeFakeStore({}, log);
    const report = await runVerifiedSync(
      baseInput({
        store,
        enumerate: async () => okResult(items(['D', '2026-07-29T00:00:00.000Z'], ['E', '2026-07-29T01:00:00.000Z'])),
        land: async (it) => {
          log.push(`land:${it.ref}`);
          return { landed: it.ref !== 'D' }; // D is already-landed (deterministic-id duplicate)
        },
      }),
    );

    expect(report.duplicatesSuppressed).toBe(1); // D
    expect(report.landed).toBe(1); // E

    const lastLandIdx = log.reduce((acc, l, i) => (l.startsWith('land:') ? i : acc), -1);
    const firstPersistIdx = log.findIndex((l) => l.startsWith('persist:'));
    expect(lastLandIdx).toBeGreaterThanOrEqual(0);
    expect(firstPersistIdx).toBeGreaterThanOrEqual(0);
    expect(lastLandIdx).toBeLessThan(firstPersistIdx); // every land precedes every durable persist
  });
});

describe('runVerifiedSync — seen-set absorb across runs', () => {
  it('a ref absorbed by a prior complete run is not re-landed on the next run', async () => {
    const store = makeFakeStore();

    await runVerifiedSync(
      baseInput({
        store,
        until: '2026-07-30T10:00:00.000Z',
        reportId: 'run1',
        enumerate: async () => okResult(items(A)),
      }),
    );
    expect(new Set(store.state.seenRefs.map((r) => r.ref))).toEqual(new Set(['A']));

    const landedRun2: string[] = [];
    const report2 = await runVerifiedSync(
      baseInput({
        store,
        until: CLOCK_ISO,
        reportId: 'run2',
        enumerate: async () => okResult(items(A, C)), // A already seen, C is new
        land: async (it) => {
          landedRun2.push(it.ref);
          return { landed: true };
        },
      }),
    );

    expect(landedRun2).toEqual(['C']); // A skipped by the seen-set, only C lands
    expect(report2.outcome).toBe('complete');
    expect(report2.verification.pass1.newRefs).toBe(1); // only C counted new
    expect(store.state.watermark).toBe(CLOCK_ISO);
    expect(new Set(store.state.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'C']));
  });
});
