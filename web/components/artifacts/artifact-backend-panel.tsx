'use client';

/**
 * "Código de servidor (backend)" — the per-artifact Layer-2 backend panel.
 *
 * Shows the artifact's server-side backend at a glance: status (ativo / inativo
 * / em execução / parado / erro), the declared handlers, core-captured logs,
 * recent invocations + outcomes, the last error, an enable/disable switch, and a
 * TRUE dry-run "executar simulação" (no data written, no email, no persisted
 * notifications — the LLM still runs so you see the real decision).
 *
 * Inbox / event-source config does NOT live here — that is the Automations area.
 * All copy is PT-PT, no emoji.
 */

import { useCallback, useEffect, useState } from 'react';
import { Server, AlertTriangle, Loader2, Play, Power, RefreshCw, ScrollText } from 'lucide-react';
import { api, tryCall } from '@/lib/api';
import type { BackendStatus, BackendInvocation, BackendLogEntry, BackendSampleRunResponse } from '@ekoa/shared';

const STATE_LABEL: Record<string, string> = {
  idle: 'Inativo',
  running: 'Em execução',
  crashed: 'Erro',
  stopped: 'Parado',
  disabled: 'Desativado',
};

const STATE_TONE: Record<string, string> = {
  idle: 'bg-neutral-100 text-neutral-600',
  running: 'bg-teal-100 text-teal-700',
  crashed: 'bg-red-100 text-red-700',
  stopped: 'bg-neutral-100 text-neutral-500',
  disabled: 'bg-amber-100 text-amber-700',
};

// The backend status flattened in the v1 contract (`status` is the state string;
// declared handlers + the enabled flag + last error ride the schema passthrough).
interface UiBackend {
  hasBackend: boolean;
  state: string;
  enabled: boolean;
  lastError?: string;
  entryPoint?: string;
  handlers: string[];
}
function normalizeBackend(resp: BackendStatus | null): UiBackend | null {
  if (!resp) return null;
  const extra = resp as { enabled?: boolean; lastError?: string };
  const declared = resp.declared as { entryPoint?: string; handlers?: string[] } | null;
  return {
    hasBackend: resp.hasBackend,
    state: resp.status,
    enabled: extra.enabled ?? resp.status !== 'disabled',
    lastError: extra.lastError,
    entryPoint: declared?.entryPoint,
    handlers: declared?.handlers ?? [],
  };
}
function invocationOk(inv: BackendInvocation): boolean {
  return (inv as { ok?: boolean }).ok ?? inv.status === 'ok';
}

const EFFECT_LABEL: Record<string, string> = {
  'appData.create': 'gravado um registo',
  'appData.update': 'atualizado um registo',
  'appData.delete': 'apagado um registo',
  'notify.inApp': 'enviada uma notificação',
  'notify.email': 'enviado um email',
};

function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function ArtifactBackendPanel({ appId }: { appId: string }) {
  const [resp, setResp] = useState<BackendStatus | null>(null);
  const [invocations, setInvocations] = useState<BackendInvocation[]>([]);
  const [logs, setLogs] = useState<BackendLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleResult, setSampleResult] = useState<BackendSampleRunResponse | null>(null);

  const be = normalizeBackend(resp);

  const load = useCallback(async () => {
    const [s, inv, lg] = await Promise.all([
      tryCall(() => api.artifacts.backendStatus({ id: appId })),
      tryCall(() => api.artifacts.backendInvocations({ id: appId, limit: 20 })),
      tryCall(() => api.artifacts.backendLogs({ id: appId, limit: 50 })),
    ]);
    if (s.ok) { setResp(s.data); setError(null); }
    else setError(s.error.message ?? 'Não foi possível carregar o backend.');
    if (inv.ok) setInvocations(inv.data.items);
    if (lg.ok) setLogs(lg.data.items);
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await tryCall(() => api.artifacts.backendStatus({ id: appId }));
      if (cancelled) return;
      if (s.ok) {
        setResp(s.data);
        setError(null);
        if (s.data.hasBackend) {
          const [inv, lg] = await Promise.all([
            tryCall(() => api.artifacts.backendInvocations({ id: appId, limit: 20 })),
            tryCall(() => api.artifacts.backendLogs({ id: appId, limit: 50 })),
          ]);
          if (!cancelled) {
            if (inv.ok) setInvocations(inv.data.items);
            if (lg.ok) setLogs(lg.data.items);
          }
        }
      } else {
        setError(s.error.message ?? 'Não foi possível carregar o backend.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [appId]);

  const onToggleEnabled = useCallback(async () => {
    const current = normalizeBackend(resp);
    if (!current) return;
    setBusy('toggle'); setError(null);
    const next = !current.enabled;
    const res = await tryCall(() => api.artifacts.backendSetEnabled({ id: appId, enabled: next }));
    if (res.ok) await load();
    else setError(res.error.message ?? 'Não foi possível alterar o estado.');
    setBusy(null);
  }, [appId, resp, load]);

  const onRunSample = useCallback(async () => {
    const current = normalizeBackend(resp);
    if (!current?.handlers.length) return;
    setBusy('sample'); setError(null); setSampleResult(null);
    const entrypoint = current.handlers[0];
    const res = await tryCall(() => api.artifacts.backendSampleRun({
      id: appId, entrypoint, input: { sample: true, subject: 'Exemplo' },
    }));
    if (res.ok) { setSampleResult(res.data); await load(); }
    else setError(res.error.message ?? 'Não foi possível executar a simulação.');
    setBusy(null);
  }, [appId, resp, load]);

  return (
    <section data-testid="artifact-backend-panel" className="rounded-xl border border-neutral-200 bg-white p-5">
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-teal-600" aria-hidden />
          <h3 className="text-base font-semibold text-neutral-900">Código de servidor (backend)</h3>
        </div>
        {be?.hasBackend && (
          <span
            data-testid="backend-state"
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATE_TONE[be.state] ?? STATE_TONE.idle}`}
          >
            {STATE_LABEL[be.state] ?? be.state}
          </span>
        )}
      </header>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden /> <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> A carregar…</p>
      ) : !be?.hasBackend ? (
        <p data-testid="backend-none" className="text-sm text-neutral-500">
          Esta aplicação não tem código de servidor. Um backend é código versionado com a aplicação
          (pasta <code className="rounded bg-neutral-100 px-1">backend/</code>) que o Ekoa executa em
          resposta a eventos. Os eventos (por exemplo, vigiar uma caixa de correio) configuram-se em
          Automações.
        </p>
      ) : (
        <>
          {/* Declared handlers + controls */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-neutral-600">
              Ponto de entrada <code className="rounded bg-neutral-100 px-1">{be?.entryPoint}</code>
              {' · '}
              <span data-testid="backend-handlers">funções: {be?.handlers.join(', ')}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                data-testid="backend-toggle" onClick={onToggleEnabled} disabled={busy === 'toggle'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {busy === 'toggle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                {be?.enabled ? 'Desativar' : 'Ativar'}
              </button>
              <button
                data-testid="backend-run-sample" onClick={onRunSample} disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                title="Executa o backend com dados de exemplo sem gravar nada"
              >
                {busy === 'sample' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Executar simulação (não grava dados)
              </button>
            </div>
          </div>

          {be?.lastError && (
            <p data-testid="backend-last-error" className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              Último erro: {be.lastError}
            </p>
          )}

          {/* Dry-run result */}
          {sampleResult && (() => {
            const sok = (sampleResult as { ok?: boolean }).ok ?? true;
            const serr = (sampleResult as { error?: string }).error;
            const effects = sampleResult.dryRunEffects ?? [];
            return (
            <div data-testid="backend-sample-result" className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-medium text-neutral-800 mb-1">
                Simulação {sok ? 'concluída' : 'falhou'} — nada foi gravado.
              </p>
              {serr && <p className="text-sm text-red-700">{serr}</p>}
              {effects.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm text-neutral-600">
                  {effects.map((e, i) => {
                    const capability = String((e as { capability?: string }).capability ?? '');
                    return (
                      <li key={i}>Numa execução real, teria {EFFECT_LABEL[capability] ?? capability}.</li>
                    );
                  })}
                </ul>
              )}
            </div>
            );
          })()}

          {/* Recent invocations */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-medium text-neutral-700">Execuções recentes</h4>
              <button onClick={load} className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800" aria-label="Atualizar">
                <RefreshCw className="h-3.5 w-3.5" /> Atualizar
              </button>
            </div>
            {invocations.length === 0 ? (
              <p data-testid="backend-no-invocations" className="text-sm text-neutral-400">Ainda não houve execuções.</p>
            ) : (
              <ul data-testid="backend-invocations" className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
                {invocations.map((inv) => {
                  const ok = invocationOk(inv);
                  const dryRun = (inv as { dryRun?: boolean }).dryRun;
                  return (
                  <li key={inv.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-neutral-800">{inv.entrypoint}</span>
                      <span className="text-neutral-400"> · {fmtTime(inv.at)} · {Math.round(inv.durationMs ?? 0)}ms</span>
                      {dryRun && <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">simulação</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ok ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                      {ok ? 'OK' : 'erro'}
                    </span>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Recent logs */}
          <div>
            <h4 className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 mb-2">
              <ScrollText className="h-4 w-4 text-neutral-400" /> Registos
            </h4>
            {logs.length === 0 ? (
              <p className="text-sm text-neutral-400">Sem registos.</p>
            ) : (
              <pre data-testid="backend-logs" className="max-h-48 overflow-auto rounded-lg bg-neutral-900 p-3 text-xs text-neutral-100">
                {logs.map((l) => `${fmtTime(l.at)} [${l.level ?? 'info'}] ${l.message}`).join('\n')}
              </pre>
            )}
          </div>
        </>
      )}
    </section>
  );
}
