"use client";

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';
import type { StepRecord } from '@/types/automation';

interface RunHistoryProps {
  automationId: string;
  /** Defaults to 50; the user scrolls/loads more from there. */
  initialLimit?: number;
}

const STATUS_TONES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-neutral-200 text-neutral-700',
  running: 'bg-amber-100 text-amber-800',
  awaiting_integration: 'bg-amber-100 text-amber-800',
};

const STEP_STATUS_TONES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-red-100 text-red-800',
  running: 'bg-amber-100 text-amber-800',
  skipped: 'bg-neutral-200 text-neutral-600',
  pending: 'bg-neutral-100 text-neutral-500',
};

export default function RunHistory({ automationId, initialLimit = 50 }: RunHistoryProps) {
  const runs = useAutomationsStore((s) => s.runs);
  const runsLoading = useAutomationsStore((s) => s.runsLoading);
  const fetchRuns = useAutomationsStore((s) => s.fetchRuns);
  const { automations } = useTranslation();
  const t = automations.runHistory;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchRuns(automationId, initialLimit);
  }, [automationId, initialLimit, fetchRuns]);

  if (runsLoading && runs.length === 0) {
    return <div className="text-sm text-neutral-500 p-4">{t.loading}</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="text-sm text-neutral-500 p-4">
        {t.empty}
      </div>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100">
      {runs.map((run) => {
        const end = run.finishedAt ?? run.endedAt;
        const dur = end
          ? Math.round((Date.parse(end) - Date.parse(run.startedAt)) / 1000)
          : null;
        const steps = run.steps ?? [];
        const stepCount = steps.length;
        const failedCount = steps.filter((s) => s.status === 'failed').length;
        const expanded = expandedId === run.id;
        return (
          <li key={run.id} className="text-sm">
            <button
              type="button"
              onClick={() => setExpandedId(expanded ? null : run.id)}
              aria-expanded={expanded}
              className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left hover:bg-neutral-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                {expanded ? (
                  <ChevronDown size={14} className="shrink-0 text-neutral-400" />
                ) : (
                  <ChevronRight size={14} className="shrink-0 text-neutral-400" />
                )}
                <span className="font-mono text-xs text-neutral-500 truncate">{run.id.slice(0, 8)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${STATUS_TONES[run.status] ?? 'bg-neutral-100 text-neutral-700'}`}>
                  {(t.status as Record<string, string>)[run.status] ?? run.status}
                </span>
                <span className="text-xs text-neutral-500">
                  {t.stepCount(stepCount)}
                  {failedCount > 0 && t.failedCount(failedCount)}
                </span>
              </div>
              <div className="text-xs text-neutral-500 whitespace-nowrap">
                {new Date(run.startedAt).toLocaleString()}
                {dur !== null && ` · ${dur}s`}
              </div>
            </button>
            {expanded && (
              <RunStepDetail steps={steps} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RunStepDetail({ steps }: { steps: StepRecord[] }) {
  const { automations } = useTranslation();
  const t = automations.runHistory;
  const stepStatus = automations.steps.status as Record<string, string>;

  if (steps.length === 0) {
    return <div className="px-3 pb-3 pl-9 text-xs text-neutral-500">{t.noSteps}</div>;
  }

  return (
    <ol className="px-3 pb-3 pl-9 space-y-2">
      {steps.map((step, i) => (
        <li key={step.stepId ?? i} className="border-l-2 border-neutral-100 pl-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-neutral-500">{t.stepLabel((step.index ?? i) + 1)}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${STEP_STATUS_TONES[step.status] ?? 'bg-neutral-100 text-neutral-600'}`}>
              {stepStatus[step.status] ?? step.status}
            </span>
            {typeof step.durationMs === 'number' && (
              <span className="text-xs text-neutral-400">{step.durationMs}ms</span>
            )}
          </div>
          {step.error?.message && (
            <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1 min-w-0 break-words line-clamp-3" title={step.error.message}>
              {step.error.message}
            </div>
          )}
          {step.screenshotUrl && (
            <a
              href={api.resolveUrl(step.screenshotUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full max-w-xs"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={api.resolveUrl(step.screenshotUrl)}
                alt={t.screenshotAlt((step.index ?? i) + 1)}
                className="max-h-40 w-auto object-contain rounded border border-neutral-200 hover:border-neutral-400 transition-colors"
                loading="lazy"
              />
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
