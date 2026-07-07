"use client";

import type { StepOutput } from '@/types/automation';

interface LocalCommandResultPanelProps {
  output: Extract<StepOutput, { kind: 'local_command' }>;
  liveChunks?: { stdout: string; stderr: string };
}

export default function LocalCommandResultPanel({ output, liveChunks }: LocalCommandResultPanelProps) {
  const stdout = liveChunks?.stdout || output.stdout;
  const stderr = liveChunks?.stderr || output.stderr;

  return (
    <div className="space-y-3 mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`px-2 py-0.5 rounded-full font-medium ${
            output.exitCode === 0
              ? 'bg-emerald-100 text-emerald-900'
              : output.exitCode === null
              ? 'bg-neutral-100 text-neutral-700'
              : 'bg-red-100 text-red-900'
          }`}
        >
          exit {output.exitCode ?? '?'}
        </span>
        <span className="text-neutral-500">{output.durationMs} ms</span>
        {output.truncated && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-medium">truncated</span>
        )}
        {output.timedOut && (
          <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-900 font-medium">timed out</span>
        )}
      </div>

      {stdout && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">stdout</div>
          <pre className="bg-neutral-900 text-neutral-100 rounded p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
            {stdout}
          </pre>
        </div>
      )}

      {stderr && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-red-700 mb-1">stderr</div>
          <pre className="bg-red-950 text-red-100 rounded p-3 text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words">
            {stderr}
          </pre>
        </div>
      )}

      {!stdout && !stderr && (
        <div className="text-xs text-neutral-500 italic">(no output)</div>
      )}
    </div>
  );
}
