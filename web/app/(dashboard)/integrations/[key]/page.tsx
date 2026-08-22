'use client';

/**
 * ONE INTEGRATION (slice S2) - `/integrations/[key]`.
 *
 * ── WHAT THIS PAGE IS, AND WHAT THE LIST PAGE KEEPS ───────────────────────────────────────────
 *
 * The list page owns CONNECTION and CONSENT: credentials, enable/disable, the write-gate approval
 * dialog, session capture. This page owns everything an integration DOES - its actions, what each
 * one runs, what it produced the last time it worked, the runs it has had, the schedules aimed at
 * it, and the control that runs it now. That split is why a card links here rather than expanding
 * further: the two answer different questions and only one of them needs a whole page.
 *
 * ── THE THREE STATES OF A PAGE THAT FETCHES ───────────────────────────────────────────────────
 *
 * A spinner is only honest while a request is OUTSTANDING. `requestedKey` is what keeps the very
 * first render (before the load effect has run) on the spinner instead of flashing not-found, and
 * the kept `ApiError` is what keeps a 500 from being reported as "this integration does not exist":
 *
 *   404               -> ABSENT. The server answers one uniform 404 for "no such integration",
 *                        "not visible to you" and "another tenant's" - no existence oracle - and it
 *                        is the only status that means there is nothing here for this user.
 *   anything else     -> FAILED TO LOAD. A 403, a 500, a dropped connection: the integration is
 *                        very probably still there, so the page offers a retry rather than a
 *                        headstone.
 *
 * ── AND A FAILED RUN IS NEVER SILENT ──────────────────────────────────────────────────────────
 *
 * `runNow` has an outcome a naive caller loses: the execute endpoint answers 200 with
 * `success: false` for everything that happened to the routed call. The store turns all three
 * shapes (transport failure, admitted-but-failed, refused by the write gate) into one outcome, and
 * this page reports every non-ok one as a toast at the moment of the click.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, Plug, RefreshCw, Zap } from 'lucide-react';
import type { Schedule } from '@ekoa/shared';
import { useIntegrationDetailStore } from '@/stores/integration-detail';
import { useSchedulesStore } from '@/stores/schedules';
import { useTranslation } from '@/stores/i18n';
import { toast } from '@/stores/toast';
import { automationIdOf } from '@/lib/integrations/action-view';
import { ActionDetail, DepartedActionNotes } from '@/components/integrations/action-detail';
import { PageShell } from '@/components/ui/page-shell';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LoadingState } from '@/components/ui/spinner';

type DetailCopy = ReturnType<typeof useTranslation>['pages']['integrations']['detail'];

/**
 * A run failure the server named with a CODE and no prose, in the reader's own words.
 *
 * `runCodes` covers two vocabularies that do not collide: the executor's own lower_snake outcome
 * tokens (`upstream_error`, `not_connected`, …) and the transport's UPPER_SNAKE envelope codes
 * (`NETWORK_ERROR`, …). `runFailed` is the fallback for a token nobody has written copy for yet -
 * never the token itself, which names something in the system and nothing the reader can act on.
 */
function runCodeText(t: DetailCopy, code: string | undefined): string {
  return (code !== undefined ? t.runCodes[code] : undefined) ?? t.runFailed;
}

export default function IntegrationDetailPage() {
  const params = useParams<{ key: string }>();
  const key = typeof params?.key === 'string' ? decodeURIComponent(params.key) : '';
  const searchParams = useSearchParams();
  const { pages, common } = useTranslation();
  const t = pages.integrations.detail;

  const load = useIntegrationDetailStore((s) => s.load);
  const reset = useIntegrationDetailStore((s) => s.reset);
  const runNow = useIntegrationDetailStore((s) => s.runNow);
  const clearActionError = useIntegrationDetailStore((s) => s.clearActionError);
  const capability = useIntegrationDetailStore((s) => s.capability);
  const capabilityError = useIntegrationDetailStore((s) => s.capabilityError);
  const loading = useIntegrationDetailStore((s) => s.loading);
  const requestedKey = useIntegrationDetailStore((s) => s.requestedKey);

  // The action's schedules come from the schedules store filtered by TARGET; there is no
  // per-target server query and inventing one for this page would be a second listing rule.
  const schedules = useSchedulesStore((s) => s.items);
  const schedulesLoadError = useSchedulesStore((s) => s.loadError);
  const fetchSchedules = useSchedulesStore((s) => s.fetchSchedules);

  /** Which action is expanded. `?action=` deep-links one, so a schedule or a link can land on it. */
  const linkedAction = searchParams?.get('action') ?? null;
  const [openAction, setOpenAction] = useState<string | null>(linkedAction);
  const lastLinkedAction = useRef(linkedAction);

  // THE DEEP LINK IS READ ON EVERY CHANGE, not only at mount. A client-side navigation from
  // `?action=a` to `?action=b` stays on this route, so React re-renders this component without
  // remounting it and a mount-only read leaves the previously opened action expanded while the
  // link the user just followed does nothing. The previous value is remembered so this only fires
  // when the PARAM moved: a user toggling a panel open must not be undone by a re-render.
  useEffect(() => {
    if (linkedAction === lastLinkedAction.current) return;
    lastLinkedAction.current = linkedAction;
    setOpenAction(linkedAction);
  }, [linkedAction]);

  useEffect(() => {
    if (key) void load(key);
    return () => reset();
  }, [key, load, reset]);

  useEffect(() => {
    void fetchSchedules();
  }, [fetchSchedules]);

  const onRun = useCallback(
    async (actionName: string) => {
      const outcome = await runNow(key, actionName);
      if (outcome.ok) {
        toast.success(t.runStarted);
        return;
      }
      // Every failure reaches the user, including the 200-with-success-false one - and it reaches
      // them as a SENTENCE. The store hands over the server's own prose when there was any and the
      // machine token when there was not; `runCodeText` turns the token into copy in the reader's
      // language, because `upstream_error` in a toast is a word from an internal vocabulary
      // presented as an explanation.
      toast.error(outcome.error || runCodeText(t, outcome.errorCode), { testId: 'integration-run-error' });
      clearActionError();
    },
    [key, runNow, clearActionError, t],
  );

  /**
   * Schedules that fire THIS integration's actions, grouped by the action they fire.
   *
   * BOTH TARGET KINDS COUNT, and the second one is why this is not a one-line filter. A schedule
   * can name the `integration_action` directly, or it can name the AUTOMATION the action is bound
   * to - and for a browser-steps / bash-cli action those reach the same execution: the runs a
   * `kind: 'automation'` schedule produces are the very runs the history section on this page
   * attributes to the action, because that section is keyed by the bound automation id. Counting
   * only the first kind told a person "this action is not scheduled" about an action that fires
   * every morning, which is what the copy in `schedulesEmpty` claims and what this now means.
   */
  const schedulesByAction = useMemo(() => {
    const map: Record<string, Schedule[]> = {};
    // Bound automation -> the actions of THIS integration it backs. An automation may back more
    // than one action, so this is a list and not a single name.
    const actionsByAutomation = new Map<string, string[]>();
    for (const action of capability?.actions ?? []) {
      const automationId = automationIdOf(capability, action.actionName);
      if (!automationId) continue;
      actionsByAutomation.set(automationId, [...(actionsByAutomation.get(automationId) ?? []), action.actionName]);
    }
    const push = (actionName: string, schedule: Schedule) => {
      (map[actionName] ??= []).push(schedule);
    };
    for (const schedule of schedules) {
      const target = schedule.target;
      if (target.kind === 'integration_action') {
        if (target.integrationKey === key) push(target.actionName, schedule);
      } else if (target.kind === 'automation') {
        for (const actionName of actionsByAutomation.get(target.automationId) ?? []) push(actionName, schedule);
      }
    }
    return map;
  }, [schedules, key, capability]);

  if (!capability || capability.integration.key !== key) {
    if (requestedKey === key && !loading) {
      // 404 is the ONE answer that means "there is nothing here for you". Everything else is a
      // failure to read something that still exists.
      const absent = capabilityError === null || capabilityError.status === 404;
      return (
        <PageShell testId="integration-detail-page">
          <PageHeader icon={Plug} title={pages.integrations.title} />
          {absent ? (
            <EmptyState
              icon={Plug}
              title={t.notFoundTitle}
              description={t.notFoundDescription}
              action={
                <Link href="/integrations">
                  <Button variant="primary" size="sm">{t.back}</Button>
                </Link>
              }
            />
          ) : (
            <EmptyState
              icon={AlertTriangle}
              title={t.loadErrorTitle}
              description={capabilityError.message}
              action={
                <div className="flex items-center gap-2" data-testid="integration-detail-load-error">
                  <Button variant="primary" size="sm" icon={RefreshCw} onClick={() => void load(key)}>
                    {common.retry}
                  </Button>
                  <Link href="/integrations">
                    <Button variant="secondary" size="sm">{t.back}</Button>
                  </Link>
                </div>
              }
            />
          )}
        </PageShell>
      );
    }
    return (
      <PageShell testId="integration-detail-page">
        <LoadingState label={t.loading} />
      </PageShell>
    );
  }

  const definition = capability.integration;
  const displayName = typeof definition.displayName === 'string' && definition.displayName !== ''
    ? definition.displayName
    : definition.key;

  return (
    <PageShell testId="integration-detail-page" width="wide">
      <PageHeader
        icon={Plug}
        title={displayName}
        description={typeof definition.description === 'string' ? definition.description : undefined}
        actions={
          <>
            <Badge tone={capability.connected ? 'success' : 'neutral'} dot data-testid="integration-detail-connected">
              {capability.connected ? common.enabled : pages.integrations.available}
            </Badge>
            <Link href="/integrations">
              <Button variant="secondary" size="sm">{t.back}</Button>
            </Link>
          </>
        }
      />

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {t.actionsTitle}
        </h2>
        {capability.actions.length === 0 ? (
          <Card padding="sm">
            <p className="flex items-center gap-2 text-sm text-neutral-500">
              <Zap size={14} className="text-neutral-400" aria-hidden />
              {t.actionsEmpty}
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {capability.actions.map((action) => (
              <ActionDetail
                key={action.actionName}
                action={action}
                connected={capability.connected}
                automationId={automationIdOf(capability, action.actionName)}
                schedules={schedulesByAction[action.actionName] ?? []}
                schedulesError={schedulesLoadError}
                onRetrySchedules={() => void fetchSchedules()}
                open={openAction === action.actionName}
                onToggle={() => setOpenAction(openAction === action.actionName ? null : action.actionName)}
                onRun={() => void onRun(action.actionName)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Notes whose ACTION is no longer on this capability. They have no card to live under, so
          without this section they are invisible and unerasable while still reaching the author's
          prompts - which is what the review found, and what the module header and the findings
          ledger both wrongly claimed was already handled. Renders nothing when there are none. */}
      <DepartedActionNotes liveActionNames={capability.actions.map((a) => a.actionName)} t={t} />
    </PageShell>
  );
}
