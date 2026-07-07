"use client";

import { useEffect } from 'react';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';

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

export default function RunHistory({ automationId, initialLimit = 50 }: RunHistoryProps) {
  const runs = useAutomationsStore((s) => s.runs);
  const runsLoading = useAutomationsStore((s) => s.runsLoading);
  const fetchRuns = useAutomationsStore((s) => s.fetchRuns);
  const { automations } = useTranslation();
  const t = automations.runHistory;

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
        const dur = run.endedAt
          ? Math.round((Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)
          : null;
        const stepCount = run.steps?.length ?? 0;
        const failedCount = run.steps?.filter((s) => s.status === 'failed').length ?? 0;
        return (
          <li key={run.id} className="px-3 py-2 flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
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
          </li>
        );
      })}
    </ul>
  );
}
