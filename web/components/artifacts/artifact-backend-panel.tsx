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
import {
  getArtifactBackendStatus, getArtifactBackendLogs, getArtifactBackendInvocations,
  setArtifactBackendEnabled, runArtifactBackendSample,
  type ArtifactBackendStatusResponse, type BackendInvocation, type BackendLogEntry, type BackendInvokeResult,
} from '@/lib/api/client';

const STATE_LABEL: Record<ArtifactBackendStatusResponse['status']['state'], string> = {
  idle: 'Inativo',
  running: 'Em execução',
  crashed: 'Erro',
  stopped: 'Parado',
  disabled: 'Desativado',
};

const STATE_TONE: Record<ArtifactBackendStatusResponse['status']['state'], string> = {
  idle: 'bg-neutral-100 text-neutral-600',
  running: 'bg-teal-100 text-teal-700',
  crashed: 'bg-red-100 text-red-700',
  stopped: 'bg-neutral-100 text-neutral-500',
  disabled: 'bg-amber-100 text-amber-700',
};

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
  const [resp, setResp] = useState<ArtifactBackendStatusResponse | null>(null);
  const [invocations, setInvocations] = useState<BackendInvocation[]>([]);
  const [logs, setLogs] = useState<BackendLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sampleResult, setSampleResult] = useState<BackendInvokeResult | null>(null);

  const load = useCallback(async () => {
    const [s, inv, lg] = await Promise.all([
      getArtifactBackendStatus(appId),
      getArtifactBackendInvocations(appId, 20),
      getArtifactBackendLogs(appId, 50),
    ]);
    if (s.success && s.data) { setResp(s.data); setError(null); }
    else setError(s.error?.message ?? 'Não foi possível carregar o backend.');
    if (inv.success && inv.data) setInvocations(inv.data.invocations);
    if (lg.success && lg.data) setLogs(lg.data.logs);
  }, [appId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = await getArtifactBackendStatus(appId);
      if (cancelled) return;
      if (s.success && s.data) {
        setResp(s.data);
        setError(null);
        if (s.data.hasBackend) {
          const [inv, lg] = await Promise.all([getArtifactBackendInvocations(appId, 20), getArtifactBackendLogs(appId, 50)]);
          if (!cancelled) {
            if (inv.success && inv.data) setInvocations(inv.data.invocations);
            if (lg.success && lg.data) setLogs(lg.data.logs);
          }
        }
      } else {
        setError(s.error?.message ?? 'Não foi possível carregar o backend.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [appId]);

  const onToggleEnabled = useCallback(async () => {
    if (!resp) return;
    setBusy('toggle'); setError(null);
    const next = !resp.status.enabled;
    const res = await setArtifactBackendEnabled(appId, next);
    if (res.success) await load();
    else setError(res.error?.message ?? 'Não foi possível alterar o estado.');
    setBusy(null);
  }, [appId, resp, load]);

  const onRunSample = useCallback(async () => {
    if (!resp?.declared) return;
    setBusy('sample'); setError(null); setSampleResult(null);
    const entrypoint = resp.declared.handlers[0];
    const res = await runArtifactBackendSample(appId, entrypoint, { sample: true, subject: 'Exemplo' });
    if (res.success && res.data) { setSampleResult(res.data.result); await load(); }
    else setError(res.error?.message ?? 'Não foi possível executar a simulação.');
    setBusy(null);
  }, [appId, resp, load]);

  return (
    <section data-testid="artifact-backend-panel" className="rounded-xl border border-neutral-200 bg-white p-5">
      <header className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-teal-600" aria-hidden />
          <h3 className="text-base font-semibold text-neutral-900">Código de servidor (backend)</h3>
        </div>
        {resp?.hasBackend && (
          <span
            data-testid="backend-state"
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATE_TONE[resp.status.state]}`}
          >
            {STATE_LABEL[resp.status.state]}
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
      ) : !resp?.hasBackend ? (
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
              Ponto de entrada <code className="rounded bg-neutral-100 px-1">{resp.declared?.entryPoint}</code>
              {' · '}
              <span data-testid="backend-handlers">funções: {resp.declared?.handlers.join(', ')}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                data-testid="backend-toggle" onClick={onToggleEnabled} disabled={busy === 'toggle'}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {busy === 'toggle' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                {resp.status.enabled ? 'Desativar' : 'Ativar'}
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

          {resp.status.lastError && (
            <p data-testid="backend-last-error" className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              Último erro: {resp.status.lastError}
            </p>
          )}

          {/* Dry-run result */}
          {sampleResult && (
            <div data-testid="backend-sample-result" className="mb-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
              <p className="text-sm font-medium text-neutral-800 mb-1">
                Simulação {sampleResult.ok ? 'concluída' : 'falhou'} — nada foi gravado.
              </p>
              {sampleResult.error && <p className="text-sm text-red-700">{sampleResult.error}</p>}
              {(sampleResult.dryRunEffects ?? []).length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm text-neutral-600">
                  {sampleResult.dryRunEffects!.map((e, i) => (
                    <li key={i}>Numa execução real, teria {EFFECT_LABEL[e.capability] ?? e.capability}.</li>
                  ))}
                </ul>
              )}
            </div>
          )}

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
                {invocations.map((inv) => (
                  <li key={inv.invokeId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium text-neutral-800">{inv.entrypoint}</span>
                      <span className="text-neutral-400"> · {fmtTime(inv.startedAt)} · {Math.round(inv.durationMs)}ms</span>
                      {inv.dryRun && <span className="ml-1.5 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">simulação</span>}
                    </span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${inv.ok ? 'bg-teal-100 text-teal-700' : 'bg-red-100 text-red-700'}`}>
                      {inv.ok ? 'OK' : 'erro'}
                    </span>
                  </li>
                ))}
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
                {logs.map((l) => `${fmtTime(l.at)} [${l.level}] ${l.msg}`).join('\n')}
              </pre>
            )}
          </div>
        </>
      )}
    </section>
  );
}
