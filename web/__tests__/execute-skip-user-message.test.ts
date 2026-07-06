/**
 * Slice B (message-dup): the build-delegation paths must NOT re-add the user's
 * message. When the chat-agent delegates to a build (build_intent / delegate),
 * the user's message ("sim") is already in the thread, so `handleBuildFirstMessage`
 * forwards `_skipUserMessage:true` into `execute()`. This pins the hook-level
 * invariant that makes that safe: `execute({_skipUserMessage:true})` adds ZERO
 * user messages, while a normal `execute()` adds exactly one. (The duplicate in
 * Image #2 was execute() re-adding "sim" after handleChatSend already added it.)
 *
 * useJobStream + the API client are mocked so the hook runs without a backend.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// `import * as api` builds an ESM namespace from own keys, so each named export
// must be declared explicitly. executeAgent returns a real jobInfo so execute()
// proceeds past the data guard; everything else is an inert success.
vi.mock('@/lib/api/client', () => {
  const ok = () => Promise.resolve({ success: true, data: null });
  return {
    executeAgent: () =>
      Promise.resolve({
        success: true,
        data: { jobId: 'job-1', traceId: 'trace-1', artifactInstanceId: null, projectPath: null, templateFiles: [] },
      }),
    cancelJob: ok,
    getJob: () => Promise.resolve({ success: true, data: { status: 'completed' } }),
    getAppUrl: (id: string) => `/apps/${id}/`,
    addMessage: ok,
    createSession: ok,
    deleteSession: ok,
    getMessages: () => Promise.resolve({ success: true, data: [] }),
    listArtifactFiles: () => Promise.resolve({ success: true, data: [] }),
    listArtifactInstances: () => Promise.resolve({ success: true, data: [] }),
    listSessions: () => Promise.resolve({ success: true, data: [] }),
    renameSession: ok,
    touchSession: ok,
  };
});

// Keep the SSE/stream machinery inert — we only care about message side effects.
vi.mock('@/hooks/useJobStream', () => ({
  useJobStream: () => [
    { isComplete: false, result: null, error: null, output: [] },
    { connect: vi.fn(), disconnect: vi.fn(), clearOutputs: vi.fn() },
  ],
}));

import { useAgentExecution } from '@/hooks/useAgentExecution';
import { useOrchestrationStore } from '@/stores/orchestration';

const SID = 'session-b';

function userMessages() {
  return (useOrchestrationStore.getState().messages[SID] || []).filter((m) => m.role === 'user');
}

beforeEach(() => {
  useOrchestrationStore.setState({ messages: {}, sessions: [], sessionJobs: {}, sessionPreviews: {} });
});

describe('execute() user-message side effect (Slice B — no duplicate on delegation)', () => {
  it('adds exactly one user message on a normal execute()', async () => {
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('build me a kanban', { language: 'pt' });
    });
    const users = userMessages();
    expect(users).toHaveLength(1);
    expect(users[0].content).toBe('build me a kanban');
  });

  it('adds ZERO user messages when _skipUserMessage is set (delegation path)', async () => {
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('sim', { language: 'pt', _skipUserMessage: true });
    });
    expect(userMessages()).toHaveLength(0);
  });

  it('simulated delegation flow adds the user turn once, not twice', async () => {
    // handleChatSend adds the user message first...
    useOrchestrationStore.getState().addMessage(SID, { role: 'user', content: 'sim' });
    // ...then the build_intent/delegation path calls execute() with the skip flag.
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('sim', { language: 'pt', _skipUserMessage: true });
    });
    const users = userMessages();
    expect(users).toHaveLength(1);
    expect(users[0].content).toBe('sim');
  });
});
