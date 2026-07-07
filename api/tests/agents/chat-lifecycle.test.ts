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
const actor = { userId: 'u1', orgId: 'o1', role: 'builder' as const };

interface Captured { stream: string; streamId: string; type: string; data: unknown }
let events: Captured[];

async function runChat(script: FakeTransportScript, message = 'hello'): Promise<string> {
  resetAgentState(script);
  events = [];
  vi.spyOn(sseManager, 'emit').mockImplementation((stream, streamId, type, data) => { events.push({ stream, streamId, type, data }); });
  const input = { actor, username: 'u1', sessionId: 's1', message, language: 'pt', deps };
  const { runId } = createChatRun(input);
  await executeChatRun(runId, input);
  return runId;
}

const chatEventsFor = (runId: string) => events.filter((e) => e.stream === 'chat' && e.streamId === runId);

describe('chat run pipeline + streaming contract', () => {
  beforeAll(() => bootAgentTestDb('ekoa_chat_lifecycle'));
  afterAll(shutdownAgentTestDb);
  beforeEach(async () => { await seedUser('u1', 'o1'); await sessions.insert({ _id: 's1', userId: 'u1', title: 't', status: 'active', messageCount: 0 }); });
  afterEach(async () => { vi.restoreAllMocks(); restoreTransport(); await messages.deleteMany({}); await sessions.deleteMany({}); });

  it('completes normally, persists the assistant message, and every event validates against ChatRunEvent', async () => {
    const runId = await runChat({ stream: [{ kind: 'text', text: 'Here is ' }], finalText: 'Here is your answer.' });
    const evs = chatEventsFor(runId);
    for (const e of evs) expect(ChatRunEvent.safeParse(e.data).success, `event ${e.type} validates`).toBe(true);
    expect(evs.some((e) => e.type === 'complete')).toBe(true);
    expect(evs.some((e) => e.type === 'error')).toBe(false);
    const assistant = (await messages.find({ sessionId: 's1', role: 'assistant' }));
    expect(assistant).toHaveLength(1);
    expect((assistant[0] as unknown as { content: string }).content).toBe('Here is your answer.');
    expect(getRun(runId)?.status).toBe('complete');
  });

  it('provider-error-as-result → terminal ERROR, never complete, and the assistant message is NOT persisted (§5.3.7)', async () => {
    const runId = await runChat({ finalText: 'Error 429: rate limit exceeded, please retry' });
    const evs = chatEventsFor(runId);
    expect(evs.some((e) => e.type === 'error')).toBe(true);
    expect(evs.some((e) => e.type === 'complete')).toBe(false);
    expect((await messages.find({ sessionId: 's1', role: 'assistant' }))).toHaveLength(0);
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
