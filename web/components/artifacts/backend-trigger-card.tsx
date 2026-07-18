'use client';

/**
 * "Ligações" — wires an artifact's Layer-2 backend handler to a real event
 * source (a watched mailbox). For each declared handler (e.g. onEmail) the card
 * lets the owner pick one of the CONNECTED platform mailboxes (Microsoft 365 /
 * Google Workspace) and create an `ekoa.triggers` listener that invokes the
 * backend on every new email — the exact precedent the live ERP uses.
 *
 * Self-contained: it fetches connected providers + existing triggers itself and
 * only renders when the artifact exposes backend handlers. PT-PT, no emoji.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link2, Loader2, AlertTriangle, Trash2, Mail, Plus } from 'lucide-react';
import { api, tryCall } from '@/lib/api';
import type { Trigger } from '@ekoa/shared';

const PROVIDER_LABEL: Record<string, string> = {
  'microsoft-365': 'Microsoft 365',
  'google-workspace': 'Google Workspace',
};

const HANDLER_LABEL: Record<string, string> = {
  onEmail: 'Novo email na caixa de correio',
  onMessage: 'Nova mensagem recebida',
};

export function BackendTriggerCard({ artifactId, handlers }: { artifactId: string; handlers: string[] }) {
  const [providers, setProviders] = useState<string[]>([]); // integrationKeys of connected mailboxes
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({}); // handler -> integrationKey
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [platRes, trigRes] = await Promise.all([
      tryCall(() => api.platformIntegrations.list()),
      tryCall(() => api.triggers.list()),
    ]);
    const connected: string[] = [];
    if (platRes.ok) {
      for (const it of platRes.data.items) {
        if (!it.connected) continue;
        if (it.provider === 'microsoft') connected.push('microsoft-365');
        else if (it.provider === 'google') connected.push('google-workspace');
      }
    }
    setProviders(connected);
    if (trigRes.ok) {
      // Artifact-backend triggers carry a top-level artifactId (automation
      // triggers carry automationId instead).
      setTriggers(trigRes.data.items.filter((t) => t.artifactId === artifactId));
    }
  }, [artifactId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [load]);

  const triggerFor = useCallback(
    (handler: string) => triggers.find((t) => t.entrypoint === handler),
    [triggers],
  );

  const onConnect = useCallback(async (handler: string) => {
    const integrationKey = selected[handler] || providers[0];
    if (!integrationKey) {
      setError('Ligue primeiro uma caixa de correio (Microsoft 365 ou Google) em Integrações.');
      return;
    }
    setBusy(handler); setError(null);
    const res = await tryCall(() => api.triggers.create({
      integrationKey,
      eventName: 'email.received',
      target: { kind: 'artifact-backend', artifactId, entrypoint: handler },
    }));
    if (res.ok) await load();
    else setError(res.error.message ?? 'Não foi possível criar a ligação.');
    setBusy(null);
  }, [selected, providers, artifactId, load]);

  const onDelete = useCallback(async (id: string) => {
    setBusy(id); setError(null);
    const res = await tryCall(() => api.triggers.delete({ id }));
    if (res.ok) await load();
    else setError(res.error.message ?? 'Não foi possível remover a ligação.');
    setBusy(null);
  }, [load]);

  if (!handlers || handlers.length === 0) return null;

  return (
    <section data-testid="backend-trigger-card" className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <header className="mb-3 flex items-center gap-2">
        <Link2 className="h-5 w-5 text-teal-600" aria-hidden />
        <h3 className="text-base font-semibold text-neutral-900">Ligações</h3>
      </header>
      <p className="mb-4 text-sm text-neutral-500">
        Ligue cada função do backend a uma caixa de correio. A cada novo email, o Ekoa executa a
        função automaticamente — por exemplo, transformar uma notificação Citius num prazo.
      </p>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-neutral-400">
          <Loader2 className="h-4 w-4 animate-spin" /> A carregar…
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
          {handlers.map((handler) => {
            const existing = triggerFor(handler);
            const effectiveProvider = selected[handler] || providers[0] || '';
            return (
              <li key={handler} data-testid={`trigger-handler-${handler}`} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Mail className="h-4 w-4 shrink-0 text-neutral-400" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutral-800">
                      {HANDLER_LABEL[handler] ?? handler}
                    </p>
                    <p className="truncate font-mono text-xs text-neutral-400">{handler}</p>
                  </div>
                </div>

                {existing ? (
                  <div data-testid={`trigger-row-${existing.id}`} className="flex items-center gap-2">
                    <span className="rounded-full bg-teal-100 px-2.5 py-1 text-xs font-medium text-teal-700">
                      Ligado · {PROVIDER_LABEL[existing.integrationKey] ?? existing.integrationKey}
                    </span>
                    <button
                      data-testid={`trigger-delete-${existing.id}`}
                      onClick={() => onDelete(existing.id)}
                      disabled={busy === existing.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
                    >
                      {busy === existing.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Desligar
                    </button>
                  </div>
                ) : providers.length === 0 ? (
                  <span data-testid="trigger-no-mailbox" className="text-sm text-neutral-500">
                    Nenhuma caixa de correio ligada. Ligue Microsoft 365 ou Google em Integrações.
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      data-testid={`trigger-provider-${handler}`}
                      value={effectiveProvider}
                      onChange={(e) => setSelected((s) => ({ ...s, [handler]: e.target.value }))}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm text-neutral-700"
                    >
                      {providers.map((p) => (
                        <option key={p} value={p}>{PROVIDER_LABEL[p] ?? p}</option>
                      ))}
                    </select>
                    <button
                      data-testid={`trigger-connect-${handler}`}
                      onClick={() => onConnect(handler)}
                      disabled={busy === handler}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {busy === handler ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Ligar caixa de correio
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
