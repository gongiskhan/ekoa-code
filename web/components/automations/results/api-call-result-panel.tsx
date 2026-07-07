"use client";

import { useMemo, useState } from 'react';
import type { StepOutput } from '@/types/automation';

interface ApiCallResultPanelProps {
  output: Extract<StepOutput, { kind: 'api_call' }>;
}

export default function ApiCallResultPanel({ output }: ApiCallResultPanelProps) {
  const parsed = useMemo(() => {
    if (!output.responseBodyIsJson) return null;
    try {
      return JSON.parse(output.responseBody);
    } catch {
      return null;
    }
  }, [output.responseBody, output.responseBodyIsJson]);

  const [activeTab, setActiveTab] = useState<'body' | 'headers'>('body');
  const [bodyView, setBodyView] = useState<'preview' | 'raw'>('preview');

  const statusOk = output.status >= 200 && output.status < 300;

  return (
    <div className="space-y-3 mt-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`px-2 py-0.5 rounded-full font-medium ${
            statusOk ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
          }`}
        >
          {output.status} {output.statusText ?? ''}
        </span>
        <span className="text-neutral-500">{output.durationMs} ms</span>
        {output.truncated && (
          <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-medium">truncated</span>
        )}
      </div>

      <div className="border-b border-neutral-200 flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={() => setActiveTab('body')}
          className={`pb-1.5 -mb-px border-b-2 ${
            activeTab === 'body' ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-neutral-500'
          }`}
        >
          Body
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('headers')}
          className={`pb-1.5 -mb-px border-b-2 ${
            activeTab === 'headers' ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-neutral-500'
          }`}
        >
          Headers ({Object.keys(output.responseHeaders).length})
        </button>
      </div>

      {activeTab === 'body' && (
        <div className="space-y-2">
          {parsed !== null && (
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setBodyView('preview')}
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  bodyView === 'preview' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setBodyView('raw')}
                className={`text-[11px] px-2 py-0.5 rounded border ${
                  bodyView === 'raw' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-neutral-300 text-neutral-600'
                }`}
              >
                Raw
              </button>
            </div>
          )}

          {parsed !== null && bodyView === 'preview' ? (
            <JsonTree value={parsed} depth={0} />
          ) : (
            <pre className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs font-mono overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap break-words">
              {output.responseBody || '(empty body)'}
            </pre>
          )}
        </div>
      )}

      {activeTab === 'headers' && (
        <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs font-mono max-h-64 overflow-y-auto">
          {Object.entries(output.responseHeaders).map(([k, v]) => (
            <div key={k} className="flex gap-2 break-all">
              <span className="text-neutral-500">{k}:</span>
              <span className="text-neutral-800">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JsonTree({ value, depth }: { value: unknown; depth: number }) {
  if (value === null) return <span className="text-neutral-400">null</span>;
  if (typeof value === 'boolean') return <span className="text-purple-600">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-blue-700">{value}</span>;
  if (typeof value === 'string') return <span className="text-emerald-700">&quot;{value}&quot;</span>;
  if (Array.isArray(value)) return <ArrayNode value={value} depth={depth} />;
  if (typeof value === 'object') return <ObjectNode value={value as Record<string, unknown>} depth={depth} />;
  return <span>{String(value)}</span>;
}

function ArrayNode({ value, depth }: { value: unknown[]; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  if (value.length === 0) return <span className="text-neutral-400">[]</span>;
  return (
    <div className="font-mono text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-neutral-500 hover:text-neutral-700">
        {open ? '▾' : '▸'} [{value.length}]
      </button>
      {open && (
        <div className="pl-4 border-l border-neutral-200 ml-1 mt-0.5">
          {value.map((v, i) => (
            <div key={i} className="flex gap-1">
              <span className="text-neutral-400">{i}:</span>
              <JsonTree value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ObjectNode({ value, depth }: { value: Record<string, unknown>; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const keys = Object.keys(value);
  if (keys.length === 0) return <span className="text-neutral-400">{'{}'}</span>;
  return (
    <div className="font-mono text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-neutral-500 hover:text-neutral-700">
        {open ? '▾' : '▸'} {'{'}{keys.length}{'}'}
      </button>
      {open && (
        <div className="pl-4 border-l border-neutral-200 ml-1 mt-0.5">
          {keys.map((k) => (
            <div key={k} className="flex gap-1">
              <span className="text-blue-700">&quot;{k}&quot;:</span>
              <JsonTree value={value[k]} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
