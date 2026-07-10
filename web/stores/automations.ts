"use client";

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type {
  Automation,
  RunRecord,
  Step,
  AutomationLiveEvent,
  AutomationCatalogEntry,
  IntegrationActionCatalogEntry,
  StreamingSession,
  StreamingConnectionStatus,
} from '@/types/automation';

// ============================================================================
// State
// ============================================================================

interface AutomationsState {
  automations: Automation[];
  loading: boolean;

  /** Currently-open automation (editor view). */
  current: Automation | null;
  currentLoading: boolean;

  /** Live run state. */
  activeRun: {
    runId?: string;
    /** @deprecated retired with the old client-minted trace id (W3); runs are keyed by `runId`. */
    traceId?: string;
    automationId?: string;
    /** Step records as they stream in via SSE (indexed by stepIndex). */
    liveSteps: Record<number, AutomationLiveEvent>;
    /**
     * Append-only timeline of every event we've seen for this run, in
     * arrival order. Used by the run viewer to render a readable log
     * (step results + patch/proposing/applied/aborted entries) and to
     * auto-scroll to the latest entry.
     */
    timeline: AutomationLiveEvent[];
    status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_integration' | 'paused_for_user' | 'awaiting_consent' | 'awaiting_daemon';
    summary?: string;
    awaitingService?: string;
    error?: string;
    /** 'rehearsal' = self-correcting validation run kicked off by planFromGoal. */
    kind?: 'normal' | 'rehearsal';
    /** Active pause-for-user request (CAPTCHA / MFA / payment-confirm). Cleared on resume. */
    pauseRequest?: {
      stepIndex: number;
      reasoning: string;
      userInstructions: string;
      failureMessage?: string;
      screenshotUrl?: string;
    };
    /** Active consent request (local_command first-time approval). Cleared on resolve. */
    consentRequest?: {
      stepIndex: number;
      shape: string;
      argv: string[];
      description: string;
    };
    /** Active daemon-required halt: a browser / local_command step needs the local ekoa daemon, which isn't connected. */
    daemonRequest?: {
      stepIndex: number;
      capability: 'browser' | 'bash';
      reason: string;
    };
    /** Live stdout/stderr accumulators per step index. */
    liveChunks?: Record<number, { stdout: string; stderr: string }>;
    streamingSession?: StreamingSession;
  };

  /** Run history for the current automation. */
  runs: RunRecord[];
  runsLoading: boolean;

  /** Catalog (automations + integration actions) for pickers. */
  catalog: {
    automations: AutomationCatalogEntry[];
    integrationActions: IntegrationActionCatalogEntry[];
  };
  catalogLoading: boolean;

  /** Inline error surfaced to the editor. */
  error?: string;
}

interface AutomationsActions {
  fetchAutomations: () => Promise<void>;
  fetchOne: (id: string) => Promise<Automation | null>;
  create: (data: {
    name: string;
    description?: string;
    steps?: Step[];
  }) => Promise<Automation | null>;
  update: (id: string, patch: Partial<Pick<Automation, 'name' | 'description' | 'steps' | 'inputSchema'>>) => Promise<Automation | null>;
  remove: (id: string) => Promise<boolean>;
  planFromGoal: (goal: string, name?: string, automationId?: string) => Promise<{
    ok: boolean;
    awaiting?: { service: string; reason: string };
    automation?: Automation;
    traceId?: string;
    rehearsing?: boolean;
    error?: string;
  }>;
  start: (id: string, inputs?: Record<string, unknown>) => Promise<string | null>;
  /** Recover the active run for an automation after a page reload (in-memory store is empty). */
  recoverActiveRun: (automationId: string) => Promise<void>;
  cancel: () => Promise<void>;
  resume: () => Promise<void>;
  applyLiveEvent: (event: AutomationLiveEvent) => void;
  setStreamingStatus: (status: StreamingConnectionStatus) => void;
  resetActiveRun: () => void;
  fetchRuns: (automationId?: string, limit?: number) => Promise<void>;
  fetchRun: (automationId: string, runId: string) => Promise<RunRecord | null>;
  submitFeedback: (input: {
    automationId: string;
    runId: string;
    stepId: string;
    kind: 'thumbs_up' | 'thumbs_down' | 'correction';
    note?: string;
  }) => Promise<boolean>;
  fetchCatalog: () => Promise<void>;
  setCurrent: (a: Automation | null) => void;
}

const INITIAL_RUN: AutomationsState['activeRun'] = {
  liveSteps: {},
  timeline: [],
  status: 'idle',
};

/**
 * Non-terminal run statuses used when recovering an in-flight run after reload.
 * The shared RunStatus is a superset; these are the states the store keeps live.
 */
const NON_TERMINAL_RUN_STATUSES = new Set<string>([
  'running',
  'awaiting_integration',
  'paused_for_user',
  'awaiting_consent',
  'awaiting_daemon',
]);

// ============================================================================
// Store
// ============================================================================

export const useAutomationsStore = create<AutomationsState & AutomationsActions>((set, get) => ({
  automations: [],
  loading: false,
  current: null,
  currentLoading: false,
  activeRun: { ...INITIAL_RUN },
  runs: [],
  runsLoading: false,
  catalog: { automations: [], integrationActions: [] },
  catalogLoading: false,

  setCurrent: (a) => set({ current: a }),

  async fetchAutomations() {
    set({ loading: true, error: undefined });
    const res = await tryCall(() => api.automations.list());
    if (res.ok) {
      set({ automations: res.data.items as unknown as Automation[], loading: false });
    } else {
      set({ loading: false, error: res.error.message || 'failed to load automations' });
    }
  },

  async fetchOne(id) {
    set({ currentLoading: true, error: undefined });
    const res = await tryCall(() => api.automations.get({ id }));
    if (res.ok) {
      const automation = res.data as unknown as Automation;
      set({ current: automation, currentLoading: false });
      return automation;
    }
    set({ currentLoading: false, error: res.error.message || 'failed to load automation' });
    return null;
  },

  async create(data) {
    const res = await tryCall(() =>
      api.automations.create({ name: data.name, description: data.description, steps: data.steps }),
    );
    if (res.ok) {
      const a = res.data as unknown as Automation;
      set((s) => ({ automations: [a, ...s.automations], current: a }));
      return a;
    }
    set({ error: res.error.message || 'failed to create' });
    return null;
  },

  async update(id, patch) {
    const res = await tryCall(() => api.automations.patch({ id, ...patch }));
    if (res.ok) {
      const updated = res.data as unknown as Automation;
      set((s) => ({
        automations: s.automations.map((a) => (a.id === id ? updated : a)),
        current: s.current?.id === id ? updated : s.current,
      }));
      return updated;
    }
    set({ error: res.error.message || 'failed to update' });
    return null;
  },

  async remove(id) {
    const res = await tryCall(() => api.automations.remove({ id }));
    if (res.ok) {
      set((s) => ({
        automations: s.automations.filter((a) => a.id !== id),
        current: s.current?.id === id ? null : s.current,
      }));
      return true;
    }
    set({ error: res.error.message || 'failed to delete' });
    return false;
  },

  async planFromGoal(goal, name, automationId) {
    const res = await tryCall(() => api.automations.plan({ goal, name, automationId }));
    if (!res.ok) {
      return { ok: false, error: res.error.message || 'planner failed' };
    }
    const plan = res.data.plan as { status?: string; service?: string; reason?: string };
    if (plan.status === 'awaiting_integration') {
      return { ok: false, awaiting: { service: plan.service ?? '', reason: plan.reason ?? '' } };
    }
    // F29: the model could not produce a usable plan — an honest, structured failure (not the
    // opaque "planner returned no automation" that a swallowed 500 used to fall through to).
    if (plan.status === 'plan_failed') {
      return { ok: false, error: plan.reason || 'O modelo não conseguiu criar um plano utilizável. Tente reformular o objetivo.' };
    }
    // The backend persisted the automation and kicked off the rehearsal
    // run. Surface both so the caller can navigate to the editor and
    // subscribe to the live rehearsal events.
    const automation = res.data.automation as unknown as Automation | undefined;
    const runId = res.data.runId;
    if (!automation) {
      return { ok: false, error: 'planner returned no automation' };
    }
    set((s) => ({
      automations: [automation, ...s.automations.filter((a) => a.id !== automation.id)],
      current: automation,
      // Pre-arm activeRun so the live-run hook can attach as soon as the
      // editor mounts and the SSE events start arriving.
      activeRun: runId
        ? { ...INITIAL_RUN, automationId: automation.id, runId, status: 'running', kind: 'rehearsal' }
        : s.activeRun,
    }));
    return { ok: true, automation, traceId: runId, rehearsing: !!res.data.rehearsing };
  },

  async start(id, inputs) {
    set({ activeRun: { ...INITIAL_RUN, automationId: id, status: 'running', kind: 'normal' } });
    const res = await tryCall(() => api.automations.createRun({ id, inputs: inputs ?? {} }));
    if (res.ok) {
      // The run id is server-minted (the old client-minted trace id is retired).
      const runId = res.data.runId;
      set((s) => ({ activeRun: { ...s.activeRun, runId } }));
      return runId;
    }
    set({
      activeRun: { ...INITIAL_RUN, status: 'failed' },
      error: res.error.message || 'failed to start run',
    });
    return null;
  },

  async recoverActiveRun(automationId) {
    // After a reload the in-memory store is empty. Per-run SSE streams need a
    // run id to subscribe, so recover the most recent in-flight run for this
    // automation before the live-run hook can attach.
    const { activeRun } = get();
    if (activeRun.runId && activeRun.automationId === automationId) return;
    const res = await tryCall(() => api.automations.listRuns({ automationId, limit: 20 }));
    if (!res.ok) return;
    const runs = res.data.items as unknown as RunRecord[];
    const live = runs.find((r) => NON_TERMINAL_RUN_STATUSES.has(r.status));
    if (!live) return;
    set((s) => {
      // Don't clobber a run the user just started for this automation.
      if (s.activeRun.runId && s.activeRun.automationId === automationId) return s;
      const status = NON_TERMINAL_RUN_STATUSES.has(live.status)
        ? (live.status as AutomationsState['activeRun']['status'])
        : 'running';
      return { activeRun: { ...INITIAL_RUN, automationId, runId: live.id, status, kind: 'normal' } };
    });
  },

  async cancel() {
    const { activeRun } = get();
    if (!activeRun.runId) {
      console.warn('[automations] cancel(): no active runId - nothing to cancel');
      return;
    }
    await tryCall(() => api.automations.cancelRun({ id: activeRun.runId! }));
    set((s) => ({ activeRun: { ...s.activeRun, status: 'cancelled', streamingSession: undefined } }));
  },

  async resume() {
    const { activeRun } = get();
    if (!activeRun.runId) {
      console.warn('[automations] resume(): no active runId - store has no record of which run is paused. Reload the page once events arrive again.');
      return;
    }
    await tryCall(() => api.automations.resumeRun({ id: activeRun.runId! }));
    // The engine will emit `resumed` which will flip status back to 'running'
    // through applyLiveEvent. We optimistically clear the pauseRequest here so
    // the UI reacts immediately.
    set((s) => ({
      activeRun: { ...s.activeRun, pauseRequest: undefined, status: 'running', streamingSession: undefined },
    }));
  },

  applyLiveEvent(event) {
    set((s) => {
      // The stream is run-scoped (openAutomationRunStream), so there is no
      // client-side trace filtering to do (FC-028).
      const timeline = [...s.activeRun.timeline, event];

      switch (event.type) {
        case 'automation_run_step': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              liveSteps: { ...s.activeRun.liveSteps, [event.stepIndex]: event },
              timeline,
            },
          };
        }
        case 'automation_run_complete': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              status: 'completed',
              summary: event.summary,
              timeline,
              streamingSession: undefined,
            },
          };
        }
        case 'automation_run_error': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              status: 'failed',
              error: event.error,
              timeline,
              streamingSession: undefined,
            },
          };
        }
        case 'automation_run_paused': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              status: 'awaiting_integration',
              awaitingService: event.service,
              timeline,
            },
          };
        }
        case 'automation_run_patch': {
          // Patch events don't change run status - they're informational
          // signals while the engine is mid-fix.
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              timeline,
            },
          };
        }
        case 'automation_run_pause_for_user': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              status: 'paused_for_user',
              timeline,
              pauseRequest: {
                stepIndex: event.stepIndex,
                reasoning: event.reasoning,
                userInstructions: event.userInstructions,
                failureMessage: event.failureMessage,
                screenshotUrl: event.screenshotUrl,
              },
            },
          };
        }
        case 'automation_run_resumed': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              status: 'running',
              pauseRequest: undefined,
              timeline,
              streamingSession: undefined,
            },
          };
        }
        case 'automation_run_streaming_available': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              timeline,
              streamingSession: {
                token: event.token,
                wsUrl: event.wsUrl,
                viewport: event.viewport,
                status: 'connecting',
              },
            },
          };
        }
        case 'automation_run_awaiting_consent': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              timeline,
              status: 'awaiting_consent',
              consentRequest: {
                stepIndex: event.stepIndex,
                shape: event.shape,
                argv: event.argv,
                description: event.description,
              },
            },
          };
        }
        case 'automation_run_awaiting_daemon': {
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              timeline,
              status: 'awaiting_daemon',
              daemonRequest: { stepIndex: event.stepIndex, capability: event.capability, reason: event.reason },
            },
          };
        }
        case 'automation_step_output_chunk': {
          const existingByIndex = { ...(s.activeRun.liveSteps ?? {}) } as Record<number, AutomationLiveEvent>;
          const prior = existingByIndex[event.stepIndex];
          // We piggy-back stdout/stderr chunks onto the most recent step
          // event for this index. The run-viewer reads liveSteps[i] to
          // render the panel; chunks appear as auxiliary live state on
          // the store.
          existingByIndex[event.stepIndex] = prior ?? event;
          const liveChunks = { ...(s.activeRun.liveChunks ?? {}) } as Record<number, { stdout: string; stderr: string }>;
          const slot = liveChunks[event.stepIndex] ?? { stdout: '', stderr: '' };
          liveChunks[event.stepIndex] = {
            stdout: event.stream === 'stdout' ? slot.stdout + event.chunk : slot.stdout,
            stderr: event.stream === 'stderr' ? slot.stderr + event.chunk : slot.stderr,
          };
          return {
            activeRun: {
              ...s.activeRun,
              runId: event.runId,
              timeline,
              liveSteps: existingByIndex,
              liveChunks,
            },
          };
        }
        default: {
          // exhaustiveness check - new event types must be handled above.
          return s;
        }
      }
    });
  },

  setStreamingStatus(status) {
    set((s) => {
      if (!s.activeRun.streamingSession) return s;
      return {
        activeRun: {
          ...s.activeRun,
          streamingSession: { ...s.activeRun.streamingSession, status },
        },
      };
    });
  },

  resetActiveRun() {
    set({ activeRun: { ...INITIAL_RUN } });
  },

  async fetchRuns(automationId, limit) {
    set({ runsLoading: true });
    const res = await tryCall(() => api.automations.listRuns({ automationId, limit }));
    if (res.ok) {
      set({ runs: res.data.items as unknown as RunRecord[], runsLoading: false });
    } else {
      set({ runsLoading: false, error: res.error.message || 'failed to load runs' });
    }
  },

  async fetchRun(_automationId, runId) {
    const res = await tryCall(() => api.automations.getRun({ id: runId }));
    if (res.ok) return res.data as unknown as RunRecord;
    return null;
  },

  async submitFeedback(input) {
    const res = await tryCall(() =>
      api.automations.stepFeedback({ id: input.runId, stepId: input.stepId, kind: input.kind, note: input.note }),
    );
    if (!res.ok) {
      set({ error: res.error.message || 'feedback failed' });
      return false;
    }
    return true;
  },

  async fetchCatalog() {
    set({ catalogLoading: true });
    const res = await tryCall(() => api.automations.catalog());
    if (res.ok) {
      set({
        catalog: res.data as unknown as AutomationsState['catalog'],
        catalogLoading: false,
      });
    } else {
      set({ catalogLoading: false });
    }
  },
}));
