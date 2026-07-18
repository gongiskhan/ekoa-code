import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ChatRunEvent, NotificationEvent } from '@ekoa/shared';
import { sseManager } from '../../src/events/sse-manager.js';
import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
import { getRun } from '../../src/agents/registry.js';
import { messages, sessions } from '../../src/data/stores.js';
import { BUILD_MARKER, INTEGRATION_MARKER } from '../../src/agents/markers.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
import type { FakeTransportScript } from './_fake-transport.js';

/**
 * Chat run pipeline (ch05 §5.6.1) + streaming contract (§5.7). Acceptance criteria 1, 6, 7:
 * provider-error-as-result → error not complete and not persisted; every emitted event validates
 * against the shared union; no `text_chunk` carries a marker substring; delegation → typed events.
 */
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + seq, genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };

interface Captured { stream: string; streamId: string; type: string; data: unknown }
let events: Captured[];

async function runChat(script: FakeTransportScript, message = 'hello'): Promise<string> {
  const { runId } = await runChatT(script, message);
  return runId;
}

async function runChatT(script: FakeTransportScript, message = 'hello'): Promise<{ runId: string; transport: ReturnType<typeof resetAgentState> }> {
  const transport = resetAgentState(script);
  events = [];
  vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
  const input = { actor, username: 'u1', sessionId: 's1', message, language: 'pt', deps };
  const { runId } = createChatRun(input);
  await executeChatRun(runId, input);
  return { runId, transport };
}

const chatEventsFor = (runId: string) => events.filter((e) => e.stream === 'chat' && e.streamId === runId);

describe('chat run pipeline + streaming contract', () => {
  beforeAll(() => bootAgentTestDb('ekoa_chat_lifecycle'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); await sessions.insert({ _id: 's1', userId: 'u1', title: 't', status: 'active', messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }); });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await messages.deleteMany({}); await sessions.deleteMany({}); });

  it('completes with the FULL concatenated stream: complete.result + the persisted assistant message equal the joined deltas, never the final-frame tail (F20)', async () => {
    // REWRITTEN for F20: this test previously scripted a final frame carrying MORE than the
    // stream and asserted the final frame won — encoding the clobber bug (the SDK result field
    // held only the last delta live, so complete.result and the persisted message were a ~25-char
    // tail of the real answer; J2/J4 evidence). New semantics: the accumulated streamed deltas
    // ARE the answer; the final frame is a fallback only when nothing streamed.
    const runId = await runChat({
      stream: [
        { kind: 'text', text: 'Com base na base de conhecimento, ' },
        { kind: 'text', text: 'a referência do processo é ' },
        { kind: 'text', text: '**RX-417**.' },
      ],
      finalText: '**RX-417**.', // the SDK result field: only the LAST delta (the live-observed shape)
    });
    const full = 'Com base na base de conhecimento, a referência do processo é **RX-417**.';
    const evs = chatEventsFor(runId);
    for (const e of evs) expect(ChatRunEvent.safeParse(e.data).success, `event ${e.type} validates`).toBe(true);
    expect(evs.some((e) => e.type === 'error')).toBe(false);

    // (a) the complete frame carries the full answer == the concatenated text_chunks (§13 streaming gate)
    const chunks = evs.filter((e) => e.type === 'text_chunk').map((e) => (e.data as { text: string }).text).join('');
    expect(chunks).toBe(full);
    const complete = evs.find((e) => e.type === 'complete');
    expect((complete!.data as { result: string }).result).toBe(full);

    // (b) the persisted assistant message is the full answer (loadHistory context integrity)
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }));
    expect(assistant).toHaveLength(1);
    expect((assistant[0] as unknown as { content: string }).content).toBe(full);
    expect(getRun(runId)?.status).toBe('complete');
  });

  it('falls back to the final frame when NOTHING streamed (no deltas -> final text is the answer)', async () => {
    const runId = await runChat({ finalText: 'Resposta directa.' });
    const evs = chatEventsFor(runId);
    expect((evs.find((e) => e.type === 'complete')!.data as { result: string }).result).toBe('Resposta directa.');
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }));
    expect((assistant[0] as unknown as { content: string }).content).toBe('Resposta directa.');
  });

  it('provider-error-as-result → terminal ERROR, never complete, and the assistant message is NOT persisted (§5.3.7)', async () => {
    const runId = await runChat({ finalText: 'Error 429: rate limit exceeded, please retry' });
    const evs = chatEventsFor(runId);
    expect(evs.some((e) => e.type === 'error')).toBe(true);
    expect(evs.some((e) => e.type === 'complete')).toBe(false);
    expect((await messages.find({ sessionId: 's1', role: 'assistant' }))).toHaveLength(0);
  });

  it('a STREAMED answer whose prose mentions an error term is NOT rerouted as a provider error (S3 review finding)', async () => {
    // The §5.3.7 error-as-result reroute exists for the nothing-streamed failure shape. F20 made
    // result.text the FULL answer, so scanning it after real deltas streamed would discard a
    // legitimate KB answer like this one ("429" trips /\b429\b/) and show "provider unavailable".
    const full = 'O erro HTTP 429 significa demasiados pedidos. Aguarde e tente novamente.';
    const runId = await runChat({
      stream: [
        { kind: 'text', text: 'O erro HTTP 429 significa demasiados pedidos. ' },
        { kind: 'text', text: 'Aguarde e tente novamente.' },
      ],
      finalText: full,
    });
    const evs = chatEventsFor(runId);
    expect(evs.some((e) => e.type === 'error')).toBe(false);
    expect((evs.find((e) => e.type === 'complete')!.data as { result: string }).result).toBe(full);
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }));
    expect((assistant[0] as unknown as { content: string }).content).toBe(full);
  });

  it('a completed run fires the post-run reply_summary on NOTIFICATIONS with the persisted turn\'s derived sheet ids (B2, decision B.E)', async () => {
    // The summary rides the per-user notifications channel, not the run stream (the client tears
    // that down on `complete`), and its ids are THREADED from the persisted assistant doc: they
    // must equal the derived ids the sheets read path serves for that message.
    const runId = await runChat({ finalText: 'Resposta que vira folha.', oneShotText: '{"title":"Titulo da folha","summary":"Resumo curto da resposta."}' });
    expect(chatEventsFor(runId).some((e) => e.type === 'complete')).toBe(true);
    await vi.waitFor(() => {
      expect(events.some((e) => e.stream === 'notifications' && e.type === 'reply_summary')).toBe(true);
    });
    const notif = events.find((e) => e.stream === 'notifications' && e.type === 'reply_summary')!;
    expect(NotificationEvent.safeParse(notif.data).success).toBe(true);
    expect(notif.streamId).toBe('u1');
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' })) as unknown as Array<{ _id: string }>;
    expect(assistant).toHaveLength(1);
    expect(notif.data).toMatchObject({
      type: 'reply_summary',
      sessionId: 's1',
      sheetId: `sheet-${assistant[0]!._id}`,
      revisionId: `rev-${assistant[0]!._id}`,
      title: 'Titulo da folha',
      summary: 'Resumo curto da resposta.',
    });
  });

  it('a build marker at start-of-stream → build_intent on notifications + complete.delegate, with clean text (§5.7.2)', async () => {
    const runId = await runChat({ finalText: `${BUILD_MARKER} a todo list app` });
    const chat = chatEventsFor(runId);
    const complete = chat.find((e) => e.type === 'complete');
    expect((complete!.data as { delegate?: { kind: string } }).delegate?.kind).toBe('build');
    const notif = events.find((e) => e.stream === 'notifications' && e.type === 'build_intent');
    expect(notif).toBeTruthy();
    expect(NotificationEvent.safeParse(notif!.data).success).toBe(true);
    // No text_chunk ever carries a marker substring.
    for (const e of chat.filter((x) => x.type === 'text_chunk')) {
      expect((e.data as { text: string }).text).not.toContain('[[EKOA');
    }
  });

  it('a split marker across text chunks never leaks into a text_chunk (§5.7.2)', async () => {
    const mid = 6;
    const runId = await runChat({
      stream: [
        { kind: 'text', text: `partial ${INTEGRATION_MARKER.slice(0, mid)}` },
        { kind: 'text', text: `${INTEGRATION_MARKER.slice(mid)}(gmail) rest` },
      ],
      finalText: `partial ${INTEGRATION_MARKER}(gmail) rest`,
    });
    for (const e of chatEventsFor(runId).filter((x) => x.type === 'text_chunk')) {
      expect((e.data as { text: string }).text).not.toContain('[[EKOA');
    }
    expect(events.some((e) => e.stream === 'notifications' && e.type === 'integration_build_intent')).toBe(true);
  });

  it('mounts the §5.4.4 knowledge tools + the §5.4.8 delegation tool as in-process MCP and allowlists their wire names', async () => {
    const { transport } = await runChatT({ finalText: 'ok' });
    const call = transport.streamCalls[0]!;
    expect((call.sdkTools ?? []).map((s) => s.name)).toEqual(['knowledge_search', 'knowledge_read', 'delegate_to_local']);
    expect(call.allowedTools).toEqual(['mcp__ekoa__knowledge_search', 'mcp__ekoa__knowledge_read', 'mcp__ekoa__delegate_to_local']);
  });

  it('never emits subagent_event, phase_changed, or usage_progress on the wire (§5.7.3)', async () => {
    const runId = await runChat({
      stream: [{ kind: 'text', text: 'hi' }, { kind: 'plan' }, { kind: 'usage', usage: { input: 1, output: 1, cacheCreate: 0, cacheRead: 0 } }],
      finalText: 'hi',
    });
    const types = new Set(chatEventsFor(runId).map((e) => e.type));
    expect(types.has('subagent_event')).toBe(false);
    expect(types.has('phase_changed')).toBe(false);
    expect(types.has('usage_progress')).toBe(false);
  });

  it('a timeout surfaces a terminal ERROR (distinguished from a silent Stop) (§5.3.6)', async () => {
    process.env.CHAT_RUN_TIMEOUT_MS = '5';
    resetAgentState({ streamDelayMs: 80, finalText: 'late' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'hi', language: 'pt', deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);
    delete process.env.CHAT_RUN_TIMEOUT_MS;
    const evs = chatEventsFor(runId);
    const err = evs.find((e) => e.type === 'error');
    expect(err).toBeTruthy();
    expect((err!.data as { code: string }).code).toBe('TIMEOUT'); // timeout ≠ silent Stop
    expect(evs.some((e) => e.type === 'complete')).toBe(false);
    expect(getRun(runId)?.status).toBe('error');
  });

  it('a timeout firing BEFORE the stream (early abort checkpoint) still surfaces TIMEOUT, never a silent cancel (§5.3.6 — G7B review find)', async () => {
    resetAgentState({ finalText: 'late' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'hi', language: 'pt', deps };
    const { runId, entry } = createChatRun(input);
    entry.timedOut = true; // the §5.3.6 timer fired during an early await (deterministic simulation)
    entry.abort.abort();
    await executeChatRun(runId, input);
    const evs = chatEventsFor(runId);
    const err = evs.find((e) => e.type === 'error');
    expect(err).toBeTruthy();
    expect((err!.data as { code: string }).code).toBe('TIMEOUT');
    expect(evs.some((e) => e.type === 'complete')).toBe(false);
    expect(getRun(runId)?.status).toBe('error');
  });

  it('a cancelled run is silent (no complete/error) and the run settles cancelled (§5.3.1)', async () => {
    resetAgentState({ aborted: true, finalText: '' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'hi', language: 'pt', deps };
    const { runId, entry } = createChatRun(input);
    entry.cancelled = true; // cancel set the state before the abort (simulated)
    entry.abort.abort();
    await executeChatRun(runId, input);
    const evs = chatEventsFor(runId);
    expect(evs.some((e) => e.type === 'complete' || e.type === 'error')).toBe(false);
    expect(getRun(runId)?.status).toBe('cancelled');
  });
});
