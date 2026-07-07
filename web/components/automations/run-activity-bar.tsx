"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Hand,
  Play,
  Square,
  Wand2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Spinner } from '@/components/ui/spinner';
import {
  buildPatchInfoByIndex,
  deriveActivityState,
  findRecentResolution,
  type ActivityState,
  type RecentResolution,
} from '@/lib/automations/activity-state';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';
import type { Step } from '@/types/automation';

interface RunActivityBarProps {
  /** The editor's current step list — the bar uses it to render
   *  step descriptions. We don't read from `current` because the
   *  user might be editing in real time. */
  steps: Step[];
  /** Restricts the bar to a single automation id. The bar lives in the
   *  editor for one automation; runs from other automations should not
   *  bleed into this view (the store also filters by traceId, but the
   *  automationId guard is cleaner). */
  scopedAutomationId: string;
}

const APPLIED_TTL_MS = 5_000;
const COMPLETED_AUTODISMISS_MS = 6_000;
const CANCELLED_AUTODISMISS_MS = 4_000;

export default function RunActivityBar({ steps, scopedAutomationId }: RunActivityBarProps) {
  const status = useAutomationsStore((s) => s.activeRun.status);
  const automationId = useAutomationsStore((s) => s.activeRun.automationId);
  const liveSteps = useAutomationsStore((s) => s.activeRun.liveSteps);
  const timeline = useAutomationsStore((s) => s.activeRun.timeline);
  const pauseRequest = useAutomationsStore((s) => s.activeRun.pauseRequest);
  const awaitingService = useAutomationsStore((s) => s.activeRun.awaitingService);
  const summary = useAutomationsStore((s) => s.activeRun.summary);
  const error = useAutomationsStore((s) => s.activeRun.error);
  const cancel = useAutomationsStore((s) => s.cancel);
  const resume = useAutomationsStore((s) => s.resume);

  // Track arrival timestamps for the resolution TTL. We can't use the
  // event's own timestamp (the wire format doesn't carry one), so we
  // record `Date.now()` for each event index when we first see it.
  const [arrivalByIndex, setArrivalByIndex] = useState<number[]>([]);
  useEffect(() => {
    setArrivalByIndex((prev) => {
      if (timeline.length === prev.length) return prev;
      const next = prev.slice();
      const now = Date.now();
      while (next.length < timeline.length) next.push(now);
      // If timeline shrunk (run reset), trim.
      if (next.length > timeline.length) next.length = timeline.length;
      return next;
    });
  }, [timeline.length]);

  // Tick state — bumped by setTimeout to expire the `applied` TTL and
  // the auto-dismiss windows for terminal states. A pure memo can't
  // expire on its own.
  const [tick, setTick] = useState(0);

  // Bar is hidden if the active run isn't for this automation.
  const ownsRun = automationId === scopedAutomationId;

  const state: ActivityState = useMemo(
    () => {
      if (!ownsRun) return { kind: 'idle' };
      return deriveActivityState({
        status: status as Parameters<typeof deriveActivityState>[0]['status'],
        liveSteps,
        timeline,
        pauseRequest,
        awaitingService,
        summary,
        error,
      });
    },
    [ownsRun, status, liveSteps, timeline, pauseRequest, awaitingService, summary, error],
  );

  const resolution: RecentResolution | null = useMemo(
    () => {
      if (!ownsRun) return null;
      return findRecentResolution(
        timeline,
        status as Parameters<typeof findRecentResolution>[1],
        arrivalByIndex,
        Date.now(),
        APPLIED_TTL_MS,
      );
    },
    // tick is intentionally a dep so the resolution disappears on TTL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ownsRun, timeline, status, arrivalByIndex, tick],
  );

  // Schedule TTL expiry for `applied` resolutions and auto-dismiss for
  // terminal states.
  useEffect(() => {
    if (resolution && !resolution.sticky) {
      const remaining = APPLIED_TTL_MS - (Date.now() - resolution.arrivedAt);
      if (remaining > 0) {
        const id = setTimeout(() => setTick((t) => t + 1), remaining + 50);
        return () => clearTimeout(id);
      }
    }
    return undefined;
  }, [resolution]);

  const [autoHidden, setAutoHidden] = useState<'completed' | 'cancelled' | null>(null);
  useEffect(() => {
    setAutoHidden(null); // any state change resets the auto-hide
    if (state.kind === 'completed') {
      const id = setTimeout(() => setAutoHidden('completed'), COMPLETED_AUTODISMISS_MS);
      return () => clearTimeout(id);
    }
    if (state.kind === 'cancelled') {
      const id = setTimeout(() => setAutoHidden('cancelled'), CANCELLED_AUTODISMISS_MS);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [state.kind]);

  // Don't render when idle or when an auto-hide kicked in for a
  // terminal state.
  if (state.kind === 'idle') return null;
  if (state.kind === 'completed' && autoHidden === 'completed') return null;
  if (state.kind === 'cancelled' && autoHidden === 'cancelled') return null;

  return (
    <ActivityBarShell state={state} resolution={resolution} steps={steps} cancel={cancel} resume={resume} />
  );
}

// ============================================================================
// Visual layer
// ============================================================================

function ActivityBarShell({
  state,
  resolution,
  steps,
  cancel,
  resume,
}: {
  state: ActivityState;
  resolution: RecentResolution | null;
  steps: Step[];
  cancel: () => void;
  resume: () => void;
}) {
  const { automations } = useTranslation();
  const t = automations.runActivityBar;

  if (state.kind === 'paused-for-user') {
    return <PausedBar state={state} resume={resume} cancel={cancel} />;
  }

  if (state.kind === 'fixing-step') {
    return (
      <BarWrapper containerClass="border-violet-300 bg-violet-50 text-violet-900">
        <Wand2 size={16} className="shrink-0 text-violet-700 animate-pulse" />
        <Headline>
          {t.fixingStepLabel(state.stepIndex + 1)}
          {state.attemptNumber ? t.attemptSuffix(state.attemptNumber) : ''}…
          <span className="font-normal text-violet-800/85">
            {t.fixingAsking}
          </span>
        </Headline>
        {state.failureMessage && <Subline tone="violet">{t.whatFailed(state.failureMessage)}</Subline>}
        <ResolutionLine resolution={resolution} />
        <button
          type="button"
          onClick={cancel}
          className="ml-auto text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 shrink-0"
        >
          <Square size={12} className="inline -mt-0.5 mr-1" />{t.cancel}
        </button>
      </BarWrapper>
    );
  }

  if (state.kind === 'running-step') {
    const step = steps[state.stepIndex];
    return (
      <BarWrapper containerClass="border-amber-200 bg-amber-50 text-amber-900">
        <Spinner size="sm" className="shrink-0 text-amber-700" />
        <Headline>
          {t.stepLabel(state.stepIndex + 1)}
          {step?.description ? `: ` : ''}
          <span className="font-normal text-amber-800/90 line-clamp-1">
            {step?.description ?? ''}
          </span>
        </Headline>
        <ResolutionLine resolution={resolution} />
        <button
          type="button"
          onClick={cancel}
          className="ml-auto text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50 shrink-0"
        >
          <Square size={12} className="inline -mt-0.5 mr-1" />{t.cancel}
        </button>
      </BarWrapper>
    );
  }

  if (state.kind === 'awaiting-integration') {
    return (
      <BarWrapper containerClass="border-amber-200 bg-amber-50 text-amber-900">
        <Spinner size="sm" className="shrink-0 text-amber-700" />
        <Headline>
          {t.waitingPrefix}<strong>{state.service ?? t.integrationFallback}</strong>{t.waitingSuffix}
        </Headline>
      </BarWrapper>
    );
  }

  if (state.kind === 'completed') {
    return (
      <BarWrapper containerClass="border-emerald-200 bg-emerald-50 text-emerald-900">
        <CheckCircle2 size={16} className="shrink-0 text-emerald-700" />
        <Headline>
          {t.runComplete}{state.summary ? ` - ${state.summary}` : ''}
        </Headline>
      </BarWrapper>
    );
  }

  if (state.kind === 'failed') {
    return (
      <BarWrapper containerClass="border-red-300 bg-red-50 text-red-900">
        <AlertTriangle size={16} className="shrink-0 text-red-700" />
        <Headline>
          {t.runFailed}{state.error ? ` - ${state.error}` : ''}
        </Headline>
      </BarWrapper>
    );
  }

  // cancelled
  return (
    <BarWrapper containerClass="border-neutral-300 bg-neutral-50 text-neutral-700">
      <Square size={16} className="shrink-0 text-neutral-600" />
      <Headline>{t.runCancelled}</Headline>
    </BarWrapper>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function BarWrapper({
  children,
  containerClass,
}: {
  children: React.ReactNode;
  containerClass: string;
}) {
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded border text-sm ${containerClass}`}>
      {children}
    </div>
  );
}

function Headline({ children }: { children: React.ReactNode }) {
  return <div className="font-medium min-w-0 flex-1">{children}</div>;
}

function Subline({ children, tone }: { children: React.ReactNode; tone: 'violet' | 'amber' | 'red' }) {
  const cls =
    tone === 'violet'
      ? 'text-violet-800/85'
      : tone === 'amber'
        ? 'text-amber-800/85'
        : 'text-red-800/85';
  return <div className={`mt-0.5 text-xs ${cls} line-clamp-1 min-w-0`}>{children}</div>;
}

function ResolutionLine({ resolution }: { resolution: RecentResolution | null }) {
  const { automations } = useTranslation();
  const t = automations.runActivityBar;
  if (!resolution) return null;
  if (resolution.patchKind === 'abort') {
    return (
      <Subline tone="red">
        {t.fixerAbortedOnStep(resolution.stepIndex + 1)}: {resolution.reasoning}
      </Subline>
    );
  }
  const verb =
    resolution.patchKind === 'insert_before'
      ? t.verbInsertedBefore
      : resolution.patchKind === 'replace_current'
        ? t.verbRewrote
        : resolution.patchKind === 'skip_current'
          ? t.verbSkipped
          : t.verbPatched;
  return (
    <Subline tone="violet">
      {t.verbStep(verb, resolution.stepIndex + 1)}
      {resolution.newStepDescription ? ` → ${resolution.newStepDescription}` : ''}
    </Subline>
  );
}

function PausedBar({
  state,
  resume,
  cancel,
}: {
  state: Extract<ActivityState, { kind: 'paused-for-user' }>;
  resume: () => void;
  cancel: () => void;
}) {
  const { automations } = useTranslation();
  const t = automations.runActivityBar;
  return (
    <div className="rounded border-2 border-cyan-500 ring-2 ring-cyan-200/60 bg-cyan-50">
      <div className="flex items-start gap-3 p-3">
        <div className="rounded-full bg-cyan-200 p-1.5 shrink-0">
          <Hand size={16} className="text-cyan-900" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-cyan-950">
            {t.needsYouOnStep(state.stepIndex + 1)}
          </div>
          <div className="mt-0.5 text-sm text-cyan-900 leading-snug">
            {state.userInstructions}
          </div>
          {state.reasoning && (
            <div className="mt-0.5 text-xs italic text-cyan-800/85 line-clamp-2">{state.reasoning}</div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={resume}
            autoFocus
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded bg-cyan-600 text-white hover:bg-cyan-700 font-medium"
          >
            <Play size={14} />
            {t.continue}
          </button>
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1 text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
          >
            <Square size={14} />
            {t.stopRun}
          </button>
        </div>
      </div>
    </div>
  );
}
