/**
 * Unit coverage for the orchestration-store logic behind three chat fixes:
 *   - Slice B (queue-while-building): enqueue / dequeue / remove / clear
 *   - Slice C (stop → edit): popLastUserTurn + composerDraft restore
 *
 * These are the pure, deterministic guts of the fixes — the UI wiring is
 * covered by the Playwright e2e spec (e2e/chat-fixes.spec.ts). The API client
 * is mocked so importing the store doesn't pull in the live connection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Any named import from the client resolves to a no-op async fn returning a
// success envelope. Keeps the store importable without a backend.
vi.mock('@/lib/api/client', () => {
  const noop = () => Promise.resolve({ success: true, data: null });
  return new Proxy({}, { get: () => noop });
});

import { useOrchestrationStore, type ChatMessage } from '@/stores/orchestration';

const SID = 'session-test';

function msg(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, timestamp: new Date(0).toISOString() };
}

beforeEach(() => {
  // Reset only the slices these tests touch.
  useOrchestrationStore.setState({
    queuedMessages: {},
    composerDraft: {},
    messages: {},
    sessions: [],
  });
});

describe('message queue (queue-while-building)', () => {
  it('enqueues messages in FIFO order and trims whitespace', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, '  first  ');
    s.enqueueMessage(SID, 'second');
    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual(['first', 'second']);
  });

  it('ignores empty / whitespace-only messages', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, '   ');
    s.enqueueMessage(SID, '');
    expect(useOrchestrationStore.getState().queuedMessages[SID] ?? []).toEqual([]);
  });

  it('dequeues FIFO and returns undefined when empty', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, 'a');
    s.enqueueMessage(SID, 'b');
    expect(s.dequeueMessage(SID)).toBe('a');
    expect(s.dequeueMessage(SID)).toBe('b');
    expect(s.dequeueMessage(SID)).toBeUndefined();
    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual([]);
  });

  it('removes a queued message by index', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, 'a');
    s.enqueueMessage(SID, 'b');
    s.enqueueMessage(SID, 'c');
    s.removeQueuedMessage(SID, 1);
    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual(['a', 'c']);
    // Out-of-range index is a no-op.
    s.removeQueuedMessage(SID, 9);
    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual(['a', 'c']);
  });

  it('clears the whole queue (used by Stop)', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, 'a');
    s.enqueueMessage(SID, 'b');
    s.clearQueue(SID);
    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual([]);
  });

  it('keeps queues isolated per session', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage('s1', 'one');
    s.enqueueMessage('s2', 'two');
    expect(useOrchestrationStore.getState().queuedMessages['s1']).toEqual(['one']);
    expect(useOrchestrationStore.getState().queuedMessages['s2']).toEqual(['two']);
  });
});

describe('drainQueue (Slice E — merge queued messages into one turn)', () => {
  it('returns ALL queued messages in order and empties the queue', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, 'first');
    s.enqueueMessage(SID, 'second');
    s.enqueueMessage(SID, 'third');
    const drained = s.drainQueue(SID);
    expect(drained).toEqual(['first', 'second', 'third']);
    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual([]);
  });

  it('returns [] when the queue is empty (no spurious flush)', () => {
    const s = useOrchestrationStore.getState();
    expect(s.drainQueue(SID)).toEqual([]);
  });

  it('drains one session without touching another', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage('s1', 'a');
    s.enqueueMessage('s1', 'b');
    s.enqueueMessage('s2', 'keep');
    expect(s.drainQueue('s1')).toEqual(['a', 'b']);
    expect(useOrchestrationStore.getState().queuedMessages['s1']).toEqual([]);
    expect(useOrchestrationStore.getState().queuedMessages['s2']).toEqual(['keep']);
  });

  it('the merged turn joins messages with a blank line (what the flush effect sends)', () => {
    const s = useOrchestrationStore.getState();
    s.enqueueMessage(SID, 'add search');
    s.enqueueMessage(SID, 'and copy/paste support');
    // Mirrors page.tsx: handleSendMessage(drained.join("\n\n"))
    const merged = s.drainQueue(SID).join('\n\n');
    expect(merged).toBe('add search\n\nand copy/paste support');
  });
});

describe('composer draft restore (Stop → edit)', () => {
  it('sets and clears a per-session draft', () => {
    const s = useOrchestrationStore.getState();
    s.setComposerDraft(SID, 'edit me');
    expect(useOrchestrationStore.getState().composerDraft[SID]).toBe('edit me');
    s.setComposerDraft(SID, undefined);
    expect(useOrchestrationStore.getState().composerDraft[SID]).toBeUndefined();
  });
});

describe('popLastUserTurn (Stop removes last message + hands it back)', () => {
  it('removes the last user message and everything after it, returning its text', () => {
    useOrchestrationStore.setState({
      sessions: [{ id: SID, name: 'x', createdAt: '', updatedAt: '', messageCount: 4 }],
      messages: {
        [SID]: [
          msg('1', 'user', 'first prompt'),
          msg('2', 'assistant', 'reply'),
          msg('3', 'user', 'second prompt'),
          msg('4', 'assistant', 'partial build output'),
        ],
      },
    });

    const removed = useOrchestrationStore.getState().popLastUserTurn(SID);
    expect(removed).toBe('second prompt');

    const after = useOrchestrationStore.getState().messages[SID];
    expect(after.map((m) => m.content)).toEqual(['first prompt', 'reply']);

    const session = useOrchestrationStore.getState().sessions.find((s) => s.id === SID)!;
    expect(session.messageCount).toBe(2);
  });

  it('returns null when there is no user message', () => {
    useOrchestrationStore.setState({
      sessions: [{ id: SID, name: 'x', createdAt: '', updatedAt: '', messageCount: 1 }],
      messages: { [SID]: [msg('1', 'assistant', 'hello')] },
    });
    expect(useOrchestrationStore.getState().popLastUserTurn(SID)).toBeNull();
    // Messages untouched.
    expect(useOrchestrationStore.getState().messages[SID]).toHaveLength(1);
  });

  it('leaves the session empty when the only turn is removed (becomes empty-state eligible)', () => {
    useOrchestrationStore.setState({
      sessions: [{ id: SID, name: 'x', createdAt: '', updatedAt: '', messageCount: 1 }],
      messages: { [SID]: [msg('1', 'user', 'only prompt')] },
    });
    const removed = useOrchestrationStore.getState().popLastUserTurn(SID);
    expect(removed).toBe('only prompt');
    expect(useOrchestrationStore.getState().messages[SID]).toEqual([]);
    expect(useOrchestrationStore.getState().sessions.find((s) => s.id === SID)!.messageCount).toBe(0);
  });
});
