/**
 * Regression: a chat-run turn is persisted server-side by the run pipeline
 * (ch05 §5.6.1 step 1 for the user message, step 7 for the assistant
 * message) — the store mirror for those turns must NOT also POST them, or
 * every run-driven message lands twice in the transcript (visible doubled
 * on session reload; found 2026-07-10 by driving the real UI).
 *
 * addMessage persists by default (system/status messages and the job/build
 * flows have no other writer) and skips the POST when opts.persist === false.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const addMessageSpy = vi.fn(() => Promise.resolve({}));
const updateSpy = vi.fn(() => Promise.resolve({}));

vi.mock('@/lib/api', () => {
  const noop = () => Promise.resolve({});
  const domain = new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === 'addMessage' ? addMessageSpy : prop === 'update' ? updateSpy : noop,
    }
  );
  const api = new Proxy({}, { get: () => domain });
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

import { useOrchestrationStore } from '@/stores/orchestration';

const SID = 'session-persist-test';

beforeEach(() => {
  addMessageSpy.mockClear();
  updateSpy.mockClear();
  useOrchestrationStore.setState({
    messages: {},
    sessions: [
      {
        id: SID,
        name: 'Session',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        messageCount: 3,
      },
    ],
  });
});

describe('addMessage server persistence opt-out', () => {
  it('POSTs the message by default (system/status/job flows have no other writer)', () => {
    useOrchestrationStore.getState().addMessage(SID, { role: 'system', content: 'A iniciar...' });
    expect(addMessageSpy).toHaveBeenCalledTimes(1);
    expect(addMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: SID, role: 'system', content: 'A iniciar...' })
    );
  });

  it('does NOT POST when persist:false (run-mirrored turns are persisted by the pipeline)', () => {
    useOrchestrationStore
      .getState()
      .addMessage(SID, { role: 'user', content: 'hello' }, { persist: false });
    expect(addMessageSpy).not.toHaveBeenCalled();
  });

  it('still appends to local state and bumps messageCount with persist:false', () => {
    useOrchestrationStore
      .getState()
      .addMessage(SID, { role: 'assistant', content: 'resposta' }, { persist: false });
    const state = useOrchestrationStore.getState();
    expect(state.messages[SID]).toHaveLength(1);
    expect(state.messages[SID]![0]!.content).toBe('resposta');
    expect(state.sessions.find((s) => s.id === SID)!.messageCount).toBe(4);
  });

  it('auto-rename still fires for the first user message even with persist:false', () => {
    useOrchestrationStore.setState({
      sessions: [
        {
          id: SID,
          name: 'Session',
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
          messageCount: 0,
        },
      ],
    });
    useOrchestrationStore
      .getState()
      .addMessage(SID, { role: 'user', content: 'primeira pergunta' }, { persist: false });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: SID, name: 'primeira pergunta' })
    );
    expect(addMessageSpy).not.toHaveBeenCalled();
  });
});
