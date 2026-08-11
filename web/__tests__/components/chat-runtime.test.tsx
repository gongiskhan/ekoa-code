/**
 * WS4b - `chat-runtime.tsx` (`ChatRuntimeProvider`/`useChatRuntime`) had ZERO tests before this
 * file, for a ~1100-line provider that owns the send router, the chat-agent SSE stream, and the
 * FC-400 reference-mint path my composer work touches directly. This is NOT full coverage of
 * that provider - build-session routing (`handleBuildSendMessage`/`handleBuildFirstMessage`,
 * which drive `useAgentExecution`), onboarding routing, `steerQueued`, `cancelActive`,
 * `retryActive`, and `editLastUserMessage` are OUT OF SCOPE here and remain untested. What's
 * covered:
 *  1. `sendMessage`'s queue-while-building guard (a message sent while a run is active queues
 *     instead of starting a second one).
 *  2. The plain chat-send path actually reaches `POST /api/v1/chat/runs` with the right payload.
 *  3. FC-400: a successful reference pick mints a session grant and rides the run request as
 *     `{grantRef,label}`; `onReferencesConsumed` fires.
 *  4. FC-400: a failed mint calls `onReferenceMintError` and the message STILL sends (a mint
 *     failure must never silently drop the user's message).
 *
 * `@/lib/api` is mocked wholesale (the typed client + stream opener) - this is a genuine
 * integration test of the provider wired to a fake transport, not of the real network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render, waitFor, act } from '@testing-library/react';

vi.mock('@/hooks/useJobStream', () => ({
  useJobStream: () => [
    { isComplete: false, result: null, error: null, output: [] },
    { connect: vi.fn(), disconnect: vi.fn(), clearOutputs: vi.fn() },
  ],
}));

// -- a minimal, controllable fake of the EventStream interface (web/lib/api/stream.ts) --
interface FakeStream {
  status: 'connected';
  onStatusChange: () => () => void;
  on: (type: string, handler: (event: unknown) => void) => () => void;
  close: ReturnType<typeof vi.fn>;
  emit: (type: string, event: unknown) => void;
}
function makeFakeStream(): FakeStream {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    status: 'connected',
    onStatusChange: () => () => undefined,
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    close: vi.fn(),
    emit: (type, event) => handlers.get(type)?.(event),
  };
}

const createRunMock = vi.fn();
const openChatRunStreamMock = vi.fn();
const createDaemonGrantMock = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    sessions: {
      list: vi.fn().mockResolvedValue({ items: [] }),
      addMessage: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    artifacts: { list: vi.fn().mockResolvedValue({ items: [], featured: [] }) },
    chat: {
      createRun: (...args: unknown[]) => createRunMock(...args),
      steerRun: vi.fn(),
    },
    jobs: { steer: vi.fn() },
    appUrl: (id: string) => `/apps/${id}/`,
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
  openChatRunStream: (...args: unknown[]) => openChatRunStreamMock(...args),
  setLanguageSource: vi.fn(),
  getToken: vi.fn(() => null),
  subscribeToken: vi.fn(() => () => undefined),
  openNotificationsStream: vi.fn(),
}));

vi.mock('@/lib/bridge-local', async () => {
  const actual = await vi.importActual<typeof import('@/lib/bridge-local')>('@/lib/bridge-local');
  return { ...actual, createDaemonGrant: (...args: unknown[]) => createDaemonGrantMock(...args) };
});

import { ApiProvider } from '@/components/providers/api-provider';
import { ChatRuntimeProvider, useChatRuntime } from '@/components/chat/chat-runtime';
import { useOrchestrationStore } from '@/stores/orchestration';

const SID = 'session-runtime';

/** A child that captures `useChatRuntime()` into a module-level ref (via an effect, not a
 *  during-render assignment) so tests can call `sendMessage`/etc from outside the render tree,
 *  without a real button click per call. */
let runtimeRef: ReturnType<typeof useChatRuntime> | null = null;
function RuntimeCapture() {
  const runtime = useChatRuntime();
  useEffect(() => {
    runtimeRef = runtime;
  });
  return null;
}

function renderRuntime() {
  return render(
    <ApiProvider>
      <ChatRuntimeProvider>
        <RuntimeCapture />
      </ChatRuntimeProvider>
    </ApiProvider>,
  );
}

beforeEach(() => {
  createRunMock.mockReset();
  openChatRunStreamMock.mockReset();
  createDaemonGrantMock.mockReset();
  runtimeRef = null;
  useOrchestrationStore.setState({
    activeSessionId: null,
    sessions: [],
    messages: {},
    sessionJobs: {},
    sessionPreviews: {},
    pendingAttachments: [],
    queuedMessages: {},
    isExecuting: false,
    editTargets: {},
    replySummaries: {},
    sheetLinks: {},
  } as never);
});

/**
 * `ChatRuntimeProvider` mounts an effect that calls `initializeBuilderSession()` (real store
 * action) - it fetches sessions/artifacts (our mocked `api.sessions.list`/`api.artifacts.list`,
 * both returning empty lists) and, on an empty fetch, resets `activeSessionId`/`sessions` rather
 * than trusting whatever local state was there before. So the SID fixture has to be applied
 * AFTER that effect settles (`runtimeRef.initialized === true`), never before - this is exactly
 * the kind of ordering trap a zero-test provider hides.
 */
async function renderRuntimeReady() {
  const utils = renderRuntime();
  await waitFor(() => expect(runtimeRef?.initialized).toBe(true));
  act(() => {
    useOrchestrationStore.setState({
      activeSessionId: SID,
      sessions: [{ id: SID, name: 'x', createdAt: '', updatedAt: '', messageCount: 0 }],
      messages: { [SID]: [] },
    } as never);
  });
  return utils;
}

describe('chat-runtime - sendMessage queue-while-building', () => {
  it('a message sent while a run is executing queues instead of starting a second run', async () => {
    await renderRuntimeReady();
    act(() => useOrchestrationStore.setState({ isExecuting: true } as never));

    act(() => runtimeRef!.sendMessage('mensagem durante o build'));

    expect(useOrchestrationStore.getState().queuedMessages[SID]).toEqual(['mensagem durante o build']);
    expect(createRunMock).not.toHaveBeenCalled();
  });
});

describe('chat-runtime - plain chat send', () => {
  it('reaches POST /chat/runs with the session id and message', async () => {
    const stream = makeFakeStream();
    openChatRunStreamMock.mockReturnValue(stream);
    createRunMock.mockResolvedValue({ runId: 'run-1' });
    await renderRuntimeReady();

    act(() => runtimeRef!.sendMessage('olá agente'));

    await waitFor(() => expect(createRunMock).toHaveBeenCalledTimes(1));
    const [request] = createRunMock.mock.calls[0] as [{ sessionId: string; message: string; references?: unknown }];
    expect(request.sessionId).toBe(SID);
    expect(request.message).toBe('olá agente');
    expect(request.references).toBeUndefined();

    // Settle the run so the test doesn't leak a dangling "executing" state into the next one.
    await act(async () => {
      stream.emit('complete', { result: 'oi' });
    });
    await waitFor(() => expect(useOrchestrationStore.getState().isExecuting).toBe(false));
  });
});

describe('chat-runtime - FC-400 reference minting (the composer\'s onReferencePicked flow lands here)', () => {
  it('a successful pick mints a session grant, rides the run request as {grantRef,label}, and consumes the chip', async () => {
    const stream = makeFakeStream();
    openChatRunStreamMock.mockReturnValue(stream);
    createRunMock.mockResolvedValue({ runId: 'run-2' });
    createDaemonGrantMock.mockResolvedValue({ grantRef: 'g-1', path: '/x/contrato.pdf', session: SID, label: 'contrato.pdf' });
    await renderRuntimeReady();

    const onReferencesConsumed = vi.fn();
    const onReferenceMintError = vi.fn();
    act(() =>
      runtimeRef!.sendMessage('resume isto', {
        references: [{ path: '/x/contrato.pdf', label: 'contrato.pdf', kind: 'file' }],
        onReferencesConsumed,
        onReferenceMintError,
      }),
    );

    await waitFor(() => expect(createDaemonGrantMock).toHaveBeenCalledWith({ path: '/x/contrato.pdf', session: SID, label: 'contrato.pdf' }));
    expect(onReferencesConsumed).toHaveBeenCalledTimes(1);
    expect(onReferenceMintError).not.toHaveBeenCalled();

    await waitFor(() => expect(createRunMock).toHaveBeenCalledTimes(1));
    const [request] = createRunMock.mock.calls[0] as [{ references?: Array<{ grantRef: string; label: string }> }];
    expect(request.references).toEqual([{ grantRef: 'g-1', label: 'contrato.pdf' }]);
  });

  it('a failed mint calls onReferenceMintError but the message STILL sends (never a silent drop)', async () => {
    const stream = makeFakeStream();
    openChatRunStreamMock.mockReturnValue(stream);
    createRunMock.mockResolvedValue({ runId: 'run-3' });
    createDaemonGrantMock.mockRejectedValue(new Error('daemon unreachable'));
    await renderRuntimeReady();

    const onReferenceMintError = vi.fn();
    act(() =>
      runtimeRef!.sendMessage('resume isto', {
        references: [{ path: '/x/contrato.pdf', label: 'contrato.pdf', kind: 'file' }],
        onReferenceMintError,
      }),
    );

    await waitFor(() => expect(onReferenceMintError).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(createRunMock).toHaveBeenCalledTimes(1));
    const [request] = createRunMock.mock.calls[0] as [{ references?: unknown }];
    expect(request.references).toBeUndefined(); // the empty-refs case omits the field entirely
  });
});
