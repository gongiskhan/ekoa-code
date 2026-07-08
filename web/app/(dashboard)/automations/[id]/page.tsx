"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plug, Save, Trash2 } from 'lucide-react';
import GoalEditor from '@/components/automations/goal-editor';
import StepList from '@/components/automations/step-list';
import RunViewer from '@/components/automations/run-viewer';
import RunHistory from '@/components/automations/run-history';
import RunActivityBar from '@/components/automations/run-activity-bar';
import { TriggerPicker } from '@/components/automations/trigger-picker';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';
import { useAutomationRun } from '@/hooks/useAutomationRun';
import { useDocumentTitleAlert } from '@/hooks/useDocumentTitleAlert';
import { buildPatchInfoByIndex } from '@/lib/automations/activity-state';
import { api, tryCall } from '@/lib/api';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Button, IconButton } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { LoadingState } from '@/components/ui/spinner';
import type { Step, StepStatus } from '@/types/automation';

interface TriggerRow {
  id: string;
  automationId: string;
  artifactId?: string;
  kind: 'webhook' | 'listener';
  integrationKey: string;
  eventName: string;
  registrationState: 'auto' | 'manual' | 'pending' | 'failed';
  createdAt: string;
}

export default function AutomationEditorPage() {
  useAutomationRun();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const router = useRouter();
  const confirm = useConfirm();
  const { automations } = useTranslation();
  const t = automations.editor;

  const current = useAutomationsStore((s) => s.current);
  const fetchOne = useAutomationsStore((s) => s.fetchOne);
  const update = useAutomationsStore((s) => s.update);
  const remove = useAutomationsStore((s) => s.remove);
  const planFromGoal = useAutomationsStore((s) => s.planFromGoal);
  const resetActiveRun = useAutomationsStore((s) => s.resetActiveRun);
  const recoverActiveRun = useAutomationsStore((s) => s.recoverActiveRun);
  const activeRunAutomationId = useAutomationsStore((s) => s.activeRun.automationId);
  const activeRunStatus = useAutomationsStore((s) => s.activeRun.status);
  const activeRunKind = useAutomationsStore((s) => s.activeRun.kind);
  const liveSteps = useAutomationsStore((s) => s.activeRun.liveSteps);
  const timeline = useAutomationsStore((s) => s.activeRun.timeline);

  const [draftName, setDraftName] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftSteps, setDraftSteps] = useState<Step[]>([]);
  const [saving, setSaving] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [tab, setTab] = useState<'editor' | 'history'>('editor');
  const [storedTrigger, setStoredTrigger] = useState<TriggerRow | null>(null);
  const lastSeenStatusRef = useRef<typeof activeRunStatus>('idle');

  // Fetch the actual persisted trigger row for accurate registrationState +
  // eventName. The denormalised Automation.trigger summary lacks
  // registrationState and uses pollAction (not eventName) for listeners,
  // so reading the trigger registry directly is the only way to render
  // the correct UI state on page reload.
  useEffect(() => {
    if (!id) return;
    void (async () => {
      const r = await tryCall(() => api.triggers.listForAutomation({ id }));
      setStoredTrigger(r.ok && r.data.items.length > 0 ? (r.data.items[0] as unknown as TriggerRow) : null);
    })();
  }, [id]);

  // Tab-title alert: prepend "(needs you)" while a run targeted at
  // this automation is paused for human action (CAPTCHA, MFA, payment
  // confirmation). Lets the user notice from another browser tab.
  useDocumentTitleAlert(
    activeRunAutomationId === id && activeRunStatus === 'paused_for_user',
    'needs you',
  );
  // `activeRunKind` is no longer used in JSX after the activity bar
  // replaced the old "Rehearsing…" pill, but referencing it here keeps
  // the selector hot in case it's needed for future state derivation.
  void activeRunKind;

  useEffect(() => {
    if (id) fetchOne(id);
  }, [id, fetchOne]);

  useEffect(() => {
    if (id && activeRunAutomationId && activeRunAutomationId !== id) {
      resetActiveRun();
    }
  }, [id, activeRunAutomationId, resetActiveRun]);

  // After a reload the in-memory store is empty, so an in-flight run for this
  // automation has to be recovered explicitly (per-run SSE streams need a run
  // id to subscribe to). No-op when a run for this automation is already live.
  useEffect(() => {
    if (id) void recoverActiveRun(id);
  }, [id, recoverActiveRun]);

  // Detect rehearsal completion: when a run targeted at this automation
  // transitions out of 'running', refetch so the refined steps land in
  // the editor.
  useEffect(() => {
    if (activeRunAutomationId !== id) return;
    const prev = lastSeenStatusRef.current;
    const curr = activeRunStatus;
    if (prev === 'running' && curr !== 'running' && curr !== 'idle') {
      fetchOne(id);
    }
    lastSeenStatusRef.current = curr;
  }, [activeRunAutomationId, activeRunStatus, id, fetchOne]);

  // Mid-rehearsal: every time a patch is applied, the engine has just
  // persisted the refined steps to the store. Refetch so the editor's
  // step list reflects what's actually being executed (otherwise the
  // run viewer renders stale step descriptions for newly-inserted
  // steps).
  const lastTimelineLen = useRef(0);
  useEffect(() => {
    if (activeRunAutomationId !== id) {
      lastTimelineLen.current = timeline.length;
      return;
    }
    const prev = lastTimelineLen.current;
    const curr = timeline.length;
    lastTimelineLen.current = curr;
    if (curr <= prev) return;
    // Only refetch on `applied` patches (insert/replace/skip) — these
    // change the step list. `proposing` and `aborted` don't.
    const newEvents = timeline.slice(prev);
    const hasApplied = newEvents.some(
      (e) => e.type === 'automation_run_patch' && e.phase === 'applied',
    );
    if (hasApplied) fetchOne(id);
  }, [timeline, activeRunAutomationId, id, fetchOne]);


  const liveStepsForThisAutomation = activeRunAutomationId === id ? liveSteps : {};

  useEffect(() => {
    if (current && current.id === id) {
      setDraftName(current.name);
      setDraftDescription(current.description);
      setDraftSteps(current.steps);
    }
  }, [current, id]);

  // Per-step indicators of whether the rehearsal fixer touched a step
  // (proposing in flight, inserted by fixer, rewritten). Must be
  // computed BEFORE the early-return below, otherwise the hook count
  // differs between the loading and loaded renders and React throws a
  // rules-of-hooks violation.
  const patchInfoByIndex = useMemo(
    () => (activeRunAutomationId === id ? buildPatchInfoByIndex(timeline) : {}),
    [activeRunAutomationId, id, timeline],
  );

  if (!current || current.id !== id) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-light" data-testid="automation-editor-page">
        <LoadingState label={t.loading} />
      </div>
    );
  }

  const dirty =
    draftName !== current.name ||
    draftDescription !== current.description ||
    JSON.stringify(draftSteps) !== JSON.stringify(current.steps);

  const save = async () => {
    setSaving(true);
    await update(current.id, { name: draftName, description: draftDescription, steps: draftSteps });
    setSaving(false);
  };

  const regenerate = async (newGoal: string) => {
    setPlanLoading(true);
    setDraftDescription(newGoal);
    // Pass the current automation id so the backend updates this record
    // in place (instead of creating a new one) and rehearses it.
    const res = await planFromGoal(newGoal, draftName, current.id);
    if (res.ok && res.automation) {
      setDraftSteps(res.automation.steps);
    }
    setPlanLoading(false);
  };

  // Map indexes to live step status for the editor's step cards
  const liveStatuses: Record<number, StepStatus> = {};
  for (const event of Object.values(liveStepsForThisAutomation)) {
    if (event.type === 'automation_run_step') {
      liveStatuses[event.stepIndex] = event.status;
    }
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-light" data-testid="automation-editor-page">
      <header className="sticky top-0 z-10 border-b border-line bg-surface px-6 py-4 md:px-8">
        <div className="flex items-center justify-between gap-3">
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder={t.namePlaceholder}
            aria-label={t.namePlaceholder}
            className="min-w-0 flex-1 border-0 bg-transparent font-display text-2xl font-semibold tracking-tight text-neutral-900 focus:outline-none focus-ring rounded"
          />
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={Save}
              disabled={!dirty || saving}
              loading={saving}
              onClick={save}
            >
              {saving ? t.saving : dirty ? t.save : t.saved}
            </Button>
            <IconButton
              icon={Trash2}
              label={t.deleteAria}
              size="sm"
              variant="danger-ghost"
              onClick={async () => {
                if (await confirm({ title: t.deleteConfirm(current.name), tone: 'danger' })) {
                  const ok = await remove(current.id);
                  if (ok) router.push('/automations');
                }
              }}
            />
          </div>
        </div>
        <div className="mt-4">
          <Tabs
            variant="pills"
            value={tab}
            onChange={(k) => setTab(k as 'editor' | 'history')}
            items={[
              { key: 'editor', label: t.tabEditor },
              { key: 'history', label: t.tabHistory },
            ]}
          />
        </div>
        {/* Activity bar — sits inside the sticky header so it stays
            visible whether the user is on Editor or Run-history tab,
            and however far they've scrolled in a long step list. */}
        <div className="mt-3">
          <RunActivityBar steps={draftSteps} scopedAutomationId={current.id} />
        </div>
      </header>

      {/* Slim banner for automations materialized by an integration
          (provisioner sets `source`). Editing stays fully available -
          the integration's actions execute these steps. */}
      {current.source && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-neutral-50 px-6 py-2.5 md:px-8"
          data-testid="automation-managed-banner"
        >
          <Plug size={13} className="shrink-0 text-neutral-400" aria-hidden />
          <p className="text-xs text-neutral-600">{t.managedBanner(current.source.integrationKey)}</p>
          <Link
            href="/integrations?tab=plataforma"
            className="text-xs font-medium text-teal-600 underline-offset-2 hover:text-teal-700 hover:underline"
          >
            {t.managedBannerLink}
          </Link>
        </div>
      )}

      {tab === 'editor' ? (
        <div className="grid gap-6 p-4 md:px-8 lg:grid-cols-2 lg:py-6">
          <div className="space-y-4">
            <GoalEditor
              goal={draftDescription}
              onChange={setDraftDescription}
              onRegenerate={regenerate}
              savedGoal={current.description}
              loading={planLoading}
            />
            <TriggerPicker
              automationId={current.id}
              initialTrigger={storedTrigger}
            />
            <StepList
              steps={draftSteps}
              selfAutomationId={current.id}
              onChange={setDraftSteps}
              liveStatuses={liveStatuses}
              patchInfoByIndex={patchInfoByIndex}
            />
          </div>
          <div>
            <RunViewer automationId={current.id} steps={draftSteps} />
          </div>
        </div>
      ) : (
        <div className="p-4 md:px-8 lg:py-6">
          <RunHistory automationId={current.id} />
        </div>
      )}
    </div>
  );
}
