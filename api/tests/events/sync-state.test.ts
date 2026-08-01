import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { SyncRunReport } from '@ekoa/shared';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { syncState, syncReports } from '../../src/data/stores.js';
import {
  syncStateId,
  readSyncState,
  advanceWatermark,
  absorbRefs,
  bumpIncomplete,
  bumpFailure,
  persistSyncReport,
  pruneSeen,
  SEEN_HARD_CAP,
  REPORT_HISTORY_CAP,
  type SyncStateKey,
  type SeenRef,
} from '../../src/events/sync-state.js';

/**
 * The durable per-action sync-state store (slice CS3), against a real mongodb-memory-server. Proves
 * the deterministic composite key, read/advance/absorb/bumpIncomplete/bumpFailure semantics (which
 * of watermark / seen-set / streak counters each moves), the seen-set date-prune + hard-cap, and the
 * capped per-key report history.
 */

let mem: MongoMemoryServer;

const KEY: SyncStateKey = { orgId: 'org1', integrationKey: 'citius', actionKey: 'consulta' };

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sync_state_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await syncState.deleteMany({});
  await syncReports.deleteMany({});
});

describe('deterministic, injective key (Finding 5)', () => {
  it('is a stable sha256 hex of the (orgId, integrationKey, actionKey) tuple (not a raw `::` join)', () => {
    expect(syncStateId(KEY)).toBe(syncStateId({ ...KEY })); // stable across calls
    expect(syncStateId(KEY)).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, injective encoding
  });

  it('is INJECTIVE: a component containing `::` cannot collide with a differently-split tuple', () => {
    // A raw `::` join would render both tuples as `a::b::c::d` and silently share one state row.
    expect(syncStateId({ orgId: 'a::b', integrationKey: 'c', actionKey: 'd' })).not.toBe(
      syncStateId({ orgId: 'a', integrationKey: 'b::c', actionKey: 'd' }),
    );
  });
});

describe('read of an unwritten key', () => {
  it('returns a fresh default (watermark null, empty seen, zeroed streaks)', async () => {
    const doc = await readSyncState(KEY);
    expect(doc._id).toBe(syncStateId(KEY));
    expect(doc.watermark).toBeNull();
    expect(doc.seenRefs).toEqual([]);
    expect(doc.consecutiveIncomplete).toBe(0);
    expect(doc.consecutiveFailures).toBe(0);
  });
});

describe('advanceWatermark (on complete)', () => {
  it('sets the watermark, absorbs newSeen, and resets both streaks', async () => {
    await bumpFailure(KEY, 'prior');
    const wm = '2026-07-30T12:00:00.000Z';
    await advanceWatermark(KEY, wm, [
      { ref: 'A', itemDate: '2026-07-29T00:00:00.000Z' },
      { ref: 'B', itemDate: '2026-07-29T02:00:00.000Z' },
    ]);

    const doc = await readSyncState(KEY);
    expect(doc.watermark).toBe(wm);
    expect(new Set(doc.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B']));
    expect(doc.consecutiveIncomplete).toBe(0);
    expect(doc.consecutiveFailures).toBe(0);
    expect(doc.lastOutcome).toBe('complete');
  });
});

describe('CAS-guarded mutators (Finding 3: per-key write race)', () => {
  it('two SEQUENTIAL advanceWatermark calls compose (watermark = last, seen = union)', async () => {
    await advanceWatermark(KEY, 'W1', [{ ref: 'A', itemDate: '2026-07-29T00:00:00.000Z' }]);
    await advanceWatermark(KEY, 'W2', [{ ref: 'B', itemDate: '2026-07-29T02:00:00.000Z' }]);

    const doc = await readSyncState(KEY);
    expect(doc.watermark).toBe('W2');
    expect(new Set(doc.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B']));
  });

  it('two CONCURRENT advanceWatermark calls both land — no lost update (CAS re-reads on _rev drift)', async () => {
    await Promise.all([
      advanceWatermark(KEY, 'W1', [{ ref: 'A', itemDate: '2026-07-29T00:00:00.000Z' }]),
      advanceWatermark(KEY, 'W2', [{ ref: 'B', itemDate: '2026-07-29T02:00:00.000Z' }]),
    ]);

    const doc = await readSyncState(KEY);
    // Neither writer clobbered the other: both refs are absorbed regardless of which won the race.
    expect(new Set(doc.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B']));
    expect(['W1', 'W2']).toContain(doc.watermark);
  });

  it('a later mutator re-reads the freshest row (stale snapshot is not reapplied) and bumps _rev', async () => {
    await advanceWatermark(KEY, 'W1', []);
    const stale = await readSyncState(KEY);
    await advanceWatermark(KEY, 'W2', []); // bumps _rev past the stale snapshot
    await bumpIncomplete(KEY); // built on the fresh row via CAS, not the stale one

    const fresh = await readSyncState(KEY);
    expect(fresh.watermark).toBe('W2'); // not rolled back to the stale W1
    expect(fresh.consecutiveIncomplete).toBe(1);
    expect(fresh._rev ?? 0).toBeGreaterThan(stale._rev ?? 0);
  });
});

describe('absorbRefs (on incomplete)', () => {
  it('merges refs into the seen-set and leaves the watermark unchanged', async () => {
    const wm = '2026-07-30T00:00:00.000Z';
    await advanceWatermark(KEY, wm, [{ ref: 'A', itemDate: '2026-07-29T00:00:00.000Z' }]);
    await absorbRefs(KEY, [{ ref: 'B', itemDate: '2026-07-29T12:00:00.000Z' }]);

    const doc = await readSyncState(KEY);
    expect(doc.watermark).toBe(wm); // unchanged
    expect(new Set(doc.seenRefs.map((r) => r.ref))).toEqual(new Set(['A', 'B']));
  });
});

describe('bumpIncomplete (on incomplete)', () => {
  it('increments consecutiveIncomplete, resets failures, keeps the watermark', async () => {
    const wm = '2026-07-30T00:00:00.000Z';
    await advanceWatermark(KEY, wm, []);
    await bumpFailure(KEY, 'transient');
    await bumpIncomplete(KEY);

    const doc = await readSyncState(KEY);
    expect(doc.watermark).toBe(wm);
    expect(doc.consecutiveIncomplete).toBe(1);
    expect(doc.consecutiveFailures).toBe(0); // a proved miss is not a machinery failure
    expect(doc.lastOutcome).toBe('incomplete');
  });
});

describe('bumpFailure (on failed)', () => {
  it('increments consecutiveFailures + stamps lastError, leaving watermark AND seen-set untouched', async () => {
    const wm = '2026-07-30T00:00:00.000Z';
    await advanceWatermark(KEY, wm, [{ ref: 'A', itemDate: '2026-07-29T00:00:00.000Z' }]);
    await bumpFailure(KEY, 'boom');
    await bumpFailure(KEY, 'boom again');

    const doc = await readSyncState(KEY);
    expect(doc.watermark).toBe(wm); // nothing moves
    expect(doc.seenRefs.map((r) => r.ref)).toEqual(['A']); // seen-set untouched
    expect(doc.consecutiveFailures).toBe(2);
    expect(doc.lastError).toBe('boom again');
    expect(doc.lastOutcome).toBe('failed');
  });
});

describe('seenRefs pruning', () => {
  it('drops refs older than watermark - MARGIN on a watermark advance', async () => {
    const wm = '2026-07-30T00:00:00.000Z';
    await advanceWatermark(KEY, wm, [
      { ref: 'recent', itemDate: '2026-07-29T00:00:00.000Z' }, // within the 7-day margin
      { ref: 'ancient', itemDate: '2026-01-01T00:00:00.000Z' }, // far older → pruned
    ]);

    const doc = await readSyncState(KEY);
    const refs = new Set(doc.seenRefs.map((r) => r.ref));
    expect(refs.has('recent')).toBe(true);
    expect(refs.has('ancient')).toBe(false);
  });

  it('hard-caps the seen-set at SEEN_HARD_CAP, keeping the newest by itemDate', async () => {
    const base = Date.parse('2026-06-01T00:00:00.000Z');
    const count = SEEN_HARD_CAP + 100;
    const many: SeenRef[] = Array.from({ length: count }, (_, i) => ({
      ref: `ref-${i}`,
      itemDate: new Date(base + i * 60_000).toISOString(),
    }));
    // watermark stays null → the date filter is inert, so ONLY the hard cap applies here.
    await absorbRefs(KEY, many);

    const doc = await readSyncState(KEY);
    expect(doc.seenRefs.length).toBe(SEEN_HARD_CAP);
    const refs = new Set(doc.seenRefs.map((r) => r.ref));
    expect(refs.has(`ref-${count - 1}`)).toBe(true); // newest kept
    expect(refs.has('ref-0')).toBe(false); // oldest dropped
  });

  it('pruneSeen is a pure helper: dedups by ref (last wins) and caps', () => {
    const out = pruneSeen(
      [
        { ref: 'x', itemDate: '2026-07-01T00:00:00.000Z' },
        { ref: 'x', itemDate: '2026-07-02T00:00:00.000Z' },
      ],
      null,
    );
    expect(out).toEqual([{ ref: 'x', itemDate: '2026-07-02T00:00:00.000Z' }]);
  });

  it('WARNS (observable, not silent) when the hard cap slices off overflow refs (Finding 5)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const base = Date.parse('2026-06-01T00:00:00.000Z');
      const many: SeenRef[] = Array.from({ length: SEEN_HARD_CAP + 5 }, (_, i) => ({
        ref: `r-${i}`,
        itemDate: new Date(base + i * 60_000).toISOString(),
      }));
      const out = pruneSeen(many, null);
      expect(out.length).toBe(SEEN_HARD_CAP);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('hard-cap overflow');
    } finally {
      warn.mockRestore();
    }
  });
});

describe('persistSyncReport', () => {
  function mkReport(i: number): SyncRunReport {
    const t = new Date(Date.parse('2026-07-30T00:00:00.000Z') + i * 60_000).toISOString();
    return {
      id: `report-${i}`,
      syncKey: syncStateId(KEY),
      orgId: KEY.orgId,
      startedAt: t,
      endedAt: t,
      outcome: 'complete',
      window: { since: null, until: t },
      verification: {
        pass1: { pages: 1, itemsSeen: 0, newRefs: 0, reachedEnd: true },
        pass2: { pages: 1, itemsSeen: 0, refsOnlyInPass2: [], reachedEnd: true },
        maxPages: 50,
      },
      landed: 0,
      duplicatesSuppressed: 0,
      sessionEvents: [],
    };
  }

  it('stores a report under _id = report.id and caps history to REPORT_HISTORY_CAP newest', async () => {
    const total = REPORT_HISTORY_CAP + 2;
    for (let i = 0; i < total; i++) await persistSyncReport(KEY, mkReport(i));

    const stateKey = syncStateId(KEY);
    const rows = await syncReports.find({ stateKey });
    expect(rows.length).toBe(REPORT_HISTORY_CAP);

    expect(await syncReports.get(`report-${total - 1}`)).not.toBeNull(); // newest kept
    expect(await syncReports.get('report-0')).toBeNull(); // oldest pruned
  });
});
