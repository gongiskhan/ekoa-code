"use client";

/**
 * Schedules list. Three surfaces on one page, in the order a person needs them:
 *  1. the task inbox - manual runs that came due and are waiting on a decision;
 *  2. the schedules themselves, grouped by WHEN they next fire (not by kind, not
 *     alphabetically - "what is coming" is the question this page answers);
 *  3. what is no longer coming: paused, then finished.
 *
 * Two rules this page is built to keep:
 *  - it never claims data does not exist when it merely failed to arrive: a broken read gets
 *    its own state (message + retry) and SUPPRESSES the empty state;
 *  - it never renders a control the actor cannot use. An org-admin SEES the whole org's
 *    schedules but may only MUTATE its own (`api/src/schedules/store.ts` canEdit/canSee), and
 *    the server refuses the rest with a uniform 404 - so a peer's row shows state, not knobs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, ClipboardCheck, Play, Plug, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Schedule, ScheduleRun, ScheduleTarget } from '@ekoa/shared';
import { useSchedulesStore } from '@/stores/schedules';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from '@/stores/i18n';
import { toast } from '@/stores/toast';
import { formatStamp, recurrenceText, relativeNext } from '@/lib/schedules/recurrence-text';
import { canActOnOwned } from '@/lib/schedules/authority';
import { ScheduleForm } from '@/components/schedules/schedule-form';
import { RunStatusBadge } from '@/components/schedules/run-status-badge';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button, IconButton } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';
import { useConfirm } from '@/components/ui/confirm-dialog';

const TARGET_ICONS: Record<ScheduleTarget['kind'], LucideIcon> = {
  manual: ClipboardCheck,
  automation: Play,
  integration_action: Plug,
};

type Bucket = 'today' | 'tomorrow' | 'thisWeek' | 'later';
const BUCKET_ORDER: Bucket[] = ['today', 'tomorrow', 'thisWeek', 'later'];

const startOfDay = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Which "when" section a next-run instant belongs to. Anything overdue reads as today. */
function bucketOf(iso: string, now: Date): Bucket {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'later';
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days <= 7) return 'thisWeek';
  return 'later';
}

export default function SchedulesPage() {
  const confirm = useConfirm();
  const { schedules: t, common, language } = useTranslation();

  const items = useSchedulesStore((s) => s.items);
  const pendingTasks = useSchedulesStore((s) => s.pendingTasks);
  const loadError = useSchedulesStore((s) => s.loadError);
  const fetchSchedules = useSchedulesStore((s) => s.fetchSchedules);
  const fetchOrgRuns = useSchedulesStore((s) => s.fetchOrgRuns);
  const update = useSchedulesStore((s) => s.update);
  const remove = useSchedulesStore((s) => s.remove);
  const runNow = useSchedulesStore((s) => s.runNow);
  const completeRun = useSchedulesStore((s) => s.completeRun);

  const me = useAuthStore((s) => s.user);

  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [busyRunIds, setBusyRunIds] = useState<string[]>([]);

  const load = useCallback(async () => {
    await Promise.all([fetchSchedules(), fetchOrgRuns('pending')]);
    setLoaded(true);
  }, [fetchSchedules, fetchOrgRuns]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Every mutating control on this page reports the same way. The store returns null/false on
   * a refusal and parks the message on `error`; reading it synchronously after the await (the
   * form's idiom) keeps the report tied to the click that caused it. Without this the switch
   * simply snapped back and delete/run-now/complete failed in silence.
   */
  const reportFailure = useCallback(() => {
    const { error, clearError } = useSchedulesStore.getState();
    toast.error(error || t.actionFailed, { testId: 'schedules-action-error' });
    clearError();
  }, [t.actionFailed]);

  // Relative next-run text goes stale as the user sits on the page; a slow tick keeps
  // "dentro de 2 h" honest without re-fetching anything.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const grouped = useMemo(() => {
    const upcoming: Record<Bucket, Schedule[]> = { today: [], tomorrow: [], thisWeek: [], later: [] };
    const paused: Schedule[] = [];
    const finished: Schedule[] = [];
    for (const schedule of items) {
      if (!schedule.enabled) {
        paused.push(schedule);
      } else if (!schedule.nextRunAt) {
        finished.push(schedule);
      } else {
        upcoming[bucketOf(schedule.nextRunAt, now)].push(schedule);
      }
    }
    for (const bucket of BUCKET_ORDER) {
      upcoming[bucket].sort((a, b) => Date.parse(a.nextRunAt ?? '') - Date.parse(b.nextRunAt ?? ''));
    }
    return { upcoming, paused, finished };
  }, [items, now]);

  const onToggle = useCallback(
    async (id: string, enabled: boolean) => {
      if (!(await update(id, { enabled }))) reportFailure();
    },
    [update, reportFailure],
  );

  const onRunNow = useCallback(
    async (id: string) => {
      setRunningIds((current) => [...current, id]);
      const fired = await runNow(id);
      setRunningIds((current) => current.filter((value) => value !== id));
      if (!fired) reportFailure();
    },
    [runNow, reportFailure],
  );

  const onCompleteRun = useCallback(
    async (runId: string, outcome: 'done' | 'dismissed') => {
      setBusyRunIds((current) => [...current, runId]);
      const done = await completeRun(runId, outcome);
      setBusyRunIds((current) => current.filter((value) => value !== runId));
      if (!done) reportFailure();
    },
    [completeRun, reportFailure],
  );

  const renderRow = (schedule: Schedule) => {
    const Icon = TARGET_ICONS[schedule.target.kind] ?? CalendarClock;
    const relative = relativeNext(schedule.nextRunAt, language, { now });
    const inFlight = runningIds.includes(schedule.id);
    const mine = canActOnOwned(me, schedule.ownerId);
    return (
      <Card
        key={schedule.id}
        padding="none"
        hover
        className="relative flex items-center gap-4 px-5 py-4"
        data-testid="schedule-row"
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-neutral-50 text-neutral-500"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          {/*
            The row navigates, so the row IS a link: a real anchor stretched over the whole card
            (the ::after overlay) rather than a div with an onClick, which no keyboard or screen
            reader could reach. The controls below sit later in the DOM and are positioned, so
            they paint above the overlay and keep their own clicks.
          */}
          <Link
            href={`/schedules/${schedule.id}`}
            className="block truncate text-sm font-medium text-neutral-900 after:absolute after:inset-0 after:rounded-2xl focus-ring"
          >
            {schedule.name}
          </Link>
          <div className="mt-0.5 truncate text-xs text-neutral-500">
            {recurrenceText(schedule.spec, language)}
          </div>
          <div className="mt-0.5 truncate text-xs text-neutral-400">
            {relative ? t.nextIn(relative) : t.noNextRun}
          </div>
          {!schedule.enabled && schedule.autoPausedAt && (
            <div className="mt-1 text-xs text-amber-700">{t.autoPausedHint}</div>
          )}
        </div>
        {schedule.lastRun && <RunStatusBadge status={schedule.lastRun.status} />}
        {/* z-10 keeps the controls above the link's overlay, so their clicks stay their own. */}
        <div className="relative z-10 flex shrink-0 items-center gap-1">
          {mine ? (
            <>
              <Switch
                checked={schedule.enabled}
                onChange={(checked) => void onToggle(schedule.id, checked)}
                aria-label={t.enabledAria}
              />
              <IconButton
                icon={Play}
                label={t.runNowAria}
                size="sm"
                variant="ghost"
                disabled={inFlight}
                onClick={() => void onRunNow(schedule.id)}
              />
              <IconButton
                icon={Trash2}
                label={t.deleteAria}
                size="sm"
                variant="danger-ghost"
                onClick={async () => {
                  if (await confirm({ title: t.deleteConfirm(schedule.name), tone: 'danger' })) {
                    if (!(await remove(schedule.id))) reportFailure();
                  }
                }}
              />
            </>
          ) : (
            /* A peer's row stays readable: the switch carried the on/off state, so a static
               badge carries it instead. */
            <Badge tone={schedule.enabled ? 'success' : 'neutral'}>
              {schedule.enabled ? t.stateActive : t.statePaused}
            </Badge>
          )}
        </div>
      </Card>
    );
  };

  const renderSection = (title: string, rows: Schedule[]) =>
    rows.length === 0 ? null : (
      <section key={title} className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
        <div className="space-y-2">{rows.map(renderRow)}</div>
      </section>
    );

  const inbox = (
    <Card as="section" className="space-y-3" data-testid="schedule-inbox">
      <div>
        <h2 className="text-sm font-semibold text-neutral-900">{t.inbox.title}</h2>
        <p className="mt-0.5 text-xs text-neutral-500">{t.inbox.description}</p>
      </div>
      <ul className="space-y-2">
        {pendingTasks.map((task) => (
          <InboxRow
            key={task.id}
            task={task}
            schedule={items.find((item) => item.id === task.scheduleId)}
            now={now}
            busy={busyRunIds.includes(task.id)}
            mine={canActOnOwned(me, task.ownerId)}
            onComplete={onCompleteRun}
          />
        ))}
      </ul>
    </Card>
  );

  if (!loaded) {
    return (
      <PageShell testId="schedules-page">
        <LoadingState label={t.loading} />
      </PageShell>
    );
  }

  const header = (
    <PageHeader
      icon={CalendarClock}
      title={t.title}
      description={items.length > 0 ? t.total(items.length) : undefined}
      actions={
        <Button variant="primary" icon={Plus} onClick={() => setFormOpen(true)} data-testid="schedule-new">
          {t.newSchedule}
        </Button>
      }
    />
  );

  const form = <ScheduleForm open={formOpen} onClose={() => setFormOpen(false)} />;

  /**
   * A read that FAILED is not a read that came back empty. The empty state below is a factual
   * claim ("you have no schedules") the page may only make once the list actually arrived, so
   * a broken read takes its place and offers the one useful action: ask again.
   */
  const loadFailure = loadError ? (
    <Card
      className="flex items-center justify-between gap-3 border-red-200 bg-red-50"
      data-testid="schedules-load-error"
    >
      <div className="flex min-w-0 items-center gap-2 text-red-600">
        <AlertTriangle size={16} className="shrink-0" aria-hidden />
        <span className="text-sm">{loadError}</span>
      </div>
      <Button variant="danger-ghost" size="sm" icon={RefreshCw} onClick={() => void load()}>
        {common.retry}
      </Button>
    </Card>
  ) : null;

  if (!loadError && items.length === 0 && pendingTasks.length === 0) {
    return (
      <PageShell testId="schedules-page">
        {header}
        <EmptyState
          icon={CalendarClock}
          title={t.emptyState.title}
          description={t.emptyState.description}
          action={
            <Button variant="primary" size="sm" icon={Plus} onClick={() => setFormOpen(true)}>
              {t.emptyState.create}
            </Button>
          }
        />
        {form}
      </PageShell>
    );
  }

  return (
    <PageShell testId="schedules-page">
      {header}
      {loadFailure}
      {pendingTasks.length > 0 && inbox}
      <div className="space-y-6">
        {BUCKET_ORDER.map((bucket) => renderSection(t.groups[bucket], grouped.upcoming[bucket]))}
        {renderSection(t.groups.paused, grouped.paused)}
        {renderSection(t.groups.finished, grouped.finished)}
      </div>
      {form}
    </PageShell>
  );
}

// ---------------------------------------------------------------------------------------

interface InboxRowProps {
  task: ScheduleRun;
  schedule?: Schedule;
  now: Date;
  busy: boolean;
  /** Whether the actor may close this task (owner or super-admin); an admin sees peers' too. */
  mine: boolean;
  onComplete: (runId: string, outcome: 'done' | 'dismissed') => void | Promise<void>;
}

function InboxRow({ task, schedule, now, busy, mine, onComplete }: InboxRowProps) {
  const { schedules: t, language } = useTranslation();
  // Overdue is a statement about the CALENDAR: only a timer-fired task can be late. A run-now
  // task's plannedFor is the click instant, which would read "Em atraso" seconds later.
  const overdue = task.trigger === 'auto' && Date.parse(task.plannedFor) < now.getTime();
  const instructions =
    schedule?.target.kind === 'manual' ? schedule.target.instructions : undefined;

  return (
    <li className="flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3" data-testid="schedule-inbox-row">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-neutral-900">
            {schedule?.name ?? t.inbox.unknownSchedule}
          </span>
          {overdue && <Badge tone="danger">{t.inbox.overdue}</Badge>}
        </div>
        {instructions && <p className="mt-0.5 text-xs text-neutral-600">{instructions}</p>}
        <p className="mt-0.5 text-xs text-neutral-400">
          {t.inbox.plannedFor(formatStamp(task.plannedFor, language))}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {mine ? (
          <>
            <Button variant="primary" size="sm" disabled={busy} onClick={() => void onComplete(task.id, 'done')}>
              {t.inbox.complete}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onComplete(task.id, 'dismissed')}>
              {t.inbox.dismiss}
            </Button>
          </>
        ) : (
          /* Only the owner may close a task; an admin sees it, and the badge says why the
             buttons are not there. */
          <Badge tone="neutral">{t.inbox.otherOwner}</Badge>
        )}
      </div>
    </li>
  );
}
