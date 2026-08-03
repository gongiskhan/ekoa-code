/**
 * CS8 — WHAT A CITIUS RUN LEARNED, plus the two things the CS6 review found missing on this rail:
 * per-key SERIALIZATION (#serialize) and the coordinate-system silent miss (hazard 5, proved in
 * `citius-sync.test.ts` and end to end in `citius-sync-completeness.e2e.test.ts`).
 *
 * The suite is Mongo-free and portal-free: every seam is injected, so the lessons a run claims to
 * have learned are observable as VALUES. What it pins:
 *
 *   1. the derivation - a proved-partial walk, a dead session, a broken page and the reconciliation's
 *      own discovery each produce a lesson that names the SPIKE it answers;
 *   2. the boundary - a lesson is derived from the walk's STATUS fields ONLY, so no notification
 *      metadata (and above all no document reference) can reach the lesson store. This is the CS8
 *      extension of the metadata-only proof: the slice added a collection, so the proof follows it;
 *   3. the write surface - nothing is recorded for a run that never ran (`needs-human` /
 *      `needs-egress`), keeping CS6's "nothing ran, nothing is written" a single statement;
 *   4. never load-bearing - a sink that throws does not fail the sync;
 *   5. #serialize - two concurrent syncs on ONE key are strictly sequential, and two actors are not.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CitiusNotificacaoMeta } from '../../src/legal/citius-mandatarios.js';
import type { CitiusInboxEnumeration } from '../../src/legal/citius-mandatarios-http.js';
import {
  syncCitiusNotifications,
  type CitiusSyncDeps,
  type CitiusSyncInput,
} from '../../src/legal/citius-sync.js';
import type { SyncLessonContext, SyncLessonInput } from '../../src/events/sync-lessons.js';
import type { EnumeratedItem, SeenRef, SyncStateSnapshot, SyncStateStore } from '../../src/events/verified-sync.js';
import type { EnsureSessionResult } from '../../src/automation/session-establishment.js';

const ACTOR = { userId: 'mandataria-1', orgId: 'firma-a', role: 'user' as const };

function row(n: number, over: Partial<CitiusNotificacaoMeta> = {}): CitiusNotificacaoMeta {
  return {
    ref: `r${n}`,
    processo: `${1000 + n}/26.0T8LSB`,
    data: `2026-06-${String(10 + n).padStart(2, '0')}`,
    tribunal: 'Tribunal Judicial da Comarca de Lisboa',
    ato: 'Citação',
    temDocumento: true,
    documentoRef: '/habilus/myhabilus/Documento.aspx?docId=segredo-do-processo',
    ...over,
  };
}

function pageOutcomes(pages: number, rows: number): CitiusInboxEnumeration['pages'] {
  return Array.from({ length: pages }, (_, i) => ({ page: i + 1, outcome: 'ok' as const, rows }));
}

const complete = (rows: CitiusNotificacaoMeta[], pagesWalked = 1): CitiusInboxEnumeration => ({
  status: 'complete', rows, pagesWalked, pages: pageOutcomes(pagesWalked, rows.length),
});

function fakeStore(initial: Partial<SyncStateSnapshot> = {}): SyncStateStore & { snapshot: SyncStateSnapshot } {
  const snapshot: SyncStateSnapshot = {
    watermark: null, seenRefs: [], consecutiveIncomplete: 0, consecutiveFailures: 0, ...initial,
  };
  return {
    snapshot,
    read: async () => ({ ...snapshot, seenRefs: [...snapshot.seenRefs] }),
    advanceWatermark: async (watermark: string, newSeen: SeenRef[]) => {
      snapshot.watermark = watermark;
      snapshot.seenRefs = [...snapshot.seenRefs, ...newSeen];
    },
    absorbRefs: async (refs: SeenRef[]) => { snapshot.seenRefs = [...snapshot.seenRefs, ...refs]; },
    bumpIncomplete: async () => { snapshot.consecutiveIncomplete += 1; },
    bumpFailure: async () => { snapshot.consecutiveFailures += 1; },
    saveReport: async () => {},
  };
}

interface Rig {
  run: () => ReturnType<typeof syncCitiusNotifications>;
  lessons: SyncLessonInput[];
  contexts: SyncLessonContext[];
  landed: EnumeratedItem[];
}

function rig(
  walks: CitiusInboxEnumeration[],
  over: {
    session?: EnsureSessionResult;
    store?: SyncStateStore;
    input?: Partial<CitiusSyncInput>;
    recordLesson?: CitiusSyncDeps['recordLesson'];
  } = {},
): Rig {
  const lessons: SyncLessonInput[] = [];
  const contexts: SyncLessonContext[] = [];
  const landed: EnumeratedItem[] = [];
  let pass = 0;
  const deps: CitiusSyncDeps = {
    establishSession: async () =>
      over.session ?? ({ status: 'reused', itemId: 'item1', storageState: { cookies: [] } } as EnsureSessionResult),
    markSessionUnhealthy: async () => true,
    enumerate: async () => {
      const w = walks[Math.min(pass, walks.length - 1)]!;
      pass += 1;
      return w;
    },
    land: async (item: EnumeratedItem) => { landed.push(item); return { landed: true }; },
    store: over.store ?? fakeStore(),
    clock: () => new Date('2026-07-01T00:00:00.000Z'),
    recordLesson:
      over.recordLesson ??
      (async (batch, ctx) => { lessons.push(...batch); contexts.push(ctx); return []; }),
  };
  const input: CitiusSyncInput = {
    actor: ACTOR, runId: 'run1', baseUrl: 'https://portal.example', ...over.input,
  };
  return { run: () => syncCitiusNotifications(input, deps), lessons, contexts, landed };
}

const signatures = (ls: SyncLessonInput[]): string[] => ls.map((l) => l.signature);

// ---------------------------------------------------------------------------
// 1. The derivation
// ---------------------------------------------------------------------------

describe('citius-sync · a run records what it learned', () => {
  it('a clean run learns nothing: an uneventful sweep is not knowledge', async () => {
    const h = rig([complete([row(1)]), complete([row(1)])]);
    const out = await h.run();
    expect(out.status).toBe('ran');
    expect(h.lessons).toEqual([]);
    // …but the seam WAS called, so "no lessons" is a derivation result, not a dead wire.
    expect(h.contexts).toHaveLength(1);
    expect(h.contexts[0]!.outcome).toBe('complete');
  });

  it('a PAGER idiom this connector cannot drive becomes a durable lesson naming its SPIKE', async () => {
    const walk: CitiusInboxEnumeration = {
      status: 'incomplete', reason: 'pager-unrecognised', rows: [row(1)], pagesWalked: 1, pages: pageOutcomes(1, 1),
    };
    const h = rig([walk, walk]);
    await h.run();

    expect(signatures(h.lessons)).toContain('walk-incomplete:pager-unrecognised');
    const lesson = h.lessons.find((l) => l.signature === 'walk-incomplete:pager-unrecognised')!;
    expect(lesson.kind).toBe('pager');
    expect(lesson.detail).toMatch(/SPIKE #3/);
  });

  it('a SHAPE the parser refused files as a parse lesson, not as a pager one', async () => {
    const walk: CitiusInboxEnumeration = {
      status: 'incomplete', reason: 'page-unparseable', rows: [], pagesWalked: 1,
      pages: [{ page: 1, outcome: 'unparseable', rows: 0, note: 'grelha com cabeçalho agrupado' }],
    };
    const h = rig([walk, walk]);
    await h.run();

    const kinds = new Map(h.lessons.map((l) => [l.signature, l.kind]));
    expect(kinds.get('walk-incomplete:page-unparseable')).toBe('parse');
    expect(kinds.get('page-unparseable')).toBe('parse');
    // the connector's own per-page note is what an operator reads
    expect(h.lessons.find((l) => l.signature === 'page-unparseable')!.detail).toBe('grelha com cabeçalho agrupado');
  });

  it('a per-page HTTP status becomes a transport lesson carrying the status in its signature', async () => {
    const walk: CitiusInboxEnumeration = {
      status: 'incomplete', reason: 'max-pages', rows: [row(1)], pagesWalked: 2,
      pages: [{ page: 1, outcome: 'ok', rows: 1 }, { page: 2, outcome: 'http-error', rows: 0, status: 429 }],
    };
    const h = rig([walk, walk]);
    await h.run();

    const lesson = h.lessons.find((l) => l.signature === 'page-http-error:429')!;
    expect(lesson.kind).toBe('transport');
    expect(lesson.page).toBe(2);
  });

  it('a DEAD SESSION teaches how it was detected, and that the item was retired', async () => {
    const dead: CitiusInboxEnumeration = {
      status: 'session-dead', detectedBy: 'login-redirect', atPage: 3, rows: [], pagesWalked: 2, pages: pageOutcomes(2, 0),
    };
    const h = rig([dead, dead]);
    const out = await h.run();

    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('failed');
    expect(signatures(h.lessons)).toContain('session-dead:login-redirect');
    expect(signatures(h.lessons)).toContain('session-retired-mid-run');
    expect(h.contexts[0]!.outcome).toBe('failed'); // the failed path records too
  });

  it('a re-established session is knowledge; a reused one is routine and is not recorded', async () => {
    const reestablished = await rig([complete([row(1)]), complete([row(1)])], {
      session: { status: 'reestablished', itemId: 'item1', storageState: { cookies: [] } } as EnsureSessionResult,
    });
    await reestablished.run();
    expect(signatures(reestablished.lessons)).toEqual(['session-reestablished']);

    const plain = rig([complete([row(1)]), complete([row(1)])]);
    await plain.run();
    expect(signatures(plain.lessons)).not.toContain('session-reestablished');
  });

  it('THE RECONCILIATION\'S OWN DISCOVERY: a late-visible item teaches that untilSkewMs is too small', async () => {
    const h = rig([complete([row(1)]), complete([row(1), row(2)])]);
    const out = await h.run();

    expect(out.status).toBe('ran');
    if (out.status !== 'ran') return;
    expect(out.report.outcome).toBe('incomplete');
    const lesson = h.lessons.find((l) => l.signature === 'reconciliation:late-visible-items')!;
    expect(lesson.kind).toBe('completeness');
    expect(lesson.detail).toMatch(/untilSkewMs/);
    expect(lesson.detail).toMatch(/#visibility-monotonic/);
    // A COUNT, never the references themselves: a notification reference is client data, and it
    // would also mint a new lesson row on every run.
    expect(lesson.detail).toMatch(/revelou 1 referência/);
    expect(lesson.detail).not.toMatch(/\br2\b/);
  });

  it('the run context stamps the report the lessons came from', async () => {
    const h = rig([complete([row(1)]), complete([row(1)])], { input: { reportId: 'relatorio-7' } });
    await h.run();
    expect(h.contexts[0]!.reportId).toBe('relatorio-7');
    expect(h.contexts[0]!.observedAt).toBe('2026-07-01T00:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// 2. The boundary — the metadata-only proof follows the new collection
// ---------------------------------------------------------------------------

describe('citius-sync · METADATA ONLY reaches the lessons seam too', () => {
  it('no lesson carries a notification field, and above all no document reference', async () => {
    // Every walk state at once, over rows that DO carry document references.
    const rows = [row(1), row(2), row(3)];
    const messy: CitiusInboxEnumeration = {
      status: 'incomplete', reason: 'page-full-no-pager', rows, pagesWalked: 2,
      pages: [
        { page: 1, outcome: 'ok', rows: 3 },
        { page: 2, outcome: 'transport-error', rows: 0, note: 'ligação terminada' },
      ],
    };
    const h = rig([messy, { ...messy, rows: [...rows, row(4)] }]);
    const out = await h.run();

    // NON-VACUITY: the rows really were carrying documents through this very run…
    expect(out.status).toBe('ran');
    expect(h.landed.length).toBeGreaterThan(0);
    expect(JSON.stringify(h.landed)).toMatch(/Documento\.aspx/);

    // …and not a byte of that reached a lesson.
    expect(h.lessons.length).toBeGreaterThan(0);
    const serialised = JSON.stringify(h.lessons);
    expect(serialised).not.toMatch(/Documento\.aspx/i);
    expect(serialised).not.toMatch(/documentoRef/);
    expect(serialised).not.toMatch(/segredo-do-processo/);
    expect(serialised).not.toMatch(/T8LSB/); // no processo number either
    expect(serialised).not.toMatch(/\br[1-9]\b/); // no row ref
  });
});

// ---------------------------------------------------------------------------
// 3. The write surface, and never load-bearing
// ---------------------------------------------------------------------------

describe('citius-sync · the lessons seam is never load-bearing', () => {
  it('a run that never ran records NOTHING (needs-human), exactly like the report and the state', async () => {
    const h = rig([complete([row(1)])], {
      session: { status: 'needs-human', route: 'attended', reason: 'cartão de advogado', attempted: false } as EnsureSessionResult,
    });
    const out = await h.run();
    expect(out.status).toBe('needs-human');
    expect(h.lessons).toEqual([]);
    expect(h.contexts).toEqual([]);
  });

  it('…and the same for needs-egress', async () => {
    const h = rig([complete([row(1)])], {
      session: { status: 'needs-egress', required: { kind: 'residential', pairingId: 'p1' } } as EnsureSessionResult,
    });
    const out = await h.run();
    expect(out.status).toBe('needs-egress');
    expect(h.contexts).toEqual([]);
  });

  it('a lessons sink that THROWS does not fail the sync, and the watermark still moved', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = fakeStore();
      const h = rig([complete([row(1)]), complete([row(1)])], {
        store,
        recordLesson: async () => { throw new Error('lesson store unreachable'); },
      });
      const out = await h.run();
      expect(out.status).toBe('ran');
      if (out.status !== 'ran') return;
      expect(out.report.outcome).toBe('complete');
      expect(store.snapshot.watermark).not.toBeNull();
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. #serialize — the CS3 obligation the route made reachable
// ---------------------------------------------------------------------------

describe('citius-sync · at most ONE run per key at a time (#serialize)', () => {
  /** A rig whose enumerate blocks until released, so an overlap is constructible rather than raced. */
  function gated(actor: typeof ACTOR): {
    start: () => Promise<unknown>;
    release: () => void;
    entries: string[];
    store: SyncStateStore & { snapshot: SyncStateSnapshot };
  } {
    const entries: string[] = [];
    const store = fakeStore();
    let unlock: () => void = () => {};
    const gate = new Promise<void>((resolve) => { unlock = resolve; });
    let started = false;
    const deps: CitiusSyncDeps = {
      establishSession: async () => ({ status: 'reused', itemId: 'i', storageState: { cookies: [] } } as EnsureSessionResult),
      markSessionUnhealthy: async () => true,
      enumerate: async () => {
        if (!started) {
          started = true;
          entries.push(`enter:${actor.userId}`);
          await gate; // hold the first pass open
          entries.push(`leave:${actor.userId}`);
        }
        return complete([row(1)]);
      },
      land: async () => ({ landed: true }),
      store,
      clock: () => new Date('2026-07-01T00:00:00.000Z'),
      recordLesson: async () => [],
    };
    return {
      start: () => syncCitiusNotifications({ actor, runId: `r-${actor.userId}`, baseUrl: 'https://portal.example' }, deps),
      release: () => unlock(),
      entries,
      store,
    };
  }

  it('a second run for the SAME actor waits for the first to finish', async () => {
    const shared: string[] = [];
    const store = fakeStore();
    let inFlight = 0;
    let maxConcurrent = 0;
    const deps: CitiusSyncDeps = {
      establishSession: async () => ({ status: 'reused', itemId: 'i', storageState: { cookies: [] } } as EnsureSessionResult),
      markSessionUnhealthy: async () => true,
      enumerate: async () => {
        inFlight += 1;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        shared.push('pass');
        await new Promise((r) => setTimeout(r, 5)); // a real interleaving opportunity
        inFlight -= 1;
        return complete([row(1)]);
      },
      land: async () => ({ landed: true }),
      store,
      clock: () => new Date('2026-07-01T00:00:00.000Z'),
      recordLesson: async () => [],
    };
    const input: CitiusSyncInput = { actor: ACTOR, runId: 'r', baseUrl: 'https://portal.example' };

    await Promise.all([syncCitiusNotifications(input, deps), syncCitiusNotifications(input, deps)]);

    // 4 passes total (2 runs x 2 verification passes) and NEVER two at once: without the lock the
    // two runs' passes interleave and both read the same seen-set before either writes.
    expect(shared).toHaveLength(4);
    expect(maxConcurrent).toBe(1);
  });

  it('a DIFFERENT actor in the same org does NOT queue behind them (one org is not one inbox)', async () => {
    const ana = gated({ ...ACTOR, userId: 'ana' });
    const bruno = gated({ ...ACTOR, userId: 'bruno' });

    const anaRun = ana.start();
    const brunoRun = bruno.start();
    // Bruno's sync must reach its first enumerate while Ana's is still held open.
    await vi.waitFor(() => expect(bruno.entries).toContain('enter:bruno'));
    expect(ana.entries).toContain('enter:ana');
    expect(ana.entries).not.toContain('leave:ana');

    ana.release();
    bruno.release();
    await Promise.all([anaRun, brunoRun]);
  });

  it('an UNSCOPEABLE request throws immediately rather than queueing behind someone else', async () => {
    await expect(
      syncCitiusNotifications(
        { actor: { userId: 'u', orgId: '', role: 'user' }, runId: 'r', baseUrl: 'https://portal.example' },
        { establishSession: async () => { throw new Error('must not be reached'); }, markSessionUnhealthy: async () => true },
      ),
    ).rejects.toThrow(/orgId em falta/);
  });
});
