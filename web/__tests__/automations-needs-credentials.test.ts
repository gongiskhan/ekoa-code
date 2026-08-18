/**
 * The web half of the `needs_credentials` halt (P3.1).
 *
 * The property that matters is the one a live-event test cannot reach: the halt SURVIVES A RELOAD.
 * The user is expected to leave the automations page for `/cofre`, establish a credential, and come
 * back — by which point the SSE frame that announced the halt was emitted to a page that no longer
 * exists. So `recoverActiveRun` must rebuild the banner from the run resource, which means
 * `needs_credentials` has to be in `NON_TERMINAL_RUN_STATUSES` (or the run is not even recovered)
 * AND the request has to be read off the recovered row (or it is recovered as a silent screen).
 *
 * Both halves are asserted, because either one alone leaves the user staring at nothing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const listRunsSpy = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    automations: {
      listRuns: (...args: unknown[]) => listRunsSpy(...args),
    },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true, data: await fn() };
    } catch (err) {
      return { ok: false, error: { message: (err as Error).message } };
    }
  },
}));

const { useAutomationsStore } = await import('@/stores/automations');

const REQUEST = {
  stepIndex: 2,
  origin: 'portal.acme.example',
  integrationKey: 'acme',
  portalDeepLink: '/cofre?origin=portal.acme.example',
  mode: 'typist' as const,
  reason: 'portal.acme.example has no credential reference to replay unattended',
};

beforeEach(() => {
  listRunsSpy.mockReset();
  useAutomationsStore.getState().resetActiveRun();
});

describe('the live event', () => {
  it('moves the run to needs_credentials and records what is being asked', () => {
    useAutomationsStore.getState().applyLiveEvent({
      type: 'automation_run_needs_credentials',
      trace_id: 'run_1',
      runId: 'run_1',
      ...REQUEST,
    });

    const { activeRun } = useAutomationsStore.getState();
    expect(activeRun.status).toBe('needs_credentials');
    expect(activeRun.runId).toBe('run_1');
    expect(activeRun.credentialsRequest).toEqual(REQUEST);
    // It also lands on the timeline, like every other halt, so the log reads continuously.
    expect(activeRun.timeline.at(-1)?.type).toBe('automation_run_needs_credentials');
  });

  it('carries the ceremony mode and the preferred pairing when there is one', () => {
    useAutomationsStore.getState().applyLiveEvent({
      type: 'automation_run_needs_credentials',
      trace_id: 'run_1',
      runId: 'run_1',
      ...REQUEST,
      mode: 'ceremony',
      preferredPairingId: 'pair_7',
    });
    expect(useAutomationsStore.getState().activeRun.credentialsRequest).toMatchObject({
      mode: 'ceremony',
      preferredPairingId: 'pair_7',
    });
  });
});

describe('recovery after a reload', () => {
  it('recovers the halted run AND rebuilds the banner from the run resource', async () => {
    listRunsSpy.mockResolvedValue({
      items: [{ id: 'run_1', automationId: 'auto_1', status: 'needs_credentials', credentialRequest: REQUEST }],
    });

    await useAutomationsStore.getState().recoverActiveRun('auto_1');

    const { activeRun } = useAutomationsStore.getState();
    expect(activeRun.runId).toBe('run_1');
    expect(activeRun.status).toBe('needs_credentials');
    // Without this the user comes back from /cofre to a run that says it is waiting and cannot say
    // what for.
    expect(activeRun.credentialsRequest).toEqual(REQUEST);
  });

  it('a terminal run is still not recovered (the status set stays a set, not a catch-all)', async () => {
    listRunsSpy.mockResolvedValue({
      items: [{ id: 'run_1', automationId: 'auto_1', status: 'completed' }],
    });
    await useAutomationsStore.getState().recoverActiveRun('auto_1');
    expect(useAutomationsStore.getState().activeRun.runId).toBeUndefined();
  });

  it('a halted run with no persisted request recovers without a banner rather than crashing', async () => {
    // A row written by an older build, or one whose request was cleared on resume.
    listRunsSpy.mockResolvedValue({
      items: [{ id: 'run_1', automationId: 'auto_1', status: 'needs_credentials' }],
    });
    await useAutomationsStore.getState().recoverActiveRun('auto_1');
    const { activeRun } = useAutomationsStore.getState();
    expect(activeRun.status).toBe('needs_credentials');
    expect(activeRun.credentialsRequest).toBeUndefined();
  });
});
