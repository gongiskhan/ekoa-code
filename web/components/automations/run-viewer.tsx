"use client";

import { Hand, Play, Square, ThumbsDown, ThumbsUp, Wand2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAutomationsStore } from '@/stores/automations';
import { useTranslation } from '@/stores/i18n';
import { api, tryCall } from '@/lib/api';
import { findLatestKnownStepIndex, findRunningStepIndex } from '@/lib/automations/activity-state';
import type {
  AutomationRunPatchEvent,
  IntegrationErrorDetails,
  Step,
  StepOutput,
} from '@/types/automation';
import ConsentDialog from './consent-dialog';
import LocalCommandResultPanel from './results/local-command-result-panel';
import ApiCallResultPanel from './results/api-call-result-panel';
import EkoaActionResultPanel from './results/ekoa-action-result-panel';

interface RunViewerProps {
  automationId: string;
  steps: Step[];
}

export default function RunViewer({ automationId, steps }: RunViewerProps) {
  const activeRun = useAutomationsStore((s) => s.activeRun);
  const current = useAutomationsStore((s) => s.current);
  const start = useAutomationsStore((s) => s.start);
  const cancel = useAutomationsStore((s) => s.cancel);
  const resume = useAutomationsStore((s) => s.resume);
  const submitFeedback = useAutomationsStore((s) => s.submitFeedback);
  const reset = useAutomationsStore((s) => s.resetActiveRun);
  const { automations } = useTranslation();
  const t = automations.runViewer;
  const [feedbackOpen, setFeedbackOpen] = useState<string | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  // Inputs the user provides on Run, indexed by field name. Persisted
  // for the editor session so re-runs don't re-prompt for the same
  // value — but cleared when the user navigates away (zustand store
  // is in-memory only).
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
  const [showInputForm, setShowInputForm] = useState(false);
  const inputFields = useMemo(
    () => current?.inputSchema?.fields ?? [],
    [current?.inputSchema?.fields],
  );
  const requiredInputs = useMemo(
    () => inputFields.filter((f) => f.required),
    [inputFields],
  );
  const missingRequired = useMemo(
    () => requiredInputs.filter((f) => !(runInputs[f.name] ?? f.defaultValue ?? '').trim()),
    [requiredInputs, runInputs],
  );

  function triggerRun(force = false) {
    // Show the input form on the FIRST click if there are any inputs
    // (so the user sees what's available and can override). Once the
    // form is visible, "Run with these inputs" forces past it — the
    // engine will try to extract any missing required values from
    // page content via the verify-step extractor; if that fails, the
    // integration step surfaces a clean error.
    if (!force && inputFields.length > 0 && !showInputForm) {
      setShowInputForm(true);
      return;
    }
    const merged: Record<string, string> = {};
    for (const f of inputFields) {
      const v = runInputs[f.name] ?? f.defaultValue ?? '';
      if (v) merged[f.name] = v;
    }
    setShowInputForm(false);
    reset();
    start(automationId, merged);
  }

  const isRunning = activeRun.status === 'running';
  const isPausedForUser = activeRun.status === 'paused_for_user';
  const liveSteps = activeRun.liveSteps;

  // Group patch events by stepIndex so each step card can show its own
  // self-correction history without us scanning the timeline twice.
  const patchesByStep = useMemo(() => {
    const out = new Map<number, AutomationRunPatchEvent[]>();
    for (const ev of activeRun.timeline) {
      if (ev.type === 'automation_run_patch') {
        const list = out.get(ev.stepIndex) ?? [];
        list.push(ev);
        out.set(ev.stepIndex, list);
      }
    }
    return out;
  }, [activeRun.timeline]);

  // "What's happening right now" lives in the page-level RunActivityBar
  // now (mounted in the editor's sticky header). The run viewer keeps
  // the per-step history (PatchNotice inside each step card) and the
  // rich PauseForUserBanner with the screenshot — those are the *log*
  // and the *full detail*, complementing the bar's *summary*.

  // Auto-scroll: align the latest active step to the TOP of the
  // viewport. That way the user always sees the next 2–3 upcoming
  // steps below it (the previous behaviour of pinning to the bottom
  // hid future context). We follow whichever index the activity state
  // would highlight: a `running` step, else the highest-known one.
  const stepRefs = useRef(new Map<number, HTMLLIElement>());
  const setStepRef = (index: number, node: HTMLLIElement | null) => {
    if (node) stepRefs.current.set(index, node);
    else stepRefs.current.delete(index);
  };
  const timelineLength = activeRun.timeline.length;
  const focusIndex = useMemo(() => {
    const running = findRunningStepIndex(liveSteps);
    if (running != null) return running;
    const latest = findLatestKnownStepIndex(liveSteps);
    return latest ?? null;
  }, [liveSteps]);
  useEffect(() => {
    if (focusIndex == null) return;
    // Anchor on the BOTTOM of the *next* step, not the top of the
    // running one. Reasons:
    //   - The running step renders its screenshot inside its <li>, so
    //     a `block: 'start'` on the running step pushes the screenshot
    //     out of view as soon as it's tall.
    //   - Pinning the bottom of step N+1 means step N (running, with
    //     screenshot) sits naturally above it and the upcoming step
    //     stays fully visible — the user always sees both "what just
    //     happened" and "what's next".
    const targetIndex =
      stepRefs.current.has(focusIndex + 1) ? focusIndex + 1 : focusIndex;
    const target = stepRefs.current.get(targetIndex);
    if (!target) return;

    // Initial scroll. Smooth so the user can track the motion.
    target.scrollIntoView({ behavior: 'smooth', block: 'end' });

    // The hard part: screenshots inside step N's <li> have no
    // intrinsic height until they load, so the initial scrollIntoView
    // anchors against an under-counted layout. Once the <img> loads,
    // it grows and pushes step N+1 out of view — that's the "cut in
    // half" symptom. Solution: watch the focused step's subtree for
    // size changes and re-scroll instantly when they happen.
    const focused = stepRefs.current.get(focusIndex);
    const observed = focused ?? target;
    const reanchor = () => {
      const t = stepRefs.current.get(targetIndex);
      if (!t) return;
      // Use `auto` (instant) for re-anchors so we don't get a
      // visible smooth-scroll wobble each time an image loads.
      t.scrollIntoView({ behavior: 'auto', block: 'end' });
    };
    const ro = new ResizeObserver(() => reanchor());
    ro.observe(observed);
    return () => ro.disconnect();
  }, [focusIndex, timelineLength]);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-neutral-900">{t.title}</h2>
          <RunStatusBadge status={activeRun.status} />
          {activeRun.summary && (
            <span className="text-xs text-neutral-500 truncate">{activeRun.summary}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isRunning || isPausedForUser ? (
            <button
              type="button"
              onClick={() => cancel()}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              <Square size={12} />
              {t.cancel}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => triggerRun()}
              disabled={steps.length === 0}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50"
            >
              <Play size={12} />
              {activeRun.status === 'idle' ? t.runAction : t.rerun}
            </button>
          )}
        </div>
      </div>

      {showInputForm && inputFields.length > 0 && (
        <div className="px-3 py-3 border-b border-neutral-200 bg-neutral-50">
          <div className="text-xs font-medium text-neutral-700 mb-2">
            {t.inputsHelp}
          </div>
          <div className="space-y-2">
            {inputFields.map((f) => (
              <label key={f.name} className="block">
                <div className="text-xs font-medium text-neutral-700">
                  {f.name}
                  {f.required && <span className="text-amber-600 ml-0.5" title={t.requiredHint}>*</span>}
                </div>
                {f.description && (
                  <div className="text-xs text-neutral-500 leading-tight mb-1">
                    {f.description}
                  </div>
                )}
                <input
                  type="text"
                  value={runInputs[f.name] ?? f.defaultValue ?? ''}
                  onChange={(e) =>
                    setRunInputs((prev) => ({ ...prev, [f.name]: e.target.value }))
                  }
                  placeholder={f.defaultValue ?? t.autoExtractPlaceholder}
                  className="w-full text-sm px-2 py-1 border border-neutral-300 rounded focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => triggerRun(true)}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-teal-600 text-white hover:bg-teal-700"
            >
              <Play size={12} />
              {t.runAction}
            </button>
            <button
              type="button"
              onClick={() => setShowInputForm(false)}
              className="text-xs px-2 py-1 rounded text-neutral-600 hover:bg-neutral-200"
            >
              {t.cancel}
            </button>
            {missingRequired.length > 0 && (
              <span className="text-xs text-amber-600">
                {t.fieldsBlank(missingRequired.length)}
              </span>
            )}
          </div>
        </div>
      )}

      {activeRun.status === 'awaiting_integration' && (
        <div className="p-3 border-b border-amber-100 bg-amber-50 text-sm text-amber-900">
          {t.awaitingPrefix}<strong>{activeRun.awaitingService}</strong>{t.awaitingSuffix}
        </div>
      )}

      {activeRun.status === 'awaiting_consent' && activeRun.consentRequest && activeRun.runId && (
        <ConsentDialog
          shape={activeRun.consentRequest.shape}
          argv={activeRun.consentRequest.argv}
          description={activeRun.consentRequest.description}
          onDecision={async (decision) => {
            await tryCall(() =>
              api.automations.consent({
                id: activeRun.runId!,
                decision,
                shape: activeRun.consentRequest!.shape,
              }),
            );
          }}
        />
      )}

      {activeRun.status === 'awaiting_daemon' && activeRun.daemonRequest && (
        <div className="p-3 border-b border-orange-100 bg-orange-50 text-sm text-orange-900">
          {t.daemonPrefix}{activeRun.daemonRequest.capability === 'bash' ? t.daemonRunCommand : t.daemonDriveBrowser}{t.daemonSuffix}
          <span className="block mt-1 text-xs text-orange-800">{activeRun.daemonRequest.reason}</span>
        </div>
      )}

      {isPausedForUser && activeRun.pauseRequest && (
        <PauseForUserBanner
          stepIndex={activeRun.pauseRequest.stepIndex}
          reasoning={activeRun.pauseRequest.reasoning}
          userInstructions={activeRun.pauseRequest.userInstructions}
          screenshotUrl={activeRun.pauseRequest.screenshotUrl}
          onContinue={() => resume()}
          onCancel={() => cancel()}
        />
      )}

      {activeRun.error && (
        <div className="p-3 border-b border-red-100 bg-red-50 text-sm text-red-900 min-w-0 break-words">
          {t.errorPrefix}{activeRun.error}
        </div>
      )}

      <ol className="divide-y divide-neutral-100">
        {steps.map((step, i) => {
          const live = liveSteps[i];
          const patches = patchesByStep.get(i) ?? [];
          return (
            <li
              key={step.id}
              ref={(node) => setStepRef(i, node)}
              className="p-3 space-y-2 scroll-mb-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-neutral-500">{t.stepLabel(i + 1)}</div>
                  <div className="text-sm text-neutral-900 line-clamp-2">{step.description}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {live && <TierBadge tier={live.type === 'automation_run_step' ? live.tier : 'cache'} />}
                  {live && live.type === 'automation_run_step' && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      live.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                      live.status === 'failed' ? 'bg-red-100 text-red-800' :
                      live.status === 'running' ? 'bg-amber-100 text-amber-800' :
                      'bg-neutral-100 text-neutral-700'
                    }`}>
                      {automations.steps.status[live.status]}
                    </span>
                  )}
                  {live && live.type === 'automation_run_step' && (
                    <span className="text-xs text-neutral-400">{live.durationMs}ms</span>
                  )}
                </div>
              </div>

              {live && live.type === 'automation_run_step' && live.error && (
                <div className="text-xs text-red-700 bg-red-50 rounded px-2 py-1.5 space-y-1.5 min-w-0 break-words">
                  <div className="font-medium line-clamp-3" title={live.error}>{live.error}</div>
                  {isIntegrationErrorDetails(live.errorDetails) && (
                    <IntegrationErrorPanel details={live.errorDetails} />
                  )}
                </div>
              )}

              {patches.length > 0 && (
                <div className="space-y-1.5">
                  {patches.map((p, idx) => (
                    <PatchNotice key={idx} event={p} />
                  ))}
                </div>
              )}

              {/* Type-aware result panels for non-browser step types */}
              {live && live.type === 'automation_run_step' && live.output && (
                <StepOutputPanel
                  output={live.output as StepOutput}
                  liveChunks={(activeRun.liveChunks ?? {})[i]}
                />
              )}

              {/* Live stdout/stderr stream for in-flight local_command steps */}
              {step.type === 'local_command' && (!live || (live.type === 'automation_run_step' && !live.output)) && activeRun.liveChunks?.[i] && (
                <div className="text-xs space-y-1.5">
                  {activeRun.liveChunks[i].stdout && (
                    <pre className="bg-neutral-900 text-neutral-100 rounded p-2 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                      {activeRun.liveChunks[i].stdout}
                    </pre>
                  )}
                  {activeRun.liveChunks[i].stderr && (
                    <pre className="bg-red-950 text-red-100 rounded p-2 font-mono overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap break-words">
                      {activeRun.liveChunks[i].stderr}
                    </pre>
                  )}
                </div>
              )}

              {live && live.type === 'automation_run_step' && live.screenshotUrl && (
                <a
                  href={api.resolveUrl(live.screenshotUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full max-w-md"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={api.resolveUrl(live.screenshotUrl)}
                    alt={t.stepScreenshotAlt(i + 1)}
                    className="rounded border border-neutral-200 hover:border-neutral-400 transition-colors"
                    loading="lazy"
                  />
                </a>
              )}

              {/* Feedback */}
              {live && live.type === 'automation_run_step' && live.status !== 'pending' && live.status !== 'running' && activeRun.runId && (
                <div className="flex items-center gap-2 text-xs">
                  {feedbackOpen === step.id ? (
                    <div className="flex items-center gap-2 w-full">
                      <input
                        type="text"
                        value={feedbackNote}
                        onChange={(e) => setFeedbackNote(e.target.value)}
                        placeholder={t.correctionPlaceholder}
                        className="flex-1 rounded border border-neutral-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          await submitFeedback({
                            automationId,
                            runId: activeRun.runId!,
                            stepId: step.id,
                            kind: 'correction',
                            note: feedbackNote.trim(),
                          });
                          setFeedbackOpen(null);
                          setFeedbackNote('');
                        }}
                        className="px-2 py-1 rounded bg-teal-600 text-white hover:bg-teal-700"
                      >
                        {t.save}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setFeedbackOpen(null); setFeedbackNote(''); }}
                        className="px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50"
                      >
                        {t.cancel}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => submitFeedback({ automationId, runId: activeRun.runId!, stepId: step.id, kind: 'thumbs_up' })}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-emerald-50 text-emerald-700"
                        title={t.thumbsUp}
                      >
                        <ThumbsUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => submitFeedback({ automationId, runId: activeRun.runId!, stepId: step.id, kind: 'thumbs_down' })}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-red-50 text-red-700"
                        title={t.thumbsDown}
                      >
                        <ThumbsDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setFeedbackOpen(step.id)}
                        className="px-1.5 py-0.5 rounded hover:bg-neutral-100 text-neutral-700"
                      >
                        {t.suggestCorrection}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      {steps.length === 0 && (
        <div className="p-4 text-sm text-neutral-500">
          {t.addStepsHint}
        </div>
      )}
    </div>
  );
}

type RunStatusBadgeStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_integration' | 'paused_for_user' | 'awaiting_consent' | 'awaiting_daemon';

function RunStatusBadge({ status }: { status: RunStatusBadgeStatus }) {
  const { automations } = useTranslation();
  const tones: Record<RunStatusBadgeStatus, string> = {
    idle: 'bg-neutral-200 text-neutral-700',
    running: 'bg-amber-200 text-amber-900',
    completed: 'bg-emerald-200 text-emerald-900',
    failed: 'bg-red-200 text-red-900',
    cancelled: 'bg-neutral-200 text-neutral-700',
    awaiting_integration: 'bg-amber-200 text-amber-900',
    paused_for_user: 'bg-cyan-200 text-cyan-900',
    awaiting_consent: 'bg-orange-200 text-orange-900',
    awaiting_daemon: 'bg-orange-200 text-orange-900',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${tones[status]}`}>
      {automations.runViewer.status[status]}
    </span>
  );
}

function PauseForUserBanner({
  stepIndex,
  reasoning,
  userInstructions,
  screenshotUrl,
  onContinue,
  onCancel,
}: {
  stepIndex: number;
  reasoning: string;
  userInstructions: string;
  screenshotUrl?: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { automations } = useTranslation();
  const t = automations.runViewer;
  return (
    <div className="border-b-4 border-cyan-500 bg-cyan-50 p-4">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-cyan-200 p-2 shrink-0">
          <Hand size={18} className="text-cyan-900" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-cyan-950">
            {t.needsHelpOnStep(stepIndex + 1)}
          </h3>
          <p className="mt-1 text-sm text-cyan-900 leading-relaxed">
            {userInstructions}
          </p>
          {reasoning && (
            <p className="mt-1 text-xs text-cyan-800/85 italic">{reasoning}</p>
          )}
          <div className="mt-3 text-xs text-cyan-800/85">
            {t.browserOpenHint}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-cyan-600 text-white hover:bg-cyan-700 font-medium"
            >
              <Play size={14} />
              {t.continue}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              <Square size={14} />
              {t.stopRun}
            </button>
          </div>
        </div>
        {screenshotUrl && (
          <a
            href={api.resolveUrl(screenshotUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="block shrink-0"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={api.resolveUrl(screenshotUrl)}
              alt={t.pausedAlt}
              className="h-32 rounded border border-cyan-200 hover:border-cyan-400"
              loading="lazy"
            />
          </a>
        )}
      </div>
    </div>
  );
}

function TierBadge({ tier }: { tier: 'cache' | 'vision' | 'cache-then-vision' }) {
  const { automations } = useTranslation();
  const tierLabels = automations.runViewer.tier;
  const label = tier === 'cache' ? tierLabels.cached : tier === 'vision' ? tierLabels.vision : tierLabels.recovered;
  const tone = tier === 'cache' ? 'bg-emerald-50 text-emerald-700' : tier === 'vision' ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-800';
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${tone}`} title={tier}>
      {label}
    </span>
  );
}

function isIntegrationErrorDetails(d: unknown): d is IntegrationErrorDetails {
  if (!d || typeof d !== 'object') return false;
  const obj = d as Record<string, unknown>;
  if (!obj.request || typeof obj.request !== 'object') return false;
  const req = obj.request as Record<string, unknown>;
  return typeof req.method === 'string' && typeof req.url === 'string';
}

function IntegrationErrorPanel({ details }: { details: IntegrationErrorDetails }) {
  const [open, setOpen] = useState(false);
  const { request, response, transportError } = details;
  const { automations } = useTranslation();
  const t = automations.runViewer;
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded border border-red-200 bg-white/60 text-red-900"
    >
      <summary className="cursor-pointer select-none px-2 py-1 text-xs font-medium hover:bg-red-50 rounded">
        {t.toggleReqRes(open)}
        {response ? ` (HTTP ${response.status})` : transportError ? t.networkSuffix : ''}
      </summary>
      <div className="px-2 py-2 space-y-2 text-[11px] font-mono leading-snug">
        <Section label={t.section.request}>
          <div>
            <span className="text-red-600/70">{request.method}</span>{' '}
            <span className="break-all">{request.url}</span>
          </div>
          {Object.keys(request.headers).length > 0 && (
            <KvBlock label={t.labelHeaders} rows={request.headers} />
          )}
          {request.body && <CodeBlock label={t.labelBody}>{request.body}</CodeBlock>}
        </Section>
        {response && (
          <Section label={t.section.response}>
            <div>
              <span className="text-red-600/70">HTTP {response.status}</span>
              {response.statusText ? <span> {response.statusText}</span> : null}
            </div>
            {Object.keys(response.headers).length > 0 && (
              <KvBlock label={t.labelHeaders} rows={response.headers} />
            )}
            <CodeBlock label={t.labelBody}>{response.body || t.empty}</CodeBlock>
          </Section>
        )}
        {transportError && !response && (
          <Section label={t.section.transportError}>
            <div>{transportError}</div>
          </Section>
        )}
      </div>
    </details>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-red-700/70">{label}</div>
      <div className="mt-0.5 space-y-1">{children}</div>
    </div>
  );
}

function KvBlock({ label, rows }: { label: string; rows: Record<string, string> }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-red-700/60">{label}</div>
      <div className="mt-0.5">
        {Object.entries(rows).map(([k, v]) => (
          <div key={k} className="break-all">
            <span className="text-red-600/70">{k}:</span> {v}
          </div>
        ))}
      </div>
    </div>
  );
}

function CodeBlock({ label, children }: { label: string; children: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-red-700/60">{label}</div>
      <pre className="mt-0.5 whitespace-pre-wrap break-all rounded bg-red-50 px-2 py-1.5 text-red-900 max-h-64 overflow-auto">
        {children}
      </pre>
    </div>
  );
}

function PatchNotice({ event }: { event: AutomationRunPatchEvent }) {
  const { automations } = useTranslation();
  const t = automations.runViewer;
  if (event.phase === 'proposing') {
    return (
      <div className="flex items-start gap-2 text-xs px-2 py-1.5 rounded border border-amber-200 bg-amber-50 text-amber-900">
        <Spinner size="xs" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">
            {t.fixingStep}{event.attemptNumber ? t.attemptSuffix(event.attemptNumber) : ''}…
          </div>
          {event.failureMessage && (
            <div className="mt-0.5 text-amber-800/90 line-clamp-2">
              {t.failurePrefix}{event.failureMessage}
            </div>
          )}
        </div>
      </div>
    );
  }
  if (event.phase === 'applied') {
    const verb = event.patchKind === 'insert_before' ? t.patchVerb.insertedBefore
      : event.patchKind === 'replace_current' ? t.patchVerb.rewrote
      : event.patchKind === 'skip_current' ? t.patchVerb.skipped
      : t.patchVerb.patched;
    return (
      <div className="flex items-start gap-2 text-xs px-2 py-1.5 rounded border border-violet-200 bg-violet-50 text-violet-900">
        <Wand2 size={12} className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="font-medium">{verb}</div>
          {event.newStepDescription && (
            <div className="mt-0.5 text-violet-800/90">
              <span className="text-violet-600/70">{t.newPrefix}</span>{event.newStepDescription}
            </div>
          )}
          {event.reasoning && (
            <div className="mt-0.5 text-violet-800/80 italic line-clamp-2">{event.reasoning}</div>
          )}
        </div>
      </div>
    );
  }
  // aborted
  return (
    <div className="text-xs px-2 py-1.5 rounded border border-red-200 bg-red-50 text-red-900">
      <div className="font-medium">{t.fixerAborted}</div>
      {event.reasoning && (
        <div className="mt-0.5 text-red-800/90 line-clamp-3">{event.reasoning}</div>
      )}
    </div>
  );
}


function StepOutputPanel({ output, liveChunks }: { output: StepOutput; liveChunks?: { stdout: string; stderr: string } }) {
  switch (output.kind) {
    case 'local_command':
      return <LocalCommandResultPanel output={output} liveChunks={liveChunks} />;
    case 'api_call':
      return <ApiCallResultPanel output={output} />;
    case 'ekoa_action':
      return <EkoaActionResultPanel output={output} />;
    default:
      return null;
  }
}

