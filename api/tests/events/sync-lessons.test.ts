/**
 * CS8 — THE LESSONS SEAM, against a real mongodb-memory-server.
 *
 * What this suite is for: `sync_reports` is already an append-only per-run trail, so a lesson store
 * that behaved like one would add nothing. The property that makes it KNOWLEDGE rather than a log is
 * that the same fact met on 200 polls is ONE row with `occurrences: 200` and an immutable
 * `firstSeenAt`. Everything below either pins that, pins one of the bounds that keep a
 * source-influenced signature from minting rows without limit, or pins the scope: a lesson learned
 * from one mandatario's inbox is not evidence about a colleague's, and must not be readable as if it
 * were.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createMem, type MongoMemoryServer } from '../helpers/mongo-mem.js';
import { connectMongo, closeMongo } from '../../src/data/mongo.js';
import { Store, type Doc } from '../../src/data/store.js';
import type { SyncStateKey } from '../../src/events/sync-state.js';
import {
  dedupeLessons,
  lessonId,
  makeSyncLessonRecorder,
  normaliseLessonSignature,
  readSyncLessons,
  LESSONS_PER_KEY_CAP,
  LESSONS_PER_RUN_CAP,
  LESSON_DETAIL_MAX,
  LESSON_SIGNATURE_MAX,
  type SyncLessonInput,
} from '../../src/events/sync-lessons.js';

let mem: MongoMemoryServer;
const lessons = new Store<Doc>('sync_lessons');

/** Two lawyers in ONE firm: same org, same integration, same base action, different actor - the
 *  Citius action-key composition (hazard 4 in legal/citius-sync.ts). */
const ANA: SyncStateKey = {
  orgId: 'firma-1',
  integrationKey: 'caixa-citius',
  actionKey: JSON.stringify(['sync_notificacoes', 'ana']),
};
const BRUNO: SyncStateKey = { ...ANA, actionKey: JSON.stringify(['sync_notificacoes', 'bruno']) };

const T1 = '2026-07-30T10:00:00.000Z';
const T2 = '2026-07-30T11:00:00.000Z';
const T3 = '2026-07-30T12:00:00.000Z';

/** A purely ALPHABETIC distinct token: digits would be normalised away into one signature. */
function alpha(i: number): string {
  return `${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))}`;
}

function lesson(over: Partial<SyncLessonInput> = {}): SyncLessonInput {
  return { kind: 'pager', signature: 'walk-incomplete:pager-unrecognised', detail: 'um controlo que este conector nao sabe accionar', ...over };
}

beforeAll(async () => {
  mem = await createMem();
  await connectMongo(mem.getUri(), 'ekoa_sync_lessons_test');
}, 60_000);

afterAll(async () => {
  await closeMongo();
  await mem.stop();
});

beforeEach(async () => {
  await lessons.deleteMany({});
});

// ---------------------------------------------------------------------------
// 1. Knowledge, not a log
// ---------------------------------------------------------------------------

describe('sync-lessons · the same fact twice is ONE row', () => {
  it('dedupes on (key, kind, signature): occurrences climb, firstSeenAt never moves', async () => {
    const record = makeSyncLessonRecorder(ANA);

    const first = await record([lesson()], { observedAt: T1, reportId: 'run-1', outcome: 'incomplete' });
    expect(first).toHaveLength(1);
    expect(first[0]!.isNew).toBe(true);
    expect(first[0]!.occurrences).toBe(1);

    const second = await record([lesson()], { observedAt: T2, reportId: 'run-2', outcome: 'complete' });
    expect(second[0]!.isNew).toBe(false);
    expect(second[0]!.occurrences).toBe(2);

    const stored = await readSyncLessons(ANA);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.firstSeenAt).toBe(T1); // "when did this inbox FIRST do this" survives
    expect(stored[0]!.lastSeenAt).toBe(T2);
    expect(stored[0]!.occurrences).toBe(2);
    expect(stored[0]!.lastReportId).toBe('run-2');
    expect(stored[0]!.lastOutcome).toBe('complete');
  });

  it('a DIFFERENT fact is a different row (dedup is per signature, not per key)', async () => {
    const record = makeSyncLessonRecorder(ANA);
    await record([lesson(), lesson({ kind: 'parse', signature: 'walk-incomplete:page-unparseable' })], {
      observedAt: T1,
    });

    const stored = await readSyncLessons(ANA);
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((l) => l.signature))).toEqual(
      new Set(['walk-incomplete:pager-unrecognised', 'walk-incomplete:page-unparseable']),
    );
  });

  it('the same signature under a different KIND is a different row (the id hashes both)', async () => {
    expect(lessonId(ANA, 'pager', 'x')).not.toBe(lessonId(ANA, 'parse', 'x'));
  });

  it('within ONE call, a repeated fact is collapsed before it ever reaches the store', async () => {
    const record = makeSyncLessonRecorder(ANA);
    // A 3-page walk where all three pages failed the same way: one lesson, occurrences 1.
    const out = await record([lesson({ page: 1 }), lesson({ page: 2 }), lesson({ page: 3 })], { observedAt: T1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.occurrences).toBe(1);
    expect(out[0]!.page).toBe(1); // the first statement wins its detail/page
  });
});

// ---------------------------------------------------------------------------
// 2. The bounds (a signature is partly source-controlled)
// ---------------------------------------------------------------------------

describe('sync-lessons · bounded, because part of a signature comes from the source', () => {
  it('DIGIT RUNS collapse, so a varying timeout/status is not a new lesson every run', () => {
    expect(normaliseLessonSignature('walk-failed:timeout after 30012ms')).toBe(
      normaliseLessonSignature('walk-failed:timeout after 29997ms'),
    );
    expect(normaliseLessonSignature('walk-failed:timeout after 30012ms')).toBe('walk-failed:timeout after #ms');
  });

  it('…and that really is what stops row growth, end to end', async () => {
    const record = makeSyncLessonRecorder(ANA);
    for (const ms of [30012, 29997, 30500]) {
      await record([lesson({ kind: 'transport', signature: `walk-failed:timeout after ${ms}ms` })], { observedAt: T1 });
    }
    const stored = await readSyncLessons(ANA);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.occurrences).toBe(3);
  });

  it('control characters and whitespace runs are flattened; case is normalised', () => {
    expect(normaliseLessonSignature('  Page\u0000-\tERROR\n\n 503 ')).toBe('page - error #');
  });

  it('signature and detail are TRUNCATED, so a hostile page cannot write a novel into a row', async () => {
    const record = makeSyncLessonRecorder(ANA);
    const out = await record(
      [lesson({ signature: `sig:${'a'.repeat(5000)}`, detail: 'd'.repeat(5000) })],
      { observedAt: T1 },
    );
    expect(out[0]!.signature.length).toBe(LESSON_SIGNATURE_MAX);
    expect(out[0]!.detail.length).toBe(LESSON_DETAIL_MAX);
  });

  it('a lesson with an empty signature is not a lesson and is dropped', async () => {
    const record = makeSyncLessonRecorder(ANA);
    expect(await record([lesson({ signature: '   ' })], { observedAt: T1 })).toEqual([]);
    expect(await readSyncLessons(ANA)).toEqual([]);
  });

  it('ONE run contributes at most LESSONS_PER_RUN_CAP distinct lessons', () => {
    const many: SyncLessonInput[] = Array.from({ length: LESSONS_PER_RUN_CAP + 40 }, (_, i) =>
      lesson({ signature: `distinct-fact-${alpha(i)}` }),
    );
    expect(dedupeLessons(many)).toHaveLength(LESSONS_PER_RUN_CAP);
  });

  it('a KEY keeps at most LESSONS_PER_KEY_CAP rows, dropping the least recently seen, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const record = makeSyncLessonRecorder(ANA);
      // The oldest-seen row: written first and never touched again.
      await record([lesson({ signature: 'the-oldest-fact' })], { observedAt: T1 });
      for (let i = 0; i < LESSONS_PER_KEY_CAP + 4; i++) {
        // ALPHABETIC, deliberately: digit runs collapse to `#` (that is the dedup working), so a
        // numeric filler would be ONE fact repeated and would test nothing.
        await record([lesson({ signature: `filler-fact-${alpha(i)}` })], { observedAt: T3 });
      }

      const stored = await readSyncLessons(ANA, LESSONS_PER_KEY_CAP * 2);
      expect(stored).toHaveLength(LESSONS_PER_KEY_CAP);
      expect(stored.map((l) => l.signature)).not.toContain('the-oldest-fact');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// 3. Scope — one org is not one inbox
// ---------------------------------------------------------------------------

describe('sync-lessons · per-ACTOR, not per-org', () => {
  it('two lawyers in the same firm keep separate knowledge, and neither read sees the other', async () => {
    await makeSyncLessonRecorder(ANA)([lesson({ signature: 'ana-only-fact' })], { observedAt: T1 });
    await makeSyncLessonRecorder(BRUNO)([lesson({ signature: 'bruno-only-fact' })], { observedAt: T1 });

    expect((await readSyncLessons(ANA)).map((l) => l.signature)).toEqual(['ana-only-fact']);
    expect((await readSyncLessons(BRUNO)).map((l) => l.signature)).toEqual(['bruno-only-fact']);
  });

  it('the SAME fact under two actors is two rows, each counting only its own inbox', async () => {
    await makeSyncLessonRecorder(ANA)([lesson()], { observedAt: T1 });
    await makeSyncLessonRecorder(ANA)([lesson()], { observedAt: T2 });
    await makeSyncLessonRecorder(BRUNO)([lesson()], { observedAt: T2 });

    expect((await readSyncLessons(ANA))[0]!.occurrences).toBe(2);
    expect((await readSyncLessons(BRUNO))[0]!.occurrences).toBe(1);
    expect(lessonId(ANA, 'pager', 'x')).not.toBe(lessonId(BRUNO, 'pager', 'x'));
  });

  it('FAILS CLOSED: an unscoped key cannot build a recorder, so it can neither write nor read', async () => {
    expect(() => makeSyncLessonRecorder({ ...ANA, orgId: '' })).toThrow(/unscoped sync key/);
    expect(() => makeSyncLessonRecorder({ ...ANA, actionKey: '  ' })).toThrow(/unscoped sync key/);
    await expect(readSyncLessons({ ...ANA, orgId: '' })).rejects.toThrow(/unscoped sync key/);
  });
});

// ---------------------------------------------------------------------------
// 4. The read
// ---------------------------------------------------------------------------

describe('sync-lessons · the read', () => {
  it('answers most recently seen first, and honours its limit', async () => {
    const record = makeSyncLessonRecorder(ANA);
    await record([lesson({ signature: 'seen-long-ago' })], { observedAt: T1 });
    await record([lesson({ signature: 'seen-recently' })], { observedAt: T3 });

    expect((await readSyncLessons(ANA)).map((l) => l.signature)).toEqual(['seen-recently', 'seen-long-ago']);
    expect(await readSyncLessons(ANA, 1)).toHaveLength(1);
    expect(await readSyncLessons(ANA, 0)).toEqual([]);
  });

  it('a key that never learned anything reads empty, not an error', async () => {
    expect(await readSyncLessons(BRUNO)).toEqual([]);
  });

  it('the row carries no storage plumbing into the read shape', async () => {
    await makeSyncLessonRecorder(ANA)([lesson()], { observedAt: T1 });
    const [row] = await readSyncLessons(ANA);
    expect(Object.keys(row!).sort()).toEqual(
      ['detail', 'firstSeenAt', 'id', 'kind', 'lastSeenAt', 'occurrences', 'signature'].sort(),
    );
  });
});
