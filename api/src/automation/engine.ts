/**
 * Automation execution engine (carryover-audit B7).
 *
 * Orchestrates the per-step two-tier resolve loop:
 *   1. Cache hit -> execute the resolved Playwright action directly (ZERO tokens).
 *   2. Cache miss / cache failure -> vision-resolve via the EXPERT tier at max effort, execute,
 *      write the cache.
 *
 * Vision failure surfaces the error to the user with screenshot + reasoning. There is NO
 * Sonnet->Opus escalation because vision is already pinned to the strongest model on first try
 * (invisible-behaviors §13.2). Same pattern for outcome verification (cache -> vision -> surface).
 *
 * Sub-automation calls recurse into runAutomation with cycle detection via
 * `runContext.visitedAutomationIds`. The RunContext.ownerUserId invariant is preserved: a
 * webhook/listener run carries a SERVER-TRUSTED owner (built by the dispatcher from the trigger,
 * never the inbound payload); the forbidden-ownership guard fires only for triggeredBy === 'user'.
 *
 * Re-pointing (B7): the injected `RunEventEmitter` seam is kept EXACTLY (the engine NEVER imports
 * events/ or the SSE manager). The daemon-bridge, integration-executor, platform-integration, and
 * scoped-memory call sites are re-pointed at the `automation/seams.ts` injected seams; run
 * persistence goes through `automation/persistence.ts`; the action/assertion cache goes through
 * `automation/cache.ts` (memory-backed). All model access is via `api/src/llm/` (vision/planner/
 * rehearsal). Run records persist at EVERY status transition (§5.6.7); the engine never retries
 * itself (one attempt per run class — retry lives in the trigger delivery pipeline in events/).
 */

import { randomUUID } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import { loadAutomationConfig } from './config.js';
import {
  getDaemonConnection,
  executeIntegrationAction,
  callPlatformIntegration,
  resolveScopedMemories,
} from './seams.js';
import { LocalBrowserSession } from './local-browser-session.js';
import { rebaseSelfUrl } from './self-url.js';
import {
  DaemonBrowserSession,
  type BrowserSession,
} from './browser-session.js';
import {
  resolvePlaywrightAction,
  verifyOutcome,
  classifyHumanAction,
  type ResolveActionOutput,
} from './vision.js';
import { applyArgsTemplate } from './template-vars.js';
import { automationStore, automationRunStore, writeStepScreenshot } from './persistence.js';
import {
  lookupActionCache,
  writeActionCache,
  lookupAssertionCache,
  writeAssertionCache,
} from './cache.js';
import {
  proposePatch,
  applyPatch,
  detectHumanActionable,
  REHEARSAL_BUDGET,
} from './rehearsal.js';
import type {
  AppliedPatch,
  Automation,
  FailureKind,
  PageFingerprint,
  PlaywrightAssertion,
  RehearsalPatch,
  RehearsalSummary,
  RunRecord,
  Step,
  StepRecord,
  StepStatus,
  StepTier,
} from './types.js';

// ============================================================================
// Public types
// ============================================================================

/**
 * Critical invariant for webhook/listener runs:
 *   RunContext.ownerUserId MUST be constructed by the dispatcher from the trigger's ownerUserId —
 *   NEVER from the inbound event payload or the URL path. The forbidden-ownership guard further
 *   down only fires for triggeredBy === 'user' specifically because webhook/listener runs already
 *   have a server-trusted owner; they must skip the guard, not satisfy it.
 */
export interface RunContext {
  ownerUserId: string;
  /** The owner's org — threaded so the memory-backed cache and scoped-memory injection are
   *  tenant-scoped (ch09 invariant 5). Built by the caller alongside ownerUserId. */
  orgId: string;
  triggeredBy: 'user' | 'agent' | 'webhook' | 'listener';
  /**
   * The event payload that fired a webhook/listener run. Steps see it as
   * {{event.*}} via the template-vars resolver. Absent on user/agent runs.
   */
  triggerEvent?: {
    triggerId: string;
    integrationKey: string;
    eventName: string;
    receivedAt: string;
    payload: unknown;
    rawHeaders: Record<string, string>;
  };
  /** Tracks the automation IDs in the current call chain to detect cycles. */
  visitedAutomationIds: Set<string>;
  parentRunId?: string;
  /** Used for SSE event correlation. */
  traceId: string;
  /** Optional cancellation signal from the handler / UI. */
  cancellation?: { isCancelled: () => boolean };
  /**
   * Resume signal from the handler. When the engine pauses for the
   * user (CAPTCHA, MFA, payment confirmation), it polls this until it
   * returns true. Set by the handler's resume-run intent.
   */
  resumeSignal?: { shouldResume: () => boolean; clear: () => void };
}

export interface RunEventEmitter {
  stepUpdate: (record: StepRecord, runId: string) => void;
  runComplete: (runId: string, durationMs: number, summary: string) => void;
  runError: (runId: string, error: string, partialSteps: StepRecord[]) => void;
  runPaused: (runId: string, reason: 'awaiting_integration', service: string) => void;
  runPatch?: (runId: string, info: RunPatchEventPayload) => void;
  runPauseForUser?: (runId: string, info: RunPauseForUserPayload) => void;
  runResumed?: (runId: string, stepIndex: number) => void;
  runStreamingAvailable?: (runId: string, info: RunStreamingAvailablePayload) => void;
  /**
   * Awaiting first-time consent for a local_command's command shape. UI
   * shows the consent dialog (approve once / always / stop).
   */
  runAwaitingConsent?: (runId: string, info: RunAwaitingConsentPayload) => void;
  /**
   * The run needs the local ekoa daemon (executor face) to run a browser
   * or local_command step, but no daemon is connected for this owner.
   * The run halts in `awaiting_daemon`; the UI tells the user to start
   * their local Ekoa.
   */
  runAwaitingDaemon?: (runId: string, info: RunAwaitingDaemonPayload) => void;
  /**
   * Live stdout / stderr chunk from a running local_command step. Frontend
   * appends to the in-progress step's output panel as chunks arrive.
   */
  runOutputChunk?: (runId: string, info: RunOutputChunkPayload) => void;
}

export interface RunAwaitingConsentPayload {
  stepIndex: number;
  shape: string;
  argv: string[];
  description: string;
}

export interface RunAwaitingDaemonPayload {
  stepIndex: number;
  /** Which capability the halted step needed: 'browser' or 'bash'. */
  capability: 'browser' | 'bash';
  /** Human-readable explanation surfaced in the UI. */
  reason: string;
}

export interface RunOutputChunkPayload {
  stepIndex: number;
  chunk: string;
  stream: 'stdout' | 'stderr';
}

export interface RunStreamingAvailablePayload {
  wsUrl: string;
  token: string;
  viewport: { width: number; height: number };
}

export interface RunPauseForUserPayload {
  stepIndex: number;
  reasoning: string;
  userInstructions: string;
  failureMessage: string;
  screenshotUrl?: string;
}

export interface RunPatchEventPayload {
  stepIndex: number;
  phase: 'proposing' | 'applied' | 'aborted';
  failureKind?: FailureKind;
  failureMessage?: string;
  patchKind?: RehearsalPatch['kind'];
  reasoning?: string;
  newStepDescription?: string;
  attemptNumber?: number;
}

export interface RunAutomationOptions {
  inputs?: Record<string, unknown>;
  emit?: RunEventEmitter;
  /** Pre-minted run id. The service layer mints the id, registers cancel/resume signals against
   *  it, and passes it in so a `POST .../runs` can register-and-respond-early (202) before the run
   *  starts (§5.2 step 1-2). Absent → the engine mints one. */
  runId?: string;
}

export interface RunAutomationResult {
  runId: string;
  status: RunRecord['status'];
  durationMs: number;
  summary: string;
  lastStepIndex: number;
  error?: string;
}

export interface RehearseAutomationOptions extends RunAutomationOptions {
  /** The user's original goal — fed to the fixer for context. */
  goal?: string;
}

export interface RehearseAutomationResult extends RunAutomationResult {
  refinedSteps: Step[];
  rehearsal: RehearsalSummary;
}

/** Build the tenant-scoped actor for the memory-backed cache from a run context. */
function actorFromCtx(ctx: RunContext): Actor {
  return { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'builder' };
}

// ============================================================================
// Public API
// ============================================================================

export async function runAutomation(
  automationId: string,
  ctx: RunContext,
  options: RunAutomationOptions = {},
): Promise<RunAutomationResult> {
  return runOrRehearse(automationId, ctx, { ...options, kind: 'normal' });
}

/**
 * Same as runAutomation but the per-step loop is allowed to mutate
 * the automation's spec via the rehearsal fixer. After the loop
 * completes, the refined steps are persisted back to the store.
 *
 * Budget-capped: at most REHEARSAL_BUDGET.maxFixerCalls fixer LLM
 * calls and REHEARSAL_BUDGET.maxWallClockMs wall-clock time. Per-index
 * patch attempts are capped at REHEARSAL_BUDGET.maxPatchesPerIndex.
 */
export async function rehearseAutomation(
  automationId: string,
  ctx: RunContext,
  options: RehearseAutomationOptions = {},
): Promise<RehearseAutomationResult> {
  const result = await runOrRehearse(automationId, ctx, { ...options, kind: 'rehearsal' });
  // runOrRehearse always returns RehearseAutomationResult fields when kind='rehearsal'.
  // Cast is safe here.
  return result as RehearseAutomationResult;
}

interface InternalRunOptions extends RehearseAutomationOptions {
  kind: 'normal' | 'rehearsal';
}

async function runOrRehearse(
  automationId: string,
  ctx: RunContext,
  options: InternalRunOptions,
): Promise<RunAutomationResult> {
  const automation = await automationStore.findById(automationId);
  if (!automation) {
    throw new Error(`automation not found: ${automationId}`);
  }
  if (automation.ownerUserId !== ctx.ownerUserId && ctx.triggeredBy === 'user') {
    throw new Error(`forbidden: not the owner of automation ${automationId}`);
  }

  // Cycle detection for sub-automation calls
  if (ctx.visitedAutomationIds.has(automationId)) {
    throw new Error(`sub-automation cycle detected: ${automationId} is already in the call chain`);
  }
  ctx.visitedAutomationIds.add(automationId);

  const runId = options.runId ?? randomUUID();
  const startedAt = new Date().toISOString();
  const inputs = options.inputs ?? {};
  const isRehearsal = options.kind === 'rehearsal';

  const initialRecord: RunRecord = {
    id: runId,
    automationId,
    startedAt,
    status: 'running',
    inputs,
    steps: [],
    triggeredBy: ctx.triggeredBy,
    ownerUserId: ctx.ownerUserId,
    orgId: ctx.orgId,
    parentRunId: ctx.parentRunId,
    kind: options.kind,
  };
  await automationRunStore.create(initialRecord);

  const emit = options.emit;

  // Executor face: browser steps normally run on the local ekoa daemon (see
  // browser-session.ts). `connection` is the live daemon for this owner, or
  // undefined when none is dialed in. When there's no daemon AND the in-process
  // fallback is enabled (automation config localBrowserEnabled — default ON in
  // dev / OFF in prod), browser steps run in-process via LocalBrowserSession
  // against the persistent per-owner Chromium context, so automations are
  // runnable in dev. Otherwise a browser step halts the run in `awaiting_daemon`.
  const connection = getDaemonConnection(ctx.ownerUserId);
  // Captured browser session credential (integration-launched runs with
  // `passCredentials`): `inputs.credentials.storageState` carries the
  // Playwright storage state a session-connect flow captured. SECRET —
  // read once here, handed opaquely to the browser session, never logged
  // and never template-substituted (template-vars redacts input.credentials).
  const credentials = inputs['credentials'];
  const sessionState = credentials && typeof credentials === 'object'
    ? (credentials as Record<string, unknown>)['storageState']
    : undefined;
  // The browser session is created lazily on first browser use so a run with
  // only api_call/integration steps still works without any browser.
  let browser: BrowserSession | null = null;
  const getBrowser = (): BrowserSession | null => {
    if (!browser) {
      if (connection) {
        // Session injection is LOCAL-SESSION-ONLY today: the daemon owns its
        // own persistent profile and the bridge protocol has no cookie
        // channel yet, so `sessionState` is deliberately NOT forwarded here.
        browser = new DaemonBrowserSession({ connection, runId, ownerUserId: ctx.ownerUserId });
      } else if (loadAutomationConfig().localBrowserEnabled) {
        browser = new LocalBrowserSession({ runId, ownerUserId: ctx.ownerUserId, sessionState });
      } else {
        return null;
      }
    }
    return browser;
  };

  // Working copy of steps — rehearsal mutates this in place. Normal runs
  // never touch it, so the user's saved spec is preserved either way until
  // we persist at the end.
  const workingSteps: Step[] = automation.steps.slice();

  // Rehearsal accounting
  let fixerCallCount = 0;
  let patchesApplied = 0;
  const patchesAtIndex = new Map<number, number>(); // currentIndex -> count
  let stuckAtIndex: number | undefined;
  let rehearsalReason: string | undefined;
  // Time spent waiting for the user during pause_for_user. Subtracted
  // from the wall-clock budget so a five-minute CAPTCHA solve doesn't
  // trip the rehearsal timeout.
  let pausedTotalMs = 0;
  // Number of pause-for-user invocations on this run. Cap'd to avoid
  // an infinite loop when a page keeps re-prompting the user for the
  // same action.
  let pauseForUserCount = 0;

  try {
    const stepRecords: StepRecord[] = [];

    let i = 0;
    while (i < workingSteps.length) {
      if (ctx.cancellation?.isCancelled()) {
        await finalize(runId, automationId, 'cancelled', stepRecords, startedAt);
        return finalizeReturn({
          runId,
          status: 'cancelled',
          startedAt,
          stepRecords,
          message: 'cancelled',
          isRehearsal,
          refinedSteps: workingSteps,
          rehearsalSummary: buildRehearsalSummary({
            isRehearsal,
            status: 'aborted',
            fixerCallCount,
            patchesApplied,
            startedAt,
            stuckAtIndex,
            reason: 'cancelled',
          }),
        });
      }

      // Wall-clock budget check (rehearsal only). Subtract pausedTotalMs
      // so time spent waiting for the user during a CAPTCHA / MFA pause
      // doesn't count.
      if (isRehearsal && (Date.now() - Date.parse(startedAt) - pausedTotalMs) > REHEARSAL_BUDGET.maxWallClockMs) {
        stuckAtIndex = i;
        rehearsalReason = `wall-clock budget of ${REHEARSAL_BUDGET.maxWallClockMs}ms exhausted`;
        await persistRefinedSteps(automation, workingSteps, isRehearsal);
        await finalize(runId, automationId, 'failed', stepRecords, startedAt, undefined, {
          isRehearsal,
          summary: buildRehearsalSummary({
            isRehearsal,
            status: 'budget_exhausted',
            fixerCallCount,
            patchesApplied,
            startedAt,
            stuckAtIndex,
            reason: rehearsalReason,
          }),
        });
        emit?.runError(runId, rehearsalReason, stepRecords);
        return finalizeReturn({
          runId,
          status: 'failed',
          startedAt,
          stepRecords,
          message: rehearsalReason,
          isRehearsal,
          refinedSteps: workingSteps,
          rehearsalSummary: buildRehearsalSummary({
            isRehearsal,
            status: 'budget_exhausted',
            fixerCallCount,
            patchesApplied,
            startedAt,
            stuckAtIndex,
            reason: rehearsalReason,
          }),
        });
      }

      const step = workingSteps[i]!;

      // Tell the UI we're starting this step. Without this, `liveSteps`
      // never sees a `status='running'` entry — every step transitions
      // from absent -> final status when executeStep returns — and the
      // activity bar can't tell which step is currently in flight.
      emit?.stepUpdate(
        {
          stepId: step.id,
          index: i,
          status: 'running',
          tier: 'cache',
          durationMs: 0,
        },
        runId,
      );

      // Hand the most recent successful step over so a verify can
      // short-circuit after a side-effect (integration / sub_automation)
      // instead of asking vision for evidence the page can't show.
      const lastRecord = stepRecords[stepRecords.length - 1];
      const previousStep = lastRecord
        ? { step: (workingSteps[lastRecord.index] ?? workingSteps[i - 1])!, record: lastRecord }
        : undefined;

      const record = await executeStep({
        browser: getBrowser(),
        daemonConnected: !!connection,
        automation,
        step,
        index: i,
        runId,
        ctx,
        inputs,
        previousStep,
        emitOutputChunk: emit?.runOutputChunk
          ? (info) => emit.runOutputChunk!(info.runId, { stepIndex: info.stepIndex, chunk: info.chunk, stream: info.stream })
          : undefined,
      });

      // Replace any prior record for this index (rehearsal retries the
      // same index after a patch); push otherwise.
      const existingAt = stepRecords.findIndex((r) => r.index === i);
      if (existingAt >= 0) {
        stepRecords[existingAt] = mergeRehearsalPatches(stepRecords[existingAt]!, record);
      } else {
        stepRecords.push(record);
      }

      await automationRunStore.update(automationId, runId, {
        steps: stepRecords,
        rehearsalSummary: isRehearsal
          ? buildRehearsalSummary({
              isRehearsal,
              status: 'ok',
              fixerCallCount,
              patchesApplied,
              startedAt,
              stuckAtIndex,
              reason: undefined,
            })
          : undefined,
      });
      emit?.stepUpdate(record, runId);

      if (record.status === 'failed') {
        // Awaiting-integration pause path is shared between modes.
        if (record.error?.recoverable === false && step.type === 'integration') {
          await finalize(runId, automationId, 'awaiting_integration', stepRecords, startedAt, {
            service: step.integrationKey ?? 'unknown',
            reason: record.error?.message ?? 'integration step is not yet executable',
          });
          emit?.runPaused(runId, 'awaiting_integration', step.integrationKey ?? 'unknown');
          if (isRehearsal) {
            await persistRefinedSteps(automation, workingSteps, isRehearsal);
          }
          return finalizeReturn({
            runId,
            status: 'awaiting_integration',
            startedAt,
            stepRecords,
            message: `paused awaiting integration: ${step.integrationKey ?? 'unknown'}`,
            isRehearsal,
            refinedSteps: workingSteps,
            rehearsalSummary: buildRehearsalSummary({
              isRehearsal,
              status: 'aborted',
              fixerCallCount,
              patchesApplied,
              startedAt,
              stuckAtIndex: i,
              reason: 'awaiting integration',
            }),
            lastStepIndex: i,
          });
        }

        // Awaiting-daemon halt: a browser / local_command step needs the
        // local ekoa daemon (executor face) but none is connected for this
        // owner. There is nothing to retry locally — the user must start
        // their local Ekoa — so we halt the run in `awaiting_daemon` and
        // surface the new SSE event rather than looping the fixer.
        const daemonDetails = extractAwaitingDaemon(record);
        if (daemonDetails) {
          await automationRunStore.update(automationId, runId, {
            status: 'awaiting_daemon',
            steps: stepRecords,
          });
          await finalize(runId, automationId, 'awaiting_daemon', stepRecords, startedAt);
          emit?.runAwaitingDaemon?.(runId, daemonDetails);
          if (isRehearsal) {
            await persistRefinedSteps(automation, workingSteps, isRehearsal);
          }
          return finalizeReturn({
            runId,
            status: 'awaiting_daemon',
            startedAt,
            stepRecords,
            message: `paused: local ekoa daemon not connected (needed for ${daemonDetails.capability})`,
            isRehearsal,
            refinedSteps: workingSteps,
            rehearsalSummary: buildRehearsalSummary({
              isRehearsal,
              status: 'aborted',
              fixerCallCount,
              patchesApplied,
              startedAt,
              stuckAtIndex: i,
              reason: 'awaiting daemon',
            }),
            lastStepIndex: i,
          });
        }

        // Awaiting-consent path: a local_command step needs first-time
        // approval for its command shape. Pause the run, emit the
        // consent event, and block on resumeSignal (same mechanism as
        // pause_for_user). The resolve-consent intent on the handler
        // sets the resume flag after the user has approved (and
        // persisted the shape on their profile if "approve always").
        const consentDetails = extractAwaitingConsent(record);
        if (consentDetails && step.type === 'local_command') {
          await automationRunStore.update(automationId, runId, {
            status: 'awaiting_consent',
            consentRequest: consentDetails,
          });
          emit?.runAwaitingConsent?.(runId, {
            stepIndex: consentDetails.stepIndex,
            shape: consentDetails.shape,
            argv: consentDetails.argv,
            description: consentDetails.description,
          });
          const resumed = await waitForResumeOrCancel(ctx);
          if (!resumed) {
            await finalize(runId, automationId, 'cancelled', stepRecords, startedAt);
            emit?.runError(runId, 'consent denied by user', stepRecords);
            return finalizeReturn({
              runId,
              status: 'cancelled',
              startedAt,
              stepRecords,
              message: 'cancelled — consent denied',
              isRehearsal,
              refinedSteps: workingSteps,
              rehearsalSummary: buildRehearsalSummary({ isRehearsal, status: 'aborted', fixerCallCount, patchesApplied, startedAt, stuckAtIndex: i, reason: 'consent denied' }),
              lastStepIndex: i,
            });
          }
          await automationRunStore.update(automationId, runId, { status: 'running', consentRequest: undefined });
          // Drop the failed record so the same index reruns clean.
          const existingAt2 = stepRecords.findIndex((r) => r.index === i);
          if (existingAt2 >= 0) stepRecords.splice(existingAt2, 1);
          emit?.runResumed?.(runId, i);
          continue;
        }

        // Pause-for-user detection. Three layers, all fire BEFORE the
        // (slow) fixer so the cyan "Ekoa needs you" bar appears the
        // moment we know a human is needed:
        //   1. Verifier-supplied humanAction — the verifier sees the
        //      screenshot and classifies the page structurally.
        //   2. Regex fast-path on the failure message — cheap backstop.
        //   3. FAST-tier classifier on a fresh screenshot — the
        //      bullet-proof fallback for browser-step Playwright errors
        //      and any case the verifier / regex missed.
        if (
          shouldAttemptFix(record, step) &&
          pauseForUserCount < REHEARSAL_BUDGET.maxNormalPauses
        ) {
          const verifierHumanAction = record.humanAction;
          const regexDetected = !verifierHumanAction
            ? detectHumanActionable(record.error?.message ?? '')
            : null;

          let detected: { reasoning: string; userInstructions: string } | null =
            verifierHumanAction
              ? {
                  reasoning: `Verifier classified the page as needing a human (${verifierHumanAction.kind})`,
                  userInstructions: verifierHumanAction.userInstructions,
                }
              : regexDetected;

          // Layer 3: FAST classifier on the daemon's latest observation
          // of the (post-failure) page. Only meaningful for browser-driven
          // steps; skipped when no browser session has observed.
          let classifierKind: string | null = null;
          const browserForClassify = getBrowser();
          if (!detected && browserForClassify?.hasObservation()) {
            try {
              const ha = await classifyHumanAction({
                screenshotPng: browserForClassify.screenshotPng(),
                pageUrl: browserForClassify.url(),
                stepContext: `${step.type}: ${step.description}`,
                userId: ctx.ownerUserId,
              });
              if (ha) {
                classifierKind = ha.kind;
                detected = {
                  reasoning: `Classifier flagged the page as needing a human (${ha.kind})`,
                  userInstructions: ha.userInstructions,
                };
              }
            } catch (err) {
              console.warn(`[automation] human-action classifier failed: ${errMsg(err)}`);
            }
          }

          if (detected) {
            console.warn(
              `[automation] pause-for-user fired on step ${i + 1}: ` +
              `${verifierHumanAction ? `verifier(${verifierHumanAction.kind})`
                : regexDetected ? 'regex-fast-path'
                : `classifier(${classifierKind})`}`,
            );
            const failureKindForEvent = classifyFailure(record, step);
            const syntheticPatch = {
              kind: 'pause_for_user' as const,
              reasoning: detected.reasoning,
              userInstructions: detected.userInstructions,
            };
            const { resumed, pausedDeltaMs } = await pauseRunForUser({
              browser: getBrowser(), automation, runId, stepIndex: i, patch: syntheticPatch, record,
              failureKind: failureKindForEvent, stepRecords, ctx, emit,
            });
            pausedTotalMs += pausedDeltaMs;
            pauseForUserCount += 1;
            if (!resumed) {
              if (isRehearsal) await persistRefinedSteps(automation, workingSteps, isRehearsal);
              await finalize(runId, automationId, 'cancelled', stepRecords, startedAt);
              return finalizeReturn({
                runId, status: 'cancelled', startedAt, stepRecords,
                message: 'cancelled while paused for user',
                isRehearsal, refinedSteps: workingSteps,
                rehearsalSummary: buildRehearsalSummary({
                  isRehearsal,
                  status: 'aborted',
                  fixerCallCount, patchesApplied, startedAt,
                  stuckAtIndex,
                  reason: 'cancelled while paused for user',
                }),
              });
            }
            continue;
          }
        }

        // Self-correction path. Runs in BOTH rehearsal and normal
        // modes — the user wants autonomous recovery by default
        // ("automations should self-correct, not just plan"). The
        // difference: rehearsal persists refined steps back to the
        // spec; normal runs apply patches transiently (workingSteps is
        // local; the saved automation is never touched). Same budget
        // either way so a doomed run doesn't burn unbounded tokens.
        if (shouldAttemptFix(record, step)) {
          const fixerLimitHit =
            fixerCallCount >= REHEARSAL_BUDGET.maxFixerCalls ||
            (patchesAtIndex.get(i) ?? 0) >= REHEARSAL_BUDGET.maxPatchesPerIndex;
          if (fixerLimitHit) {
            stuckAtIndex = i;
            rehearsalReason = (patchesAtIndex.get(i) ?? 0) >= REHEARSAL_BUDGET.maxPatchesPerIndex
              ? `stuck: tried ${patchesAtIndex.get(i)} patches at step ${i + 1} without progress`
              : `fixer call budget of ${REHEARSAL_BUDGET.maxFixerCalls} exhausted`;
            await persistRefinedSteps(automation, workingSteps, isRehearsal);
            await finalize(runId, automationId, 'failed', stepRecords, startedAt, undefined, {
              isRehearsal,
              summary: buildRehearsalSummary({
                isRehearsal,
                status: (patchesAtIndex.get(i) ?? 0) >= REHEARSAL_BUDGET.maxPatchesPerIndex ? 'stuck' : 'budget_exhausted',
                fixerCallCount,
                patchesApplied,
                startedAt,
                stuckAtIndex,
                reason: rehearsalReason,
              }),
            });
            emit?.runError(runId, rehearsalReason, stepRecords);
            return finalizeReturn({
              runId,
              status: 'failed',
              startedAt,
              stepRecords,
              message: rehearsalReason,
              isRehearsal,
              refinedSteps: workingSteps,
              rehearsalSummary: buildRehearsalSummary({
                isRehearsal,
                status: (patchesAtIndex.get(i) ?? 0) >= REHEARSAL_BUDGET.maxPatchesPerIndex ? 'stuck' : 'budget_exhausted',
                fixerCallCount,
                patchesApplied,
                startedAt,
                stuckAtIndex,
                reason: rehearsalReason,
              }),
            });
          }

          // Tell the UI we're proposing a fix — fixer LLM calls take 5–15s.
          const failureKindForEvent = classifyFailure(record, step);
          const attemptNumber = (patchesAtIndex.get(i) ?? 0) + 1;
          emit?.runPatch?.(runId, {
            stepIndex: i,
            phase: 'proposing',
            failureKind: failureKindForEvent,
            failureMessage: record.error?.message ?? 'unknown',
            attemptNumber,
          });

          // Ask the fixer using the daemon's latest observation of the
          // (post-failure) page. Browser-step failures always have one;
          // non-browser failures (local_command, etc.) pass an empty
          // screenshot — the fixer re-plans from the failure message.
          let patch: RehearsalPatch;
          try {
            const browserForFix = getBrowser();
            const haveObs = browserForFix?.hasObservation() ?? false;
            const screenshotPng = haveObs ? browserForFix!.screenshotPng() : Buffer.alloc(0);
            const accessibilitySnapshot = haveObs ? browserForFix!.accessibilitySnapshot() : undefined;
            const pageUrl = haveObs ? browserForFix!.url() : 'about:blank';
            fixerCallCount += 1;
            patch = await proposePatch({
              goal: options.goal ?? automation.description ?? '',
              steps: workingSteps,
              currentIndex: i,
              failureKind: failureKindForEvent,
              failureMessage: record.error?.message ?? 'unknown',
              screenshotPng,
              accessibilitySnapshot,
              pageUrl,
              patchesAtThisIndex: patchesAtIndex.get(i) ?? 0,
              userId: ctx.ownerUserId,
            });
          } catch (err) {
            stuckAtIndex = i;
            rehearsalReason = `fixer LLM call failed: ${errMsg(err)}`;
            await persistRefinedSteps(automation, workingSteps, isRehearsal);
            await finalize(runId, automationId, 'failed', stepRecords, startedAt, undefined, {
              isRehearsal,
              summary: buildRehearsalSummary({
                isRehearsal,
                status: 'failed',
                fixerCallCount,
                patchesApplied,
                startedAt,
                stuckAtIndex,
                reason: rehearsalReason,
              }),
            });
            emit?.runError(runId, rehearsalReason, stepRecords);
            return finalizeReturn({
              runId,
              status: 'failed',
              startedAt,
              stepRecords,
              message: rehearsalReason,
              isRehearsal,
              refinedSteps: workingSteps,
              rehearsalSummary: buildRehearsalSummary({
                isRehearsal,
                status: 'failed',
                fixerCallCount,
                patchesApplied,
                startedAt,
                stuckAtIndex,
                reason: rehearsalReason,
              }),
            });
          }

          if (patch.kind === 'pause_for_user') {
            const { resumed, pausedDeltaMs } = await pauseRunForUser({
              browser: getBrowser(), automation, runId, stepIndex: i, patch, record,
              failureKind: failureKindForEvent, stepRecords, ctx, emit,
            });
            pausedTotalMs += pausedDeltaMs;
            if (!resumed) {
              await persistRefinedSteps(automation, workingSteps, isRehearsal);
              await finalize(runId, automationId, 'cancelled', stepRecords, startedAt);
              return finalizeReturn({
                runId, status: 'cancelled', startedAt, stepRecords,
                message: 'cancelled while paused for user',
                isRehearsal, refinedSteps: workingSteps,
                rehearsalSummary: buildRehearsalSummary({
                  isRehearsal,
                  status: 'aborted',
                  fixerCallCount, patchesApplied, startedAt,
                  stuckAtIndex,
                  reason: 'cancelled while paused for user',
                }),
              });
            }
            // Resumed. Do not advance i — retry the same step.
            continue;
          }

          if (patch.kind === 'abort') {
            stuckAtIndex = i;
            rehearsalReason = `fixer aborted: ${patch.reasoning}`;
            emit?.runPatch?.(runId, {
              stepIndex: i,
              phase: 'aborted',
              failureKind: failureKindForEvent,
              failureMessage: record.error?.message ?? 'unknown',
              patchKind: 'abort',
              reasoning: patch.reasoning,
              attemptNumber,
            });
            // Annotate the failed step record with the abort reasoning.
            const annotated = annotateRecordWithPatch(record, patch, classifyFailure(record, step), record.error?.message ?? '');
            const idx = stepRecords.findIndex((r) => r.index === i);
            if (idx >= 0) stepRecords[idx] = annotated;
            await automationRunStore.update(automationId, runId, { steps: stepRecords });
            await persistRefinedSteps(automation, workingSteps, isRehearsal);
            await finalize(runId, automationId, 'failed', stepRecords, startedAt, undefined, {
              isRehearsal,
              summary: buildRehearsalSummary({
                isRehearsal,
                status: 'aborted',
                fixerCallCount,
                patchesApplied,
                startedAt,
                stuckAtIndex,
                reason: rehearsalReason,
              }),
            });
            emit?.runError(runId, rehearsalReason, stepRecords);
            return finalizeReturn({
              runId,
              status: 'failed',
              startedAt,
              stepRecords,
              message: rehearsalReason,
              isRehearsal,
              refinedSteps: workingSteps,
              rehearsalSummary: buildRehearsalSummary({
                isRehearsal,
                status: 'aborted',
                fixerCallCount,
                patchesApplied,
                startedAt,
                stuckAtIndex,
                reason: rehearsalReason,
              }),
            });
          }

          // Apply the patch in-place.
          const failureKind = classifyFailure(record, step);
          const failureMessage = record.error?.message ?? '';
          const patchedSteps = applyPatch(workingSteps, i, patch);
          // Replace workingSteps in place (keep the same array ref).
          workingSteps.splice(0, workingSteps.length, ...patchedSteps);
          patchesApplied += 1;
          patchesAtIndex.set(i, (patchesAtIndex.get(i) ?? 0) + 1);

          // Persist the patched plan to the automation store immediately.
          // This is what keeps the editor's step list in sync with what
          // the engine is actually running — without it, the run viewer
          // shows stale step descriptions after a patch. Cheap (one write)
          // and the editor's live `current` state picks it up on next fetch.
          await persistRefinedSteps(automation, workingSteps, isRehearsal).catch((err) => {
            console.warn(`[automation] mid-rehearsal persist failed: ${errMsg(err)}`);
          });

          emit?.runPatch?.(runId, {
            stepIndex: i,
            phase: 'applied',
            failureKind,
            failureMessage,
            patchKind: patch.kind,
            reasoning: patch.reasoning,
            newStepDescription: patch.kind === 'insert_before' || patch.kind === 'replace_current'
              ? patch.newStep.description
              : undefined,
            attemptNumber,
          });

          // Annotate the failing record with the patch we just applied.
          const annotated = annotateRecordWithPatch(record, patch, failureKind, failureMessage);
          const idx = stepRecords.findIndex((r) => r.index === i);
          if (idx >= 0) stepRecords[idx] = annotated;
          await automationRunStore.update(automationId, runId, {
            steps: stepRecords,
            rehearsalSummary: buildRehearsalSummary({
              isRehearsal,
              status: 'ok',
              fixerCallCount,
              patchesApplied,
              startedAt,
              stuckAtIndex,
              reason: undefined,
            }),
          });
          emit?.stepUpdate(annotated, runId);

          // For insert_before / replace_current, retry at the same index.
          // For skip_current, the step at i was removed — i now points
          // at what was previously i+1, so do not advance. Either way,
          // drop the now-stale failing record so the next step takes its
          // proper index slot and re-execute at i.
          const removeIdx = stepRecords.findIndex((r) => r.index === i);
          if (removeIdx >= 0) stepRecords.splice(removeIdx, 1);
          // Do not advance i — retry at the same position with the patched plan.
          continue;
        }

        // Normal mode (or non-recoverable rehearsal failure): bail.
        if (isRehearsal) {
          await persistRefinedSteps(automation, workingSteps, isRehearsal);
        }
        await finalize(runId, automationId, 'failed', stepRecords, startedAt, undefined, isRehearsal ? {
          isRehearsal,
          summary: buildRehearsalSummary({
            isRehearsal,
            status: 'failed',
            fixerCallCount,
            patchesApplied,
            startedAt,
            stuckAtIndex: i,
            reason: record.error?.message,
          }),
        } : undefined);
        emit?.runError(runId, record.error?.message ?? 'step failed', stepRecords);
        return finalizeReturn({
          runId,
          status: 'failed',
          startedAt,
          stepRecords,
          message: record.error?.message ?? 'failed',
          isRehearsal,
          refinedSteps: workingSteps,
          rehearsalSummary: buildRehearsalSummary({
            isRehearsal,
            status: 'failed',
            fixerCallCount,
            patchesApplied,
            startedAt,
            stuckAtIndex: i,
            reason: record.error?.message,
          }),
        });
      }

      // Step completed — advance.
      i += 1;
    }

    if (isRehearsal) {
      await persistRefinedSteps(automation, workingSteps, isRehearsal);
    }
    await finalize(runId, automationId, 'completed', stepRecords, startedAt, undefined, isRehearsal ? {
      isRehearsal,
      summary: buildRehearsalSummary({
        isRehearsal,
        status: 'ok',
        fixerCallCount,
        patchesApplied,
        startedAt,
        stuckAtIndex,
        reason: rehearsalReason,
      }),
    } : undefined);
    const durationMs = Date.now() - Date.parse(startedAt);
    const summaryText = isRehearsal
      ? `${stepRecords.length} step(s) completed; ${patchesApplied} patch(es) applied`
      : `${stepRecords.length} step(s) completed`;
    emit?.runComplete(runId, durationMs, summaryText);
    return finalizeReturn({
      runId,
      status: 'completed',
      startedAt,
      stepRecords,
      message: summaryText,
      isRehearsal,
      refinedSteps: workingSteps,
      rehearsalSummary: buildRehearsalSummary({
        isRehearsal,
        status: 'ok',
        fixerCallCount,
        patchesApplied,
        startedAt,
        stuckAtIndex,
        reason: rehearsalReason,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Filter out null / undefined entries — old run records persisted by
    // earlier engine versions can contain literal `null` items in steps[].
    // Reading .index off them crashes finalizeReturn.
    const persisted = (await automationRunStore.findById(automationId, runId))?.steps ?? [];
    const partial = persisted.filter(
      (r): r is StepRecord => r != null && typeof r === 'object' && typeof r.index === 'number',
    );
    if (isRehearsal) {
      await persistRefinedSteps(automation, workingSteps, isRehearsal).catch(() => {});
    }
    await finalize(runId, automationId, 'failed', partial, startedAt);
    emit?.runError(runId, message, partial);
    return finalizeReturn({
      runId,
      status: 'failed',
      startedAt,
      stepRecords: partial,
      message,
      isRehearsal,
      refinedSteps: workingSteps,
      rehearsalSummary: buildRehearsalSummary({
        isRehearsal,
        status: 'failed',
        fixerCallCount,
        patchesApplied,
        startedAt,
        stuckAtIndex,
        reason: message,
      }),
    });
  } finally {
    ctx.visitedAutomationIds.delete(automationId);
    // Release the per-run browser session. The daemon session is a no-op (the
    // daemon owns the page lifecycle); the in-process LocalBrowserSession closes
    // its per-run page here so pages don't accumulate across runs.
    await (browser as BrowserSession | null)?.dispose?.();
  }
}

// ============================================================================
// Per-step execution
// ============================================================================

interface ExecuteStepArgs {
  /**
   * Daemon-backed browser session for browser/verify/navigate steps.
   * Null when no local ekoa daemon is connected for this owner — a
   * step that needs it returns an awaiting_daemon failure the outer
   * loop converts into a halt.
   */
  browser: BrowserSession | null;
  /** Whether a daemon connection exists (drives the awaiting_daemon halt). */
  daemonConnected: boolean;
  automation: Automation;
  step: Step;
  index: number;
  runId: string;
  ctx: RunContext;
  inputs: Record<string, unknown>;
  /**
   * The step that ran immediately before this one in the same run.
   * Used so a verify step after a successful side-effect step
   * (integration / sub_automation) can short-circuit instead of asking
   * vision to find UI evidence that doesn't exist.
   */
  previousStep?: { step: Step; record: StepRecord };
  /**
   * Optional sink for live stdout / stderr chunks from local_command
   * steps. Wired by the run emitter so the UI sees streaming output as
   * commands execute. Other step types ignore this.
   */
  emitOutputChunk?: (info: { runId: string; stepIndex: number; chunk: string; stream: 'stdout' | 'stderr' }) => void;
}

async function executeStep(args: ExecuteStepArgs): Promise<StepRecord> {
  const { browser, daemonConnected, automation, step, index, runId, ctx, inputs } = args;
  const stepStart = Date.now();

  // Defensive: a malformed step (null, missing id/type, or an obsolete
  // schema where type is something this engine doesn't know) must
  // produce a failed *record* rather than throwing or returning
  // undefined. Mark non-recoverable so the rehearsal fixer doesn't loop
  // on something it can't fix.
  if (!step || typeof step !== 'object' || typeof step.id !== 'string' || typeof step.type !== 'string') {
    return {
      stepId: typeof step?.id === 'string' ? step.id : `step-${index}`,
      index,
      status: 'failed',
      tier: 'cache',
      durationMs: Date.now() - stepStart,
      error: {
        message: `step ${index} is malformed (missing id or type) — likely an old-schema automation. Re-plan or delete.`,
        recoverable: false,
      },
    };
  }

  const baseRecord: StepRecord = {
    stepId: step.id,
    index,
    status: 'running',
    tier: 'cache',
    durationMs: 0,
  };

  try {
    switch (step.type) {
      case 'navigate': {
        if (!step.url) throw new Error(`navigate step ${step.id} missing url`);
        if (!browser) return awaitingDaemonRecord(baseRecord, stepStart, index, 'browser');
        // Auto-adjust a self-targeting URL (a stale localhost port the planner
        // guessed) to the running Ekoa frontend origin.
        const navUrl = rebaseSelfUrl(step.url);
        await browser.act({ kind: 'navigate', url: navUrl }, { stepId: step.id });
        const screenshotPath = await snap(browser, automation.id, runId, index);
        const fingerprint = browser.fingerprint();
        return finishRecord(baseRecord, 'completed', stepStart, {
          tier: 'cache',
          fingerprint,
          screenshotPath,
          resolvedAction: { kind: 'navigate', url: navUrl },
        });
      }

      case 'wait': {
        const ms = step.durationMs ?? 1000;
        if (!browser) return awaitingDaemonRecord(baseRecord, stepStart, index, 'browser');
        await browser.act({ kind: 'wait', durationMs: ms }, { stepId: step.id });
        return finishRecord(baseRecord, 'completed', stepStart, {
          tier: 'cache',
          resolvedAction: { kind: 'wait', durationMs: ms },
        });
      }

      case 'sub_automation': {
        if (!step.subAutomationId) throw new Error(`sub_automation step ${step.id} missing subAutomationId`);
        const sub = await runAutomation(step.subAutomationId, {
          ...ctx,
          parentRunId: runId,
          // visitedAutomationIds is the same set (mutated by recursive call)
        }, {
          inputs: applyArgsTemplate(step.argsTemplate ?? {}, inputs, undefined, undefined, ctx.triggerEvent?.payload),
        });
        if (sub.status !== 'completed') {
          const detail = sub.error ?? `status=${sub.status}`;
          throw new Error(`sub-automation ${step.subAutomationId} did not complete: ${detail}`);
        }
        return finishRecord(baseRecord, 'completed', stepStart, { tier: 'cache' });
      }

      case 'integration': {
        if (!step.integrationKey || !step.integrationAction) {
          throw new Error(`integration step ${step.id} missing integrationKey or integrationAction`);
        }
        // Capture context: the model can reference the page that's open
        // RIGHT BEFORE this step runs (e.g. send_email_simple with the
        // current page screenshot as an attachment). Captured lazily so
        // we don't pay the cost when no template needs it. Sourced from
        // the daemon's most recent observation; empty when no browser
        // session exists (integration-only, daemon-less run).
        const captures = buildCaptureContext(browser, step.argsTemplate);
        const stepArgs = applyArgsTemplate(step.argsTemplate ?? {}, inputs, captures, undefined, ctx.triggerEvent?.payload);
        const isPlatform = step.integrationKey === 'google-workspace' || step.integrationKey === 'microsoft-365';
        let result: { success: boolean; data?: unknown; error?: string; details?: unknown };
        if (isPlatform) {
          result = await callPlatformIntegration(
            { integrationKey: step.integrationKey, actionName: step.integrationAction, args: stepArgs as Record<string, unknown> },
            { userId: ctx.ownerUserId, userRole: 'admin', userScopes: ['agent:execute'], traceId: ctx.traceId },
          );
        } else {
          result = await executeIntegrationAction({
            integrationKey: step.integrationKey,
            actionName: step.integrationAction,
            args: stepArgs as Record<string, unknown>,
            ownerUserId: ctx.ownerUserId,
          });
        }
        if (!result.success) {
          // Differentiate "integration not connected" (awaiting_integration)
          // from other failures (recoverable; user can fix and retry).
          const notConnected = /not connected/i.test(result.error ?? '');
          return finishRecord(baseRecord, 'failed', stepStart, {
            tier: 'cache',
            error: {
              message: result.error ?? 'integration call failed',
              recoverable: !notConnected,
              details: result.details,
            },
          });
        }
        return finishRecord(baseRecord, 'completed', stepStart, { tier: 'cache' });
      }

      case 'browser': {
        if (!browser) return awaitingDaemonRecord(baseRecord, stepStart, index, 'browser');
        return await executeBrowserStep({ browser, daemonConnected, automation, step, index, runId, ctx, inputs, baseRecord, stepStart });
      }

      case 'verify': {
        if (!browser) return awaitingDaemonRecord(baseRecord, stepStart, index, 'browser');
        return await executeVerifyStep({ browser, daemonConnected, automation, step, index, runId, ctx, inputs, baseRecord, stepStart, previousStep: args.previousStep });
      }

      case 'local_command': {
        if (!daemonConnected) return awaitingDaemonRecord(baseRecord, stepStart, index, 'bash');
        const { executeLocalCommandStep } = await import('./executors/local-command.js');
        return await executeLocalCommandStep({
          step, index, runId, automation, ctx, inputs, baseRecord, stepStart,
          finishRecord,
          emitChunk: args.emitOutputChunk,
        });
      }

      case 'api_call': {
        const { executeApiCallStep } = await import('./executors/api-call.js');
        return await executeApiCallStep({
          step, index, runId, automation, ctx, inputs, baseRecord, stepStart,
          finishRecord,
        });
      }

      case 'ekoa_action': {
        const { executeEkoaActionStep } = await import('./executors/ekoa-action.js');
        return await executeEkoaActionStep({
          step, index, runId, automation, ctx, inputs, baseRecord, stepStart,
          finishRecord,
        });
      }

      default: {
        // Unknown step type — old-schema record or a typo in a hand-edited
        // spec. Don't fall through. Mark non-recoverable so the fixer
        // doesn't loop.
        return finishRecord(baseRecord, 'failed', stepStart, {
          tier: 'cache',
          error: {
            message: `unknown step type "${String(step.type)}" — this automation likely uses an obsolete schema. Re-plan or delete.`,
            recoverable: false,
          },
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: baseRecord.tier,
      error: { message, recoverable: true },
    });
  }
}

interface BrowserVerifyContext extends Omit<ExecuteStepArgs, 'browser'> {
  /** Guaranteed non-null: callers gate on the daemon being connected. */
  browser: BrowserSession;
  baseRecord: StepRecord;
  stepStart: number;
}

async function executeBrowserStep(args: BrowserVerifyContext): Promise<StepRecord> {
  const { browser, automation, step, index, runId, ctx, baseRecord, stepStart } = args;
  const actor = actorFromCtx(ctx);

  // 0. Ensure we hold a current observation of the page going INTO this
  // step. All tiers read fingerprint / screenshot off this held observation.
  await browser.ensureObserved({ stepId: step.id });

  // 1. Compute fingerprint + scoped memories upfront — both tiers need them.
  const fingerprint = browser.fingerprint();
  const scopedMemories = await loadScopedMemorySnippets(automation.id, step.description, ctx);

  // 2. Tier 1: cache hit
  const cached = await lookupActionCache(automation.id, step.id, fingerprint, actor);
  if (cached) {
    try {
      await browser.act(cached.action, { stepId: step.id });
      const screenshotPath = await snap(browser, automation.id, runId, index);
      // Refresh successCount / lastUsedAt
      await writeActionCache({
        automationId: automation.id,
        stepId: step.id,
        fingerprint,
        action: cached.action,
        actor,
        confidence: cached.confidence,
      });
      return finishRecord(baseRecord, 'completed', stepStart, {
        tier: 'cache',
        fingerprint,
        screenshotPath,
        resolvedAction: cached.action,
      });
    } catch (err) {
      // Fall through to vision (tier 'cache-then-vision')
      console.warn(`[automation] cache action failed for ${automation.id}/${step.id}, falling back to vision: ${errMsg(err)}`);
    }
  }

  // 3. Tier 2: vision (EXPERT on max effort). The screenshot fed to vision
  // is the daemon's observation of the page going into the step.
  const screenshotPng = browser.screenshotPng();
  let vision: ResolveActionOutput;
  try {
    vision = await resolvePlaywrightAction({
      stepDescription: step.description,
      expectedOutcome: step.expectedOutcome,
      screenshotPng,
      pageUrl: browser.url(),
      scopedMemories,
      userId: ctx.ownerUserId,
    });
  } catch (err) {
    const message = `vision resolution failed: ${errMsg(err)}`;
    const screenshotPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      error: { message, recoverable: true },
    });
  }

  // Confidence gate: a `low` resolution is the model's own admission
  // it's guessing. Don't execute it — return a recoverable failure so
  // the rehearsal fixer can re-plan instead of committing the guess.
  if (vision.confidence === 'low') {
    const screenshotPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      resolvedAction: vision.action,
      visionReasoning: vision.reasoning,
      error: {
        message: `vision resolver returned low confidence — refusing to execute the guess. Reasoning: ${vision.reasoning}`,
        recoverable: true,
      },
    });
  }

  try {
    await browser.act(vision.action, { stepId: step.id });
    const screenshotPath = await snap(browser, automation.id, runId, index);

    // We already gated `low` above; only `medium`/`high` reach here.
    // Skip the cache for noop — the "step is already satisfied" verdict
    // is page-state-specific; caching it could over-skip on the next run.
    if (vision.action.kind !== 'noop') {
      await writeActionCache({
        automationId: automation.id,
        stepId: step.id,
        fingerprint,
        action: vision.action,
        actor,
        confidence: vision.confidence,
      });
    }

    return finishRecord(baseRecord, 'completed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      resolvedAction: vision.action,
      visionReasoning: vision.reasoning,
    });
  } catch (err) {
    const screenshotPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      resolvedAction: vision.action,
      visionReasoning: vision.reasoning,
      error: { message: errMsg(err), recoverable: true },
    });
  }
}

async function executeVerifyStep(args: BrowserVerifyContext): Promise<StepRecord> {
  const { browser, automation, step, index, runId, ctx, baseRecord, stepStart, previousStep, inputs } = args;
  const actor = actorFromCtx(ctx);
  if (!step.expectedOutcome) {
    throw new Error(`verify step ${step.id} missing expectedOutcome`);
  }

  // Short-circuit: a verify step right after a successful side-effect
  // step (integration call, sub-automation) has no UI evidence to
  // inspect — the API success IS the confirmation. Asking vision to
  // "see" that an email was sent wastes tokens and almost always fails
  // (the page hasn't changed). Pass through with a synthetic reasoning.
  if (
    previousStep &&
    previousStep.record.status === 'completed' &&
    (previousStep.step.type === 'integration' || previousStep.step.type === 'sub_automation')
  ) {
    const screenshotPath = await snap(browser, automation.id, runId, index);
    const sideEffect = previousStep.step.type === 'integration'
      ? `${previousStep.step.integrationKey ?? 'integration'}.${previousStep.step.integrationAction ?? 'action'}`
      : `sub-automation ${previousStep.step.subAutomationId ?? ''}`;
    return finishRecord(baseRecord, 'completed', stepStart, {
      tier: 'cache',
      screenshotPath,
      visionReasoning: `confirmed by previous step's success (${sideEffect})`,
    });
  }

  // Ensure a current observation of the page going into the verify.
  await browser.ensureObserved({ stepId: step.id });
  const fingerprint = browser.fingerprint();

  // Tier 0: planner-authored deterministic assertion. Cheaper than the
  // run-cache lookup AND eliminates the hallucination surface for
  // outcomes the planner could express deterministically. Falls through
  // to the existing tier 1/2 ladder on assertion failure.
  if (step.cachedAssertion) {
    try {
      await browser.assert(step.cachedAssertion, { stepId: step.id });
      const screenshotPath = await snap(browser, automation.id, runId, index);
      return finishRecord(baseRecord, 'completed', stepStart, {
        tier: 'cache',
        fingerprint,
        screenshotPath,
        assertionResolved: step.cachedAssertion,
      });
    } catch (err) {
      console.warn(`[automation] planner-authored assertion failed for ${automation.id}/${step.id}, falling through: ${errMsg(err)}`);
    }
  }

  const scopedMemories = await loadScopedMemorySnippets(automation.id, step.expectedOutcome, ctx);

  // Build extract targets from inputSchema fields that are still empty
  // in the run's `inputs` map. Computed BEFORE the cache lookup so we
  // can bypass the cache when extraction is the whole reason the verify
  // step needs to run — the cached assertion would skip vision and never
  // read the page content we need.
  const extractTargets = (automation.inputSchema?.fields ?? [])
    .filter((f) => {
      const current = inputs[f.name];
      return current == null || (typeof current === 'string' && current.trim().length === 0);
    })
    .map((f) => ({ name: f.name, description: f.description }));

  // Tier 1: cached deterministic assertion (from a previous run's
  // verifier). Skip the cache entirely when there are extract targets —
  // the deterministic assertion only checks pass/fail, never reads input
  // values off the page.
  const cached = extractTargets.length === 0
    ? await lookupAssertionCache(automation.id, step.id, fingerprint, actor)
    : null;
  if (cached) {
    try {
      await browser.assert(cached.assertion, { stepId: step.id });
      const screenshotPath = await snap(browser, automation.id, runId, index);
      await writeAssertionCache({
        automationId: automation.id,
        stepId: step.id,
        fingerprint,
        assertion: cached.assertion,
        actor,
      });
      return finishRecord(baseRecord, 'completed', stepStart, {
        tier: 'cache',
        fingerprint,
        screenshotPath,
        assertionResolved: cached.assertion,
      });
    } catch (err) {
      console.warn(`[automation] cached assertion failed for ${automation.id}/${step.id}, falling back to vision: ${errMsg(err)}`);
    }
  }

  // Tier 2: vision verifier (EXPERT on max effort). Screenshot + URL come
  // from the daemon's held observation of the page.
  const screenshotPng = browser.screenshotPng();
  let result;
  try {
    result = await verifyOutcome({
      expectedOutcome: step.expectedOutcome,
      screenshotPng,
      pageUrl: browser.url(),
      scopedMemories,
      extractTargets: extractTargets.length > 0 ? extractTargets : undefined,
      userId: ctx.ownerUserId,
    });
  } catch (err) {
    const screenshotPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      error: { message: `verifier failed: ${errMsg(err)}`, recoverable: true },
    });
  }

  const screenshotPath = await snap(browser, automation.id, runId, index);

  if (!result.passed) {
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      visionReasoning: result.reasoning,
      error: { message: `outcome not met: ${result.reasoning}`, recoverable: true },
      humanAction: result.humanAction,
    });
  }

  // Cache the verifier-proposed assertion on first pass
  if (result.cachedAssertion) {
    await writeAssertionCache({
      automationId: automation.id,
      stepId: step.id,
      fingerprint,
      assertion: result.cachedAssertion,
      actor,
    });
  }

  // Merge any inputs the verifier extracted off the page into the run's
  // inputs map (mutates by design — `inputs` is the shared reference the
  // outer loop and downstream steps see). Only fills empty slots so a
  // user-supplied value wins over a page-extracted one.
  if (result.extractedInputs) {
    for (const [k, v] of Object.entries(result.extractedInputs)) {
      const current = (args.inputs as Record<string, unknown>)[k];
      if (current == null || (typeof current === 'string' && current.trim().length === 0)) {
        (args.inputs as Record<string, unknown>)[k] = v;
        console.log(`[automation] verifier extracted ${k}="${v}" from page on step ${step.id}`);
      }
    }
  }

  return finishRecord(baseRecord, 'completed', stepStart, {
    tier: cached ? 'cache-then-vision' : 'vision',
    fingerprint,
    screenshotPath,
    visionReasoning: result.reasoning,
    assertionResolved: result.cachedAssertion,
  });
}

// ============================================================================
// Helpers
// ============================================================================

async function loadScopedMemorySnippets(
  automationId: string,
  message: string,
  ctx: RunContext,
): Promise<string[]> {
  try {
    return await resolveScopedMemories({
      automationId,
      ownerUserId: ctx.ownerUserId,
      orgId: ctx.orgId,
      query: message,
      maxMemories: 8,
    });
  } catch {
    return [];
  }
}

/**
 * Build the `{{capture.*}}` substitution map for an integration step.
 *
 * Currently exposes `lastScreenshot` — base64 (no data URI prefix) of the
 * page right before the integration call. Cheap to skip when no template
 * needs it: we scan the argsTemplate values for `{{capture.X}}` references
 * and only generate the keys we see referenced.
 */
function buildCaptureContext(
  browser: BrowserSession | null,
  argsTemplate: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!argsTemplate) return undefined;
  const referenced = new Set<string>();
  const re = /\{\{\s*capture\.([a-zA-Z0-9_]+)\s*\}\}/g;
  for (const v of Object.values(argsTemplate)) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(v)) !== null) referenced.add(m[1]!);
  }
  if (referenced.size === 0) return undefined;
  const out: Record<string, string> = {};
  if (referenced.has('lastScreenshot') && browser?.hasObservation()) {
    const b64 = browser.screenshotB64();
    if (b64) out.lastScreenshot = b64;
  }
  return out;
}

/**
 * Persist the browser's latest observation screenshot as the per-step PNG.
 * No-op when no browser session has observed yet.
 */
async function snap(
  browser: BrowserSession | null,
  automationId: string,
  runId: string,
  index: number,
): Promise<string | undefined> {
  if (!browser || !browser.hasObservation()) return undefined;
  try {
    const png = browser.screenshotPng();
    return writeStepScreenshot(automationId, runId, index, png);
  } catch (err) {
    console.warn(`[automation] screenshot failed for ${automationId}/${runId} step ${index}: ${errMsg(err)}`);
    return undefined;
  }
}

/** Build the awaiting_daemon failure record the outer loop converts to a halt. */
function awaitingDaemonRecord(
  base: StepRecord,
  stepStart: number,
  index: number,
  capability: 'browser' | 'bash',
): StepRecord {
  return finishRecord(base, 'failed', stepStart, {
    tier: 'cache',
    error: {
      message: `local ekoa daemon not connected — this ${capability === 'browser' ? 'browser' : 'local command'} step needs your local Ekoa running`,
      recoverable: false,
      details: {
        kind: 'awaiting_daemon',
        capability,
        stepIndex: index,
      },
    },
  });
}

interface FinishExtras {
  tier?: StepTier;
  fingerprint?: PageFingerprint;
  screenshotPath?: string;
  resolvedAction?: import('./types.js').ResolvedAction;
  assertionResolved?: PlaywrightAssertion;
  visionReasoning?: string;
  error?: { message: string; recoverable: boolean; details?: unknown };
  humanAction?: import('./types.js').HumanActionRequired;
  output?: import('./types.js').StepOutput;
}

function finishRecord(base: StepRecord, status: StepStatus, stepStart: number, extras: FinishExtras): StepRecord {
  return {
    ...base,
    status,
    tier: extras.tier ?? base.tier,
    fingerprint: extras.fingerprint,
    screenshotPath: extras.screenshotPath,
    resolvedAction: extras.resolvedAction,
    assertionResolved: extras.assertionResolved,
    visionReasoning: extras.visionReasoning,
    error: extras.error,
    humanAction: extras.humanAction,
    output: extras.output,
    durationMs: Date.now() - stepStart,
  };
}

async function finalize(
  runId: string,
  automationId: string,
  status: RunRecord['status'],
  steps: StepRecord[],
  startedAt: string,
  awaitingIntegration?: { service: string; reason: string },
  rehearsal?: { isRehearsal: boolean; summary: RehearsalSummary | undefined },
): Promise<void> {
  await automationRunStore.update(automationId, runId, {
    status,
    endedAt: new Date().toISOString(),
    steps,
    awaitingIntegration,
    ...(rehearsal?.isRehearsal && rehearsal.summary ? { rehearsalSummary: rehearsal.summary } : {}),
  });
  void startedAt; // referenced by the result helper instead
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Common pause-and-wait flow: persist the pause request, emit the SSE
 * event, block on resume/cancel, and on resume drop the failing record
 * so the outer loop re-executes at the same index.
 *
 * Used both by the rehearsal fixer's pause_for_user patch and by the
 * fast-path human-action detection so that a CAPTCHA / MFA never sits
 * waiting on a 5–15 s Opus round-trip before the UI surfaces it.
 *
 * Returns the wall-clock spent paused so the caller can subtract it from
 * the rehearsal time budget.
 */
async function pauseRunForUser(args: {
  browser: BrowserSession | null;
  automation: Automation;
  runId: string;
  stepIndex: number;
  patch: Extract<RehearsalPatch, { kind: 'pause_for_user' }>;
  record: StepRecord;
  failureKind: FailureKind;
  stepRecords: StepRecord[];
  ctx: RunContext;
  emit?: RunEventEmitter;
}): Promise<{ resumed: boolean; pausedDeltaMs: number }> {
  const {
    browser, automation, runId, stepIndex: i, patch, record,
    failureKind, stepRecords, ctx, emit,
  } = args;

  const screenshotPath = await snap(browser, automation.id, runId, i);
  const screenshotUrl = screenshotPath
    ? `/automation-screenshots/${screenshotPath.replace(/^automation-runs\//, '')}`
    : undefined;
  const annotated = annotateRecordWithPatch(record, patch, failureKind, record.error?.message ?? '');
  const idx = stepRecords.findIndex((r) => r.index === i);
  if (idx >= 0) stepRecords[idx] = annotated;

  await automationRunStore.update(automation.id, runId, {
    status: 'paused_for_user',
    steps: stepRecords,
    pauseRequest: {
      stepIndex: i,
      reasoning: patch.reasoning,
      userInstructions: patch.userInstructions,
      screenshotPath,
    },
  });
  emit?.runPauseForUser?.(runId, {
    stepIndex: i,
    reasoning: patch.reasoning,
    userInstructions: patch.userInstructions,
    failureMessage: record.error?.message ?? '',
    screenshotUrl,
  });

  // The live CDP screencast during a pause needs a live browser canvas,
  // which the streaming/ media channel owns (ch03 §3.7); until the pause
  // overlay is wired to it the UI shows the static post-failure screenshot.
  // The pause/resume flow itself is unchanged.

  const pausedAt = Date.now();
  const resumed = await waitForResumeOrCancel(ctx);
  const pausedDeltaMs = Date.now() - pausedAt;
  if (!resumed) return { resumed: false, pausedDeltaMs };

  await automationRunStore.update(automation.id, runId, {
    status: 'running',
    pauseRequest: undefined,
  });
  emit?.runResumed?.(runId, i);
  // Drop the failed record so the outer loop's executeStep creates a
  // clean record at index i on retry.
  const removeIdx = stepRecords.findIndex((r) => r.index === i);
  if (removeIdx >= 0) stepRecords.splice(removeIdx, 1);
  return { resumed: true, pausedDeltaMs };
}

/**
 * Block until the user resumes the run (returns true) or cancels it
 * (returns false). Polls the resumeSignal / cancellation hooks every
 * 250 ms. No timeout: when paused for a CAPTCHA / MFA / payment, the user
 * decides how long they need. Cancel is the way out if they walk away.
 */
async function waitForResumeOrCancel(ctx: RunContext): Promise<boolean> {
  if (!ctx.resumeSignal) {
    // No signal hook plumbed through — fall back to honouring cancel
    // immediately. Should not happen in normal handler use.
    return false;
  }
  for (;;) {
    if (ctx.cancellation?.isCancelled()) return false;
    if (ctx.resumeSignal.shouldResume()) {
      ctx.resumeSignal.clear();
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

// Helpers for non-browser pause flows (local_command awaiting consent)
function extractAwaitingConsent(record: StepRecord): { stepIndex: number; shape: string; argv: string[]; description: string } | null {
  const details = record.error?.details;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== 'awaiting_consent') return null;
  return {
    stepIndex: typeof d.stepIndex === 'number' ? d.stepIndex : record.index,
    shape: String(d.shape ?? ''),
    argv: Array.isArray(d.argv) ? (d.argv as string[]) : [],
    description: String(d.description ?? ''),
  };
}

/** Detect the awaiting_daemon failure record (no local daemon connected). */
function extractAwaitingDaemon(
  record: StepRecord,
): RunAwaitingDaemonPayload | null {
  const details = record.error?.details;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== 'awaiting_daemon') return null;
  const capability = d.capability === 'bash' ? 'bash' : 'browser';
  return {
    stepIndex: typeof d.stepIndex === 'number' ? d.stepIndex : record.index,
    capability,
    reason: record.error?.message ?? 'local ekoa daemon not connected',
  };
}

// ============================================================================
// Rehearsal helpers
// ============================================================================

interface FinalizeReturnArgs {
  runId: string;
  status: RunRecord['status'];
  startedAt: string;
  stepRecords: StepRecord[];
  message: string;
  isRehearsal: boolean;
  refinedSteps: Step[];
  rehearsalSummary: RehearsalSummary | undefined;
  /** Override last-step index (used by the awaiting-integration path). */
  lastStepIndex?: number;
}

function finalizeReturn(args: FinalizeReturnArgs): RunAutomationResult | RehearseAutomationResult {
  // Defensive: filter out null / undefined entries that could have been
  // written by older versions of the engine.
  const records = args.stepRecords.filter(
    (r): r is StepRecord => r != null && typeof r === 'object' && typeof r.index === 'number',
  );
  const lastIndex = args.lastStepIndex ?? (records.length > 0
    ? records[records.length - 1]!.index
    : -1);
  const base: RunAutomationResult = {
    runId: args.runId,
    status: args.status,
    durationMs: Date.now() - Date.parse(args.startedAt),
    summary: args.message,
    lastStepIndex: lastIndex,
    error: args.status === 'failed' ? args.message : undefined,
  };
  if (args.isRehearsal) {
    return {
      ...base,
      refinedSteps: args.refinedSteps,
      rehearsal: args.rehearsalSummary ?? {
        status: 'failed',
        fixerCallCount: 0,
        patchesApplied: 0,
        wallClockMs: Date.now() - Date.parse(args.startedAt),
      },
    };
  }
  return base;
}

interface BuildSummaryArgs {
  isRehearsal: boolean;
  status: RehearsalSummary['status'];
  fixerCallCount: number;
  patchesApplied: number;
  startedAt: string;
  stuckAtIndex?: number;
  reason?: string;
}

function buildRehearsalSummary(args: BuildSummaryArgs): RehearsalSummary | undefined {
  if (!args.isRehearsal) return undefined;
  return {
    status: args.status,
    fixerCallCount: args.fixerCallCount,
    patchesApplied: args.patchesApplied,
    wallClockMs: Date.now() - Date.parse(args.startedAt),
    stuckAtIndex: args.stuckAtIndex,
    reason: args.reason,
  };
}

/** Carry over any rehearsalPatches from prior attempts at the same index. */
function mergeRehearsalPatches(prev: StepRecord, next: StepRecord): StepRecord {
  if (!prev.rehearsalPatches || prev.rehearsalPatches.length === 0) return next;
  return { ...next, rehearsalPatches: [...prev.rehearsalPatches, ...(next.rehearsalPatches ?? [])] };
}

function annotateRecordWithPatch(
  record: StepRecord,
  patch: RehearsalPatch,
  failureKind: FailureKind,
  failureMessage: string,
): StepRecord {
  const applied: AppliedPatch = {
    kind: patch.kind,
    reasoning: patch.reasoning,
    newStep: patch.kind === 'insert_before' || patch.kind === 'replace_current' ? patch.newStep : undefined,
    failureKind,
    failureMessage,
    appliedAt: new Date().toISOString(),
  };
  return {
    ...record,
    rehearsalPatches: [...(record.rehearsalPatches ?? []), applied],
  };
}

function classifyFailure(record: StepRecord, step: Step): FailureKind {
  if (step.type === 'verify') return 'verify_failed';
  if (step.type === 'browser') return 'browser_failed';
  if (step.type === 'navigate') return 'navigate_failed';
  if (step.type === 'integration') return 'integration_failed';
  void record;
  return 'other';
}

/**
 * Decide whether a failed record is a candidate for self-correction.
 * Non-recoverable errors (e.g. missing integration) and unsupported
 * step types (sub_automation) are surfaced to the user instead.
 */
function shouldAttemptFix(record: StepRecord, step: Step): boolean {
  if (record.error?.recoverable === false) return false;
  switch (step.type) {
    case 'browser':
    case 'verify':
    case 'navigate':
      return true;
    case 'wait':
    case 'integration':
    case 'sub_automation':
      return false;
    case 'local_command':
    case 'api_call':
    case 'ekoa_action':
      // Fixer can rewrite argv / URLs / capability mappings on retry.
      return true;
  }
}

async function persistRefinedSteps(
  automation: Automation,
  refinedSteps: Step[],
  isRehearsal: boolean,
): Promise<void> {
  // Only rehearsal runs commit fixer-applied patches back to the spec.
  // Normal runs apply patches transiently in the working copy so this run
  // completes, but the user's saved automation stays exactly as they wrote
  // it. Without this guard the fixer would silently rewrite the user's spec
  // on every normal run.
  if (!isRehearsal) return;
  await automationStore.update(automation.id, {
    steps: refinedSteps,
    updatedAt: new Date().toISOString(),
  });
}
