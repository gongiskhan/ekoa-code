/**
 * Refused-build feed (BRIEF 9a): a capability refusal on POST /jobs (403 with
 * details.capability canBuildApps/canEditApps) is never a dead end - execute() must
 * attach the pre-drafted request (`metadata.refusal`) to the error message it adds,
 * so the chat bubble can offer "Pedir ao administrador" (change-requests
 * fileFromRefusal). Any other failure stays a plain error with NO refusal payload.
 *
 * useJobStream + api.jobs.create are mocked so the hook runs without a backend;
 * everything else on '@/lib/api' is the real module (partial mock via importOriginal).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Mutable per-test rejection for api.jobs.create; read at CALL time inside the factory.
let nextCreateError: unknown;

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    api: {
      ...original.api,
      jobs: {
        ...original.api.jobs,
        create: () => Promise.reject(nextCreateError),
      },
    },
  };
});

// Keep the SSE/stream machinery inert - we only care about message side effects.
vi.mock('@/hooks/useJobStream', () => ({
  useJobStream: () => [
    { isComplete: false, result: null, error: null, output: [] },
    { connect: vi.fn(), disconnect: vi.fn(), clearOutputs: vi.fn() },
  ],
}));

import { ApiError } from '@/lib/api';
import { useAgentExecution } from '@/hooks/useAgentExecution';
import { useOrchestrationStore } from '@/stores/orchestration';

const SID = 'session-9a';
const REFUSAL_MSG = 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.';

function errorMessages() {
  return (useOrchestrationStore.getState().messages[SID] || []).filter(
    (m) => m.metadata?.type === 'error',
  );
}

beforeEach(() => {
  useOrchestrationStore.setState({ messages: {}, sessions: [], sessionJobs: {}, sessionPreviews: {} });
});

describe('execute() capability refusal carries the pre-drafted request (BRIEF 9a)', () => {
  it('403 canBuildApps -> error message carries metadata.refusal with the original text', async () => {
    nextCreateError = new ApiError(403, 'FORBIDDEN', REFUSAL_MSG, { capability: 'canBuildApps' });
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('Cria uma aplicação de faturas', { language: 'pt' });
    });
    const errors = errorMessages();
    expect(errors).toHaveLength(1);
    expect(errors[0].content).toContain('pedir ao administrador');
    expect(errors[0].metadata?.refusal).toEqual({ text: 'Cria uma aplicação de faturas' });
  });

  it('403 canEditApps on a follow-up -> refusal carries the appId', async () => {
    nextCreateError = new ApiError(403, 'FORBIDDEN', REFUSAL_MSG, { capability: 'canEditApps' });
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('Adiciona um campo de telefone', {
        language: 'pt',
        artifactInstanceId: 'app-123',
      });
    });
    const errors = errorMessages();
    expect(errors).toHaveLength(1);
    expect(errors[0].metadata?.refusal).toEqual({ text: 'Adiciona um campo de telefone', appId: 'app-123' });
  });

  it('a non-capability failure stays a plain error with NO refusal payload', async () => {
    nextCreateError = new ApiError(500, 'INTERNAL', 'Ocorreu um erro.', undefined);
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('Cria uma aplicação de faturas', { language: 'pt' });
    });
    const errors = errorMessages();
    expect(errors).toHaveLength(1);
    expect(errors[0].metadata?.refusal).toBeUndefined();
  });

  it('a 403 WITHOUT details.capability (non-capability forbidden) gets no refusal payload', async () => {
    nextCreateError = new ApiError(403, 'FORBIDDEN', 'Proibido.', undefined);
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('Cria uma aplicação de faturas', { language: 'pt' });
    });
    const errors = errorMessages();
    expect(errors).toHaveLength(1);
    expect(errors[0].metadata?.refusal).toBeUndefined();
  });
});
