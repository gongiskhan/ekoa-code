import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { ChatRunEvent } from '@ekoa/shared';
import { sseManager } from '../../src/events/sse-manager.js';
import { createChatRun, executeChatRun } from '../../src/agents/chat.js';
import { messages, sessions } from '../../src/data/stores.js';
import { INTEGRATION_MARKER, CONTEXT_OPEN, CONTEXT_CLOSE } from '../../src/agents/markers.js';
import { bootAgentTestDb, shutdownAgentTestDb, resetAgentState, restoreTransport, seedUser } from './_setup.js';
import type { FakeTransportScript } from './_fake-transport.js';

/**
 * The chat thinking channel (§5.7 + ch12 white-label). Working commentary — intermediate-turn
 * text + thinking blocks, classified at the llm/ transport — streams as `thinking_chunk`,
 * engine-identity-REDACTED server-side (the persona governs answers, not thinking) and
 * marker-filtered like every channel. It never enters `text_chunk`, `complete.result`, or the
 * persisted answer; it rides assistant-message metadata so a reloaded session can replay it.
 */
let tick = 0;
let seq = 0;
const deps = { now: () => 1_700_000_000_000 + (tick += 10), genId: () => `id_${seq++}` };
const actor = { userId: 'u1', orgId: 'o1', role: 'user' as const };

interface Captured { stream: string; streamId: string; type: string; data: unknown }
let events: Captured[];

async function runChat(script: FakeTransportScript, message = 'que modelo és tu?'): Promise<string> {
  resetAgentState(script);
  events = [];
  vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
  const input = { actor, username: 'u1', sessionId: 's1', message, language: 'pt', deps };
  const { runId } = createChatRun(input);
  await executeChatRun(runId, input);
  return runId;
}

const chatEventsFor = (runId: string) => events.filter((e) => e.stream === 'chat' && e.streamId === runId);
const joined = (evs: Captured[], type: string) => evs.filter((e) => e.type === type).map((e) => (e.data as { text: string }).text).join('');

const LEAK = /claude|anthropic|sonnet|opus|haiku/i;

describe('chat thinking channel (§5.7 + ch12 white-label)', () => {
  beforeAll(() => bootAgentTestDb('ekoa_chat_thinking'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); await sessions.insert({ _id: 's1', userId: 'u1', title: 't', status: 'active', messageCount: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }); });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await messages.deleteMany({}); await sessions.deleteMany({}); });

  it('streams commentary as validated thinking_chunk events, engine-identity-redacted, never mixed into text_chunk / complete.result / the persisted answer', async () => {
    const answer = 'Sou o Agente EKOA, o assistente da plataforma.';
    const runId = await runChat({
      stream: [
        { kind: 'thinking', text: 'O utilizador pergunta que modelo sou. Tecnicamente sou o Claude Sonnet, um modelo da Anthropic, ' },
        { kind: 'thinking', text: 'mas devo apresentar-me sempre como Agente EKOA e nunca revelar o motor.' },
        { kind: 'text', text: answer },
      ],
      finalText: answer,
    });
    const evs = chatEventsFor(runId);
    for (const e of evs) expect(ChatRunEvent.safeParse(e.data).success, `event ${e.type} validates`).toBe(true);

    // (a) the thinking channel exists, carries the commentary, and is redacted on the wire
    const thinking = joined(evs, 'thinking_chunk');
    expect(thinking.length).toBeGreaterThan(0);
    expect(thinking).not.toMatch(LEAK);
    expect(thinking).toContain('Agente EKOA');
    for (const e of evs.filter((x) => x.type === 'thinking_chunk')) {
      expect((e.data as { text: string }).text).not.toMatch(LEAK);
    }

    // (b) the answer channel and terminal result carry ONLY the answer
    expect(joined(evs, 'text_chunk')).toBe(answer);
    expect((evs.find((e) => e.type === 'complete')!.data as { result: string }).result).toBe(answer);

    // (c) persisted: content is the answer; metadata replays the REDACTED thinking + duration
    const assistant = await messages.find({ sessionId: 's1', role: 'assistant' });
    expect(assistant).toHaveLength(1);
    const doc = assistant[0] as unknown as { content: string; metadata?: { thinking?: string; thinkingDurationMs?: number; traceId?: string } };
    expect(doc.content).toBe(answer);
    expect(doc.metadata?.traceId).toBe(runId); // B1 provenance rides beside the thinking replay
    expect(doc.metadata?.thinking).toBeTruthy();
    expect(doc.metadata!.thinking!).not.toMatch(LEAK);
    expect(doc.metadata!.thinkingDurationMs).toBeTypeOf('number');
    expect(doc.metadata!.thinkingDurationMs!).toBeGreaterThan(0);
  });

  it('a run with no commentary emits no thinking_chunk and persists no thinking metadata (provenance only)', async () => {
    const runId = await runChat({ stream: [{ kind: 'text', text: 'Resposta directa.' }], finalText: 'Resposta directa.' });
    expect(chatEventsFor(runId).some((e) => e.type === 'thinking_chunk')).toBe(false);
    const assistant = await messages.find({ sessionId: 's1', role: 'assistant' });
    const meta = (assistant[0] as unknown as { metadata?: { thinking?: string; thinkingDurationMs?: number; traceId?: string; memoriesUsed?: number } }).metadata;
    expect(meta?.thinking).toBeUndefined();
    expect(meta?.thinkingDurationMs).toBeUndefined();
    // Provenance (B1): traceId + memoriesUsed are stamped on EVERY persisted assistant turn -
    // the web renders feedback buttons off traceId and the memories line off memoriesUsed.
    expect(meta?.traceId).toBe(runId);
    expect(meta?.memoriesUsed).toBe(0);
  });

  it('no marker — whole or split across chunks — ever reaches a thinking_chunk; delegation is NOT triggered from thinking; a context block in thinking still persists (§5.7.2)', async () => {
    const mid = 6;
    const runId = await runChat({
      stream: [
        { kind: 'thinking', text: `vou pedir a integração ${INTEGRATION_MARKER.slice(0, mid)}` },
        { kind: 'thinking', text: `${INTEGRATION_MARKER.slice(mid)}(gmail) e registar ${CONTEXT_OPEN}{"lead":"ACME"}${CONTEXT_CLOSE} contexto.` },
        { kind: 'text', text: 'A resposta final.' },
      ],
      finalText: 'A resposta final.',
    });
    const evs = chatEventsFor(runId);
    for (const e of evs.filter((x) => x.type === 'thinking_chunk' || x.type === 'text_chunk')) {
      const text = (e.data as { text: string }).text;
      expect(text).not.toContain('[[EKOA');
      expect(text).not.toContain('ekoa-context');
    }
    // Action markers are answer-level signals: a marker in commentary must not delegate.
    expect(events.some((e) => e.stream === 'notifications' && e.type === 'integration_build_intent')).toBe(false);
    expect((evs.find((e) => e.type === 'complete')!.data as { delegate?: unknown }).delegate).toBeUndefined();
    // ...but a context block emitted mid-commentary still reaches the session record.
    const session = await sessions.get('s1');
    expect((session as unknown as { lastContext?: string }).lastContext).toBe('{"lead":"ACME"}');
    // And the persisted thinking metadata is marker-free too.
    const assistant = await messages.find({ sessionId: 's1', role: 'assistant' });
    const meta = (assistant[0] as unknown as { metadata?: { thinking?: string } }).metadata;
    expect(meta?.thinking).toBeTruthy();
    expect(meta!.thinking!).not.toContain('[[EKOA');
    expect(meta!.thinking!).not.toContain('ekoa-context');
  });

  it('thinking chunks alone do not mask the provider-error-as-result reroute (§5.3.7)', async () => {
    // A provider failure aborts the request BEFORE any answer delta; commentary may already have
    // streamed. streamedAny counts ANSWER chunks only, so the error-as-result scan still runs.
    const runId = await runChat({
      stream: [{ kind: 'thinking', text: 'vou consultar a base de conhecimento…' }],
      finalText: 'Error 429: rate limit exceeded, please retry',
    });
    const evs = chatEventsFor(runId);
    expect(evs.some((e) => e.type === 'error')).toBe(true);
    expect(evs.some((e) => e.type === 'complete')).toBe(false);
    expect(await messages.find({ sessionId: 's1', role: 'assistant' })).toHaveLength(0);
  });
});
