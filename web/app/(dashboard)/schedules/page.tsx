"use client";

/**
 * Schedules list. Three surfaces on one page, in the order a person needs them:
 *  1. the task inbox - manual runs that came due and are waiting on a decision;
 *  2. the schedules themselves, grouped by WHEN they next fire (not by kind, not
 *     alphabetically - "what is coming" is the question this page answers);
 *  3. what is no longer coming: paused, then finished.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarClock, ClipboardCheck, Play, Plug, Plus, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Schedule, ScheduleRun, ScheduleTarget } from '@ekoa/shared';
import { useSchedulesStore } from '@/stores/schedules';
import { useTranslation } from '@/stores/i18n';
import { formatStamp, recurrenceText, relativeNext } from '@/lib/schedules/recurrence-text';
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
  const router = useRouter();
  const confirm = useConfirm();
  const { schedules: t, language } = useTranslation();

  const items = useSchedulesStore((s) => s.items);
  const pendingTasks = useSchedulesStore((s) => s.pendingTasks);
  const fetchSchedules = useSchedulesStore((s) => s.fetchSchedules);
  const fetchOrgRuns = useSchedulesStore((s) => s.fetchOrgRuns);
  const update = useSchedulesStore((s) => s.update);
  const remove = useSchedulesStore((s) => s.remove);
  const runNow = useSchedulesStore((s) => s.runNow);
  const completeRun = useSchedulesStore((s) => s.completeRun);

  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [busyRunIds, setBusyRunIds] = useState<string[]>([]);

  useEffect(() => {
    void (async () => {
      await Promise.all([fetchSchedules(), fetchOrgRuns('pending')]);
      setLoaded(true);
    })();
  }, [fetchSchedules, fetchOrgRuns]);

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

  const onRunNow = useCallback(
    async (id: string) => {
      setRunningIds((current) => [...current, id]);
      await runNow(id);
      setRunningIds((current) => current.filter((value) => value !== id));
    },
    [runNow],
  );

  const onCompleteRun = useCallback(
    async (runId: string, outcome: 'done' | 'dismissed') => {
      setBusyRunIds((current) => [...current, runId]);
      await completeRun(runId, outcome);
      setBusyRunIds((current) => current.filter((value) => value !== runId));
    },
    [completeRun],
  );

  const renderRow = (schedule: Schedule) => {
    const Icon = TARGET_ICONS[schedule.target.kind] ?? CalendarClock;
    const relative = relativeNext(schedule.nextRunAt, language, { now });
    const inFlight = runningIds.includes(schedule.id);
    return (
      <Card
        key={schedule.id}
        padding="none"
        hover
        className="flex cursor-pointer items-center gap-4 px-5 py-4"
        data-testid="schedule-row"
        onClick={() => router.push(`/schedules/${schedule.id}`)}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-neutral-50 text-neutral-500"
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-neutral-900">{schedule.name}</div>
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
        {/* Row controls act on the schedule, never on the row's navigation. */}
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={schedule.enabled}
            onChange={(checked) => void update(schedule.id, { enabled: checked })}
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
                void remove(schedule.id);
              }
            }}
          />
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

  if (items.length === 0 && pendingTasks.length === 0) {
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
  onComplete: (runId: string, outcome: 'done' | 'dismissed') => void | Promise<void>;
}

function InboxRow({ task, schedule, now, busy, onComplete }: InboxRowProps) {
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
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void onComplete(task.id, 'done')}>
          {t.inbox.complete}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onComplete(task.id, 'dismissed')}>
          {t.inbox.dismiss}
        </Button>
      </div>
    </li>
  );
}
