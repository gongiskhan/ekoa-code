'use client';

import { useEffect, useRef, useState } from 'react';
import { LogIn, ShieldCheck, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useIntegrationsStore } from '@/stores/integrations';
import { useTranslation } from '@/stores/i18n';
import type { IntegrationSkill } from '@/types/integration';

interface SessionConnectPanelProps {
  skill: IntegrationSkill;
}

function formatCapturedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Browser-session connect flow for integrations with `sessionConnect`
 * (authType 'browser_session'). Renders inside the integration card,
 * alongside the plain config fields (InlineCredentialForm).
 *
 * Fetches session-status lazily on mount (the panel only mounts for
 * session-connect integrations), then the store polls every 2s while a
 * login window is open, stopping on captured/failed or after 7 minutes.
 */
export function SessionConnectPanel({ skill }: SessionConnectPanelProps) {
  const { pages } = useTranslation();
  const t = pages.integrations;
  const key = skill.integrationKey;

  const entry = useIntegrationsStore((s) => s.sessionStatuses[key]);
  const busy = useIntegrationsStore((s) => Boolean(s.sessionBusy[key]));
  const refreshSessionStatus = useIntegrationsStore((s) => s.refreshSessionStatus);
  const connectSession = useIntegrationsStore((s) => s.connectSession);
  const cancelSessionWait = useIntegrationsStore((s) => s.cancelSessionWait);

  const [actionError, setActionError] = useState<string | null>(null);

  // Lazy status fetch, once per mount (not for every card on the page)
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    void refreshSessionStatus(key);
  }, [key, refreshSessionStatus]);

  async function handleConnect() {
    setActionError(null);
    const result = await connectSession(key);
    if (!result.success && result.error) setActionError(result.error);
  }

  function renderBody() {
    if (!entry) {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5">
          <Spinner size="xs" className="text-neutral-400" />
          <span className="text-[11px] text-neutral-400">{t.sessionChecking}</span>
        </div>
      );
    }

    const { sessionConnect, session } = entry;
    const status = session.status;

    // Captured: subdued success row + renew (only where capture is possible)
    if (status === 'captured') {
      return (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldCheck size={12} className="flex-shrink-0 text-teal-500" />
            <span className="text-[11px] text-neutral-600 truncate">
              {t.sessionActiveSince(session.capturedAt ? formatCapturedAt(session.capturedAt) : '-')}
            </span>
          </div>
          {sessionConnect.available && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConnect()}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-teal-50 hover:text-teal-600 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw size={10} />
              <span>{t.sessionRenew}</span>
            </button>
          )}
        </div>
      );
    }

    // Waiting: the login window is open; the store polls until capture
    if (status === 'waiting_login') {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-teal-200/70 bg-teal-50/50 p-2.5">
          <Spinner size="xs" className="flex-shrink-0 text-teal-600" />
          <p className="flex-1 text-[11px] leading-relaxed text-teal-700">{t.sessionWaiting}</p>
          <button
            type="button"
            onClick={() => cancelSessionWait(key)}
            className="flex-shrink-0 rounded-md px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors cursor-pointer"
          >
            {t.sessionCancelWait}
          </button>
        </div>
      );
    }

    // Failed, or environment where capture is unavailable (e.g. production
    // without a local Ekoa): surface the API message + a retry affordance.
    if (status === 'failed' || !sessionConnect.available) {
      const message =
        actionError ||
        session.message ||
        (!sessionConnect.available ? sessionConnect.message : t.sessionFailedDefault);
      const retry = sessionConnect.available
        ? () => void handleConnect()
        : () => void refreshSessionStatus(key);
      return (
        <div className="space-y-2 rounded-lg border border-amber-200/80 bg-amber-50/60 p-2.5">
          <div className="flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0 text-amber-500" />
            <p className="text-[11px] leading-relaxed text-amber-700">{message}</p>
          </div>
          <Button variant="secondary" size="sm" loading={busy} onClick={retry}>
            {t.sessionRetry}
          </Button>
        </div>
      );
    }

    // None: explanatory line + primary connect button
    const guide = skill.sessionConnect?.guidePt || t.sessionConnectDefaultGuide;
    return (
      <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/60 p-2.5">
        <p className="text-[11px] leading-relaxed text-neutral-500">{guide}</p>
        {actionError && (
          <div className="flex items-start gap-1.5">
            <AlertCircle size={12} className="mt-0.5 flex-shrink-0 text-red-500" />
            <p className="text-[11px] text-red-600">{actionError}</p>
          </div>
        )}
        <Button
          variant="primary"
          size="sm"
          icon={LogIn}
          loading={busy}
          onClick={() => void handleConnect()}
        >
          {t.sessionOpenLogin}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="mb-2"
      data-testid={`session-connect-panel-${key}`}
      onClick={(e) => e.stopPropagation()}
    >
      {renderBody()}
    </div>
  );
}
