'use client';

/**
 * "Ligações" - wires an artifact's Layer-2 backend handler to a real event source. For each
 * declared handler the card lets the owner pick a source and creates the `ekoa.triggers` listener
 * that invokes the backend on every new event.
 *
 * A SOURCE IS NOT ALWAYS A MAILBOX, and until 2026-08-31 this card assumed it was: it listed only
 * connected platform mailboxes and hardcoded `eventName: 'email.received'` on the trigger it
 * created. So an artifact whose backend listens to anything else had no way to be wired from the
 * UI - the `legal-citius` inbox declares `onNotificacaoCitius`, fed by the citius package's own
 * listener (`notificacao.recebida`, polling the Portal dos Mandatários), and the card would have
 * offered it a mailbox and then bound it to the wrong event. The source list is now the union of
 * the connected mailboxes AND every ENABLED integration's declared `listenerEvents`
 * (`GET /api/v1/integrations/active`), and the trigger carries that source's own event name. The
 * mailbox case is unchanged in behaviour: it is now one entry of the general list rather than the
 * only thing the card knows about.
 *
 * Self-contained: it fetches sources + existing triggers itself and only renders when the artifact
 * exposes backend handlers. PT-PT, no emoji.
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
  onNotificacaoCitius: 'Nova notificação no Portal dos Mandatários',
};

/** One thing a handler can be wired to: an integration plus the event it emits. */
type Source = { integrationKey: string; eventName: string; label: string };

/** The mailbox sources, in the shape everything else now uses. */
const EMAIL_EVENT = 'email.received';

/** Stable key for a source in a <select> (an integration may declare more than one event). */
const sourceKey = (s: Source) => `${s.integrationKey}::${s.eventName}`;

export function BackendTriggerCard({ artifactId, handlers }: { artifactId: string; handlers: string[] }) {
  const [sources, setSources] = useState<Source[]>([]); // everything a handler can be wired to
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({}); // handler -> sourceKey
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [platRes, activeRes, trigRes] = await Promise.all([
      tryCall(() => api.platformIntegrations.list()),
      tryCall(() => api.integrations.listActive()),
      tryCall(() => api.triggers.list()),
    ]);
    const found: Source[] = [];
    if (platRes.ok) {
      for (const it of platRes.data.items) {
        if (!it.connected) continue;
        const key = it.provider === 'microsoft' ? 'microsoft-365' : it.provider === 'google' ? 'google-workspace' : null;
        if (key) found.push({ integrationKey: key, eventName: EMAIL_EVENT, label: PROVIDER_LABEL[key]! });
      }
    }
    if (activeRes.ok) {
      for (const it of activeRes.data.items) {
        // The catalog types an event as an open record, so every field is checked rather than
        // trusted: an event with no usable name is skipped, never rendered as an empty option.
        for (const ev of it.listenerEvents ?? []) {
          const name = typeof ev?.name === 'string' ? ev.name : '';
          if (!name) continue;
          // Skip a duplicate of a mailbox already listed above (a platform provider that also
          // declares an email listener would otherwise appear twice under two different names).
          if (found.some((src) => src.integrationKey === it.key && src.eventName === name)) continue;
          // The package's own PT-PT label when it has one; never the raw event name alone, which
          // means nothing to the person choosing.
          const labelPt = typeof ev?.labelPt === 'string' && ev.labelPt ? ev.labelPt : name;
          found.push({
            integrationKey: it.key,
            eventName: name,
            label: `${it.displayName ?? it.key} · ${labelPt}`,
          });
        }
      }
    }
    setSources(found);
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
    const chosen = sources.find((s) => sourceKey(s) === selected[handler]) ?? sources[0];
    if (!chosen) {
      setError('Ligue primeiro uma origem de eventos (uma caixa de correio ou uma integração com escuta) em Integrações.');
      return;
    }
    setBusy(handler); setError(null);
    // The EVENT comes from the chosen source, never from a constant here: binding a portal listener
    // to `email.received` would create a trigger nothing ever fires.
    const res = await tryCall(() => api.triggers.create({
      integrationKey: chosen.integrationKey,
      eventName: chosen.eventName,
      target: { kind: 'artifact-backend', artifactId, entrypoint: handler },
    }));
    if (res.ok) await load();
    else setError(res.error.message ?? 'Não foi possível criar a ligação.');
    setBusy(null);
  }, [selected, sources, artifactId, load]);

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
        Ligue cada função do backend a uma origem de eventos: uma caixa de correio, ou uma
        integração que escute (como o Portal dos Mandatários). A cada novo evento, o Ekoa executa a
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
            const effectiveSource = selected[handler] || (sources[0] ? sourceKey(sources[0]) : '');
            const existingLabel = existing
              ? sources.find((s) => s.integrationKey === existing.integrationKey && s.eventName === existing.eventName)?.label
                ?? PROVIDER_LABEL[existing.integrationKey] ?? existing.integrationKey
              : '';
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
                      Ligado · {existingLabel}
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
                ) : sources.length === 0 ? (
                  <span data-testid="trigger-no-mailbox" className="text-sm text-neutral-500">
                    Nenhuma origem de eventos ligada. Ligue uma caixa de correio (Microsoft 365 ou
                    Google) ou uma integração com escuta em Integrações.
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      data-testid={`trigger-provider-${handler}`}
                      value={effectiveSource}
                      onChange={(e) => setSelected((s) => ({ ...s, [handler]: e.target.value }))}
                      className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm text-neutral-700"
                    >
                      {sources.map((src) => (
                        <option key={sourceKey(src)} value={sourceKey(src)}>{src.label}</option>
                      ))}
                    </select>
                    <button
                      data-testid={`trigger-connect-${handler}`}
                      onClick={() => onConnect(handler)}
                      disabled={busy === handler}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {busy === handler ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      Ligar origem
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
