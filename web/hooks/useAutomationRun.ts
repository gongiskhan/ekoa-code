"use client";

import { useEffect } from 'react';
import { api, tryCall, openAutomationRunStream, type EventStream, type Unsubscribe } from '@/lib/api';
import type { AutomationRunEvent } from '@ekoa/shared';
import { useAutomationsStore } from '@/stores/automations';
import type {
  AutomationLiveEvent,
  AutomationRunStepEvent,
  AutomationRunCompleteEvent,
  AutomationRunErrorEvent,
  AutomationRunPausedEvent,
  AutomationRunPatchEvent,
  AutomationRunPauseForUserEvent,
  AutomationRunResumedEvent,
  AutomationRunStreamingAvailableEvent,
  AutomationRunAwaitingConsentEvent,
  AutomationRunAwaitingDaemonEvent,
  AutomationStepOutputChunkEvent,
  FailureKind,
  PatchKind,
  StepOutput,
  StepStatus,
  StepTier,
} from '@/types/automation';

/**
 * Subscribe to a run's SSE events and pipe them into the automations store.
 *
 * FC-028: each active run gets its own scoped `openAutomationRunStream(runId)`
 * (no firehose, no client-side trace filtering). The mission's `AutomationRunEvent`
 * union carries the new event names (`step`, `patch`, ...); this hook maps each
 * member back to the store's UI-local `AutomationLiveEvent` shape (the old wire
 * names, still consumed by `activity-state.ts` and the run viewer), preserving
 * the rich per-step fields the backend passes through.
 *
 * The hook is mounted at both the dashboard layout and the automation editor
 * page; a module-level ref-counted manager keeps exactly one stream per run id
 * so events are delivered once regardless of how many components subscribe.
 */

type RunEvt<K extends AutomationRunEvent['type']> = Extract<AutomationRunEvent, { type: K }>;

function toStepEvent(runId: string, e: RunEvt<'step'>): AutomationRunStepEvent {
  const raw = e as unknown as Record<string, unknown>;
  return {
    type: 'automation_run_step',
    trace_id: runId,
    runId,
    stepIndex: e.stepIndex,
    stepId: typeof raw.stepId === 'string' ? raw.stepId : '',
    status: e.status as StepStatus,
    tier: (raw.tier as StepTier) ?? 'cache',
    resolvedAction: raw.resolvedAction,
    error: typeof raw.error === 'string' ? raw.error : undefined,
    errorDetails: raw.errorDetails,
    screenshotUrl: typeof raw.screenshotUrl === 'string' ? raw.screenshotUrl : undefined,
    output: raw.output as StepOutput | undefined,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
  };
}

function toChunkEvent(runId: string, e: RunEvt<'step_output_chunk'>): AutomationStepOutputChunkEvent {
  return {
    type: 'automation_step_output_chunk',
    trace_id: runId,
    runId,
    stepIndex: e.stepIndex,
    stream: e.stream,
    chunk: e.chunk,
  };
}

function toPatchEvent(runId: string, e: RunEvt<'patch'>): AutomationRunPatchEvent {
  // The domain patch payload rides inside `.patch` per the shared contract;
  // fall back to the event itself in case the backend sends the fields flat.
  const raw = e as unknown as Record<string, unknown>;
  const p = (raw.patch ?? raw) as Record<string, unknown>;
  return {
    type: 'automation_run_patch',
    trace_id: runId,
    runId,
    stepIndex: typeof p.stepIndex === 'number' ? p.stepIndex : 0,
    phase: (p.phase as AutomationRunPatchEvent['phase']) ?? 'proposing',
    failureKind: p.failureKind as FailureKind | undefined,
    failureMessage: typeof p.failureMessage === 'string' ? p.failureMessage : undefined,
    patchKind: p.patchKind as PatchKind | undefined,
    reasoning: typeof p.reasoning === 'string' ? p.reasoning : undefined,
    newStepDescription: typeof p.newStepDescription === 'string' ? p.newStepDescription : undefined,
    attemptNumber: typeof p.attemptNumber === 'number' ? p.attemptNumber : undefined,
  };
}

function toPausedEvent(runId: string, e: RunEvt<'paused'>): AutomationRunPausedEvent {
  return {
    type: 'automation_run_paused',
    trace_id: runId,
    runId,
    reason: 'awaiting_integration',
    service: e.service,
  };
}

function toPauseForUserEvent(runId: string, e: RunEvt<'pause_for_user'>): AutomationRunPauseForUserEvent {
  return {
    type: 'automation_run_pause_for_user',
    trace_id: runId,
    runId,
    stepIndex: e.stepIndex,
    reasoning: e.reasoning,
    userInstructions: e.userInstructions,
    failureMessage: e.failureMessage,
    screenshotUrl: e.screenshotUrl,
  };
}

function toResumedEvent(runId: string): AutomationRunResumedEvent {
  return { type: 'automation_run_resumed', trace_id: runId, runId, stepIndex: 0 };
}

function toStreamingEvent(runId: string, e: RunEvt<'streaming_available'>): AutomationRunStreamingAvailableEvent {
  return {
    type: 'automation_run_streaming_available',
    trace_id: runId,
    runId,
    wsUrl: e.wsUrl,
    token: e.token,
    viewport: e.viewport,
  };
}

function toConsentEvent(runId: string, e: RunEvt<'awaiting_consent'>): AutomationRunAwaitingConsentEvent {
  return {
    type: 'automation_run_awaiting_consent',
    trace_id: runId,
    runId,
    stepIndex: e.stepIndex,
    shape: e.shape,
    argv: e.argv,
    description: e.description,
  };
}

function toDaemonEvent(runId: string, e: RunEvt<'awaiting_daemon'>): AutomationRunAwaitingDaemonEvent {
  return {
    type: 'automation_run_awaiting_daemon',
    trace_id: runId,
    runId,
    stepIndex: e.stepIndex,
    capability: e.capability,
    reason: e.reason,
  };
}

function toCompleteEvent(runId: string, e: RunEvt<'complete'>): AutomationRunCompleteEvent {
  const raw = e as unknown as Record<string, unknown>;
  return {
    type: 'automation_run_complete',
    trace_id: runId,
    runId,
    durationMs: typeof raw.durationMs === 'number' ? raw.durationMs : 0,
    summary: e.summary,
  };
}

function toErrorEvent(runId: string, e: RunEvt<'error'>): AutomationRunErrorEvent {
  const raw = e as unknown as Record<string, unknown>;
  return {
    type: 'automation_run_error',
    trace_id: runId,
    runId,
    error: e.message,
    partialResults: typeof raw.partialResults === 'number' ? raw.partialResults : 0,
  };
}

// -- Module-level per-run stream manager ------------------------------------------------

interface RunEntry {
  stream: EventStream<AutomationRunEvent>;
  refs: number;
  teardown: () => void;
}

const runEntries = new Map<string, RunEntry>();

function feed(event: AutomationLiveEvent): void {
  useAutomationsStore.getState().applyLiveEvent(event);
}

function openEntry(runId: string): RunEntry {
  const stream = openAutomationRunStream(runId);
  let readyCount = 0;
  let done = false;
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    stream.on('ready', () => {
      readyCount += 1;
      // A manual reconnect (2nd+ ready) loses the ring-buffer position, so
      // re-sync the run's terminal state via GET /runs/:id (mirrors FC-026).
      if (readyCount > 1 && !done) {
        void tryCall(() => api.automations.getRun({ id: runId })).then((r) => {
          if (!r.ok || done) return;
          const status = (r.data as { status?: string }).status;
          const summary = (r.data as { summary?: string }).summary;
          if (status === 'completed') {
            done = true;
            feed(toCompleteEvent(runId, { type: 'complete', summary: summary ?? '' }));
            stream.close();
          } else if (status === 'failed') {
            done = true;
            feed(toErrorEvent(runId, { type: 'error', code: 'RUN_FAILED', message: summary ?? 'run failed' }));
            stream.close();
          }
        });
      }
    }),
  );

  unsubs.push(stream.on('step', (e) => feed(toStepEvent(runId, e))));
  unsubs.push(stream.on('step_output_chunk', (e) => feed(toChunkEvent(runId, e))));
  unsubs.push(stream.on('patch', (e) => feed(toPatchEvent(runId, e))));
  unsubs.push(stream.on('paused', (e) => feed(toPausedEvent(runId, e))));
  unsubs.push(stream.on('pause_for_user', (e) => feed(toPauseForUserEvent(runId, e))));
  unsubs.push(stream.on('resumed', () => feed(toResumedEvent(runId))));
  unsubs.push(stream.on('streaming_available', (e) => feed(toStreamingEvent(runId, e))));
  unsubs.push(stream.on('awaiting_consent', (e) => feed(toConsentEvent(runId, e))));
  unsubs.push(stream.on('awaiting_daemon', (e) => feed(toDaemonEvent(runId, e))));
  unsubs.push(
    stream.on('complete', (e) => {
      done = true;
      feed(toCompleteEvent(runId, e));
      stream.close();
    }),
  );
  unsubs.push(
    stream.on('error', (e) => {
      done = true;
      feed(toErrorEvent(runId, e));
      stream.close();
    }),
  );

  return {
    stream,
    refs: 0,
    teardown: () => {
      for (const u of unsubs) u();
      stream.close();
    },
  };
}

function acquireRun(runId: string): () => void {
  let entry = runEntries.get(runId);
  if (!entry) {
    entry = openEntry(runId);
    runEntries.set(runId, entry);
  }
  entry.refs += 1;
  return () => {
    const current = runEntries.get(runId);
    if (!current) return;
    current.refs -= 1;
    if (current.refs <= 0) {
      current.teardown();
      runEntries.delete(runId);
    }
  };
}

export function useAutomationRun(): void {
  const runId = useAutomationsStore((s) => s.activeRun.runId);

  useEffect(() => {
    if (!runId) return;
    const release = acquireRun(runId);
    return release;
  }, [runId]);
}
