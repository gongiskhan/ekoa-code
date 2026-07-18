/**
 * Unit coverage for the B5 reply_summary ID ROUTING (codex fix 1): a summary attaches ONLY
 * to the turn whose sheet/revision ids match - never "the newest assistant turn" - and an
 * event whose turn has not landed yet is buffered (capped) and consumed when the matching
 * turn arrives via addMessage / stampTurnSheetLink / loadSessionMessages. Plus the B7
 * finding-1 reload path: loadSessionMessages rehydrates summary entries from the persisted
 * turn metadata (summaryTitle/summarySummary/summaryRevision). The UI wiring is covered by
 * web/e2e/summary-cards-chip.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Controllable transcript read for the hydration tests; every other endpoint resolves to a
// no-op success envelope so the store stays importable without a backend.
const getMessages = vi.fn<() => Promise<{ items: unknown[] }>>(async () => ({ items: [] }));
vi.mock('@/lib/api', () => {
  const noop = () => Promise.resolve({ success: true, data: null });
  const api = new Proxy(
    {},
    {
      get: (_t, domain) =>
        new Proxy({}, { get: (_t2, fn) => (domain === 'sessions' && fn === 'getMessages' ? getMessages : noop) }),
    },
  );
  return {
    api,
    tryCall: async (fn: () => Promise<unknown>) => {
      try {
        return { ok: true, data: await fn() };
      } catch (error) {
        return { ok: false, error };
      }
    },
  };
});

import { useOrchestrationStore, type ChatMessage, type ReplySummaryEntry } from '@/stores/orchestration';

const SID = 'session-summary';

function turn(id: string, role: ChatMessage['role'], metadata?: ChatMessage['metadata']): ChatMessage {
  return { id, role, content: `conteudo ${id}`, timestamp: new Date(0).toISOString(), metadata };
}

function entry(sheetId: string, revisionId: string, extra?: Partial<ReplySummaryEntry>): ReplySummaryEntry {
  return { sheetId, revisionId, title: `t-${sheetId}`, summary: `s-${revisionId}`, ...extra };
}

beforeEach(() => {
  getMessages.mockReset();
  getMessages.mockResolvedValue({ items: [] });
  useOrchestrationStore.setState({
    messages: {},
    sessions: [],
    replySummaries: {},
    pendingReplySummaries: {},
    sheetLinks: {},
  });
});

/** A server transcript row as GET /sessions/:id/messages serves it. */
function serverRow(id: string, role: string, metadata?: Record<string, unknown>): Record<string, unknown> {
  return { id, role, content: `conteudo ${id}`, createdAt: new Date(0).toISOString(), ...(metadata ? { metadata } : {}) };
}

describe('attachReplySummary - ID routing, never recency', () => {
  it('attaches to the turn whose derived id matches, NOT the newest turn', () => {
    // Two server-id fresh turns; the event describes the OLDER one (a slow summary for
    // turn m1 arriving after m2 landed - the exact misattachment the codex finding named).
    useOrchestrationStore.setState({
      messages: { [SID]: [turn('m1', 'assistant'), turn('u1', 'user'), turn('m2', 'assistant')] },
    });
    useOrchestrationStore.getState().attachReplySummary(SID, entry('sheet-m1', 'rev-m1'));
    const summaries = useOrchestrationStore.getState().replySummaries[SID]!;
    expect(summaries['m1']).toMatchObject({ sheetId: 'sheet-m1' });
    expect(summaries['m2']).toBeUndefined();
  });

  it('routes a revision-turn event by revisionId - the fresh turn whose derived sheet was revised is NOT hit', () => {
    // m1's derived sheet (sheet-m1) was later revised by the stamped revision turn m2:
    // both relate to sheet-m1, so revisionId is the discriminator.
    useOrchestrationStore.setState({
      messages: {
        [SID]: [
          turn('m1', 'assistant'),
          turn('m2', 'assistant', { sheetId: 'sheet-m1', revisionId: 'r2', revisionNumber: 2 }),
        ],
      },
    });
    const s = useOrchestrationStore.getState();
    s.attachReplySummary(SID, entry('sheet-m1', 'r2', { revision: 2 }));
    s.attachReplySummary(SID, entry('sheet-m1', 'rev-m1'));
    const summaries = useOrchestrationStore.getState().replySummaries[SID]!;
    expect(summaries['m2']).toMatchObject({ revisionId: 'r2', revision: 2 });
    expect(summaries['m1']).toMatchObject({ revisionId: 'rev-m1' });
  });

  it('BUFFERS an event with no matching turn and consumes it when the turn lands via addMessage', () => {
    const s = useOrchestrationStore.getState();
    s.attachReplySummary(SID, entry('sheet-m9', 'rev-m9'));
    expect(useOrchestrationStore.getState().replySummaries[SID]).toBeUndefined();
    expect(useOrchestrationStore.getState().pendingReplySummaries[SID]).toHaveLength(1);

    // A non-matching assistant turn consumes nothing...
    s.addMessage(SID, { role: 'assistant', content: 'outra resposta' }, { persist: false });
    expect(useOrchestrationStore.getState().pendingReplySummaries[SID]).toHaveLength(1);

    // ...the ID-matching turn (a server-id reload row) drains it.
    useOrchestrationStore.setState((state) => ({
      messages: { ...state.messages, [SID]: [...(state.messages[SID] ?? []), turn('m9', 'assistant')] },
    }));
    s.attachReplySummary(SID, entry('sheet-x', 'rev-x')); // unrelated: buffered, not attached
    s.stampTurnSheetLink(SID, 'm9', { sheetId: 'sheet-m9', revisionId: 'rev-m9' });
    const state = useOrchestrationStore.getState();
    expect(state.replySummaries[SID]!['m9']).toMatchObject({ sheetId: 'sheet-m9' });
    expect(state.pendingReplySummaries[SID]).toHaveLength(1); // only the unrelated one left
  });

  it('stampTurnSheetLink writes server ids onto the mirror turn and drains the waiting event (the settle flow)', () => {
    // The live-mirror shape: a local-id turn with no ids; the summary outran the stamp.
    const localId = useOrchestrationStore
      .getState()
      .addMessage(SID, { role: 'assistant', content: 'resposta' }, { persist: false });
    useOrchestrationStore.getState().attachReplySummary(SID, entry('sh-1', 'rv-2', { revision: 2 }));
    expect(useOrchestrationStore.getState().replySummaries[SID]).toBeUndefined();

    useOrchestrationStore.getState().stampTurnSheetLink(SID, localId, { sheetId: 'sh-1', revisionId: 'rv-2', revisionNumber: 2 });
    const state = useOrchestrationStore.getState();
    expect(state.messages[SID]!.find((m) => m.id === localId)!.metadata).toMatchObject({
      sheetId: 'sh-1',
      revisionId: 'rv-2',
      revisionNumber: 2,
    });
    expect(state.replySummaries[SID]![localId]).toMatchObject({ revisionId: 'rv-2' });
    expect(state.pendingReplySummaries[SID]).toEqual([]);
  });

  it('drops an exact duplicate event instead of migrating it to another turn', () => {
    useOrchestrationStore.setState({
      messages: { [SID]: [turn('m1', 'assistant'), turn('m2', 'assistant')] },
    });
    const s = useOrchestrationStore.getState();
    s.attachReplySummary(SID, entry('sheet-m1', 'rev-m1'));
    s.attachReplySummary(SID, entry('sheet-m1', 'rev-m1'));
    const state = useOrchestrationStore.getState();
    expect(Object.keys(state.replySummaries[SID]!)).toEqual(['m1']);
    expect(state.pendingReplySummaries[SID]).toBeUndefined();
  });

  it('caps the pending buffer at 8, dropping the oldest', () => {
    const s = useOrchestrationStore.getState();
    for (let i = 0; i < 10; i++) s.attachReplySummary(SID, entry(`sheet-p${i}`, `rev-p${i}`));
    const pending = useOrchestrationStore.getState().pendingReplySummaries[SID]!;
    expect(pending).toHaveLength(8);
    expect(pending[0]!.sheetId).toBe('sheet-p2');
    expect(pending[7]!.sheetId).toBe('sheet-p9');
  });
});

describe('loadSessionMessages - persisted-summary hydration (B7 finding 1)', () => {
  it('rebuilds summary entries from persisted metadata: derived ids for a FRESH turn, back-referenced ids + ordinal for a REVISION turn', async () => {
    getMessages.mockResolvedValue({
      items: [
        serverRow('u1', 'user'),
        // Fresh turn: summary persisted, no sheet back-reference -> derived id vocabulary.
        serverRow('m1', 'assistant', {
          isEssential: true,
          summaryTitle: 'Titulo persistido',
          summarySummary: 'Resumo persistido da resposta.',
        }),
        // Revision turn: back-reference + ordinal persisted alongside the summary.
        serverRow('m2', 'assistant', {
          isEssential: true,
          sheetId: 'sheet-m1',
          revisionId: 'r2',
          revisionNumber: 2,
          summaryTitle: 'Tom mais formal',
          summarySummary: 'A despedida ficou formal.',
          summaryRevision: 2,
        }),
        // No persisted summary (the B.E degradation) -> stays placeholder, no entry.
        serverRow('m3', 'assistant', { isEssential: true }),
      ],
    });
    await useOrchestrationStore.getState().loadSessionMessages(SID);

    const summaries = useOrchestrationStore.getState().replySummaries[SID]!;
    expect(summaries['m1']).toEqual({
      sheetId: 'sheet-m1',
      revisionId: 'rev-m1',
      title: 'Titulo persistido',
      summary: 'Resumo persistido da resposta.',
    });
    expect(summaries['m2']).toEqual({
      sheetId: 'sheet-m1',
      revisionId: 'r2',
      title: 'Tom mais formal',
      summary: 'A despedida ficou formal.',
      revision: 2,
    });
    expect(summaries['m3']).toBeUndefined();
  });

  it('a live-attached entry wins over the hydrated copy, and hydration still drains an unrelated buffered event', async () => {
    // The live event attached to m1 first (this page life); the persisted copy must not
    // clobber it. A buffered event for m9 waits for its turn to land via the same load.
    useOrchestrationStore.setState({
      messages: { [SID]: [turn('m1', 'assistant')] },
      replySummaries: { [SID]: { m1: entry('sheet-m1', 'rev-m1', { title: 'titulo LIVE' }) } },
      pendingReplySummaries: { [SID]: [entry('sheet-m9', 'rev-m9')] },
    });
    getMessages.mockResolvedValue({
      items: [
        serverRow('m1', 'assistant', {
          isEssential: true,
          summaryTitle: 'titulo persistido mais antigo',
          summarySummary: 'resumo persistido',
        }),
        serverRow('m9', 'assistant', { isEssential: true }),
      ],
    });
    await useOrchestrationStore.getState().loadSessionMessages(SID);

    const state = useOrchestrationStore.getState();
    expect(state.replySummaries[SID]!['m1']!.title).toBe('titulo LIVE');
    expect(state.replySummaries[SID]!['m9']).toMatchObject({ sheetId: 'sheet-m9' });
    expect(state.pendingReplySummaries[SID]).toEqual([]);
  });

  it('rows with a summaryTitle but no summarySummary hydrate nothing (never a half-card)', async () => {
    getMessages.mockResolvedValue({
      items: [serverRow('m1', 'assistant', { isEssential: true, summaryTitle: 'so titulo' })],
    });
    await useOrchestrationStore.getState().loadSessionMessages(SID);
    expect(useOrchestrationStore.getState().replySummaries[SID]).toBeUndefined();
  });
});
