import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ChatRunEvent, NotificationEvent } from '@ekoa/shared';
import { sseManager } from '../../src/events/sse-manager.js';
import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
import { getRun } from '../../src/agents/registry.js';
import { messages, sessions, activityLogs } from '../../src/data/stores.js';
import { listSessionSheets, findSessionSheet } from '../../src/data/session-sheets.js';
import { BUILD_MARKER, INTEGRATION_MARKER } from '../../src/agents/markers.js';
import { logActivity } from '../../src/data/activity.js';
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
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await messages.deleteMany({}); await sessions.deleteMany({}); await activityLogs.deleteMany({}); });

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
    // (c) the persisted turn mirrors the client's essential-turn shape (B7 fix): the web's
    // transcript filter drops any metadata-bearing assistant row without isEssential, so a
    // reloaded transcript rendered ZERO assistant turns once B1 started stamping traceId.
    const meta = (assistant[0] as unknown as { metadata?: { isEssential?: boolean; type?: string } }).metadata;
    expect(meta?.isEssential).toBe(true);
    expect(meta?.type).toBe('text');
    expect(getRun(runId)?.status).toBe('complete');
  });

  it('falls back to the final frame when NOTHING streamed (no deltas -> final text is the answer)', async () => {
    const runId = await runChat({ finalText: 'Resposta directa.' });
    const evs = chatEventsFor(runId);
    expect((evs.find((e) => e.type === 'complete')!.data as { result: string }).result).toBe('Resposta directa.');
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }));
    expect((assistant[0] as unknown as { content: string }).content).toBe('Resposta directa.');
  });

  it('B7 retraction: pre-tool narration forwards a client-visible text_reset BEFORE the real answer\'s next text_chunk (authorized deletion signal)', async () => {
    // Narration longer than the marker filter's split-marker hold-back window, so a clean
    // prefix actually reaches the wire as a text_chunk before the reset does.
    const narration = 'Vou verificar os documentos relevantes na base de conhecimento da organização. ';
    const runId = await runChat({
      stream: [
        { kind: 'text', text: narration }, // narration streamed before the tool call
        { kind: 'text_reset' }, // the transport retracts it (tool_use revealed a tool turn)
        { kind: 'thinking', text: narration }, // classification re-routes it to thinking
        { kind: 'text', text: 'A resposta.' }, // the real answer streams after the reset
      ],
      finalText: 'A resposta.',
    });
    const evs = chatEventsFor(runId);
    for (const e of evs) expect(ChatRunEvent.safeParse(e.data).success, `event ${e.type} validates`).toBe(true);
    // The reset reaches the CLIENT stream, after the narration chunk and before the answer's
    // first chunk - the client's drop of its live buffer keys on THIS event, never tool_event.
    const flow = evs.filter((e) => e.type === 'text_chunk' || e.type === 'text_reset');
    expect(flow.map((e) => e.type)).toEqual(['text_chunk', 'text_reset', 'text_chunk']);
    expect(narration.startsWith((flow[0]!.data as { text: string }).text)).toBe(true);
    expect((flow[2]!.data as { text: string }).text).toBe('A resposta.');
    // Post-reset accumulation is the answer: complete.result + the persisted turn carry it.
    expect((evs.find((e) => e.type === 'complete')!.data as { result: string }).result).toBe('A resposta.');
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }));
    expect((assistant[0] as unknown as { content: string }).content).toBe('A resposta.');
  });

  it('B7 retraction: a run WITHOUT a transport reset (e.g. a tool call with no pre-tool text) emits NO text_reset - no unauthorized deletions', async () => {
    const runId = await runChat({
      stream: [
        { kind: 'thinking', text: 'a pensar. ' },
        { kind: 'tool_use', tool: 'knowledge_search', args: {} },
        { kind: 'text', text: 'A resposta.' },
      ],
      finalText: 'A resposta.',
    });
    const evs = chatEventsFor(runId);
    expect(evs.some((e) => e.type === 'text_reset')).toBe(false);
    expect((evs.find((e) => e.type === 'complete')!.data as { result: string }).result).toBe('A resposta.');
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

    // B7 finding 1: the pipeline threaded the persisted _id into the hook, which stamped the
    // summary onto the SAME turn's metadata (after the emit) - the reload-restore source. The
    // fresh shape carries no revision ordinal.
    await vi.waitFor(async () => {
      const doc = (await messages.get(assistant[0]!._id)) as unknown as { metadata?: Record<string, unknown> };
      expect(doc.metadata).toMatchObject({
        isEssential: true,
        summaryTitle: 'Titulo da folha',
        summarySummary: 'Resumo curto da resposta.',
      });
      expect(doc.metadata!.summaryRevision).toBeUndefined();
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

  it('a voice-sourced run (input.source==="voice") carries the voice-context note in the system prompt; the paired voice.turn activity row carries source:voice (C7 seam close)', async () => {
    // The voice.turn row is written by the VOICE WS SESSION itself (api/src/voice/index.ts
    // auditTurn, landed C2) - an entirely separate module from the chat run pipeline, fired
    // when the STT turn commits (BEFORE its transcript ever reaches this HTTP endpoint). C7's
    // job is only the other half: source:'voice' on THIS run threads the voiceContextNote
    // (assembleRunContext's voiceActive, wired since C5). This test proves both halves hold
    // for one logical voice turn without duplicating either module's own tests (C2's
    // tests/voice/metering.test.ts already pins the row's shape+writer).
    await logActivity(
      { userId: 'u1', username: 'u1', orgId: 'o1' },
      'voice',
      'turn',
      deps,
      { source: 'voice', sessionId: 'voice-sess-1', transcriptMessageId: 'm-voice-1', lang: 'pt', mode: 'talking' },
      { voice_stt_ms: 1200 },
    );

    const transport = resetAgentState({ finalText: 'O prazo é de 30 dias.' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'Qual é o prazo?', language: 'pt', source: 'voice' as const, deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);
    expect(chatEventsFor(runId).some((e) => e.type === 'complete')).toBe(true);

    // 1. The voice-context note (output shaping only) rode the system prompt.
    const call = transport.streamCalls[0]!;
    expect(call.systemPrompt).toContain('Sessão de voz ativa');
    expect(call.systemPrompt).toContain('lidas em voz alta');

    // 2. A non-voice run over the SAME session gets no such note (voiceActive defaults false).
    const plain = resetAgentState({ finalText: 'Resposta normal.' });
    const plainInput = { actor, username: 'u1', sessionId: 's1', message: 'outra pergunta', language: 'pt', deps };
    const { runId: plainRunId } = createChatRun(plainInput);
    await executeChatRun(plainRunId, plainInput);
    expect(plain.streamCalls[0]!.systemPrompt ?? '').not.toContain('Sessão de voz ativa');

    // 3. The paired voice.turn activity row (the voice session's own write) carries source:voice.
    const rows = (await activityLogs.find({ category: 'voice', type: 'turn' })) as unknown as Array<{
      metadata?: { source?: string; transcriptMessageId?: string };
    }>;
    expect(rows.some((r) => r.metadata?.source === 'voice' && r.metadata?.transcriptMessageId === 'm-voice-1')).toBe(true);
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

  it('reviseSheetId: the reply persists as an AGENT revision on the SAME sheet, the turn back-references it, and the summary hook gets the REVISION-turn input (B5, locked 5+7)', async () => {
    // The origin assistant turn -> the derived sheet the composer chip targets. A common line
    // that does NOT change lets us prove the summary hook received the DIFF basis, never the
    // whole reply (decision B.E).
    const baseBody = 'Minuta de carta\n\nParagrafo comum que nao muda.\n\nCumprimentos informais.';
    const revisedBody = 'Minuta de carta\n\nParagrafo comum que nao muda.\n\nCom os melhores cumprimentos.';
    const instruction = 'Torna a despedida mais formal';
    // Seeded BEFORE the run's deps.now() epoch so transcript order (timestamp sort) holds.
    await messages.insert({ _id: 'm-origin', sessionId: 's1', role: 'assistant', content: baseBody, timestamp: '2023-11-01T00:00:01.000Z' });

    const transport = resetAgentState({
      finalText: revisedBody,
      oneShotText: '{"title":"Despedida mais formal","summary":"A despedida da minuta ficou formal."}',
    });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: instruction, language: 'pt', reviseSheetId: 'sheet-m-origin', deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);

    // 1. Revision persistence: the SAME sheet grew one AGENT revision carrying the user
    //    message as its instruction - no new sheet was spawned (locked 5).
    const session = (await sessions.get('s1'))!;
    const sheets = await listSessionSheets(session);
    expect(sheets.map((s) => s.sheetId)).toEqual(['sheet-m-origin']);
    const revs = sheets[0]!.revisions;
    expect(revs).toHaveLength(2);
    expect(revs[1]).toMatchObject({ content: revisedBody, editSource: 'agent', instruction });

    // 2. The persisted assistant turn back-references the revised sheet (decision B.B).
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }, { timestamp: 1 })) as unknown as Array<{ _id: string; metadata?: Record<string, unknown> }>;
    expect(assistant).toHaveLength(2);
    expect(assistant[1]!.metadata).toMatchObject({ sheetId: 'sheet-m-origin', revisionId: revs[1]!.revisionId, revisionNumber: 2 });

    // 3. The reply_summary event carries the REVISED sheet's ids + the revision ordinal, so
    //    the transcript card focuses the SAME sheet (locked 5).
    await vi.waitFor(() => {
      expect(events.some((e) => e.stream === 'notifications' && e.type === 'reply_summary')).toBe(true);
    });
    const notif = events.find((e) => e.stream === 'notifications' && e.type === 'reply_summary')!;
    expect(NotificationEvent.safeParse(notif.data).success).toBe(true);
    expect(notif.data).toMatchObject({
      type: 'reply_summary',
      sessionId: 's1',
      sheetId: 'sheet-m-origin',
      revisionId: revs[1]!.revisionId,
      revision: 2,
    });

    // 4. The hook received the REVISION-turn input (B2's waiting producer): the edit
    //    instruction + the compact diff basis - changed lines only, never the whole reply.
    const call = transport.oneShotCalls.find((c) => /revision/i.test(c.systemPrompt ?? ''));
    expect(call, 'one revision-turn summary call').toBeTruthy();
    expect(call!.prompt).toContain(`Edit instruction: ${instruction}`);
    expect(call!.prompt).toContain('- Cumprimentos informais.');
    expect(call!.prompt).toContain('+ Com os melhores cumprimentos.');
    expect(call!.prompt).not.toContain('Paragrafo comum que nao muda.');

    // 5. B7 finding 1, REVISION shape: the summary + its ordinal persisted onto the revision
    //    turn's metadata (the messageId threading covers both shapes), alongside the B.B
    //    back-reference the persist path wrote.
    await vi.waitFor(async () => {
      const doc = (await messages.get(assistant[1]!._id)) as unknown as { metadata?: Record<string, unknown> };
      expect(doc.metadata).toMatchObject({
        sheetId: 'sheet-m-origin',
        revisionId: revs[1]!.revisionId,
        summaryTitle: 'Despedida mais formal',
        summarySummary: 'A despedida da minuta ficou formal.',
        summaryRevision: 2,
      });
    });
  });

  it('an UNKNOWN reviseSheetId falls back to fresh-sheet behavior (the chip is a default, never a hard failure)', async () => {
    resetAgentState({ finalText: 'Resposta nova.', oneShotText: '{"title":"Titulo","summary":"Resumo."}' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'torna mais curto', language: 'pt', reviseSheetId: 'sheet-nao-existe', deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);
    expect(chatEventsFor(runId).some((e) => e.type === 'complete')).toBe(true);

    // No revision landed anywhere; the reply derives its OWN sheet with no back-reference.
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' })) as unknown as Array<{ _id: string; metadata?: Record<string, unknown> }>;
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.metadata?.sheetId).toBeUndefined();
    const session = (await sessions.get('s1'))!;
    const sheets = await listSessionSheets(session);
    expect(sheets.map((s) => s.sheetId)).toEqual([`sheet-${assistant[0]!._id}`]);
    await vi.waitFor(() => {
      expect(events.some((e) => e.stream === 'notifications' && e.type === 'reply_summary')).toBe(true);
    });
    const notif = events.find((e) => e.stream === 'notifications' && e.type === 'reply_summary')!;
    expect(notif.data).toMatchObject({ sheetId: `sheet-${assistant[0]!._id}`, revisionId: `rev-${assistant[0]!._id}` });
    expect((notif.data as { revision?: number }).revision).toBeUndefined();
  });

  it('a FOREIGN reviseSheetId (a well-formed sheet-<messageId> from ANOTHER session) falls back to FRESH - deriveById\'s session guard rejects it and neither session record is corrupted (codex fix 4)', async () => {
    // A message in ANOTHER session of the SAME user: its derived id is perfectly well-formed,
    // so only the session guard stands between it and a cross-session revision.
    await sessions.insert({ _id: 's2', userId: 'u1', title: 't2', status: 'active', messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
    await messages.insert({ _id: 'm-foreign', sessionId: 's2', role: 'assistant', content: 'Folha de outra sessao.', timestamp: '2023-11-01T00:00:01.000Z' });

    // The rejection is the SESSION GUARD in deriveById, not the id shape: the identical id
    // resolves in its OWN session and returns null for s1.
    expect(await findSessionSheet('s2', 'sheet-m-foreign')).not.toBeNull();
    expect(await findSessionSheet('s1', 'sheet-m-foreign')).toBeNull();

    resetAgentState({ finalText: 'Resposta nova.', oneShotText: '{"title":"Titulo","summary":"Resumo."}' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'torna mais curto', language: 'pt', reviseSheetId: 'sheet-m-foreign', deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);
    expect(chatEventsFor(runId).some((e) => e.type === 'complete')).toBe(true);

    // FRESH fallback in s1: the reply derives its OWN sheet, no back-reference.
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' })) as unknown as Array<{ _id: string; metadata?: Record<string, unknown> }>;
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.metadata?.sheetId).toBeUndefined();
    const s1 = (await sessions.get('s1'))!;
    expect(await listSessionSheets(s1)).toMatchObject([{ sheetId: `sheet-${assistant[0]!._id}` }]);
    // Neither session record was corrupted: no sheet materialised on s1, and the foreign
    // session's sheet gained NO revision.
    expect(s1.sheets ?? []).toEqual([]);
    const foreign = (await findSessionSheet('s2', 'sheet-m-foreign'))!;
    expect(foreign.revisions).toHaveLength(1);
    expect((await sessions.get('s2'))!.sheets ?? []).toEqual([]);
    // The reply_summary is the FRESH shape (no revision ordinal), with the fresh derived ids.
    await vi.waitFor(() => {
      expect(events.some((e) => e.stream === 'notifications' && e.type === 'reply_summary')).toBe(true);
    });
    const notif = events.find((e) => e.stream === 'notifications' && e.type === 'reply_summary')!;
    expect(notif.data).toMatchObject({ sheetId: `sheet-${assistant[0]!._id}`, revisionId: `rev-${assistant[0]!._id}` });
    expect((notif.data as { revision?: number }).revision).toBeUndefined();
  });

  it('a STALE reviseSheetId (the sheet EXISTED as a derived view, then its base message was deleted) falls back to FRESH without corrupting the session record (codex fix 4)', async () => {
    // The sheet is real first - derivable - then its base message disappears (e.g. a pruned
    // transcript): the chip may still carry the id at send time.
    await messages.insert({ _id: 'm-stale', sessionId: 's1', role: 'assistant', content: 'Folha antiga.', timestamp: '2023-11-01T00:00:01.000Z' });
    expect(await findSessionSheet('s1', 'sheet-m-stale')).not.toBeNull();
    await messages.delete('m-stale');
    expect(await findSessionSheet('s1', 'sheet-m-stale')).toBeNull();

    resetAgentState({ finalText: 'Resposta nova.', oneShotText: '{"title":"Titulo","summary":"Resumo."}' });
    events = [];
    vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
    const input = { actor, username: 'u1', sessionId: 's1', message: 'torna mais curto', language: 'pt', reviseSheetId: 'sheet-m-stale', deps };
    const { runId } = createChatRun(input);
    await executeChatRun(runId, input);
    expect(chatEventsFor(runId).some((e) => e.type === 'complete')).toBe(true);

    // FRESH fallback: the reply derives its OWN sheet, the stale sheet stays gone, and the
    // session record gained no materialised ghost of it.
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' })) as unknown as Array<{ _id: string; metadata?: Record<string, unknown> }>;
    expect(assistant).toHaveLength(1);
    expect(assistant[0]!.metadata?.sheetId).toBeUndefined();
    const s1 = (await sessions.get('s1'))!;
    expect(s1.sheets ?? []).toEqual([]);
    expect(await listSessionSheets(s1)).toMatchObject([{ sheetId: `sheet-${assistant[0]!._id}` }]);
    await vi.waitFor(() => {
      expect(events.some((e) => e.stream === 'notifications' && e.type === 'reply_summary')).toBe(true);
    });
    const notif = events.find((e) => e.stream === 'notifications' && e.type === 'reply_summary')!;
    expect(notif.data).toMatchObject({ sheetId: `sheet-${assistant[0]!._id}`, revisionId: `rev-${assistant[0]!._id}` });
    expect((notif.data as { revision?: number }).revision).toBeUndefined();
  });
});
