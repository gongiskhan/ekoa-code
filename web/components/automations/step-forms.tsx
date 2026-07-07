"use client";

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/stores/i18n';
import type {
  ApiCallBodyKind,
  ApiCallMethod,
  ApiCallSpec,
  EkoaActionSpec,
  LocalCommandSpec,
} from '@/types/automation';

const METHODS: ApiCallMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const BODY_KINDS: ApiCallBodyKind[] = ['none', 'json', 'text', 'form'];

// ===========================================================================
// local_command form
// ===========================================================================

export function LocalCommandForm({
  value,
  onChange,
}: {
  value: LocalCommandSpec | undefined;
  onChange: (spec: LocalCommandSpec) => void;
}) {
  const { automations } = useTranslation();
  const t = automations.forms;
  const v = value ?? { argv: [] };
  const [argvText, setArgvText] = useState(() => (v.argv ?? []).map(quoteArg).join(' '));

  useEffect(() => {
    // sync from external changes (planner produces a value, edit-in-place sets argvText)
    setArgvText((v.argv ?? []).map(quoteArg).join(' '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(v.argv)]);

  function commitArgv(text: string) {
    setArgvText(text);
    const argv = parseArgvLine(text);
    onChange({ ...v, argv });
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.commandLabel}</label>
        <input
          type="text"
          value={argvText}
          onChange={(e) => commitArgv(e.target.value)}
          placeholder='cat "~/Downloads/foo.txt"'
          className="w-full text-sm font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs">
          <label className="text-neutral-600">{t.cwd}</label>
          <input
            type="text"
            value={v.cwd ?? ''}
            onChange={(e) => onChange({ ...v, cwd: e.target.value || undefined })}
            placeholder={t.homePlaceholder}
            className="rounded border border-neutral-300 bg-white px-2 py-1 w-40 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-neutral-600">{t.timeoutMs}</label>
          <input
            type="number"
            value={v.timeoutMs ?? 300000}
            onChange={(e) => onChange({ ...v, timeoutMs: Number(e.target.value) })}
            min={1000}
            step={5000}
            className="rounded border border-neutral-300 bg-white px-2 py-1 w-28 focus:outline-none focus:ring-1 focus:ring-orange-500"
          />
        </div>
      </div>
    </div>
  );
}

function quoteArg(s: string): string {
  if (s === '' || /[\s"'\\]/.test(s)) {
    return JSON.stringify(s);
  }
  return s;
}

/**
 * Simple argv parser: respects double/single quotes and backslash escapes.
 * Not a full shell tokenizer — good enough for the human-editable input.
 */
function parseArgvLine(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur !== '') { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

// ===========================================================================
// api_call form
// ===========================================================================

export function ApiCallForm({
  value,
  onChange,
}: {
  value: ApiCallSpec | undefined;
  onChange: (spec: ApiCallSpec) => void;
}) {
  const { automations } = useTranslation();
  const t = automations.forms;
  const v: ApiCallSpec = value ?? { method: 'GET', url: '' };

  function headerEntries() {
    return Object.entries(v.headers ?? {});
  }

  function setHeader(key: string, val: string, oldKey?: string) {
    const next: Record<string, string> = { ...(v.headers ?? {}) };
    if (oldKey && oldKey !== key) delete next[oldKey];
    if (key) next[key] = val;
    onChange({ ...v, headers: next });
  }

  function removeHeader(key: string) {
    const next: Record<string, string> = { ...(v.headers ?? {}) };
    delete next[key];
    onChange({ ...v, headers: next });
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          value={v.method}
          onChange={(e) => onChange({ ...v, method: e.target.value as ApiCallMethod })}
          className="text-sm rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="text"
          value={v.url}
          onChange={(e) => onChange({ ...v, url: e.target.value })}
          placeholder="https://api.example.com/path?x={{input.x}}"
          className="flex-1 text-sm font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500 mb-1">{t.headers}</div>
        <div className="space-y-1">
          {headerEntries().map(([k, val], i) => (
            <div key={`${k}-${i}`} className="flex gap-1">
              <input
                type="text"
                value={k}
                onChange={(e) => setHeader(e.target.value, val, k)}
                placeholder={t.headerKeyPlaceholder}
                className="text-xs font-mono rounded border border-neutral-300 bg-white px-2 py-1 w-1/3"
              />
              <input
                type="text"
                value={val}
                onChange={(e) => setHeader(k, e.target.value)}
                placeholder={t.headerValuePlaceholder}
                className="text-xs font-mono rounded border border-neutral-300 bg-white px-2 py-1 flex-1"
              />
              <button type="button" onClick={() => removeHeader(k)} className="text-xs text-red-600 px-1">×</button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setHeader(`header-${Object.keys(v.headers ?? {}).length + 1}`, '')}
            className="text-xs text-blue-700 hover:underline"
          >
            {t.addHeader}
          </button>
        </div>
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.bodyKind}</label>
          <select
            value={v.bodyKind ?? 'none'}
            onChange={(e) => onChange({ ...v, bodyKind: e.target.value as ApiCallBodyKind })}
            className="text-sm rounded border border-neutral-300 bg-white px-2 py-1.5"
          >
            {BODY_KINDS.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.authIntegration}</label>
          <input
            type="text"
            value={v.authIntegrationKey ?? ''}
            onChange={(e) => onChange({ ...v, authIntegrationKey: e.target.value || undefined })}
            placeholder={t.authPlaceholder}
            className="text-sm font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 w-full"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.timeout}</label>
          <input
            type="number"
            value={v.timeoutMs ?? 30000}
            onChange={(e) => onChange({ ...v, timeoutMs: Number(e.target.value) })}
            min={1000}
            step={1000}
            className="text-sm rounded border border-neutral-300 bg-white px-2 py-1.5 w-28"
          />
        </div>
      </div>

      {(v.bodyKind ?? 'none') !== 'none' && (
        <div>
          <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.body}</label>
          <textarea
            value={v.body ?? ''}
            onChange={(e) => onChange({ ...v, body: e.target.value })}
            placeholder='{"key": "{{input.value}}"}'
            rows={4}
            className="w-full text-xs font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// ekoa_action form
// ===========================================================================

export function EkoaActionForm({
  value,
  onChange,
}: {
  value: EkoaActionSpec | undefined;
  onChange: (spec: EkoaActionSpec) => void;
}) {
  const { automations } = useTranslation();
  const t = automations.forms;
  const v: EkoaActionSpec = value ?? { artifactSlug: '', capabilityName: '', inputs: {} };
  const inputsJson = useMemo(() => JSON.stringify(v.inputs ?? {}, null, 2), [v.inputs]);
  const [inputsText, setInputsText] = useState(inputsJson);
  const [inputsErr, setInputsErr] = useState<string | null>(null);

  useEffect(() => { setInputsText(inputsJson); }, [inputsJson]);

  function commitInputs(text: string) {
    setInputsText(text);
    try {
      const parsed = JSON.parse(text || '{}') as Record<string, unknown>;
      setInputsErr(null);
      onChange({ ...v, inputs: parsed });
    } catch (err) {
      setInputsErr(err instanceof Error ? err.message : t.invalidJson);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.artifactSlug}</label>
          <input
            type="text"
            value={v.artifactSlug}
            onChange={(e) => onChange({ ...v, artifactSlug: e.target.value })}
            placeholder="my-crm"
            className="w-full text-sm font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
        <div className="flex-1">
          <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.capability}</label>
          <input
            type="text"
            value={v.capabilityName}
            onChange={(e) => onChange({ ...v, capabilityName: e.target.value })}
            placeholder="add_client"
            className="w-full text-sm font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
      <div>
        <label className="text-xs uppercase tracking-wide text-neutral-500 block mb-1">{t.inputsJson}</label>
        <textarea
          value={inputsText}
          onChange={(e) => commitInputs(e.target.value)}
          rows={5}
          className="w-full text-xs font-mono rounded border border-neutral-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
        {inputsErr && <div className="text-xs text-red-700 mt-1">{inputsErr}</div>}
      </div>
    </div>
  );
}
