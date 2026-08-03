'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Clock, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { SyncRunOutcome, SyncStateView } from '@ekoa/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { fetchCitiusSyncState, runCitiusSync } from '@/lib/sync/citius-sync';
import {
  formatSyncMoment,
  notificationCount,
  presentSyncOutcome,
  type SyncOutcomeTone,
} from '@/lib/sync/sync-outcome';

/**
 * SyncOutcomePanel (slice CS7) - where a lawyer finds out whether their Citius inbox is actually
 * complete.
 *
 * THE ONE THING THIS PANEL MUST GET RIGHT: "Completa" and "INCOMPLETA" cannot look like two shades
 * of the same thing. INCOMPLETA means notifications may be missing and the read pointer was
 * deliberately held back, which is a fact someone has to act on; Completa is the boring default.
 * So the two states differ in colour family, in the weight of the label chip, in the size of the
 * headline, and in whether the card carries a left accent bar at all - a difference that survives a
 * glance from across the room, not a badge you have to read.
 *
 * "Falhou" is kept a THIRD thing, not a variant of INCOMPLETA. It is red rather than amber, and it
 * says the sync never ran - i.e. nothing is known about the inbox either way. Telling someone
 * "notifications may be missing" when the truth is "we have not looked" is a different (and
 * equally damaging) lie.
 *
 * The panel renders NOTHING when the api answers 404: CS6's flag defaults off, and an unshipped
 * feature should not advertise itself on a page every user opens. It also renders nothing while the
 * first fetch is in flight, so no skeleton flashes on the deployments where the feature is off.
 */

interface ToneStyle {
  /** Extra classes on the Card: the accent bar + surface tint. */
  /** The statement block: tint + accent bar. This is the element that carries the visual weight. */
  block: string;
  /** The label chip - fill weight is part of how the three states are told apart. */
  chip: string;
  /** The headline's size/weight/colour. */
  headline: string;
  icon: LucideIcon;
  iconClass: string;
  /** The body copy inside the statement block. */
  body: string;
  /** The "what happens next" line. */
  next: string;
}

/**
 * The tint and the accent bar live on the STATEMENT BLOCK inside the card, not on the card itself -
 * the same shape the sibling panels use (SessionConnectPanel's status rows). It also keeps the card
 * chrome uniform with every other card on the page while the block inside it is what changes weight.
 */
const TONE_STYLES: Record<SyncOutcomeTone, ToneStyle> = {
  // Quiet on purpose: no accent bar, no colour wash. A green banner every day is a banner nobody reads.
  success: {
    block: 'rounded-lg border border-line bg-neutral-50/70 px-3 py-2.5',
    chip: 'bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-600/15',
    headline: 'text-sm font-medium text-neutral-800',
    icon: ShieldCheck,
    iconClass: 'text-teal-600',
    body: 'text-xs leading-relaxed text-neutral-600',
    next: 'text-xs text-neutral-500',
  },
  // The loud one: a 4px amber accent bar, an amber wash, a SOLID uppercase chip, a bigger headline.
  warning: {
    block: 'rounded-lg border border-amber-200/70 border-l-4 border-l-amber-500 bg-amber-50/80 px-3 py-3',
    chip: 'bg-amber-500 text-white tracking-[0.08em]',
    headline: 'text-base font-semibold text-amber-900',
    icon: AlertTriangle,
    iconClass: 'text-amber-600',
    body: 'text-xs leading-relaxed text-amber-900/80',
    next: 'text-xs font-medium text-amber-800',
  },
  // Loud too, but a different claim and a different colour family from INCOMPLETA.
  danger: {
    block: 'rounded-lg border border-red-200/70 border-l-4 border-l-red-500 bg-red-50/80 px-3 py-3',
    chip: 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-600/20',
    headline: 'text-sm font-semibold text-red-900',
    icon: XCircle,
    iconClass: 'text-red-600',
    body: 'text-xs leading-relaxed text-red-900/80',
    next: 'text-xs text-red-800',
  },
  neutral: {
    block: 'rounded-lg border border-line bg-neutral-50/70 px-3 py-2.5',
    chip: 'bg-neutral-100 text-neutral-600 ring-1 ring-inset ring-neutral-500/10',
    headline: 'text-sm font-medium text-neutral-700',
    icon: Clock,
    iconClass: 'text-neutral-400',
    body: 'text-xs leading-relaxed text-neutral-600',
    next: 'text-xs text-neutral-500',
  },
};

/** A run that never established a session did not fail - it did not happen. Each branch says which. */
function runNotice(outcome: SyncRunOutcome): { text: string; detail: string | null } | null {
  if (outcome.status === 'ran') return null;
  if (outcome.status === 'needs-egress') {
    return {
      text: 'A sessão continua válida, mas neste momento não há uma saída de rede compatível para a utilizar. A sincronização não chegou a correr.',
      detail: `Ligação necessária: ${outcome.required.pairingId}`,
    };
  }
  const base =
    outcome.route === 'attended'
      ? 'É preciso entrar no Citius pessoalmente para restabelecer a sessão. A sincronização não chegou a correr.'
      : 'É preciso alguém a conduzir o login no Citius para restabelecer a sessão. A sincronização não chegou a correr.';
  // `attempted` is the one field here with a consequence attached: a credential was SUBMITTED, and
  // the lock-out policy of the portal is unforgiving, so a retry is not a free action.
  const attemptedWarning = outcome.attempted
    ? ' Já foi submetida uma tentativa de login: não repita sem verificar a credencial, sob pena de bloqueio da conta no portal.'
    : '';
  return { text: `${base}${attemptedWarning}`, detail: outcome.reason || null };
}

export function SyncOutcomePanel() {
  const [state, setState] = useState<SyncStateView | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<{ text: string; detail: string | null } | null>(null);
  const aborted = useRef(false);

  const load = useCallback(async () => {
    const result = await fetchCitiusSyncState();
    if (aborted.current) return;
    if (result.kind === 'ready') {
      setState(result.state);
      setStatus('ready');
      setError(null);
      return;
    }
    if (result.kind === 'unavailable') {
      setStatus('unavailable');
      return;
    }
    setError(result.message);
    setStatus('error');
  }, []);

  useEffect(() => {
    aborted.current = false;
    // The fetch is started inside an async callback rather than called from the effect body so no
    // state is set synchronously during the effect (react-hooks/set-state-in-effect); every setState
    // below happens after an await, in a callback the unmount guard has already had a chance to veto.
    void (async () => {
      await load();
    })();
    return () => {
      aborted.current = true;
    };
  }, [load]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setNotice(null);
    setError(null);
    try {
      const result = await runCitiusSync();
      if (aborted.current) return;
      if (result.kind === 'outcome') {
        setNotice(runNotice(result.outcome));
        // The state row is the source of truth for what is on screen; re-read it rather than
        // patching the panel from the run's own answer.
        await load();
        return;
      }
      setError(
        result.kind === 'unavailable'
          ? 'A sincronização Citius já não está disponível nesta instalação.'
          : result.message,
      );
    } finally {
      if (!aborted.current) setRunning(false);
    }
  }, [load]);

  if (status === 'loading' || status === 'unavailable') return null;

  if (status === 'error' || !state) {
    return (
      <Card padding="md" data-testid="sync-outcome-panel" data-outcome="error">
        <div className="flex items-start gap-2">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-neutral-800">
              Não foi possível ler o estado da sincronização Citius.
            </p>
            <p className="mt-1 text-xs text-neutral-500" data-testid="sync-outcome-error">
              {error ?? 'Tente novamente dentro de momentos.'}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const view = presentSyncOutcome(state);
  const tone = TONE_STYLES[view.tone];
  const Icon = tone.icon;
  const lastMoment = formatSyncMoment(state.lastRunAt);
  // A failed run landed nothing, and printing "0 notificações" next to a failure reads as "there
  // were none" - which is precisely the claim a failed run cannot make. So the per-run figure is
  // shown only when there WAS a reading.
  const showRunLanded = view.kind === 'complete' || view.kind === 'incomplete';

  return (
    <Card
      padding="md"
      className="space-y-3"
      data-testid="sync-outcome-panel"
      data-outcome={view.kind}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone.iconClass}`} aria-hidden />
          <span className="text-sm font-semibold text-neutral-900">Sincronização Citius</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tone.chip}`}
            data-testid="sync-outcome-label"
          >
            {view.label}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={RefreshCw}
          loading={running}
          onClick={() => void handleRun()}
          data-testid="sync-run-now"
        >
          Sincronizar agora
        </Button>
      </div>

      <div className={`space-y-2 ${tone.block}`} data-testid="sync-outcome-statement">
        <p className={tone.headline} data-testid="sync-outcome-headline" role="status">
          {view.headline}
        </p>
        <p className={tone.body} data-testid="sync-outcome-body">
          {view.body}
        </p>

        {view.reason && (
          <div
            className="rounded-lg border border-line bg-surface px-3 py-2"
            data-testid="sync-outcome-reason"
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {view.reasonLabel}
            </p>
            <p className="mt-1 text-xs text-neutral-700">{view.reason}</p>
            {view.streakNote && (
              <p className="mt-1 text-xs font-medium text-neutral-800" data-testid="sync-outcome-streak">
                {view.streakNote}
              </p>
            )}
          </div>
        )}

        <p className={tone.next} data-testid="sync-outcome-next">
          {view.next}
        </p>
      </div>

      {view.kind !== 'never' && (
        <dl
          className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-500"
          data-testid="sync-outcome-evidence"
        >
          <div className="flex gap-1.5">
            <dt>{view.kind === 'failed' ? 'Última tentativa' : 'Última leitura'}</dt>
            <dd className="font-medium tabular-nums text-neutral-700" data-testid="sync-evidence-lastrun">
              {lastMoment ?? 'sem registo'}
            </dd>
          </div>
          {showRunLanded && state.latest && (
            <div className="flex gap-1.5">
              <dt>Nesta leitura</dt>
              <dd className="font-medium tabular-nums text-neutral-700" data-testid="sync-evidence-landed">
                {notificationCount(state.latest.landed)}
              </dd>
            </div>
          )}
          <div className="flex gap-1.5">
            <dt>Total nesta caixa</dt>
            <dd className="font-medium tabular-nums text-neutral-700" data-testid="sync-evidence-total">
              {notificationCount(state.landed)}
            </dd>
          </div>
        </dl>
      )}

      {notice && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2"
          data-testid="sync-run-notice"
        >
          <p className="text-xs leading-relaxed text-amber-900">{notice.text}</p>
          {notice.detail && <p className="mt-1 text-[11px] text-amber-700">{notice.detail}</p>}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600" data-testid="sync-run-error">
          {error}
        </p>
      )}
    </Card>
  );
}
