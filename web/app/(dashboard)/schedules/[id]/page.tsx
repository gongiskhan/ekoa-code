"use client";

/**
 * One schedule: what it fires, when it fires next, and every fire it has already had.
 *
 * The "requested id" guard mirrors the automation editor (`automations/[id]/page.tsx`):
 * a spinner is only honest while a fetch is outstanding, so not-found is shown ONLY after
 * the fetch for THIS id has come back empty - never on the first render.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CalendarClock, ClipboardCheck, Pencil, Play, Plug, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Schedule, ScheduleRun, ScheduleTarget } from '@ekoa/shared';
import { api, tryCall } from '@/lib/api';
import { useSchedulesStore } from '@/stores/schedules';
import { useTranslation } from '@/stores/i18n';
import { formatStamp, recurrenceText, relativeNext } from '@/lib/schedules/recurrence-text';
import { ScheduleForm } from '@/components/schedules/schedule-form';
import { RunStatusBadge } from '@/components/schedules/run-status-badge';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Button, IconButton } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
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

export default function ScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();
  const confirm = useConfirm();
  const { schedules: t, language } = useTranslation();

  const runs = useSchedulesStore((s) => s.runs[id]);
  const fetchRuns = useSchedulesStore((s) => s.fetchRuns);
  const update = useSchedulesStore((s) => s.update);
  const remove = useSchedulesStore((s) => s.remove);
  const runNow = useSchedulesStore((s) => s.runNow);

  const [current, setCurrent] = useState<Schedule | null>(null);
  /** The id the last fetch was dispatched for - tells "not asked yet" from "asked, nothing". */
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [editing, setEditing] = useState(false);
  const [firing, setFiring] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setRequestedId(id);
    setFetching(true);
    const res = await tryCall(() => api.schedules.get({ id }));
    setFetching(false);
    setCurrent(res.ok ? res.data : null);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (id) void fetchRuns(id);
  }, [id, fetchRuns]);

  if (!current || current.id !== id) {
    if (requestedId === id && !fetching) {
      return (
        <PageShell testId="schedule-detail-page">
          <PageHeader icon={CalendarClock} title={t.title} />
          <EmptyState
            icon={CalendarClock}
            title={t.detail.notFoundTitle}
            description={t.detail.notFoundDescription}
            action={
              <Link href="/schedules">
                <Button variant="primary" size="sm">
                  {t.detail.notFoundBack}
                </Button>
              </Link>
            }
          />
        </PageShell>
      );
    }
    return (
      <PageShell testId="schedule-detail-page">
        <LoadingState label={t.detail.loading} />
      </PageShell>
    );
  }

  const Icon = TARGET_ICONS[current.target.kind] ?? CalendarClock;
  const relative = relativeNext(current.nextRunAt, language);
  // `undefined` means the history has not come back yet; `[]` means it came back empty.
  const historyLoading = runs === undefined;
  const history = runs ?? [];

  const onToggle = async (enabled: boolean) => {
    const saved = await update(current.id, { enabled });
    if (saved) setCurrent(saved);
  };

  return (
    <PageShell testId="schedule-detail-page">
      <PageHeader
        icon={CalendarClock}
        title={current.name}
        description={current.description || undefined}
        actions={
          <>
            <Switch
              checked={current.enabled}
              onChange={(checked) => void onToggle(checked)}
              label={t.detail.enabledLabel}
            />
            <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setEditing(true)}>
              {t.detail.edit}
            </Button>
            <IconButton
              icon={Play}
              label={t.runNowAria}
              size="sm"
              variant="ghost"
              disabled={firing}
              onClick={async () => {
                setFiring(true);
                await runNow(current.id);
                await fetchRuns(current.id);
                setFiring(false);
              }}
            />
            <IconButton
              icon={Trash2}
              label={t.deleteAria}
              size="sm"
              variant="danger-ghost"
              onClick={async () => {
                if (await confirm({ title: t.deleteConfirm(current.name), tone: 'danger' })) {
                  if (await remove(current.id)) router.push('/schedules');
                }
              }}
            />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600">
          <span>{recurrenceText(current.spec, language)}</span>
          <span className="text-neutral-400">{relative ? t.nextIn(relative) : t.noNextRun}</span>
          {current.spec.kind === 'recurring' && (
            <span className="text-xs text-neutral-400">{t.detail.timezone(current.spec.rule.timezone)}</span>
          )}
          {!current.enabled && current.autoPausedAt && (
            <span className="text-xs text-amber-700">{t.autoPausedHint}</span>
          )}
        </div>
      </PageHeader>

      <Card as="section" className="space-y-3">
        <CardTitle icon={Icon}>{t.detail.targetTitle}</CardTitle>
        <TargetSummary target={current.target} />
      </Card>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t.detail.historyTitle}
        </h2>
        {historyLoading || history.length === 0 ? (
          <Card padding="sm">
            <p className="text-sm text-neutral-500">
              {historyLoading ? t.detail.historyLoading : t.detail.historyEmpty}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {history.map((run) => (
              <RunRow key={run.id} run={run} target={current.target} />
            ))}
          </div>
        )}
      </section>

      <ScheduleForm
        open={editing}
        onClose={() => setEditing(false)}
        schedule={current}
        onSaved={(saved) => setCurrent(saved)}
      />
    </PageShell>
  );
}

// ---------------------------------------------------------------------------------------

function TargetSummary({ target }: { target: ScheduleTarget }) {
  const { schedules: t } = useTranslation();

  if (target.kind === 'manual') {
    return (
      <div className="space-y-2">
        <Badge tone="neutral">{t.targetKinds.manual}</Badge>
        <div>
          <p className="text-xs font-medium text-neutral-600">{t.detail.instructionsTitle}</p>
          <p className="mt-1 text-sm text-neutral-700">{target.instructions || t.noDescription}</p>
        </div>
      </div>
    );
  }

  if (target.kind === 'automation') {
    return (
      <div className="space-y-2">
        <Badge tone="neutral">{t.targetKinds.automation}</Badge>
        <div>
          <Link
            href={`/automations/${target.automationId}`}
            className="text-sm font-medium text-teal-600 underline-offset-2 hover:text-teal-700 hover:underline"
          >
            {t.detail.openAutomation}
          </Link>
        </div>
        {target.inputs && Object.keys(target.inputs).length > 0 && (
          <div>
            <p className="text-xs font-medium text-neutral-600">{t.detail.inputsTitle}</p>
            <pre className="mt-1 overflow-x-auto rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-700">
              {JSON.stringify(target.inputs, null, 2)}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{t.targetKinds.integration_action}</Badge>
        <span className="text-sm text-neutral-700">
          {target.integrationKey} / {target.actionName}
        </span>
      </div>
      {target.args && Object.keys(target.args).length > 0 && (
        <div>
          <p className="text-xs font-medium text-neutral-600">{t.detail.argsTitle}</p>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-700">
            {JSON.stringify(target.args, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function RunRow({ run, target }: { run: ScheduleRun; target: ScheduleTarget }) {
  const { schedules: t, language } = useTranslation();
  const duration =
    run.firedAt && run.finishedAt
      ? Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.firedAt)) / 1000))
      : null;

  return (
    <Card padding="sm" className="space-y-1.5" data-testid="schedule-run-row">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <span className="text-xs text-neutral-500">
          {t.detail.plannedFor}: {formatStamp(run.plannedFor, language)}
        </span>
        {run.firedAt && (
          <span className="text-xs text-neutral-500">
            {t.detail.firedAt}: {formatStamp(run.firedAt, language)}
          </span>
        )}
        {duration !== null && <span className="text-xs text-neutral-400">{t.detail.duration(duration)}</span>}
        {run.detail?.code && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-600">
            {run.detail.code}
          </span>
        )}
      </div>
      {run.note && (
        <p className="text-xs text-neutral-600">
          {t.detail.noteLabel}: {run.note}
        </p>
      )}
      {run.automationRunId && target.kind === 'automation' && (
        <Link
          href={`/automations/${target.automationId}`}
          className="inline-block font-mono text-[11px] text-teal-600 underline-offset-2 hover:underline"
        >
          {t.detail.runIdLabel} {run.automationRunId.slice(0, 8)}
        </Link>
      )}
    </Card>
  );
}
