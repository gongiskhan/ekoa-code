/**
 * Per-session busy state (S4, session parallelism). sessionBusy(id) is the per-session
 * replacement for the global isExecuting flag: true when the session has a live build
 * (running|queued) OR a live chat run. The chat-run half is written by setSessionChatRun
 * (populated by the chat control plane in a later slice); this slice adds the map + selector.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useOrchestrationStore } from '@/stores/orchestration';

function reset() {
  useOrchestrationStore.setState({ sessionJobs: {}, sessionChatRuns: {} });
}

beforeEach(reset);

describe('sessionBusy selector', () => {
  it('is false for an unknown / idle session', () => {
    const s = useOrchestrationStore.getState();
    expect(s.sessionBusy('nope')).toBe(false);
    s.setSessionJob('sess', { status: 'idle' });
    expect(useOrchestrationStore.getState().sessionBusy('sess')).toBe(false);
  });

  it('is true while a build is running or queued', () => {
    const s = useOrchestrationStore.getState();
    s.setSessionJob('sess', { status: 'running' });
    expect(useOrchestrationStore.getState().sessionBusy('sess')).toBe(true);
    s.setSessionJob('sess', { status: 'queued' });
    expect(useOrchestrationStore.getState().sessionBusy('sess')).toBe(true);
  });

  it('is false once the build reaches a terminal status', () => {
    const s = useOrchestrationStore.getState();
    for (const status of ['completed', 'failed', 'cancelled'] as const) {
      s.setSessionJob('sess', { status });
      expect(useOrchestrationStore.getState().sessionBusy('sess')).toBe(false);
    }
  });

  it('is true while a chat run is live even with no build', () => {
    const s = useOrchestrationStore.getState();
    s.setSessionChatRun('sess', { runId: 'run-1', startedAt: Date.now() });
    expect(useOrchestrationStore.getState().sessionBusy('sess')).toBe(true);
    // …and false again once the chat run is cleared.
    useOrchestrationStore.getState().setSessionChatRun('sess', null);
    expect(useOrchestrationStore.getState().sessionBusy('sess')).toBe(false);
  });

  it('tracks each session independently (no cross-talk)', () => {
    const s = useOrchestrationStore.getState();
    s.setSessionJob('sess-A', { status: 'running' });
    s.setSessionChatRun('sess-B', { runId: 'run-b', startedAt: Date.now() });
    const g = useOrchestrationStore.getState();
    expect(g.sessionBusy('sess-A')).toBe(true);
    expect(g.sessionBusy('sess-B')).toBe(true);
    expect(g.sessionBusy('sess-C')).toBe(false);
  });
});
