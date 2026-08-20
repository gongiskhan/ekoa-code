'use client';

/**
 * ONE ACTION, opened (slice S2): what it does, what it did the last time it worked, when it is
 * scheduled, and the control that runs it now.
 *
 * ── WHY THIS IS READ-ONLY ─────────────────────────────────────────────────────────────────────
 *
 * An action's steps are the DEFINITION's (an api-call action's request template) or the bound
 * AUTOMATION's (a browser-steps / bash-cli action's plan). Editing either from here would be a
 * second authoring path over surfaces that already have one, and the edit would be silently
 * partial - an api-call action's request lives on a definition document with its own save gate and
 * its own guardrails. So this view SHOWS and links; it never writes a step.
 *
 * ── THE STATES THAT ARE NOT "EMPTY" ───────────────────────────────────────────────────────────
 *
 * Three sections here fetch (the samples, the bound automation, the run history) and each of them
 * can be OUTSTANDING, FAILED, or BACK-AND-EMPTY. Every one renders those three differently: a
 * failed read says so and offers a retry, an outstanding read says it is loading, and only a read
 * that actually came back empty says "nothing here". Telling a user their history is empty because
 * a request 500'd is the defect this file is written against.
 *
 * ── AND THE CONTROLS THE ACTOR CANNOT USE ARE NOT RENDERED ────────────────────────────────────
 *
 * `runNow` is offered only when the server would admit it: the integration is connected, and the
 * action either does not need approval or already has one. Both facts come from the SERVER's own
 * capability row (`connected`, `requiresApproval`, `approved`) - the fail-closed reading of
 * `mutates` lives in `api/src/integrations/action-consent.ts` and is never re-derived here. When it
 * is not offered, the row still reads: the reason is stated, with a link to the page that can fix
 * it. A button that exists to be refused is worse than no button.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, ChevronDown, Play, RefreshCw } from 'lucide-react';
import type { IntegrationCapabilityAction, RunRecord, Schedule } from '@ekoa/shared';
import { api } from '@/lib/api';
import { useTranslation } from '@/stores/i18n';
import { useIntegrationDetailStore, type ReadFailure } from '@/stores/integration-detail';
import { httpTemplateOf } from '@/lib/integrations/action-view';
import { formatStamp, recurrenceText } from '@/lib/schedules/recurrence-text';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type DetailCopy = ReturnType<typeof useTranslation>['pages']['integrations']['detail'];

/** The backing chip's words. `invalid` is the executor's own token for a package that contradicts
 *  itself, and it is shown rather than hidden: an action that cannot run should say so. */
function backingLabel(t: DetailCopy, backingType: string): string {
  if (backingType === 'api-call') return t.backing.apiCall;
  if (backingType === 'browser-steps') return t.backing.browserSteps;
  if (backingType === 'bash-cli') return t.backing.bashCli;
  return t.backing.invalid;
}

/**
 * The consent chip, straight off the server's row.
 *
 * `requiresApproval` is the API's fail-closed reading of `mutates` (only a literal `false` is a
 * read) and `approved` is the live approval this caller holds. Neither is recomputed here - a
 * second copy of that rule in the dashboard could disagree with the thing that actually refuses.
 */
function consentChip(t: DetailCopy, action: IntegrationCapabilityAction): { tone: BadgeTone; label: string } {
  if (!action.requiresApproval) return { tone: 'neutral', label: t.readOnly };
  return action.approved
    ? { tone: 'success', label: t.writeApproved }
    : { tone: 'warning', label: t.writeNeedsApproval };
}

/**
 * A run's status, in the words the run-history surface already uses.
 *
 * The SAME copy table, deliberately: `automations.runHistory.status` covers the statuses the engine
 * actually reports and the raw token is the fallback for one nobody has written copy for yet - the
 * reading `components/automations/run-history.tsx` takes, not a second one.
 */
function runStatusText(copy: Record<string, string>, status: string): string {
  return copy[status] ?? status;
}

function runTone(status: string): BadgeTone {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'danger';
  if (status === 'running') return 'info';
  return 'neutral';
}

/** One step of the sample, as the evidence row points at it. */
interface EvidenceStepSample {
  stepIndex: number;
  screenshotUrl?: string;
  excerpt?: string;
  truncated?: boolean;
}

/**
 * HOW WELL THE SAMPLE'S STEPS FIT THE PLAN BEING RENDERED.
 *
 * The evidence row numbers its steps by `stepIndex` INTO THE PLAN AS IT WAS WHEN THE RUN HAPPENED.
 * The plan rendered here is the one fetched for whatever automation the action's binding names
 * TODAY. Those are two different things the moment anyone edits the automation on `/automations` or
 * re-binds the action, and joining by index across that gap files one step's screenshot and output
 * under a DIFFERENT step and labels it as that step's evidence - a lie about what the system did,
 * rendered with no signal at all.
 *
 * WHAT IDENTITY IS ACTUALLY AVAILABLE, and it is the ceiling rather than a guarantee: the row pins
 * a `runId`, and nothing else identifies the plan. There is no plan hash on `RunRecord` and none on
 * the row, and the action `shape` fingerprints the BINDING (`action-consent.ts`'s `actionShape`),
 * not the automation's steps - so an edit to the bound automation's plan moves neither. The
 * strongest available check is therefore the RUN: a `runId` present in the history fetched for THIS
 * automation proves the sample's run executed THIS automation. It does not prove the plan is
 * unedited since, which is why a shape change (the one edit signal there is) still downgrades it.
 *
 *   'run'   - the run is in this automation's own history AND the action's shape is unchanged.
 *             Join silently: this is as identified as the data allows.
 *   'older' - no such proof (the history is bounded at 20, or has not come back, or the binding
 *             moved, or the action was re-authored), but every sample addresses a step this plan
 *             HAS and the two agree on length. Join, and SAY the samples may be from an earlier
 *             version of these steps.
 *   'none'  - the sample addresses steps this plan does not have, or the lengths disagree. Do not
 *             join at all; a partial join is the same misalignment with fewer symptoms.
 */
export type StepSampleFit = 'run' | 'older' | 'none';

export function stepSampleFit(input: {
  samples: EvidenceStepSample[];
  planLength: number;
  /** The run the sample pins, when the sample is an automation one. */
  evidenceRunId: string | undefined;
  /** The sample is a PREFIX of a longer run, so a shorter list is expected rather than a mismatch. */
  evidenceTruncated: boolean;
  /** The action's fingerprint is the one the run exercised. */
  shapeUnchanged: boolean;
  /** This automation's own run history, once it has come back. */
  runs: RunRecord[] | undefined;
}): StepSampleFit {
  const { samples, planLength, evidenceRunId, evidenceTruncated, shapeUnchanged, runs } = input;
  if (samples.length === 0 || planLength === 0) return 'none';
  if (samples.some((s) => s.stepIndex < 0 || s.stepIndex >= planLength)) return 'none';
  const lengthAgrees = evidenceTruncated ? samples.length <= planLength : samples.length === planLength;
  if (!lengthAgrees) return 'none';
  const runProved = shapeUnchanged
    && evidenceRunId !== undefined
    && (runs ?? []).some((run) => run.id === evidenceRunId);
  return runProved ? 'run' : 'older';
}

export interface ActionDetailProps {
  action: IntegrationCapabilityAction;
  /** Connected per the SERVER's capability row - the executor's own `not_connected`/`disabled`. */
  connected: boolean;
  /** The automation this action's binding names; absent for every api-call action. */
  automationId: string | undefined;
  /** This action's schedules, already filtered by the page. */
  schedules: Schedule[];
  /** The schedules list itself failed to load - distinct from "this action has none". */
  schedulesError: string | undefined;
  /** Re-run the schedules read; the list belongs to the page, so its retry does too. */
  onRetrySchedules: () => void;
  open: boolean;
  onToggle: () => void;
  onRun: () => void;
}

export function ActionDetail({
  action,
  connected,
  automationId,
  schedules,
  schedulesError,
  onRetrySchedules,
  open,
  onToggle,
  onRun,
}: ActionDetailProps) {
  const { pages, common, language, automations } = useTranslation();
  const t = pages.integrations.detail;
  const runStatusCopy = automations.runHistory.status as Record<string, string>;

  const capability = useIntegrationDetailStore((s) => s.capability);
  const integrationKey = useIntegrationDetailStore((s) => s.key);
  const evidence = useIntegrationDetailStore((s) => s.evidence[action.actionName]);
  const evidenceLoaded = useIntegrationDetailStore((s) => s.evidenceLoaded);
  const evidenceError = useIntegrationDetailStore((s) => s.evidenceError);
  const steps = useIntegrationDetailStore((s) => s.steps[action.actionName]);
  const stepsError = useIntegrationDetailStore((s) => s.stepsError[action.actionName]);
  const runs = useIntegrationDetailStore((s) => s.runs[action.actionName]);
  const runsError = useIntegrationDetailStore((s) => s.runsError[action.actionName]);
  const running = useIntegrationDetailStore((s) => Boolean(s.running[action.actionName]));
  const fetchSteps = useIntegrationDetailStore((s) => s.fetchSteps);
  const fetchRuns = useIntegrationDetailStore((s) => s.fetchRuns);
  const fetchEvidence = useIntegrationDetailStore((s) => s.fetchEvidence);

  // Lazy: an integration may carry two dozen actions and each open one costs two more requests.
  useEffect(() => {
    if (!open || !automationId) return;
    if (steps === undefined && !stepsError) void fetchSteps(action.actionName, automationId);
    if (runs === undefined && !runsError) void fetchRuns(action.actionName, automationId);
  }, [open, automationId, steps, stepsError, runs, runsError, fetchSteps, fetchRuns, action.actionName]);

  const chip = consentChip(t, action);
  const http = httpTemplateOf(capability, action.actionName);
  // THE SERVER'S OWN ADMISSION, mirrored: connected, and either not gated or already approved.
  const runnable = connected && (!action.requiresApproval || action.approved);
  const blockedReason = !connected
    ? t.cannotRunNotConnected
    : action.requiresApproval && !action.approved
      ? t.cannotRunNeedsApproval
      : undefined;
  // The sample was recorded against a DIFFERENT version of the action: the shape is the approval
  // fingerprint, so a mismatch means the bytes changed and the sample is about the old ones.
  const staleEvidence = evidence?.shape !== undefined && evidence.shape !== action.shape;
  const lastRun = runs?.[0];

  // The sample's step pointers, and whether they may be laid over the plan below at all - see
  // `stepSampleFit`. A sample that does not fit is dropped rather than partially joined.
  const automationSample = evidence?.evidence.kind === 'automation' ? evidence.evidence : undefined;
  const sampleFit = stepSampleFit({
    samples: automationSample?.steps ?? [],
    planLength: steps?.plan?.steps?.length ?? 0,
    evidenceRunId: automationSample?.runId,
    evidenceTruncated: automationSample?.truncated === true,
    shapeUnchanged: !staleEvidence,
    runs,
  });

  return (
    <Card padding="sm" className="space-y-3" data-testid={`integration-action-${action.actionName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-medium text-neutral-800">{action.actionName}</span>
            <Badge tone="neutral">{backingLabel(t, action.backingType)}</Badge>
            <Badge tone={chip.tone} data-testid={`integration-action-consent-${action.actionName}`}>
              {chip.label}
            </Badge>
            {action.authoringState === 'provisional' && <Badge tone="warning">{t.provisional}</Badge>}
            {action.authoringState === 'trusted' && <Badge tone="brand">{t.trusted}</Badge>}
          </div>
          <p className="text-sm text-neutral-600">{action.description}</p>
          <p className="truncate font-mono text-[11px] text-neutral-400" title={action.target}>
            {action.target}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          {runnable ? (
            <Button
              variant="secondary"
              size="sm"
              icon={Play}
              loading={running}
              disabled={running}
              onClick={onRun}
              data-testid={`integration-action-run-${action.actionName}`}
            >
              {running ? t.running : t.runNow}
            </Button>
          ) : (
            /* No control the server would refuse. The reason, and where to fix it. */
            <div className="max-w-xs text-right" data-testid={`integration-action-blocked-${action.actionName}`}>
              <p className="text-[11px] text-neutral-500">{blockedReason}</p>
              {action.requiresApproval && !action.approved && connected && (
                <Link
                  href="/integrations"
                  className="text-[11px] font-medium text-teal-600 underline-offset-2 hover:underline"
                >
                  {t.manageOnList}
                </Link>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="focus-ring flex items-center gap-1 rounded text-[11px] text-neutral-400 transition-colors hover:text-teal-600"
            data-testid={`integration-action-toggle-${action.actionName}`}
          >
            <ChevronDown size={12} className={open ? 'rotate-180 transition-transform' : 'transition-transform'} />
            <span>{open ? pages.integrations.showLess : pages.integrations.showMore}</span>
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-4 border-t border-neutral-100 pt-3">
          {/* --- WHAT IT DOES: the request template, or the bound automation's steps ---------- */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t.stepsTitle}</h3>

            {http && (
              <div>
                <p className="text-[11px] text-neutral-500">{t.requestTitle}</p>
                <p className="mt-1 overflow-x-auto rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-700">
                  <span className="font-semibold">{http.method}</span> {http.url}
                </p>
              </div>
            )}

            {automationId && (
              <AutomationSteps
                automationId={automationId}
                steps={steps}
                error={stepsError}
                evidenceSteps={sampleFit === 'none' ? [] : (automationSample?.steps ?? [])}
                samplesAreOlder={sampleFit === 'older'}
                onRetry={() => void fetchSteps(action.actionName, automationId)}
                t={t}
                common={common}
              />
            )}
          </section>

          {/* --- THE SAMPLE of the last validated run ---------------------------------------- */}
          <section className="space-y-2" data-testid={`integration-action-evidence-${action.actionName}`}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t.evidenceTitle}</h3>
            {evidenceError ? (
              /* The samples read is the STORE's, keyed by the integration, so its retry is one
                 store call away - the same affordance the steps and history rows already carry,
                 and the reason a person does not have to reload the whole page to recover. */
              <ErrorRow
                message={t.evidenceError}
                detail={evidenceError.detail}
                onRetry={integrationKey ? () => void fetchEvidence(integrationKey) : undefined}
                retryLabel={common.retry}
              />
            ) : evidence ? (
              <div className="space-y-2">
                <p className="text-[11px] text-neutral-500">{t.evidenceAt(formatStamp(evidence.validatedAt, language))}</p>
                {staleEvidence && (
                  <p className="text-[11px] text-amber-700" data-testid={`integration-evidence-stale-${action.actionName}`}>
                    {t.evidenceStale}
                  </p>
                )}
                {evidence.evidence.kind === 'api-call' && (
                  <div className="space-y-2">
                    <div>
                      <p className="text-[11px] text-neutral-500">{t.evidenceRequest}</p>
                      <p className="mt-1 overflow-x-auto rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-700">
                        <span className="font-semibold">{evidence.evidence.request.method}</span>{' '}
                        {evidence.evidence.request.url}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-neutral-500">
                        {t.evidenceResponse(evidence.evidence.response.status)}
                        {evidence.evidence.response.truncated ? ` - ${t.evidenceTruncated}` : ''}
                      </p>
                      {evidence.evidence.response.body && (
                        <pre className="mt-1 max-h-56 overflow-auto rounded-lg bg-neutral-50 p-2 font-mono text-xs text-neutral-700">
                          {evidence.evidence.response.body}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Only after the read came BACK: `evidenceLoaded` is what keeps an outstanding
                 fetch from rendering as "this action has never run". */
              <p className="text-xs text-neutral-500">
                {evidenceLoaded ? t.evidenceNone : t.evidenceLoading}
              </p>
            )}
          </section>

          {/* --- RUN HISTORY (automation-backed actions yield runs) --------------------------- */}
          {automationId && (
            <section className="space-y-2" data-testid={`integration-action-history-${action.actionName}`}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t.historyTitle}</h3>
              {runsError ? (
                <ErrorRow
                  message={t.historyError}
                  detail={runsError.detail}
                  onRetry={() => void fetchRuns(action.actionName, automationId)}
                  retryLabel={common.retry}
                />
              ) : runs === undefined ? (
                <p className="text-xs text-neutral-500">{t.historyLoading}</p>
              ) : runs.length === 0 ? (
                <p className="text-xs text-neutral-500">{t.historyEmpty}</p>
              ) : (
                <ul className="space-y-1">
                  {lastRun && (
                    <li className="text-[11px] text-neutral-500" data-testid={`integration-action-last-run-${action.actionName}`}>
                      {t.lastRun}: {runStatusText(runStatusCopy, lastRun.status)}
                      {lastRun.startedAt ? ` - ${formatStamp(lastRun.startedAt, language)}` : ''}
                    </li>
                  )}
                  {runs.map((run) => (
                    <li key={run.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1">
                      <Badge tone={runTone(run.status)}>{runStatusText(runStatusCopy, run.status)}</Badge>
                      <span className="text-[11px] text-neutral-500">
                        {/* A queued run has neither stamp yet, and `formatStamp` answers '' for an
                            absent one - which renders as a gap the reader has to interpret. Say
                            that it has not started instead. */}
                        {formatStamp(run.startedAt ?? run.finishedAt, language) || t.historyNoStamp}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-400">{run.id.slice(0, 8)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* --- SCHEDULES aimed at THIS action ----------------------------------------------- */}
          <section className="space-y-2" data-testid={`integration-action-schedules-${action.actionName}`}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{t.schedulesTitle}</h3>
            {schedulesError ? (
              <ErrorRow
                message={t.schedulesError}
                detail={schedulesError}
                onRetry={onRetrySchedules}
                retryLabel={common.retry}
              />
            ) : schedules.length === 0 ? (
              <p className="text-xs text-neutral-500">{t.schedulesEmpty}</p>
            ) : (
              <ul className="space-y-1">
                {schedules.map((schedule) => (
                  <li key={schedule.id}>
                    {/* A real link: the row navigates, and it is keyboard-reachable and
                        middle-clickable because it is an anchor rather than a div with onClick. */}
                    <Link
                      href={`/schedules/${schedule.id}`}
                      className="focus-ring flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 px-2 py-1 hover:bg-neutral-100"
                    >
                      <CalendarClock size={12} className="shrink-0 text-neutral-400" aria-hidden />
                      <span className="text-xs text-neutral-700">{schedule.name}</span>
                      <span className="text-[11px] text-neutral-500">{recurrenceText(schedule.spec, language)}</span>
                      {!schedule.enabled && <Badge tone="neutral">{common.disabled}</Badge>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Card>
  );
}

// -----------------------------------------------------------------------------------------

/**
 * The bound automation's steps, READ-ONLY, with the evidence run's screenshot and output resolved
 * onto the step it belongs to.
 *
 * The join is by INDEX, which is what the evidence row stores (`{runId, stepIndex}`) and what the
 * plan numbers its steps by. A step with no matching pointer simply shows no sample - true of every
 * step of an action that has never run, and of every step past the evidence row's cap.
 *
 * WHETHER THE JOIN MAY HAPPEN AT ALL is decided by `stepSampleFit` and arrives here already made:
 * `evidenceSteps` is EMPTY when the sample does not fit this plan, and `samplesAreOlder` is set
 * when it fits but nothing proves it was recorded against these steps. This component only renders
 * that verdict; it does not re-derive it.
 */
function AutomationSteps({
  automationId,
  steps,
  error,
  evidenceSteps,
  samplesAreOlder,
  onRetry,
  t,
  common,
}: {
  automationId: string;
  steps: { plan?: { steps?: { description?: string; tool?: string }[] } } | null | undefined;
  error: ReadFailure | undefined;
  evidenceSteps: EvidenceStepSample[];
  samplesAreOlder: boolean;
  onRetry: () => void;
  t: DetailCopy;
  common: ReturnType<typeof useTranslation>['common'];
}) {
  if (error) {
    return <ErrorRow message={t.stepsError} detail={error.detail} onRetry={onRetry} retryLabel={common.retry} />;
  }
  if (steps === undefined) return <p className="text-xs text-neutral-500">{t.stepsLoading}</p>;
  const plan = steps?.plan?.steps ?? [];
  if (plan.length === 0) return <p className="text-xs text-neutral-500">{t.stepsEmpty}</p>;

  const byIndex = new Map(evidenceSteps.map((s) => [s.stepIndex, s]));

  return (
    <div className="space-y-2">
      {samplesAreOlder && evidenceSteps.length > 0 && (
        /* The samples fit these steps but nothing proves they were recorded against them. Said
           once, above the list, rather than implied by silence under each screenshot. */
        <p className="text-[11px] text-amber-700" data-testid={`integration-steps-samples-older-${automationId}`}>
          {t.stepSamplesOlder}
        </p>
      )}
      <ol className="space-y-2" data-testid={`integration-steps-${automationId}`}>
        {plan.map((step, index) => {
          const sample = byIndex.get(index);
          return (
            <li key={index} className="space-y-1 border-l-2 border-neutral-100 pl-3">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 font-mono text-[11px] text-neutral-400">{index + 1}</span>
                <span className="text-xs text-neutral-700">{step.description || step.tool || '-'}</span>
              </div>
              {sample?.excerpt && (
                <pre className="max-h-32 overflow-auto rounded-lg bg-neutral-50 p-2 font-mono text-[11px] text-neutral-600">
                  {sample.excerpt}
                </pre>
              )}
              {sample?.screenshotUrl && (
                /* The plane serves these behind org + owner checks; the URL is a pointer into it,
                   never bytes copied onto the evidence row. */
                <a
                  href={api.withPreviewToken(api.resolveUrl(sample.screenshotUrl))}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full max-w-xs"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.withPreviewToken(api.resolveUrl(sample.screenshotUrl))}
                    alt={t.stepScreenshot(index)}
                    className="max-h-40 w-auto rounded border border-neutral-200 object-contain transition-colors hover:border-neutral-400"
                    loading="lazy"
                  />
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A failed READ, rendered where the thing it failed to read would have gone - never as an empty. */
function ErrorRow({
  message,
  detail,
  onRetry,
  retryLabel,
}: {
  message: string;
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5"
      data-testid="integration-detail-section-error"
    >
      <div className="flex min-w-0 items-center gap-2 text-red-600">
        <AlertTriangle size={14} className="shrink-0" aria-hidden />
        <span className="text-xs">{detail || message}</span>
      </div>
      {onRetry && retryLabel && (
        <Button variant="danger-ghost" size="sm" icon={RefreshCw} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
