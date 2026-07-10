/**
 * Orchestration-store logic behind the thinking channel: the per-session streamingThinking
 * buffer (fed by `thinking_chunk` SSE events), its flush into message metadata on complete,
 * and the invariant that every abandon path (clearStreamingChat) drops BOTH live buffers.
 * The UI wiring is covered by web/e2e/chat-thinking.spec.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/api/client', () => {
  const noop = () => Promise.resolve({ success: true, data: null });
  return new Proxy({}, { get: () => noop });
});

import { useOrchestrationStore } from '@/stores/orchestration';

const SID = 'session-thinking';

beforeEach(() => {
  useOrchestrationStore.setState({ streamingChat: {}, streamingThinking: {} });
});

describe('streaming thinking buffer', () => {
  it('appends deltas per session and flush returns-and-clears', () => {
    const s = useOrchestrationStore.getState();
    s.appendStreamingThinking(SID, 'primeiro ');
    s.appendStreamingThinking(SID, 'segundo');
    s.appendStreamingThinking('other-session', 'noutro lado');
    expect(useOrchestrationStore.getState().streamingThinking[SID]).toBe('primeiro segundo');

    expect(s.flushStreamingThinking(SID)).toBe('primeiro segundo');
    expect(useOrchestrationStore.getState().streamingThinking[SID]).toBe('');
    // Other sessions are untouched.
    expect(useOrchestrationStore.getState().streamingThinking['other-session']).toBe('noutro lado');
  });

  it('flushing an empty buffer returns the empty string', () => {
    expect(useOrchestrationStore.getState().flushStreamingThinking(SID)).toBe('');
  });

  it('clearStreamingChat clears BOTH live buffers (answer + thinking)', () => {
    const s = useOrchestrationStore.getState();
    s.appendStreamingChat(SID, 'resposta parcial');
    s.appendStreamingThinking(SID, 'raciocínio parcial');
    s.clearStreamingChat(SID);
    const state = useOrchestrationStore.getState();
    expect(state.streamingChat[SID]).toBe('');
    expect(state.streamingThinking[SID]).toBe('');
  });

  it('clearStreamingChat clears thinking even when the answer buffer is empty (thinking-only run abandoned)', () => {
    const s = useOrchestrationStore.getState();
    s.appendStreamingThinking(SID, 'só raciocínio, sem resposta ainda');
    s.clearStreamingChat(SID);
    expect(useOrchestrationStore.getState().streamingThinking[SID]).toBe('');
  });
});
