"use client";

import { useState } from 'react';
import type { StepOutput } from '@/types/automation';

interface EkoaActionResultPanelProps {
  output: Extract<StepOutput, { kind: 'ekoa_action' }>;
}

export default function EkoaActionResultPanel({ output }: EkoaActionResultPanelProps) {
  const [showTrace, setShowTrace] = useState(false);
  const hasFailed = output.trace.some((t) => t.status === 'failed');

  return (
    <div className="space-y-3 mt-2">
      <div className="flex items-center gap-2 text-xs">
        <span
          className={`px-2 py-0.5 rounded-full font-medium ${
            hasFailed ? 'bg-red-100 text-red-900' : 'bg-emerald-100 text-emerald-900'
          }`}
        >
          {hasFailed ? 'failed' : 'completed'}
        </span>
        <span className="text-neutral-500">{output.durationMs} ms</span>
        <span className="text-neutral-500">{output.trace.length} ops</span>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded p-3 text-sm text-emerald-900">
        {output.result}
      </div>

      <button
        type="button"
        onClick={() => setShowTrace((v) => !v)}
        className="text-xs text-neutral-500 hover:text-neutral-700 underline-offset-2 hover:underline"
      >
        {showTrace ? 'Hide' : 'Show'} primitive trace ({output.trace.length} ops)
      </button>

      {showTrace && (
        <div className="border border-neutral-200 rounded divide-y divide-neutral-100 text-xs">
          {output.trace.map((t, i) => (
            <div key={i} className={`px-3 py-2 ${t.status === 'failed' ? 'bg-red-50' : ''}`}>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-neutral-500">{i + 1}.</span>
                <span className="font-mono text-emerald-700">{t.op}</span>
                <span className="text-neutral-700">{t.summary}</span>
                <span className="ml-auto text-neutral-400">{t.durationMs}ms</span>
              </div>
              {t.error && <div className="ml-6 mt-1 text-red-700">{t.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
