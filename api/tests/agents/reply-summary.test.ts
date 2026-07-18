import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { NotificationEvent } from '@ekoa/shared';
import { sseManager } from '../../src/events/sse-manager.js';
import { runReplySummary, scheduleReplySummary, compactDiffBasis } from '../../src/agents/reply-summary.js';
import { tokenEvents } from '../../src/data/stores.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';

/**
 * Post-run reply summary (B2, decision B.E). The hook in isolation: a fresh-sheet turn emits ONE
 * FAST `reply-summary`-attributed call and ONE schema-valid `reply_summary` notification; a
 * revision turn feeds the model the edit instruction + a compact diff basis, never the whole
 * reply; any failure (model error, unparseable output) emits NO event and never throws - the
 * run is fully isolated from the hook.
 */
interface Captured { stream: string; streamId: string; type: string; data: unknown }
let events: Captured[];

const baseInput = {
  userId: 'u1',
  sessionId: 's1',
  runId: 'r1',
  sheetId: 'sheet-m1',
  revisionId: 'rev-m1',
};
const SUMMARY_JSON = '{"title":"Minuta de contrato","summary":"Estrutura de um contrato de arrendamento habitacional."}';

function spySse(): void {
  events = [];
  vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => {
    events.push({ stream, streamId, type, data });
  });
}
const summaryEvents = () => events.filter((e) => e.stream === 'notifications' && e.type === 'reply_summary');

describe('runReplySummary (B2, decision B.E)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_reply_summary'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); });
  afterEach(async () => {
    vi.restoreAllMocks();
    restoreTransport();
    await tokenEvents.deleteMany({});
  });

  it('fresh-sheet turn: ONE FAST user_work reply-summary call, ONE schema-valid reply_summary notification carrying the threaded ids', async () => {
    const transport = resetAgentState({ oneShotText: SUMMARY_JSON });
    spySse();
    const res = await runReplySummary({ ...baseInput, turn: { kind: 'fresh', replyText: '# Minuta\nEstrutura da minuta pedida.' } });
    expect(res.emitted).toBe(true);

    // Exactly one model call, attributed like memory extraction: user_work, FAST, billed to u1.
    expect(transport.oneShotCalls).toHaveLength(1);
    const rows = (await tokenEvents.find({ agentType: 'reply-summary' })) as unknown as Array<{ tier: string; attributionKind: string; userId?: string; billeeUserId?: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tier).toBe('FAST');
    expect(rows[0]!.attributionKind).toBe('user_work');

    // Exactly one notification on the per-user channel, valid against the shared union.
    const evs = summaryEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]!.streamId).toBe('u1');
    const parsed = NotificationEvent.safeParse(evs[0]!.data);
    expect(parsed.success).toBe(true);
    expect(evs[0]!.data).toMatchObject({
      type: 'reply_summary',
      sessionId: 's1',
      sheetId: 'sheet-m1',
      revisionId: 'rev-m1',
      title: 'Minuta de contrato',
      summary: 'Estrutura de um contrato de arrendamento habitacional.',
    });
  });

  it('revision turn: the model input is the edit instruction + a compact diff basis, never the whole reply', async () => {
    const transport = resetAgentState({ oneShotText: '{"title":"Tom mais formal","summary":"O tom da carta passou a formal."}' });
    spySse();
    const unchangedLine = 'Paragrafo inicial que permanece igual em ambas as versoes.';
    const res = await runReplySummary({
      ...baseInput,
      turn: {
        kind: 'revision',
        instruction: 'torna o tom mais formal',
        baseContent: `${unchangedLine}\nOla, escrevo-te sobre a renda.\nAte ja.`,
        revisedContent: `${unchangedLine}\nExmo. Senhor, venho por este meio expor a questao da renda.\nCom os melhores cumprimentos.`,
      },
    });
    expect(res.emitted).toBe(true);
    expect(transport.oneShotCalls).toHaveLength(1);
    const prompt = transport.oneShotCalls[0]!.prompt;
    expect(prompt).toContain('torna o tom mais formal');
    expect(prompt).toContain('- Ola, escrevo-te sobre a renda.');
    expect(prompt).toContain('+ Exmo. Senhor, venho por este meio expor a questao da renda.');
    // Compactness: the line common to both versions never reaches the model.
    expect(prompt).not.toContain(unchangedLine);
    expect(summaryEvents()).toHaveLength(1);
  });

  it('model failure degrades: NO event, no throw, resolved { emitted: false }', async () => {
    const transport = resetAgentState({});
    transport.oneShot = async () => { throw new Error('provider down'); };
    spySse();
    const res = await scheduleReplySummary({ ...baseInput, turn: { kind: 'fresh', replyText: 'qualquer resposta' } });
    expect(res.emitted).toBe(false);
    expect(summaryEvents()).toHaveLength(0);
  });

  it('unparseable model output degrades the same way: NO event, no throw', async () => {
    resetAgentState({ oneShotText: 'not json at all' });
    spySse();
    const res = await runReplySummary({ ...baseInput, turn: { kind: 'fresh', replyText: 'qualquer resposta' } });
    expect(res.emitted).toBe(false);
    expect(summaryEvents()).toHaveLength(0);
  });

  it('compactDiffBasis strips common prefix/suffix lines and caps each side', () => {
    const common = Array.from({ length: 5 }, (_, i) => `linha comum ${i}`);
    const base = [...common, 'so na base', ...common].join('\n');
    const revised = [...common, 'so na revisao', ...common].join('\n');
    const diff = compactDiffBasis(base, revised);
    expect(diff).toBe('- so na base\n+ so na revisao');

    const manyAdded = Array.from({ length: 30 }, (_, i) => `nova linha ${i}`);
    const capped = compactDiffBasis('', manyAdded.join('\n'));
    expect(capped).toContain('+ nova linha 19');
    expect(capped).not.toContain('+ nova linha 20');
    expect(capped).toContain('(10 more lines)');
  });
});

// Threading through the pipeline is pinned in chat-lifecycle.test.ts (the completed-run case):
// the event's sheetId/revisionId equal the derived ids of the persisted assistant message.
