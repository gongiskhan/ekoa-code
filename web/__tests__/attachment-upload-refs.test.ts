/**
 * WS4a: the client-side half of the uploadId/attachmentId mix-up. `FileAttachment.attachmentId`
 * is a composer-chip id the UI mints locally (file-picker.ts's makeId()) purely to key/remove a
 * chip - the server has never heard of it. The real server-issued upload reference lives in
 * `FileAttachment.path` (file-picker.ts's stageFile() puts the staged uploadId there). Before this
 * fix, useAgentExecution.ts's `execute()` sent `uploadId: a.attachmentId` to `POST /api/v1/jobs`:
 * every build-with-attachment silently referenced an id the server had never minted.
 *
 * `@/lib/api` is mocked (the typed client); `api.jobs.create` is a spy that captures its call
 * args, so this pins the WIRE shape without a live backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/hooks/useJobStream', () => ({
  useJobStream: () => [
    { isComplete: false, result: null, error: null, output: [] },
    { connect: vi.fn(), disconnect: vi.fn(), clearOutputs: vi.fn() },
  ],
}));

const createMock = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    jobs: { create: (...args: unknown[]) => createMock(...args) },
    appUrl: (id: string) => `/apps/${id}/`,
    // The orchestration store's addMessage() fire-and-forgets a persist call on every message
    // execute() adds (the "sim"/user turn, the "Construção iniciada." status turn) - stub it so
    // that fire-and-forget has something to call rather than throwing on `undefined.addMessage`.
    sessions: {
      addMessage: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
}));

import { useAgentExecution } from '@/hooks/useAgentExecution';
import { useOrchestrationStore } from '@/stores/orchestration';

const SID = 'session-attach';

beforeEach(() => {
  useOrchestrationStore.setState({ messages: {}, sessions: [], sessionJobs: {}, sessionPreviews: {} });
  createMock.mockReset();
  createMock.mockResolvedValue({ job: { id: 'job-1', artifactId: null } });
});

describe('useAgentExecution attachments -> POST /api/v1/jobs wire shape (WS4a)', () => {
  it('sends the SERVER-issued upload reference (.path), never the composer chip id (.attachmentId)', async () => {
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('resume o anexo', {
        language: 'pt',
        attachments: [
          { attachmentId: 'chip-local-only-1', displayName: 'nota.txt', path: 'upload-server-real-id-1', type: 'file' },
        ],
      });
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const [request] = createMock.mock.calls[0] as [{ attachments?: Array<{ uploadId: string; displayName: string }> }];
    expect(request.attachments).toEqual([{ uploadId: 'upload-server-real-id-1', displayName: 'nota.txt' }]);
    // The chip id never leaves the browser.
    expect(JSON.stringify(request.attachments)).not.toContain('chip-local-only-1');
  });

  it('drops url-type attachments (prepended to the message text elsewhere) and folders ride the SAME .path fix', async () => {
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('build isto', {
        language: 'pt',
        attachments: [
          { attachmentId: 'chip-url', displayName: 'https://example.com', path: 'https://example.com', type: 'url' },
          { attachmentId: 'chip-folder', displayName: 'projeto', path: 'folder-server-root-2', type: 'folder' },
        ],
      });
    });

    const [request] = createMock.mock.calls[0] as [{ attachments?: Array<{ uploadId: string; displayName: string }> }];
    expect(request.attachments).toEqual([{ uploadId: 'folder-server-root-2', displayName: 'projeto' }]);
  });

  it('omits `attachments` entirely when there are none (no empty-array noise on the wire)', async () => {
    const { result } = renderHook(() => useAgentExecution(SID));
    await act(async () => {
      await result.current.execute('sem anexos', { language: 'pt' });
    });

    const [request] = createMock.mock.calls[0] as [{ attachments?: unknown }];
    expect(request.attachments).toBeUndefined();
  });
});
