/**
 * Pure derivation of "what is the run doing right now" from the
 * automations store's `activeRun` state. Used by the page-level
 * RunActivityBar to render a single, prominent indicator of in-flight
 * activity.
 *
 * Why a separate module: the rules for "is the fixer working RIGHT NOW
 * vs. does the timeline just contain an old patch event" are subtle
 * enough that they deserve their own surface. Keeping them out of
 * React-component code means we can reason about — and later test —
 * the state machine without DOM concerns.
 */

import type {
  AutomationLiveEvent,
  AutomationRunPatchEvent,
  AutomationRunStepEvent,
  PatchKind,
  RunStatus,
  StepStatus,
} from '@/types/automation';

export type ActivityStateKind =
  | 'idle'
  | 'running-step'
  | 'fixing-step'
  | 'paused-for-user'
  | 'awaiting-integration'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunningStepState {
  kind: 'running-step';
  stepIndex: number;
  /** Filled in by the bar from the editor's step list. */
  stepDescription?: string;
}

export interface FixingStepState {
  kind: 'fixing-step';
  stepIndex: number;
  attemptNumber?: number;
  failureMessage?: string;
}

export interface PausedForUserState {
  kind: 'paused-for-user';
  stepIndex: number;
  reasoning: string;
  userInstructions: string;
  failureMessage?: string;
  screenshotUrl?: string;
}

export interface AwaitingIntegrationState {
  kind: 'awaiting-integration';
  service?: string;
}

export interface SimpleState {
  kind: 'idle' | 'completed' | 'failed' | 'cancelled';
  summary?: string;
  error?: string;
}

export type ActivityState =
  | SimpleState
  | RunningStepState
  | FixingStepState
  | PausedForUserState
  | AwaitingIntegrationState;

/**
 * Sticky-result side-channel — rendered alongside the primary state so
 * the user can read what just got patched while the next step is
 * already running. Distinct from `ActivityState` because the result is
 * a transient overlay, not a state itself.
 */
export interface RecentResolution {
  patchKind: PatchKind;
  stepIndex: number;
  reasoning: string;
  newStepDescription?: string;
  /** Wall-clock the event arrived in the timeline (ms). */
  arrivedAt: number;
  /** True for `aborted` — sticky until the run reaches a terminal state. */
  sticky: boolean;
}

// ============================================================================
// Inputs / shape
// ============================================================================

export interface DeriveInput {
  status: RunStatus | 'idle';
  liveSteps: Record<number, AutomationLiveEvent>;
  timeline: AutomationLiveEvent[];
  pauseRequest?: {
    stepIndex: number;
    reasoning: string;
    userInstructions: string;
    failureMessage?: string;
    screenshotUrl?: string;
  };
  awaitingService?: string;
  summary?: string;
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Walk the timeline and find the most recent `proposing` patch event
 * that has NOT been resolved by a later `applied` or `aborted` event
 * for the same `(stepIndex, attemptNumber)` pair.
 *
 * Keying on `stepIndex` alone would be wrong: the same step can fail
 * multiple times in a single run, each retry getting its own fixer
 * call. Without `attemptNumber`, attempt 2's `proposing` would be
 * "resolved" by attempt 1's `applied` and we'd silently drop the live
 * fixing-state signal.
 */
export function findUnresolvedProposing(
  timeline: AutomationLiveEvent[],
): AutomationRunPatchEvent | null {
  // Build a quick lookup of resolved (stepIndex, attemptNumber) pairs.
  const resolved = new Set<string>();
  for (const ev of timeline) {
    if (ev.type !== 'automation_run_patch') continue;
    if (ev.phase === 'applied' || ev.phase === 'aborted') {
      resolved.add(`${ev.stepIndex}:${ev.attemptNumber ?? 0}`);
    }
  }
  // Walk backwards — the most recent unresolved one is the right answer.
  for (let i = timeline.length - 1; i >= 0; i--) {
    const ev = timeline[i];
    if (ev.type !== 'automation_run_patch' || ev.phase !== 'proposing') continue;
    if (!resolved.has(`${ev.stepIndex}:${ev.attemptNumber ?? 0}`)) {
      return ev;
    }
  }
  return null;
}

/**
 * Most recent `applied` (within `appliedTtlMs` of `now`) or `aborted`
 * (sticky until run terminates) patch event. Returned events have
 * `sticky` set so callers know whether to schedule a re-render to drop
 * them.
 */
export function findRecentResolution(
  timeline: AutomationLiveEvent[],
  status: DeriveInput['status'],
  arrivalByEventIndex: number[],
  now: number,
  appliedTtlMs: number,
): RecentResolution | null {
  const runTerminated =
    status === 'completed' || status === 'failed' || status === 'cancelled';
  for (let i = timeline.length - 1; i >= 0; i--) {
    const ev = timeline[i];
    if (ev.type !== 'automation_run_patch') continue;
    if (ev.phase !== 'applied' && ev.phase !== 'aborted') continue;
    if (ev.phase === 'applied') {
      const arrivedAt = arrivalByEventIndex[i] ?? now;
      if (now - arrivedAt > appliedTtlMs) return null;
      return {
        patchKind: ev.patchKind ?? 'replace_current',
        stepIndex: ev.stepIndex,
        reasoning: ev.reasoning ?? '',
        newStepDescription: ev.newStepDescription,
        arrivedAt,
        sticky: false,
      };
    }
    // aborted — sticky until terminal
    if (runTerminated) return null;
    return {
      patchKind: 'abort',
      stepIndex: ev.stepIndex,
      reasoning: ev.reasoning ?? '',
      arrivedAt: arrivalByEventIndex[i] ?? now,
      sticky: true,
    };
  }
  return null;
}

/**
 * Find the index of the step that's currently running. Walks the
 * `liveSteps` map (indexed by stepIndex). Returns the lowest index with
 * status='running' so we always show the earliest in-flight step.
 */
export function findRunningStepIndex(liveSteps: Record<number, AutomationLiveEvent>): number | null {
  let best: number | null = null;
  for (const key of Object.keys(liveSteps)) {
    const idx = Number(key);
    const ev = liveSteps[idx];
    if (ev?.type !== 'automation_run_step') continue;
    const stepStatus: StepStatus = ev.status;
    if (stepStatus === 'running') {
      if (best === null || idx < best) best = idx;
    }
  }
  return best;
}

/**
 * Highest stepIndex we've seen any event for. Used as a fallback when
 * no step is *currently* in `running` status — between two steps the
 * engine has already emitted `completed` for step N but not yet
 * `running` for step N+1, and we'd otherwise snap back to step 0. The
 * latest known step is the most useful "where is the run focused"
 * signal in that gap.
 */
export function findLatestKnownStepIndex(liveSteps: Record<number, AutomationLiveEvent>): number | null {
  let best: number | null = null;
  for (const key of Object.keys(liveSteps)) {
    const idx = Number(key);
    const ev = liveSteps[idx];
    if (ev?.type !== 'automation_run_step') continue;
    if (best === null || idx > best) best = idx;
  }
  return best;
}

// ============================================================================
// Per-step patch info — for the editor list
// ============================================================================

export interface StepPatchInfo {
  /** A `proposing` patch is unresolved on this step right now. */
  proposing: boolean;
  insertedByFixer: boolean;
  rewritten: boolean;
  skipped: boolean;
}

export function buildPatchInfoByIndex(
  timeline: AutomationLiveEvent[],
): Record<number, StepPatchInfo> {
  const out: Record<number, StepPatchInfo> = {};
  const proposing = findUnresolvedProposing(timeline);

  for (const ev of timeline) {
    if (ev.type !== 'automation_run_patch') continue;
    const slot = (out[ev.stepIndex] ??= {
      proposing: false,
      insertedByFixer: false,
      rewritten: false,
      skipped: false,
    });
    if (ev.phase === 'applied') {
      if (ev.patchKind === 'insert_before') slot.insertedByFixer = true;
      if (ev.patchKind === 'replace_current') slot.rewritten = true;
      if (ev.patchKind === 'skip_current') slot.skipped = true;
    }
  }

  if (proposing) {
    const slot = (out[proposing.stepIndex] ??= {
      proposing: false,
      insertedByFixer: false,
      rewritten: false,
      skipped: false,
    });
    slot.proposing = true;
  }

  return out;
}

// ============================================================================
// Public API — derive the activity-bar state
// ============================================================================

/**
 * Decide what state the activity bar should be in. Precedence is
 * top-down — first match wins:
 *
 *   1. paused_for_user (most urgent — user must act)
 *   2. terminal states (completed, failed, cancelled)
 *   3. unresolved proposing patch (fixer is working)
 *   4. a step is currently 'running' (engine is executing)
 *   5. awaiting_integration (sub-case of running, different copy)
 *   6. idle
 */
export function deriveActivityState(input: DeriveInput): ActivityState {
  // 1. Paused for user takes priority over everything — the run is
  //    blocked on the human and they need to know.
  if (input.status === 'paused_for_user' && input.pauseRequest) {
    return {
      kind: 'paused-for-user',
      stepIndex: input.pauseRequest.stepIndex,
      reasoning: input.pauseRequest.reasoning,
      userInstructions: input.pauseRequest.userInstructions,
      failureMessage: input.pauseRequest.failureMessage,
      screenshotUrl: input.pauseRequest.screenshotUrl,
    };
  }

  // 2. Terminal states.
  if (input.status === 'completed') {
    return { kind: 'completed', summary: input.summary };
  }
  if (input.status === 'failed') {
    return { kind: 'failed', error: input.error };
  }
  if (input.status === 'cancelled') {
    return { kind: 'cancelled' };
  }

  // 3. Fixer is mid-flight on some step.
  const proposing = findUnresolvedProposing(input.timeline);
  if (proposing) {
    return {
      kind: 'fixing-step',
      stepIndex: proposing.stepIndex,
      attemptNumber: proposing.attemptNumber,
      failureMessage: proposing.failureMessage,
    };
  }

  // 4. A step is actively running.
  if (input.status === 'running') {
    const runningIndex = findRunningStepIndex(input.liveSteps);
    if (runningIndex != null) {
      return { kind: 'running-step', stepIndex: runningIndex };
    }
    // We're 'running' but no step has status='running' right now —
    // engine just emitted `completed` for step N and hasn't yet
    // emitted `running` for step N+1. Show the latest step we know
    // about (not stepIndex=0) so the bar tracks progress instead of
    // snapping back to the start.
    const latestKnown = findLatestKnownStepIndex(input.liveSteps);
    return { kind: 'running-step', stepIndex: latestKnown ?? 0 };
  }

  // 5. Awaiting an integration the user hasn't connected yet.
  if (input.status === 'awaiting_integration') {
    return { kind: 'awaiting-integration', service: input.awaitingService };
  }

  return { kind: 'idle' };
}

// Re-export the event types so consumers can import everything from
// this module without reaching back into `types/automation`.
export type { AutomationLiveEvent, AutomationRunPatchEvent, AutomationRunStepEvent };
