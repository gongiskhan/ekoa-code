/**
 * Job-stream manager (S4, session parallelism). The manager owns one SSE stream per
 * running/queued job keyed by liveness, and every event MUST write to the OWNING session's
 * store buckets - never store.activeSessionId (the old useJobStream fallback that misattributed
 * a backgrounded build's output onto whatever session was focused).
 *
 * openJobStream is mocked to return a controllable fake stream per jobId so the test can drive
 * schema-shaped JobEvents through the exact handlers the real SSE transport would; api.jobs.get
 * is mocked for the rehydration + ready-resync paths.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { JobEvent } from '@ekoa/shared';

interface FakeStream {
  status: 'connected' | 'disconnected';
  onStatusChange: () => () => void;
  on: (type: string, h: (e: unknown) => void) => () => void;
  close: ReturnType<typeof vi.fn>;
  emit: (event: JobEvent) => void;
}

const fakeStreams = new Map<string, FakeStream>();

function makeFake(jobId: string): FakeStream {
  const handlers = new Map<string, (e: unknown) => void>();
  const fake: FakeStream = {
    status: 'connected',
    onStatusChange: () => () => {},
    on: (type, h) => {
      handlers.set(type, h);
      return () => handlers.delete(type);
    },
    close: vi.fn(),
    emit: (event) => {
      const h = handlers.get(event.type);
      if (h) h(event);
    },
  };
  fakeStreams.set(jobId, fake);
  return fake;
}

const jobGet = vi.fn<(args: { id: string }) => Promise<{ id: string; status: string; createdAt: string }>>();

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    openJobStream: (jobId: string) => makeFake(jobId),
    api: {
      ...original.api,
      appUrl: (id: string) => `/apps/${id}/`,
      jobs: { ...original.api.jobs, get: (args: { id: string }) => jobGet(args) },
      artifacts: { ...original.api.artifacts, filesList: () => Promise.resolve({ files: [] }) },
    },
  };
});

import {
  trackJob,
  untrackJob,
  isTracked,
  ensureTracked,
  rehydrateJobs,
  __resetJobStreamManager,
} from '@/lib/job-stream-manager';
import { ApiError } from '@/lib/api';
import { useOrchestrationStore } from '@/stores/orchestration';

function resetStore() {
  useOrchestrationStore.setState({
    sessionJobs: {},
    sessionChatRuns: {},
    messages: {},
    sessionPreviews: {},
    activityMessages: {},
    streamingChat: {},
    streamingThinking: {},
    activeSessionId: null,
  });
}

function seedJob(sessionId: string, jobId: string, status: 'idle' | 'queued' | 'running' | 'completed') {
  useOrchestrationStore.getState().setSessionJob(sessionId, { jobId, status });
}

beforeEach(() => {
  resetStore();
  fakeStreams.clear();
  jobGet.mockReset();
});

afterEach(() => {
  __resetJobStreamManager();
});

describe('job-stream manager - per-session event routing', () => {
  it('routes two concurrent jobs to their OWN sessions (no cross-contamination)', () => {
    seedJob('sess-A', 'job-A', 'running');
    seedJob('sess-B', 'job-B', 'running');
    trackJob('job-A', 'sess-A');
    trackJob('job-B', 'sess-B');

    fakeStreams.get('job-A')!.emit({ type: 'artifact', artifactId: 'art-A', appUrl: '/apps/art-A/' });
    fakeStreams.get('job-B')!.emit({ type: 'artifact', artifactId: 'art-B', appUrl: '/apps/art-B/' });

    const jobs = useOrchestrationStore.getState().sessionJobs;
    expect(jobs['sess-A'].artifactInstanceId).toBe('art-A');
    expect(jobs['sess-B'].artifactInstanceId).toBe('art-B');
    expect(useOrchestrationStore.getState().sessionPreviews['sess-A'].appUrl).toBe('/apps/art-A/');
    expect(useOrchestrationStore.getState().sessionPreviews['sess-B'].appUrl).toBe('/apps/art-B/');
  });

  it('MISATTRIBUTION REGRESSION: a background session\'s event lands on THAT session even while another is active', () => {
    // The old useJobStream fell back to store.activeSessionId, so a backgrounded build's
    // output landed on the focused session. Prove the fallback is gone.
    seedJob('foreground', 'job-fg', 'running');
    seedJob('background', 'job-bg', 'running');
    useOrchestrationStore.setState({ activeSessionId: 'foreground' });
    trackJob('job-fg', 'foreground');
    trackJob('job-bg', 'background');

    // Emit for the BACKGROUND job while `foreground` is the active session.
    fakeStreams.get('job-bg')!.emit({ type: 'artifact', artifactId: 'art-bg', appUrl: '/apps/art-bg/' });
    fakeStreams.get('job-bg')!.emit({
      type: 'plan_step',
      status: 'scaffolding',
      description: 'Estruturar o projeto',
    });

    const jobs = useOrchestrationStore.getState().sessionJobs;
    const messages = useOrchestrationStore.getState().messages;
    // Landed on the owning (background) session...
    expect(jobs['background'].artifactInstanceId).toBe('art-bg');
    expect((messages['background'] ?? []).some((m) => m.metadata?.phase === 'scaffolding')).toBe(true);
    // ...and NOT on the active (foreground) session.
    expect(jobs['foreground'].artifactInstanceId).toBeNull();
    expect((messages['foreground'] ?? []).length).toBe(0);
  });

  it('flips a queued job to running on the first execution event', () => {
    seedJob('sess-Q', 'job-Q', 'queued');
    trackJob('job-Q', 'sess-Q');
    expect(useOrchestrationStore.getState().sessionJobs['sess-Q'].status).toBe('queued');

    fakeStreams.get('job-Q')!.emit({ type: 'routing', tier: 'expert', reason: 'first build' });
    expect(useOrchestrationStore.getState().sessionJobs['sess-Q'].status).toBe('running');
  });

  it('writes terminal state and closes the stream on complete', () => {
    seedJob('sess-C', 'job-C', 'running');
    trackJob('job-C', 'sess-C');
    const fake = fakeStreams.get('job-C')!;

    fake.emit({ type: 'complete', durationMs: 1200, result: 'pronto' });

    expect(useOrchestrationStore.getState().sessionJobs['sess-C'].status).toBe('completed');
    expect(fake.close).toHaveBeenCalled();
    expect(isTracked('job-C')).toBe(false);
  });

  it('writes failed state and closes the stream on error (sanitized message)', () => {
    seedJob('sess-E', 'job-E', 'running');
    trackJob('job-E', 'sess-E');
    const fake = fakeStreams.get('job-E')!;

    fake.emit({ type: 'error', code: 'ADAPTER_ERROR', message: 'Claude Sonnet exploded' });

    const jobs = useOrchestrationStore.getState().sessionJobs;
    expect(jobs['sess-E'].status).toBe('failed');
    const errMsg = (useOrchestrationStore.getState().messages['sess-E'] ?? []).find((m) => m.metadata?.type === 'error');
    expect(errMsg).toBeTruthy();
    // The engine identity must never survive to the user-facing message.
    expect(errMsg!.content).not.toMatch(/claude|sonnet|anthropic/i);
    expect(isTracked('job-E')).toBe(false);
  });

  it('trackJob is idempotent - a second call does not open a second stream', () => {
    seedJob('sess-I', 'job-I', 'running');
    trackJob('job-I', 'sess-I');
    const first = fakeStreams.get('job-I')!;
    trackJob('job-I', 'sess-I');
    // Same fake instance is reused (openJobStream was not called again).
    expect(fakeStreams.get('job-I')).toBe(first);
    expect(isTracked('job-I')).toBe(true);
  });

  it('untrackJob closes the stream without writing a terminal status', () => {
    seedJob('sess-U', 'job-U', 'running');
    trackJob('job-U', 'sess-U');
    const fake = fakeStreams.get('job-U')!;
    untrackJob('job-U');
    expect(fake.close).toHaveBeenCalled();
    expect(isTracked('job-U')).toBe(false);
    // status untouched (the cancel path sets it, not the manager)
    expect(useOrchestrationStore.getState().sessionJobs['sess-U'].status).toBe('running');
  });
});

describe('job-stream manager - rehydrateJobs', () => {
  it('writes terminal state for a job that finished while the tab was gone', async () => {
    // persist sanitizes running -> idle, so a mid-build refresh lands as idle + jobId.
    seedJob('sess-done', 'job-done', 'idle');
    jobGet.mockResolvedValue({ id: 'job-done', status: 'completed', createdAt: '' });

    await rehydrateJobs();

    expect(useOrchestrationStore.getState().sessionJobs['sess-done'].status).toBe('completed');
    expect(isTracked('job-done')).toBe(false);
  });

  it('re-attaches a live stream for a job still running after refresh', async () => {
    seedJob('sess-live', 'job-live', 'idle');
    jobGet.mockResolvedValue({ id: 'job-live', status: 'running', createdAt: '' });

    await rehydrateJobs();

    expect(useOrchestrationStore.getState().sessionJobs['sess-live'].status).toBe('running');
    expect(isTracked('job-live')).toBe(true);
    // The reattached stream delivers live events to the owning session.
    fakeStreams.get('job-live')!.emit({ type: 'artifact', artifactId: 'art-live', appUrl: '/apps/art-live/' });
    expect(useOrchestrationStore.getState().sessionJobs['sess-live'].artifactInstanceId).toBe('art-live');
  });

  it('skips sessions with a terminal status or no jobId (no server call)', async () => {
    seedJob('sess-terminal', 'job-terminal', 'completed');
    useOrchestrationStore.getState().setSessionJob('sess-fresh', { status: 'idle' }); // no jobId

    await rehydrateJobs();

    expect(jobGet).not.toHaveBeenCalled();
    expect(isTracked('job-terminal')).toBe(false);
  });

  it('marks a session failed only on a definitive 404 (review #6: transient loss is not failure)', async () => {
    seedJob('sess-gone', 'job-gone', 'idle');
    jobGet.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'job gone'));

    await rehydrateJobs();

    expect(useOrchestrationStore.getState().sessionJobs['sess-gone'].status).toBe('failed');
    expect(isTracked('job-gone')).toBe(false);
  });
});

describe('job-stream manager - review-round recovery (ensureTracked)', () => {
  it('review #4: a dead entry (force-closed stream, e.g. logout) is dropped and re-tracked', async () => {
    seedJob('sess-D', 'job-D', 'running');
    trackJob('job-D', 'sess-D');
    // Simulate the token-cleared close: the stream is closed for good but the entry survives.
    fakeStreams.get('job-D')!.status = 'disconnected';
    jobGet.mockResolvedValueOnce({ id: 'job-D', status: 'running', createdAt: 'now' });

    await ensureTracked('job-D', 'sess-D');

    expect(isTracked('job-D')).toBe(true);
    // A fresh stream was opened (the fake map now holds the NEW stream, status connected).
    expect(fakeStreams.get('job-D')!.status).toBe('connected');
    expect(useOrchestrationStore.getState().sessionJobs['sess-D'].status).toBe('running');
  });

  it('review #5: server status created (pre-running window) is live - shown queued and tracked', async () => {
    seedJob('sess-C', 'job-C', 'idle');
    jobGet.mockResolvedValueOnce({ id: 'job-C', status: 'created', createdAt: 'now' });

    await ensureTracked('job-C', 'sess-C');

    expect(useOrchestrationStore.getState().sessionJobs['sess-C'].status).toBe('queued');
    expect(isTracked('job-C')).toBe(true);
  });

  it('review #6: a transient fetch error leaves the state untouched; only a 404 marks failed', async () => {
    seedJob('sess-T', 'job-T', 'idle');
    jobGet.mockRejectedValueOnce(new Error('network down')); // normalises to status 0

    await ensureTracked('job-T', 'sess-T');
    expect(useOrchestrationStore.getState().sessionJobs['sess-T'].status).toBe('idle'); // no phantom failure
    expect(isTracked('job-T')).toBe(false);

    jobGet.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'gone'));
    await ensureTracked('job-T', 'sess-T');
    expect(useOrchestrationStore.getState().sessionJobs['sess-T'].status).toBe('failed');
  });

  it('review #3: a healthy tracked stream is left alone (no churn on revisit)', async () => {
    seedJob('sess-H', 'job-H', 'running');
    trackJob('job-H', 'sess-H');
    const before = fakeStreams.get('job-H')!;

    await ensureTracked('job-H', 'sess-H');

    expect(fakeStreams.get('job-H')).toBe(before); // same stream instance - not rebuilt
    expect(jobGet).not.toHaveBeenCalled(); // no server round-trip for a healthy stream
  });
});
