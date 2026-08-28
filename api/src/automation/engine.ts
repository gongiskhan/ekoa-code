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
import { RunCredentialRequest, type Actor, type LocalBrowserCapture } from '@ekoa/shared';
import { loadAutomationConfig } from './config.js';
import {
  cofrePortalDeepLink,
  evaluateCredentialGate,
  resolveAdhocSession,
  resolveStepOrigin,
  type CredentialGateDeps,
  type CredentialGateInput,
  type CredentialGateVerdict,
} from './credential-gate.js';
import { registerCredentialWaiter } from './credential-waiters.js';
// The login relay prompt, so a locality refusal only a person can clear can say WHERE to log in.
// PURE (`cofre/relay.ts` composes and returns; it registers nothing), which is what makes it safe
// to call on a refusal path that must not have side effects of its own.
import { issueLoginRelayPrompt } from '../cofre/index.js';
import { classifyOrigin, type OriginPosture } from './origin-posture.js';
import {
  resolveLocality,
  narrowLocalityForRun,
  refusalIsNeutral,
  hostedTypistPermitFor,
  type LocalityVerdict,
} from './locality.js';
import {
  machineRetired,
  residentialEgressPairings,
  SESSION_MACHINE_RETIRED_REASON,
  type EgressCandidate,
  type EgressResolution,
} from './egress-policy.js';
import {
  getDaemonConnection,
  executeIntegrationAction,
  callPlatformIntegration,
  resolveScopedMemories,
  loadEgressCandidates,
  loadIntegrationActionDeclaration,
  type IntegrationActionDeclaration,
} from './seams.js';
import { LocalBrowserSession } from './local-browser-session.js';
import { rebaseSelfUrlWithProvenance, originOf } from './self-url.js';
import { isCredentialAdjacentFailure } from './human-action-routing.js';
import {
  DaemonBrowserSession,
  releaseBrowserLease,
  type BrowserLease,
  type BrowserSession,
} from './browser-session.js';
import {
  resolvePlaywrightAction,
  verifyOutcome,
  classifyHumanAction,
  type ResolveActionOutput,
} from './vision.js';
import { applyArgsTemplate } from './template-vars.js';
import { SecretRegistry } from '../security/redaction.js';
import {
  automationStore,
  automationRunStore,
  writeStepScreenshot,
  screenshotUrlFromPath,
  createStepLogAccumulator,
} from './persistence.js';
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
} from './rehearsal.js';
import { withGoogleSsoGuidance } from './login-guidance.js';
import {
  REHEARSAL_BUDGET,
  NORMAL_RUN_BUDGET,
  STEP_RETRY_BUDGET,
  createStepRetryLedger,
  type StepRetryLedger,
} from './budgets.js';
import type {
  AppliedPatch,
  Automation,
  ConsentRequest,
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
  StepType,
} from './types.js';
import { resolveStepDeclaration } from './types.js';

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
/**
 * Input names a verifier must never populate from page content (Cofre R-4, invariant I2). These are
 * the names whose values are, by convention, exactly the material that must not enter the shared
 * `inputs` map — from there they are template-substituted into downstream api_call URLs, headers
 * and bodies whose RESOLVED form is persisted into the step record.
 * PT-PT names are included because the planner writes Portuguese input names.
 * Exported so the security suite can pin the vocabulary: a control that is not asserted is not a
 * control (this repo's own verdict rule).
 */
export const SECRET_SHAPED_INPUT_NAME =
  /(?:otp|mfa|2fa|totp|token|password|passwd|senha|palavra[-_]?passe|secret|segredo|apikey|api[-_]?key|authorization|auth[-_]?token|\bauth\b|bearer|cookie|session|sessao|sess[aã]o|credential|credencial|\bpin\b|cvv)/i;

/**
 * Register every string in a decrypted credential bag (Cofre H-1). The bag is
 * `{ [field]: value }` or a nested `{ [key]: { [field]: value } }`; both shapes appear depending on
 * whether the credentials came from an integration action or a captured session.
 */
function registerCredentialBag(registry: SecretRegistry, bag: unknown): void {
  if (!bag || typeof bag !== 'object') return;
  for (const v of Object.values(bag as Record<string, unknown>)) {
    if (typeof v === 'string') registry.register(v);
    else if (v && typeof v === 'object') registerCredentialBag(registry, v);
  }
}

/**
 * Filter a step record before it leaves the engine (Cofre H-1).
 *
 * The record goes THREE places at once — the SSE stream, the persisted run row, and (on a failure)
 * the rehearsal fixer's prompt. Filtering here rather than at each sink is deliberate: a new sink
 * added later inherits the filter instead of having to remember it.
 */
function redactStepRecord(record: StepRecord, secrets: SecretRegistry | undefined): StepRecord {
  if (!secrets || secrets.size === 0) return record;
  return {
    ...record,
    ...(record.error
      ? {
          error: {
            ...record.error,
            message: secrets.redact(record.error.message),
            ...(record.error.details !== undefined
              ? { details: secrets.redactDeep(record.error.details) }
              : {}),
          },
        }
      : {}),
    ...(record.output !== undefined
      ? { output: secrets.redactDeep(record.output) as StepRecord['output'] }
      : {}),
    ...(record.resolvedAction !== undefined
      ? { resolvedAction: secrets.redactDeep(record.resolvedAction) as StepRecord['resolvedAction'] }
      : {}),
    // `logTail` (slice E4) is the bounded tail of what a step streamed while it ran, and it landed
    // on StepRecord from a different line of work than this filter. The claim above — that a new
    // sink inherits the filter — holds for sinks but NOT for new FIELDS, which is how the two
    // changes could both be right and still leave a gap. In the wired daemon path the text is
    // already ingress-redacted (bridge H-4), so this is defence in depth rather than the only
    // guard; it is here so the docblock is true of the whole record, not most of it.
    ...(record.logTail !== undefined
      ? { logTail: { ...record.logTail, text: secrets.redact(record.logTail.text) } }
      : {}),
  };
}

export interface RunContext {
  ownerUserId: string;
  /** The owner's org — threaded so the memory-backed cache and scoped-memory injection are
   *  tenant-scoped (ch09 invariant 5). Built by the caller alongside ownerUserId. */
  orgId: string;
  triggeredBy: 'user' | 'agent' | 'webhook' | 'listener' | 'schedule';
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
  /**
   * THE BROWSER LEASE THE WHOLE CALL TREE SHARES (see `BrowserLease`).
   *
   * Set only on the context a `sub_automation` step builds for its child. A run that arrives
   * without one is the OUTERMOST pass: it mints the lease, is the only pass that ends it, and hands
   * this same object down so every sub-automation beneath it drives the browser its parent holds
   * rather than queueing behind it forever.
   */
  browserLease?: BrowserLease;
  /** Used for SSE event correlation. */
  traceId: string;
  /**
   * RUN-SCOPED SECRET REGISTRY (Cofre H-1). Every credential value the run resolves is registered
   * here, and every byte stream the run produces toward a model, a log, an SSE frame or a persisted
   * record passes through it.
   *
   * Scoped to the RUN, never process-wide: a process-wide registry would outlive the use window and
   * quietly redact one tenant's output using another tenant's values. Created by `startRun` so
   * every step of a run shares one, and populated lazily as credentials are loaded — a run that
   * touches no credential has an empty registry, which is a genuine no-op rather than a cost.
   */
  secrets?: SecretRegistry;
  /** Optional cancellation signal from the handler / UI. */
  cancellation?: { isCancelled: () => boolean };
  /**
   * Resume signal from the handler. When the engine pauses for the
   * user (CAPTCHA, MFA, payment confirmation), it polls this until it
   * returns true. Set by the handler's resume-run intent.
   */
  resumeSignal?: { shouldResume: () => boolean; clear: () => void };
  /**
   * Command shapes the owner approved for THIS RUN ONLY ("permitir uma vez").
   *
   * Without it, `once` could not mean what the dialog says it means. `resolveConsent` deliberately
   * persists nothing for `once` — correct — and sets the resume flag; the engine then re-runs the
   * step, `local-command.ts` re-reads the DURABLE approvals store, still finds nothing, and asks
   * the same question again. The user was in a loop with no exit but "sempre" or "parar", which is
   * precisely the choice `once` exists to avoid.
   *
   * Run-scoped, in memory, and never written down: an answer about one execution must not outlive
   * it. It is a Set on the signal record the handler already owns, so it dies with the run — a
   * restart loses it, and losing it means the user is asked again, which is the safe direction.
   */
  runApprovedShapes?: { has: (shape: string) => boolean; add: (shape: string) => void };
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
   * The Cofre holds no usable credential for an origin this run needs. The run halts in
   * `needs_credentials`; the UI names the origin and deep-links to `/cofre`. Beside
   * `runAwaitingDaemon` and not beside `runPauseForUser` on purpose — this halt outlives the
   * process, so it is a re-dispatch, not a poll.
   */
  runNeedsCredentials?: (runId: string, info: RunCredentialRequest) => void;
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
  /**
   * Restart a HALTED run at this step index instead of at 0 (P3.1 auto-resume).
   *
   * WHY NOT "just run it again". A `needs_credentials` halt is a pause, not a failure: the steps
   * before it already ran, and re-running them would re-execute their effects — an api_call write
   * that succeeded before the halt would fire twice for one user action. So the resumed run keeps
   * its OWN run id and its OWN step records, and picks up at the step that stopped it. The step
   * records for earlier indices are read back from the persisted run, so the timeline the user was
   * already looking at stays whole rather than restarting at zero under them.
   *
   * Absent → 0, which is every other caller and every pre-existing behaviour.
   */
  resumeFromStepIndex?: number;
  /**
   * LEARN WHAT THIS RUN'S PAGE ASKS THE SERVER FOR (slice P2).
   *
   * When present, the run arms the machine's network recorder before the first step that drives a
   * browser, and hands everything it recorded to this sink as the run ends - whatever the run's
   * outcome, because only the CALLER knows whether the pass is worth compiling a recipe from.
   *
   * WHY THE LEARNING PASS IS THE ORDINARY RUN, instrumented, rather than a pass of its own: an
   * automation-backed action already drives its authored steps vision-first on every run. A
   * separate goal-driven exploration would pay for a second expensive pass, adapt worse than
   * `rehearsal.ts` already does, and - the reason it is not here - have no production caller. A
   * passive listener on the run that was going to happen anyway costs one frame, and what it
   * compiles makes every later run of that action free.
   *
   * ARMED LAZILY AND ONLY FOR A BROWSER-DRIVING STEP. Arming takes the machine's lease, so doing it
   * at run start would open a headed profile for an api_call-only automation that never wanted one.
   */
  observeNetwork?: (captures: LocalBrowserCapture[]) => void;
}

/** Step types that put a page in front of the machine, and therefore the ones worth arming the
 *  network recorder for. Anything else runs without a browser and would only pay for a lease. */
const BROWSER_DRIVING_STEP_TYPES: ReadonlySet<StepType> = new Set<StepType>(['browser', 'navigate', 'verify']);

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
  return { userId: ctx.ownerUserId, orgId: ctx.orgId, role: 'user' };
}

// ============================================================================
// Public API
// ============================================================================

/** Drop the `credentials` key from a run's inputs before persistence/wire (credential boundary,
 *  §5.6.7). The in-memory `inputs` keeps it for the browser session; the stored copy never has it.
 *  Exported so EVERY persist site scrubs — the service's register-first insert AND this engine
 *  create both write the run row, so both must strip credentials (Codex round-2). */
export function scrubCredentials(inputs: Record<string, unknown>): Record<string, unknown> {
  if (!('credentials' in inputs)) return inputs;
  const { credentials: _dropped, ...rest } = inputs;
  return rest;
}

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

  // CREDENTIAL BOUNDARY (ch05 §5.6.7; v2 invariant I2): `inputs.credentials` carries decrypted
  // secrets (an integration action's passCredentials fields, a captured Playwright storageState).
  // It is consumed IN-MEMORY only (the browser session below; template-vars redacts it from any
  // substitution). It must NEVER reach the persisted run record — `GET /automations/runs/:id`
  // returns `inputs` to the owner AND org admins, so a persisted credential is a cross-actor leak.
  const persistedInputs = scrubCredentials(inputs);

  // H-1: one registry per RUN. Seeded from `inputs.credentials` (the decrypted bag the browser
  // session consumes) so the values are known BEFORE the first step produces any output. Steps
  // that resolve further credentials register them as they go.
  ctx.secrets ??= new SecretRegistry();
  registerCredentialBag(ctx.secrets, inputs.credentials);

  // RESUMING A HALTED RUN (P3.1). Clamped to the step list: a persisted index from an automation
  // whose steps were edited between the halt and the resume would otherwise skip past the end (or
  // start mid-nowhere), and starting over from 0 is the safe reading of "that index no longer
  // means anything".
  const resumeFrom = Math.max(0, Math.min(options.resumeFromStepIndex ?? 0, automation.steps.length - 1));
  const isResume = resumeFrom > 0;

  const initialRecord: RunRecord = {
    id: runId,
    automationId,
    startedAt,
    status: 'running',
    inputs: persistedInputs,
    steps: [],
    triggeredBy: ctx.triggeredBy,
    ownerUserId: ctx.ownerUserId,
    orgId: ctx.orgId,
    parentRunId: ctx.parentRunId,
    kind: options.kind,
  };
  await automationRunStore.create(initialRecord);
  if (isResume) {
    // `create` is a duplicate no-op on an existing id (the service's register-first insert is the
    // row that sticks), so a resumed run is still sitting at `needs_credentials` in the store. Put
    // it back to `running` and drop the request the human just answered, or the UI would show a
    // credential banner over a run that is already moving again.
    await automationRunStore.update(automationId, runId, { status: 'running', credentialRequest: undefined });
  }

  const emit = options.emit;

  // Bounded per-step capture of everything the run STREAMS (slice E4). Independent of `emit`: the
  // SSE frames are ephemeral and may have no listener at all (a gateway-key caller has no stream),
  // so the tail is accumulated whether or not anyone is watching, and persisted on the step record
  // as each step finishes. Caps live in persistence.ts.
  const stepLogs = createStepLogAccumulator();

  // Executor face: browser steps DEFAULT TO THE BRIDGE (P4.1) — the owner's paired machine has the
  // real profile, the real IP and the real fingerprint, and every reason the hosted browser exists
  // is a fallback reason. `connection` is the live daemon for this owner, or undefined when none is
  // dialed in.
  //
  // WHEN THERE IS NO DAEMON the fallback is decided PER ORIGIN POSTURE, in every environment
  // (`locality.ts`): a permissive origin may run in the hosted Chromium, an adversarial one never
  // does, and an origin nobody classified is adversarial. It used to be decided by
  // `localBrowserEnabled` ALONE, which meant the deployment environment answered "may this site be
  // automated from a datacenter IP" - outside production, for every target, silently yes. That flag
  // keeps its `!isProd` default and is now only an operator kill switch: it can close the fallback,
  // never open it for an adversarial origin. A step that posture will not carry halts in
  // `awaiting_daemon`, which is the honest state for it: a machine of yours is needed.
  const connection = getDaemonConnection(ctx.ownerUserId);
  // Captured browser session credential (integration-launched runs with
  // `passCredentials`): `inputs.credentials.storageState` carries the
  // Playwright storage state a session-connect flow captured. SECRET —
  // read once here, handed opaquely to the browser session, never logged
  // and never template-substituted (template-vars redacts input.credentials).
  const credentials = inputs['credentials'];
  // `let`, because the credential gate below may establish a session for a declared origin and that
  // storageState is what the browser must start from. Assigned only while `browser` is still null
  // (the session is injected at context creation, and there is no cookie channel to a live one).
  let sessionState = credentials && typeof credentials === 'object'
    ? (credentials as Record<string, unknown>)['storageState']
    : undefined;
  /**
   * WHICH PORTAL `sessionState` IS FOR, or null when nothing here can say.
   *
   * A RUN IS NOT A PORTAL. `sessionState` is one variable for a whole run, and a run can navigate
   * from portal A to portal B, so "a session is in hand" is not the same claim as "this step's
   * origin has a session". Only the second one licenses answering a login wall with "we already did
   * that" (S-login-step), and conflating them is the run-level `preferredPairingId` defect in
   * another costume: one portal judged by another's facts.
   *
   * NULL FOR A CREDENTIAL PASSED IN BY THE CALLER (`inputs.credentials.storageState`), because
   * nothing in this loop knows which origin that blob was captured against - the integration that
   * launched the run does. Null is the closed reading: it withholds the S-login-step answer rather
   * than guessing, which leaves that path exactly as it behaved before the guard existed.
   */
  let sessionOrigin: string | null = null;
  // THE BROWSER LEASE FOR THIS CALL TREE. An outermost pass mints one and owns
  // its end; a sub-automation inherits its parent's through `ctx` and must not
  // end it (see `BrowserLease`). Minted whether or not this run ends up using a
  // browser - it costs a uuid, and deciding later would mean the sub-automation
  // step needing to know something the parent has not discovered yet.
  const browserLease: BrowserLease = ctx.browserLease ?? { id: randomUUID(), used: false };
  const ownsBrowserLease = ctx.browserLease === undefined;
  /**
   * P4.2 - the pairing where each checked-out session's ceremony HAPPENED, KEYED BY THE ORIGIN THAT
   * SESSION BELONGS TO. Read off the item (`sessionMetadata.establishedBy.pairingId`) by the
   * credential gate, never invented here, and honoured as a preference for adversarial origins only.
   *
   * A MAP, AND NOT A `let`, BECAUSE A RUN IS NOT A PORTAL. This was one run-level variable set by
   * whichever gated step last reported a pairing, and `resolveLocalityForStep` forwarded it into
   * EVERY later browser step whatever origin that step was about. So a run that logs into portal A
   * and then browses portal B judged portal B's steps against portal A's ceremony machine: retire
   * that machine and the run halted `needs_credentials` naming PORTAL B, the owner re-established
   * portal B exactly as instructed, and the next fire produced the identical halt - while every one
   * of those fires counted against the failure ceiling (`needs_credentials` is deliberately NOT in
   * `NEUTRAL_BLOCKED_CODES`) until the schedule auto-paused. A session is bound to one origin, so
   * its preference is too, and the key is the origin the gate resolved it for.
   */
  const preferredPairingByOrigin = new Map<string, string>();
  // The browser session is created lazily on first browser use so a run with
  // only api_call/integration steps still works without any browser.
  let browser: BrowserSession | null = null;
  /** The route the in-process session's context was LAUNCHED for (proxy is a launch option). */
  let inProcessRoute: EgressResolution | null = null;
  /**
   * The locality verdict for the step currently executing, resolved at the top of each iteration
   * for the step types that can reach a browser. Null means no browser-capable step is in flight,
   * and `getBrowser` then behaves as it did before locality existed (the recovery paths — the
   * fixer's screenshot, the human-action classifier — ask for whatever session already exists).
   */
  let stepLocality: LocalityVerdict | null = null;
  /**
   * The ORIGIN the locality verdict above was resolved for, kept beside it because a `human`-cleared
   * refusal has to name the site the person must re-establish a session against
   * (`RunCredentialRequest.origin` is required, and inventing one would aim a human at the wrong
   * portal). Null when no origin could be resolved, which `refusalRecordFor` reads as "cannot ask
   * for a ceremony" and answers with a plain terminal failure rather than a halt naming nowhere.
   */
  let stepOrigin: string | null = null;
  /**
   * THE POSTURE OF `stepOrigin`, kept beside it rather than re-derived where it is read.
   *
   * The ad-hoc adversarial halt (D-ADHOC-5) fires only for an ADVERSARIAL origin, and "adversarial"
   * has to mean the same thing there as it means to locality and to the credential gate - including
   * the case that makes the fork real, a PERMISSIVE origin whose declaration says so. Re-classifying
   * at the pause site would mean a second `classifyOrigin` call with a second answer about where its
   * action declaration comes from, and the closed default would quietly make every origin
   * adversarial: `classifyOrigin(url)` with no action is CLOSED by design, so a re-derivation that
   * forgot the declaration would not fail, it would just always say yes.
   *
   * So it is assigned exactly where the classification is already computed, from the same resolved
   * action, and is null for the same reason `stepOrigin` is.
   */
  let stepOriginPosture: OriginPosture | null = null;
  /**
   * The org's machines, read ONCE per run rather than per step.
   *
   * THREE STATES, NOT TWO. `undefined` = not read yet (the memo sentinel); `null` = read, and this
   * process has no listing (an unbound seam); `[]` = read, and the org genuinely has no machines.
   * The last two used to be one value, which is what let an account whose only laptop was revoked
   * retry forever - see `seams.ts` `loadEgressCandidates` and docs/findings.md
   * `an-org-whose-only-machine-is-revoked-retried-forever`.
   */
  let egressCandidates: readonly EgressCandidate[] | null | undefined;
  /**
   * The listing, read at most once. The MEMO IS THE SENTINEL, so this cannot depend on call order:
   * the previous shape used `??=` against a `null`-initialised variable, which made "not read yet"
   * and "no listing" the same state and left a reader that ran first quietly answering for one when
   * it meant the other.
   */
  const fleetNow = async (): Promise<readonly EgressCandidate[] | null> => {
    if (egressCandidates === undefined) egressCandidates = await loadEgressCandidates(ctx.orgId);
    return egressCandidates;
  };
  /**
   * THE MACHINES CHECKOUT MAY RELEASE A RESIDENTIAL-BOUND SESSION FOR - the fleet fact the
   * credential gate needs, and the one this loop used to withhold entirely.
   *
   * A ceremony session is stamped `boundEgress: { kind: 'residential', pairingId }`
   * (`bridge/attended.ts`, the only writer of `establishedBy: machine` in this repo), so
   * `checkoutSession` releases it only when that machine is in this list. Passing nothing left
   * `ensureSession` defaulting to `[]`, which refused EVERY attended session with
   * `egress-unavailable`: an attended card-login session could never be reused by an automation,
   * the run halted `awaiting_daemon` - neutral against the failure ceiling, so the schedule
   * re-fired forever, uncounted, with nothing the owner could do - and `verdict.status === 'reused'`
   * was never reached for a machine-established session, which made the whole P4.2 preference
   * below unreachable in production.
   *
   * Read from the SAME candidate list locality resolves against, through the SAME predicate
   * (`residentialEgressPairings`), so "this machine can carry the work" and "this machine's session
   * may be released" cannot answer differently.
   */
  const residentialAvailableNow = async (): Promise<readonly string[]> => {
    // No listing is the same as no usable machine FOR SELECTION - the closed direction, and the one
    // this seam has always taken. The distinction between "no listing" and "no machines" matters to
    // retirement, not to whether a session may be released.
    return residentialEgressPairings((await fleetNow()) ?? [], ctx.orgId);
  };
  /**
   * EVERY machine the org still has, live or not - a different question from the one above, and the
   * difference is what separates "start your laptop" from "that laptop is gone".
   *
   * `null` TRAVELS THROUGH rather than being flattened to `[]`, and that is the whole point:
   * `machineRetired` answers NO for `null` (this process does not know what the org has, and
   * not-knowing may never escalate a neutral wait into a terminal halt) and YES for `[]` (the
   * registry was asked and said the org has no machines, so every pairing it once had is gone).
   * Flattening them was the defect: a solo tenant who revoked their only laptop produced `[]`, it
   * read as ignorance, and the run re-fired nightly forever against hardware that no longer existed.
   */
  const knownPairingsNow = async (): Promise<readonly string[] | null> => {
    return (await fleetNow())?.map((c) => c.pairingId) ?? null;
  };
  /**
   * THE ACTION DECLARATION SEAM, READ ONCE PER (integration, action) FOR THE LIFE OF THE RUN - the
   * way `fleetNow` memoises the fleet listing, and for the same reason.
   *
   * `resolveStepOrigin` walks BACKWARDS from a step index to the nearest step that states a URL, and
   * every `integration` step it passes costs one definition-store read. It runs two to three times
   * per gated browser step (locality, the gate, and the post-gate re-resolution when the gate hands
   * back a ceremony pairing), so a run of N browser steps behind one integration step paid O(N) store
   * reads for the same row.
   *
   * KEYED BY THE LOOKUP, NOT BY THE STEP, and that distinction is load-bearing. A cache keyed by step
   * index holds a value RESOLVED FOR ONE STEP AND REUSED FOR ANOTHER, which is precisely the shape
   * that produced the run-level `preferredPairingId` defect (docs/findings.md
   * `resolve-step-origin-runs-twice-per-gated-browser-step`, which warned against exactly that). This
   * memoises the SEAM CALL: the same `(integrationKey, actionName)` under the same run actor is the
   * same row, and nothing derived from a step is stored. The actor is fixed for the run, so it is not
   * part of the key; the seam is per-run-actor for tenancy reasons and this memo never outlives one.
   *
   * THE PROMISE IS THE CACHE ENTRY, so two concurrent walks of the same key share one store read
   * instead of racing to issue two. A rejected read is not cached - the entry is dropped so a later
   * step re-asks rather than inheriting a transient failure for the whole run.
   */
  const declarationMemo = new Map<string, Promise<IntegrationActionDeclaration | null>>();
  const loadDeclarationOnce: typeof loadIntegrationActionDeclaration = (integrationKey, actionName, actor) => {
    // The separator is an ESCAPED NUL: it cannot occur in either component, so no pair of
    // key/action can collide with another by concatenation. Written `\u0000` and never as a
    // raw byte - a raw control byte makes the file BINARY to git, grep and every grep-based CI
    // gate (`tests/security/binary-bytes-gate.test.ts`, which caught exactly this).
    const key = `${integrationKey}\u0000${actionName}`;
    const hit = declarationMemo.get(key);
    if (hit) return hit;
    const pending = loadIntegrationActionDeclaration(integrationKey, actionName, actor)
      .catch((err: unknown) => {
        declarationMemo.delete(key);
        throw err;
      });
    declarationMemo.set(key, pending);
    return pending;
  };
  const getBrowser = (): BrowserSession | null => {
    if (!browser) {
      // NO `blocked` GUARD HERE, on purpose. A refused step never reaches `executeStep` at all -
      // `localityRecord` short-circuits the `??` chain below, and every other `getBrowser` caller
      // is a post-failure recovery path the awaiting-daemon halt already returned before. A branch
      // that cannot be entered is a branch no test can pin, and an unpinnable guard reads as
      // protection while providing none.
      //
      // WHICH IS WHY THE `stepLocality?.kind !== 'in-process'` CONJUNCT IS GONE from this line. It
      // was never enterable: `resolveLocality` returns `bridge` or `blocked` whenever
      // `daemonConnected` is true, and `daemonConnected` IS `!!connection`, so a truthy `connection`
      // and an `in-process` verdict cannot co-occur. It read as a second opinion about which session
      // to build while providing none - the exact thing the paragraph above rejects.
      if (connection) {
        // SESSION INJECTION, NOW ON BOTH ROUTES (S-inject). This branch used to carry a carve-out
        // saying the bridge protocol had no cookie channel - which was true, and was the entire
        // reason a bridge run could never start authenticated: a ceremony pushed a session UP and
        // nothing ever brought one back DOWN, so every capture was write-only and the daemon's own
        // persistent profile was the only thing a run could be logged in by. `session.deliver` is
        // that channel, and the value rides the LEASE-TAKING frame (see
        // `DaemonBrowserSession.takeSessionDelivery`).
        //
        // It is the SAME `sessionState` the in-process branch below injects, resolved by the same
        // credential gate through the same owner-scoped unwrap. One session per run, whichever
        // browser ends up running it - there is deliberately no second, bridge-specific resolution.
        browser = new DaemonBrowserSession({
          connection,
          runId,
          ownerUserId: ctx.ownerUserId,
          // The session marks the lease used on its first frame. Marking it here
          // would mark every daemon-connected run, browser step or not: this
          // factory runs for EVERY step (`executeStep({ browser: getBrowser() })`).
          lease: browserLease,
          // GUARDED, so a run with nothing to inject sends no delivery frame at all rather than one
          // carrying `undefined`. The daemon's profile is persistent, and "no session resolved"
          // has to keep meaning "whatever this machine already holds".
          ...(sessionState !== undefined ? { sessionState } : {}),
        });
      } else if (stepLocality?.kind === 'in-process') {
        inProcessRoute = stepLocality.egress;
        browser = new LocalBrowserSession({
          runId,
          ownerUserId: ctx.ownerUserId,
          sessionState,
          egress: stepLocality.egress,
        });
      } else {
        return null;
      }
    }
    return browser;
  };

  // ── THE LEARNING LISTENER (slice P2) ──────────────────────────────────────────────────────
  //
  // Armed at most once, and only when the caller asked to observe AND the step about to run is one
  // that drives a page. `startCapture` is a lifecycle frame: it takes the machine's lease, so
  // arming for an integration-only automation would open a headed profile nobody wanted.
  //
  // A FAILURE TO ARM IS NOT A FAILURE TO RUN. A daemon that predates the capture frames answers an
  // error; the run carries on uninstrumented and the caller compiles nothing, which is exactly the
  // behaviour before this existed.
  let captureArmed = false;
  const armNetworkCapture = async (step: Step, index: number): Promise<void> => {
    if (!options.observeNetwork || captureArmed) return;
    if (!BROWSER_DRIVING_STEP_TYPES.has(step.type)) return;
    // THE LAST MOMENT A SESSION CAN STILL BE INJECTED (S-inject).
    //
    // `getBrowser()` below CREATES the browser session and `startCapture` TAKES the machine's
    // lease, and a jar is built with cookies or without them - there is no injecting into a live
    // one. Because arming happens before the credential gate, an ad-hoc run with `observeNetwork`
    // set reached the gate with the browser already open, `sessionUnresolved` already false, and so
    // never looked a stored session up at all: the feature was inert on precisely the discovery /
    // recipe-compile runs a free-text goal most often takes to an undeclared origin.
    //
    // The DECLARED path never had this problem - its `sessionState` is assigned from
    // `inputs.credentials` before the loop, so it is already in hand here - which is why the fix is
    // to resolve the AD-HOC one at this point rather than to move the arming or relax the gate.
    await resolveAdhocSessionBeforeLease(step, index);
    const session = getBrowser();
    if (!session || typeof session.startCapture !== 'function') return;
    captureArmed = true;
    try {
      await session.startCapture();
    } catch {
      captureArmed = false;
    }
  };

  /**
   * The undeclared-origin session lookup, run BEFORE the recorder takes the lease.
   *
   * It is the same `adhocSessionReuse` the credential gate reaches for a step that declares no
   * `credentialRefs`, called through `resolveAdhocSession` - not a second implementation and not a
   * relaxed one. Everything that makes it safe there makes it safe here: reuse only, no
   * `credentialRef` and no hosted-typist permit passed, so it cannot open a browser, submit a
   * password, halt the run or ask for a person, and it needs no locality verdict to decide. That is
   * what lets it run this early, before locality has been resolved for the step.
   *
   * IT COSTS AT MOST ONE COFRE READ PER RUN. `armNetworkCapture` returns immediately once
   * `captureArmed`, and the guard below returns once a session is in hand or a browser exists, so
   * this cannot repeat per step. When it finds nothing, the gate's own per-step call still runs and
   * behaves exactly as before.
   */
  const resolveAdhocSessionBeforeLease = async (step: Step, index: number): Promise<void> => {
    if (sessionState !== undefined || browser) return;
    const verdict = await resolveAdhocSession(
      {
        actor: actorFromCtx(ctx),
        runId,
        automationName: automation.name,
        steps: workingSteps,
        index,
        residentialAvailable: await residentialAvailableNow(),
        // TRUE BY CONSTRUCTION at this point - the guard above just proved both halves. Passing the
        // literal rather than recomputing keeps the one definition of "unresolved" at the guard.
        sessionUnresolved: true,
      },
      step,
      { loadActionDeclaration: loadDeclarationOnce },
    );
    if (verdict.kind !== 'ready') return;
    sessionState = verdict.storageState;
    sessionOrigin = verdict.origin;
    // P4.2, learned EARLIER than on the ordinary path and therefore more cheaply: the gate's own
    // call learns the preference after locality has already been resolved and has to re-resolve it.
    // Here locality has not run yet for this step, so recording it now means the first resolution
    // already knows which machine the session belongs to and no second pass is needed.
    if (verdict.preferredPairing) {
      preferredPairingByOrigin.set(verdict.preferredPairing.origin, verdict.preferredPairing.pairingId);
    }
  };

  // Working copy of steps — rehearsal mutates this in place. Normal runs
  // never touch it, so the user's saved spec is preserved either way until
  // we persist at the end.
  const workingSteps: Step[] = automation.steps.slice();

  /**
   * WHERE this step runs (P4.1). Pure joinery around `locality.ts`: gather the run's facts, ask,
   * answer. Called from the loop BEFORE the credential gate, and again if the gate hands back a
   * ceremony pairing the first call did not have.
   */
  const resolveLocalityForStep = async (index: number, step: Step): Promise<LocalityVerdict> => {
    const candidates = await fleetNow();
    const declaration = resolveStepDeclaration(step);
    // The ACTION the origin declaration is ABOUT. `resolveStepOrigin` walks backwards to the
    // nearest step that states a URL, so a browser step inherits the portal the run navigated to
    // AND the action whose `httpConfig.baseUrl` produced that origin - which is exactly the caller
    // contract `classifyOrigin` requires (the label applies only to the origin its action is
    // about; the two match by construction here). Nothing is looked up by name.
    const resolvedOrigin = await resolveStepOrigin(
      workingSteps,
      index,
      actorFromCtx(ctx),
      loadDeclarationOnce,
    );
    // An origin that cannot be resolved is not a licence: `classifyOrigin('')` is CLOSED, which is
    // what an unknown destination has to be.
    stepOrigin = resolvedOrigin?.origin ?? null;
    const classification = classifyOrigin(
      resolvedOrigin ? `https://${resolvedOrigin.origin}` : '',
      resolvedOrigin?.action ?? undefined,
    );
    // Recorded from the SAME classification locality is about to be decided from - see
    // `stepOriginPosture`. Null when no origin resolved, which is not "permissive": it is "nothing
    // was resolved", and the ad-hoc halt refuses to fire on it rather than guessing either way.
    stepOriginPosture = resolvedOrigin ? classification.posture : null;
    // THE PREFERENCE FOR *THIS* ORIGIN, and no other. A run touching two portals holds two
    // independent answers, and a step gets the one belonging to the site it is about - a lookup
    // that MISSES is the honest answer for a portal no session was checked out for, and means
    // "any machine of yours", not "the machine some other portal's session was made on".
    const preferredPairingId = resolvedOrigin ? preferredPairingByOrigin.get(resolvedOrigin.origin) : undefined;
    const verdict = resolveLocality({
      classification,
      declaredTarget: declaration.target,
      offlinePolicy: declaration.offlinePolicy,
      daemonConnected: !!connection,
      ...(connection?.pairingId ? { daemonPairingId: connection.pairingId } : {}),
      ...(preferredPairingId ? { preferredPairingId } : {}),
      candidates,
      actorOrg: ctx.orgId,
      inProcessFallbackEnabled: loadAutomationConfig().localBrowserEnabled,
    });

    // WHAT THIS RUN HAS ALREADY DONE, which the step list cannot state: the page the hosted browser
    // has drifted onto, and the route its context is already open for. Both refusals are BUILT IN
    // `locality.ts` (they used to be built here, which is exactly how the drift halt escaped that
    // module's cross-product census for six rounds) - this is the gather, not the judgement.
    //
    // `inProcessRoute` is read HERE rather than at the refusal site it used to live at, and the two
    // are the same value: nothing between this call and `refusalRecordFor` calls `getBrowser()`,
    // which is the only writer.
    return narrowLocalityForRun(verdict, {
      liveUrl: browser?.hasObservation() ? browser.url() : null,
      declaredOrigin: resolvedOrigin?.origin ?? null,
      openedRoute: inProcessRoute,
    });
  };

  /**
   * A locality verdict this loop must refuse, as the halt record the outer loop already knows.
   *
   * NEUTRALITY IS A TABLE READ, NOT A FALL-THROUGH, and that inversion is the whole point. This
   * asked `clearedBy === 'pair-a-machine'` and carried EVERYTHING ELSE as the environment halt, so a
   * refusal that failed to be the one terminal case inherited "retry forever" by saying nothing -
   * `awaiting_daemon` is neutral against the failure ceiling by design (the laptop opens and the
   * next fire works), and three separate defects reached production through that default. It now
   * asks `refusalIsNeutral`, which answers from `CLEARING_ACTS` where every act's neutrality is
   * written beside the reason it is true, so the default for anything unconsidered is TERMINAL: a
   * schedule that pauses loudly rather than one that repeats silently.
   *
   * WHICH terminal halt is a separate question, and it is about what the person is asked to DO
   * rather than about how it counts.
   */
  const refusalRecordFor = (step: Step, index: number, verdict: LocalityVerdict): StepRecord | undefined => {
    // There is deliberately NO `bridge`-inherits-a-hosted-session branch here, nor a route/drift
    // check: those are the RUN's own facts and `narrowLocalityForRun` has already folded them into
    // the verdict. `connection` is read once per run, and `resolveLocality` only answers `bridge`
    // when a daemon is connected and only `in-process` when none is - so within one run the two
    // cannot both occur, and a branch that cannot be entered is one no test can pin.
    if (verdict.kind !== 'blocked') return undefined;
    if (refusalIsNeutral(verdict.clearedBy)) return localityBlockedRecord(step, index, verdict.reason);
    if (verdict.clearedBy === 'pair-a-machine') {
      // TERMINAL EITHER WAY - the property that matters, and the one `awaiting_daemon` would
      // destroy. What is left is WHICH terminal halt, and that turns on whether a ceremony is an
      // honest thing to ask this person for.
      //
      // A step that DECLARES a credential for a known origin is the case the whole branch exists
      // for: the account's only machine was revoked after a session was established on it, so
      // pairing a replacement is necessary and not sufficient, and `needs_credentials` is the halt
      // that carries the portal's `/cofre` deep link to finish the job.
      //
      // A step that declares NONE gets the plain non-recoverable failure. Sending a person to the
      // Cofre to establish a credential nothing asked for is a wrong specific instruction, which
      // is worse than an honest general one - the same reasoning the blocked badge follows.
      const wantsCredential = resolveStepDeclaration(step).credentialRefs.length > 0;
      return stepOrigin && wantsCredential
        ? localityNeedsCeremonyRecord(step, index, verdict.reason, stepOrigin, automation.name)
        : localityTerminalFailureRecord(step, index, verdict.reason);
    }
    // `edit-the-automation`, and every future non-neutral act until one argues for something else:
    // the plain non-recoverable failure. NEVER a ceremony - re-establishing a session does not stop
    // an automation navigating off its declared origin, and a wrong specific instruction is worse
    // than an honest general one.
    return localityTerminalFailureRecord(step, index, verdict.reason);
  };

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
  // How many LOGIN asks this run has answered with the session it was already given (S-login-step).
  // Capped, so "we already logged in" can be said once and does not become a way to walk past every
  // sign-in wall for the rest of the run.
  let sessionSatisfiedLogins = 0;
  // What STEP_RETRY_BUDGET has already been spent, per step index. One per run: the budget
  // bounds THIS run's recovery, and the rehearsal fixer revisiting an index must not get a
  // fresh allowance each time it comes back.
  const retryLedger: StepRetryLedger = createStepRetryLedger();

  try {
    // A resumed run inherits the records of the steps that already ran, so the persisted timeline
    // (and the rehearsal patch merge below, which looks records up by index) stays continuous.
    // Filtered through the same defensive predicate `finalizeReturn` uses — an old-schema row must
    // not be able to crash a resume.
    const stepRecords: StepRecord[] = isResume
      ? ((await automationRunStore.findById(automationId, runId))?.steps ?? []).filter(
          (r): r is StepRecord => r != null && typeof r === 'object' && typeof r.index === 'number' && r.index < resumeFrom,
        )
      : [];

    /**
     * THE DURABLE CREDENTIAL HALT, as one exit rather than two copies of one.
     *
     * Persist `needs_credentials` + the request, finalize, park a waiter, emit, return. It is
     * DURABLE in the sense the in-process pause is not: everything a resume needs is in the store,
     * so the run survives an api restart, a deploy, and a human who takes an hour. The waiter is the
     * fast path and the persisted row is the slow one, and neither is load-bearing alone
     * (`credential-waiters.ts`).
     *
     * It became a function when a SECOND caller appeared. The gate's halt (below) is raised before
     * its step runs; the ad-hoc adversarial halt is raised after one failed, from inside the
     * pause-detection block. Two call sites, one exit - because a second copy of this would be a
     * second place for the waiter registration or the finalize to be forgotten, and forgetting
     * either produces a run that is parked forever with nothing able to wake it.
     */
    const haltForCredentials = async (
      details: RunCredentialRequest,
      index: number,
    ): Promise<ReturnType<typeof finalizeReturn>> => {
      await automationRunStore.update(automationId, runId, {
        status: 'needs_credentials',
        steps: stepRecords,
        credentialRequest: details,
      });
      await finalize(runId, automationId, 'needs_credentials', stepRecords, startedAt);
      registerCredentialWaiter({
        runId,
        orgId: ctx.orgId,
        userId: ctx.ownerUserId,
        origin: details.origin,
      });
      emit?.runNeedsCredentials?.(runId, details);
      if (isRehearsal) {
        await persistRefinedSteps(automation, workingSteps, isRehearsal);
      }
      return finalizeReturn({
        runId,
        status: 'needs_credentials',
        startedAt,
        stepRecords,
        message: `paused: no usable credential for ${details.origin}`,
        isRehearsal,
        refinedSteps: workingSteps,
        rehearsalSummary: buildRehearsalSummary({
          isRehearsal,
          status: 'aborted',
          fixerCallCount,
          patchesApplied,
          startedAt,
          stuckAtIndex: index,
          reason: 'awaiting credentials',
        }),
        lastStepIndex: index,
      });
    };

    let i = resumeFrom;
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

      // Wall-clock budget check. BOTH modes are capped now - a normal run used to have no
      // ceiling at all, so a run whose page never settled sat here holding a browser session
      // until a human noticed and cancelled it. Rehearsal keeps its tighter (fixer-driven)
      // budget; a normal run gets the looser one, because its length is mostly the site's.
      //
      // pausedTotalMs is subtracted in both: time the user spent solving a CAPTCHA / MFA / a
      // headed ceremony is not the run being slow, and a cap that counted it would make a long
      // legitimate pause fatal. The exit is the EXISTING runError -> terminal `failed` path;
      // a normal run manufactures no rehearsal summary (buildRehearsalSummary answers undefined
      // when isRehearsal is false).
      const wallClockCapMs = isRehearsal ? REHEARSAL_BUDGET.maxWallClockMs : NORMAL_RUN_BUDGET.maxWallClockMs;
      if ((Date.now() - Date.parse(startedAt) - pausedTotalMs) > wallClockCapMs) {
        stuckAtIndex = i;
        rehearsalReason = `wall-clock budget of ${wallClockCapMs}ms exhausted`;
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

      // ARM THE RECORDER BEFORE THE FIRST PAGE-DRIVING STEP, never after: an exchange the page
      // made before the listener attached is one the compile never sees.
      await armNetworkCapture(step, i);

      // Hand the most recent successful step over so a verify can
      // short-circuit after a side-effect (integration / sub_automation)
      // instead of asking vision for evidence the page can't show.
      const lastRecord = stepRecords[stepRecords.length - 1];
      const previousStep = lastRecord
        ? { step: (workingSteps[lastRecord.index] ?? workingSteps[i - 1])!, record: lastRecord }
        : undefined;

      // P4.1: WHERE this step runs - RESOLVED BEFORE THE CREDENTIAL GATE, and the order is the
      // security property. The gate calls `ensureSession`, whose typist path OPENS A BROWSER and
      // submits a password into it; running the gate first meant that browser could be opened, from
      // the datacenter, against an origin locality was about to refuse outright. Nothing may open a
      // browser ahead of the decision that says where the step belongs.
      //
      // Resolved per step (posture is a fact about the ORIGIN, and a run can touch more than one)
      // and only for the step types that can reach a browser - an api_call or integration step has
      // no locality to decide and must not be halted by one.
      stepLocality = null;
      // Cleared WITH the verdict, never left standing from the previous step: a posture is a fact
      // about an origin, and holding last step's answer while this step's is unresolved is exactly
      // how the run-level `preferredPairingId` defect judged one portal by another's facts.
      stepOriginPosture = null;
      let localityRecord: StepRecord | undefined;
      if (STEP_TYPES_NEEDING_BROWSER.has(step.type)) {
        stepLocality = await resolveLocalityForStep(i, step);
        localityRecord = refusalRecordFor(step, i, stepLocality);
      }

      // THE CREDENTIAL GATE (P3.1), for every integration and with no branch on any of them. It
      // fires only for a step whose declaration NAMES a Cofre reference, so a run that asks for no
      // credential is not gated at all and behaves exactly as it did before this existed. A halt
      // is expressed as a FAILED STEP RECORD with typed details, so it flows through the one
      // persist/emit/halt path the awaiting-daemon and consent halts already use rather than
      // opening a second exit from the loop.
      //
      // SKIPPED ENTIRELY for a step locality already refused: that step is not going to run, so
      // establishing a credential for it would be work nobody asked for done through a browser
      // nobody may open.
      // THE HOSTED-BROWSER PERMIT. Half of the typist's permission; the other half is the origin's
      // posture, applied inside the gate. Two independent conditions, both closed by default:
      //
      //   - this process must have a hosted browser to offer at all (`localBrowserEnabled`, off in
      //     production), and
      //   - the step's resolved locality must leave the typist a door that MATCHES the one the work
      //     will use (`hostedTypistPermitFor`). An absent permit means the typist is unreachable and
      //     the run halts asking for a person, which is the closed direction: typing a password out
      //     of a different door than the session is then used from shows the portal two identities
      //     for one account, and it is the one act in the run that hands over a secret.
      const hostedBrowser = loadAutomationConfig().localBrowserEnabled
        ? hostedTypistPermitFor(stepLocality)
        : undefined;
      // Annotated rather than inferred: `{}` is assignable to the gate's all-optional result today,
      // so the union collapses silently - and would stop collapsing, as a confusing error at the
      // reads below, the day the gate grows a required field.
      const gate: Awaited<ReturnType<typeof credentialGateRecord>> = localityRecord
        ? {}
        : await credentialGateRecord({
            actor: actorFromCtx(ctx),
            runId,
            automationName: automation.name,
            steps: workingSteps,
            index: i,
            // THE FLEET FACT CHECKOUT NEEDS. Withholding it is not a neutral omission: it is the
            // statement "no machine of yours can carry residential egress", which refuses every
            // attended session there is. See `residentialAvailableNow`.
            residentialAvailable: await residentialAvailableNow(),
            // S-inject: whether an UNDECLARED-origin session lookup could still change anything.
            // A session is injected when the browser context is CREATED, so once `browser` exists
            // or a session is already in hand the lookup could only produce a value nothing would
            // consume - at the cost of a Cofre read on every remaining step of the run. Exactly the
            // pair of facts the `sessionState = gate.storageState` assignment below tests for.
            sessionUnresolved: sessionState === undefined && !browser,
            ...(hostedBrowser ? { hostedBrowser } : {}),
            // The SAME per-run memo locality resolves origins through, so the gate's own
            // `resolveStepOrigin` walk re-reads no definition this run has already read.
          }, step, await knownPairingsNow(), automation.name, { loadActionDeclaration: loadDeclarationOnce });
      if (!gate.record && gate.storageState !== undefined && !browser) {
        sessionState = gate.storageState;
        // Recorded WITH the session, from the gate that checked it out, so the two can never
        // describe different portals. `null` when a gate predating the field answers - closed.
        sessionOrigin = gate.origin ?? null;
      }
      // P4.2: the pairing where this session's ceremony happened, FILED UNDER THE ORIGIN IT BELONGS
      // TO. It is a PREFERENCE, honoured for adversarial origins only, and it is recorded on the
      // session item rather than invented here (`sessionMetadata.establishedBy.pairingId`, stamped
      // by `bridge/attended.ts`). The gate hands back the origin with it, so a run touching several
      // portals accumulates one answer per portal instead of overwriting a single run-level one.
      //
      // It arrives from the gate, i.e. AFTER locality was resolved, so the verdict is re-resolved
      // when it is new. Re-resolving can only NARROW: without the preference the requirement is
      // "any machine of yours", with it "that machine", and every extra refusal that produces is
      // one this loop must honour before a browser opens. No browser can have opened in between -
      // the gate only ever opens one for a PERMISSIVE origin, and a permissive origin never carries
      // a preference (`credential-gate.ts` drops it).
      const learned = gate.preferredPairing;
      if (learned && preferredPairingByOrigin.get(learned.origin) !== learned.pairingId) {
        preferredPairingByOrigin.set(learned.origin, learned.pairingId);
        if (stepLocality) {
          stepLocality = await resolveLocalityForStep(i, step);
          localityRecord = refusalRecordFor(step, i, stepLocality);
        }
      }

      const executed = localityRecord ?? gate.record ?? await executeStep({
        browser: getBrowser(),
        daemonConnected: !!connection,
        automation,
        step,
        index: i,
        runId,
        ctx,
        browserLease,
        inputs,
        previousStep,
        retryLedger,
        // ALWAYS supplied: the accumulator needs every chunk even when no SSE emitter exists.
        // Forwarding to the stream stays exactly as before when one does.
        emitOutputChunk: (info) => {
          stepLogs.append(info.stepIndex, info.chunk);
          emit?.runOutputChunk?.(info.runId, { stepIndex: info.stepIndex, chunk: info.chunk, stream: info.stream });
        },
      });
      // Attach the step's captured tail as it finishes, so EVERY persist site below (the per-step
      // update and every finalize path) carries it — including the cancelled/failed exits.
      const logTail = stepLogs.tailFor(i);
      const record: StepRecord = logTail ? { ...executed, logTail } : executed;

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
      emit?.stepUpdate(redactStepRecord(record, ctx.secrets), runId);

      if (record.status === 'failed') {
        // AWAITING-CONSENT PAUSE for an integration step (C2 follow-up). Checked BEFORE the
        // awaiting-integration branch below, which would otherwise swallow it - both are
        // non-recoverable integration failures, and reporting "connect the integration" to someone
        // who has to APPROVE AN ACTION sends them to the wrong place.
        //
        // TERMINAL, not the blocking dialog `local_command`/`api_call` get. Those two pause on a
        // shape the run itself asked about, and `resolveConsent` answers it through
        // `approved_commands`. An integration action's approval lives in a different store, is
        // keyed on the action rather than on this run, and is granted on the integration's own
        // action-approvals surface: pausing the process to wait for an answer that arrives
        // elsewhere would hold a listener tick open indefinitely, and offering the command dialog
        // would bank the answer in a store this gate does not read (a re-prompt loop). So the run
        // halts in `awaiting_consent` with the refusal on the step, the human approves the action,
        // and they re-run.
        //
        // THE SSE TERMINAL EVENT IS `error`, CHOSEN AMONG BAD OPTIONS AND WORTH SAYING WHY. The
        // `paused` frame carries ONLY a service name (`shared/events.ts`), and the dashboard maps it
        // to `awaiting_integration` - i.e. it would tell someone whose integration is connected and
        // working to go connect it, with no way to learn what actually happened. `error` carries the
        // MESSAGE, which names the action, the destination and the fact that an approval is needed,
        // so the live view says something true and actionable. The persisted run status is
        // `awaiting_consent` either way, which is what the run resource and the history show. The
        // right fix is a wire event that can carry a pause REASON; `shared/` is another slice's live
        // surface this wave, so it is journaled in findings.md rather than done here.
        const integrationConsent = extractAwaitingIntegrationConsent(record);
        if (integrationConsent) {
          await finalize(runId, automationId, 'awaiting_consent', stepRecords, startedAt);
          // Fixed copy, not `record.error?.message` (see the step-failure emit below).
          emit?.runError(runId, 'Esta integração precisa de aprovação para escrever.', stepRecords);
          if (isRehearsal) {
            await persistRefinedSteps(automation, workingSteps, isRehearsal);
          }
          return finalizeReturn({
            runId,
            status: 'awaiting_consent',
            startedAt,
            stepRecords,
            message: record.error?.message ?? 'paused awaiting approval for a write',
            isRehearsal,
            refinedSteps: workingSteps,
            rehearsalSummary: buildRehearsalSummary({
              isRehearsal,
              status: 'aborted',
              fixerCallCount,
              patchesApplied,
              startedAt,
              stuckAtIndex: i,
              reason: 'awaiting approval',
            }),
            lastStepIndex: i,
          });
        }

        // NEEDS-CREDENTIALS halt (P3.1). The Cofre holds nothing usable for the origin this step
        // declared.
        //
        // ORDER IS LOAD-BEARING, and it cost a red test to learn: this is checked BEFORE the
        // awaiting-integration branch below, which fires on ANY non-recoverable failure of an
        // `integration` step and would otherwise swallow every credential halt on the integration
        // rail — telling a user whose integration is connected and working to go connect it. It is
        // also before the awaiting-daemon block, for the mirror reason: "start your local Ekoa" is
        // the wrong instruction for someone whose machine is running and whose password is missing.
        //
        // HALT AND RE-DISPATCH, not pause-and-poll. The human is about to leave this page, walk to
        // `/cofre` and come back — possibly after a reload, possibly after a restart — so the run
        // must be recoverable from the STORE, not from a listener tick. The waiter registered here
        // is the fast path (`credential-waiters.ts`); the persisted state below is what makes the
        // slow path (a reloading client, or the `/cofre` establish action calling resume) work at
        // all. Neither is load-bearing alone.
        const credentialDetails = extractNeedsCredentials(record);
        if (credentialDetails) {
          return await haltForCredentials(credentialDetails, i);
        }

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
        //
        // `api_call` joins it: a non-idempotent HTTP request is an effect on the user's behalf in
        // exactly the way a shell command is, it is authored by the same planner (and used to be
        // authorable by the fixer), and it now asks the same question through the same ceremony.
        // On an UNATTENDED run there is no `resumeSignal`, so `waitForResumeOrCancel` answers false
        // immediately and the run cancels - an unapproved write is refused rather than left hanging.
        const consentDetails = extractAwaitingConsent(record);
        if (consentDetails && (step.type === 'local_command' || step.type === 'api_call')) {
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
          pauseForUserCount < (isRehearsal ? REHEARSAL_BUDGET.maxNormalPauses : NORMAL_RUN_BUDGET.maxNormalPauses)
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
            // A LOGIN pause is the one moment the user can still choose HOW to sign in, and the
            // obvious button - "Continue with Google" - is the one that cannot work in this browser
            // (findings: `google-sso-refuses-the-automated-ceremony-browser`). Appended rather than
            // asked of the model: the prompt would make it likely, this makes it certain. The
            // regex fast-path carries the same sentence in its own English copy.
            //
            // ALL THREE LAYERS CONTRIBUTE A KIND now (the regex table carries one per rule), because
            // the kind stopped being decoration the moment it started deciding between an in-process
            // pause and a durable halt, below. An unclassified detection - a keyword rule matching
            // several states - leaves this null and therefore takes the pause, which is the closed
            // direction: a halt asks a human to walk to a machine and log in somewhere.
            const detectedKind = verifierHumanAction?.kind ?? classifierKind ?? regexDetected?.kind ?? null;
            const failureKindForEvent = classifyFailure(record, step);

            // ── S-LOGIN-STEP: THE RUN ALREADY HAS THE ANSWER ──────────────────────────────────
            //
            // A re-dispatched run comes back with the captured session already injected and restarts
            // at the navigation that put it on the portal - so it re-runs the same sign-in step, now
            // on an authenticated page. Asked to PERFORM a sign-in there, the resolver finds no such
            // action and refuses with low confidence, which reads to every layer above as "a human
            // is needed" all over again. That is the infinite loop this finding measured
            // (`ad-hoc-adversarial-browser-run-pauses-in-process-not-durably`, gap (b)): the human
            // logs in, the run asks them to log in, forever, and the ceremony half makes it worse
            // rather than better because each round now costs a walk to a machine.
            //
            // So a LOGIN ask on a run this platform already handed a session for is answered by the
            // platform: the step is completed as a no-op and the run moves on. The claim being made
            // is narrow and true - "we already did the thing you are asking for" - and if the session
            // turns out to be dead the run fails at whatever it was actually trying to read, which is
            // a bounded, diagnosable failure instead of a loop.
            //
            // ONCE PER RUN. A second login wall after we spent our answer is a genuinely new fact
            // (a session that died mid-run), and it gets the ordinary pause. The cap is what stops
            // this from becoming a way to ignore every login wall forever.
            //
            // AND ONLY FOR THE PORTAL THE SESSION IS ACTUALLY FOR. `sessionState !== undefined` is a
            // fact about the RUN; the claim being made here is about an ORIGIN, and a run that
            // checked a session out at portal A and then walked into a sign-in wall at portal B
            // would otherwise answer B with A's session - marking a genuine login wall "already
            // signed in", writing that claim onto B's step record, and pre-empting the durable fork
            // for an origin that qualifies for it. That is the run-level `preferredPairingId` defect
            // again, so the comparison is against THIS step's origin.
            //
            // EXACT EQUALITY, not a covering rule. Both sides are bare hosts produced by the same
            // `resolveStepOrigin` walk, so equality is exactly "the session we hold was checked out
            // for the portal this step is on". A looser rule (parent-domain covering) would decide
            // the question a session's own binding already answers, in a second place, and the two
            // could disagree. A null on either side means nothing here can say which portal is which
            // and the guard withholds its answer - the closed direction, and the pre-existing pause.
            if (
              detectedKind === 'login' &&
              sessionState !== undefined &&
              sessionOrigin !== null &&
              stepOrigin !== null &&
              sessionOrigin === stepOrigin &&
              sessionSatisfiedLogins < MAX_SESSION_SATISFIED_LOGINS
            ) {
              sessionSatisfiedLogins += 1;
              console.warn(
                `[automation] login step ${i + 1} satisfied by the session this run was given; not pausing`,
              );
              const satisfied = satisfiedBySessionRecord(record);
              const at = stepRecords.findIndex((r) => r.index === i);
              if (at >= 0) stepRecords[at] = satisfied;
              await automationRunStore.update(automationId, runId, { steps: stepRecords });
              emit?.stepUpdate(redactStepRecord(satisfied, ctx.secrets), runId);
              i += 1;
              continue;
            }

            // ── S-DURABLE: THE ONE BEHAVIOURAL FORK ───────────────────────────────────────────
            //
            // An adversarial origin's login wall halts DURABLY instead of pausing in process
            // (docs/decisions.md 2026-08-24, D-ADHOC-5). Four conditions, each doing its own work:
            //
            //  - the KIND is one a login ceremony can actually clear. `payment`, `identity`,
            //    `signature` and `other` are not: nothing about capturing a session answers a 3-D
            //    Secure screen, and sending someone to a ceremony for one would be a wrong
            //    instruction rather than a slow one.
            //  - the run is BRIDGE-ROUTED. The ceremony opens a headed browser on a machine of this
            //    owner's, and the session that comes back is bound to that machine's residential
            //    line; a hosted run has no machine to send anyone to.
            //  - an ORIGIN RESOLVED. It is the ask, and it is also the key the re-dispatch will look
            //    the captured session up by. With none, the ceremony would name nowhere and the
            //    capture could never be found again - so the run takes the pause it would have taken.
            //  - the origin is ADVERSARIAL. A PERMISSIVE origin keeps `paused_for_user`, unchanged
            //    and deliberately: its credential is portable, its author said it tolerates
            //    automation, and it has no machine-bound ceremony to be sent to.
            //
            // NOT among them, and worth saying because its absence looks like an oversight: whether
            // the run is ATTENDED. An unattended run has no `resumeSignal` at all, so the pause it
            // would otherwise take resolves immediately as "not resumed" and CANCELS it. A durable
            // halt is strictly better for exactly that run, so conditioning on attendedness would
            // withhold the fix from the runs that need it most.
            //
            // AND THE HALT IS A RETURN, which is the whole of S-profile: `pauseRunForUser` blocks
            // inside the loop holding the browser, the profile lease and its Chromium SingletonLock,
            // so a second run against the same origin could not acquire the profile and timed out at
            // the invocation window. Returning runs the outer `finally`, which disposes the session
            // and releases the lease - and the ceremony opens its own browser rather than contending
            // for that one, so the two never queue behind each other again.
            if (
              CEREMONY_CLEARABLE_HUMAN_ACTIONS.has(detectedKind ?? '') &&
              stepLocality?.kind === 'bridge' &&
              stepOrigin &&
              stepOriginPosture === 'adversarial'
            ) {
              console.warn(
                `[automation] adversarial login wall on step ${i + 1} (${stepOrigin}): ` +
                'halting durably for a ceremony instead of pausing in process',
              );
              return await haltForCredentials(
                ceremonyCredentialRequest({
                  step,
                  index: i,
                  origin: stepOrigin,
                  automationName: automation.name,
                  reason: adhocCeremonyReason(detectedKind, stepOrigin),
                  // The page is gone the moment this returns, so the resume restarts at the step
                  // that navigated to it rather than at this one. See `RunCredentialRequest`.
                  resumeFromStepIndex: lastNavigationIndexAtOrBefore(workingSteps, i),
                }),
                i,
              );
            }
            const syntheticPatch = {
              kind: 'pause_for_user' as const,
              reasoning: detected.reasoning,
              userInstructions: withGoogleSsoGuidance(detected.userInstructions, detectedKind),
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
        // The RUN-level terminal message is user-facing copy, so it stays fixed: `record.error
        // .message` is a raw step failure (an integration's HTTP body, a stack, an internal
        // path) and belongs in the step record the run UI already renders per step, not in the
        // run's headline (finding `run-error-text-leak`).
        emit?.runError(runId, 'A execução não foi concluída.', stepRecords);
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
    // ── HAND THE LEARNING OVER, THEN DISARM (slice P2) ──────────────────────────────────────
    //
    // BEFORE `dispose`, because the drain reads the session's own accumulated buffer. The sink is
    // called whatever the run's outcome: this function does not know whether the pass is worth
    // compiling from, and the caller does. A throwing sink must not take the run's cleanup down
    // with it, so it is caught here rather than trusted.
    if (captureArmed) {
      const session = browser as BrowserSession | null;
      try {
        options.observeNetwork?.(session?.drainCaptures?.() ?? []);
      } catch (err) {
        console.warn(`[automation] the network-capture sink threw: ${err instanceof Error ? err.message : String(err)}`);
      }
      // The machine drops the recorder on the lease release below too (`tool-executor.ts`); this is
      // the polite half, and it is what disarms a lease this pass does not own.
      await session?.stopCapture?.().catch(() => undefined);
    }
    // This pass's own session: the in-process one closes its per-run page so pages
    // don't accumulate; the daemon one stops its keepalive heartbeat.
    await (browser as BrowserSession | null)?.dispose?.();
    // END OF RUN on the daemon, and the ONE place it happens. Conditions, each
    // load-bearing:
    //   - `ownsBrowserLease`: a sub-automation shares its parent's lease. A child
    //     that released here would drop the page, wipe the jar and sign the user
    //     out from under the parent the moment it returned.
    //   - `browserLease.used`: sent when ANY pass in this tree opened a daemon
    //     browser, including a sub-automation while this pass never touched one -
    //     `used` is a field on the shared object precisely so the owner can see
    //     that. A tree that never opened a browser sends nothing, rather than a
    //     frame (and a ledger row) per integration-only run.
    if (ownsBrowserLease && browserLease.used && connection) {
      await releaseBrowserLease(connection, {
        leaseId: browserLease.id,
        ownerUserId: ctx.ownerUserId,
        runId,
      });
    }
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
  /**
   * The browser lease of the call tree this step belongs to. Only `sub_automation`
   * reads it, and only to hand it down: it is what makes a child run a tenant of its
   * parent's browser instead of a second one queueing behind it. It is NOT taken off
   * `ctx`, because on the OUTERMOST pass `ctx.browserLease` is undefined by
   * definition - that pass is the one that minted it.
   */
  browserLease: BrowserLease;
  inputs: Record<string, unknown>;
  /**
   * The step that ran immediately before this one in the same run.
   * Used so a verify step after a successful side-effect step
   * (integration / sub_automation) can short-circuit instead of asking
   * vision to find UI evidence that doesn't exist.
   */
  previousStep?: { step: Step; record: StepRecord };
  /**
   * Per-run record of what `STEP_RETRY_BUDGET` has already been spent on, keyed by step index.
   * Owned by the run loop (one per run) so a step index the rehearsal fixer keeps returning to
   * cannot re-ground with vision on every visit. Optional so a caller that does not retry (there
   * is one today: the run loop) is not forced to fabricate one.
   */
  retryLedger?: StepRetryLedger;
  /**
   * Optional sink for live stdout / stderr chunks from local_command
   * steps. Wired by the run emitter so the UI sees streaming output as
   * commands execute. Other step types ignore this.
   */
  emitOutputChunk?: (info: { runId: string; stepIndex: number; chunk: string; stream: 'stdout' | 'stderr' }) => void;
}

async function executeStep(args: ExecuteStepArgs): Promise<StepRecord> {
  const { browser, daemonConnected, automation, step, index, runId, ctx, browserLease, inputs } = args;
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
        // Auto-adjust a URL the planner guessed at a local port for EKOA'S OWN frontend. Narrow by
        // construction now (`self-url.ts`), and no longer silent: a rewrite is reported in the step
        // record, because one that vanished is what made a live run unexplainable.
        const rebase = rebaseSelfUrlWithProvenance(step.url);
        const navUrl = rebase.url;
        await browser.act({ kind: 'navigate', url: navUrl }, { stepId: step.id });
        const screenshotPath = await snap(browser, automation.id, runId, index);
        const fingerprint = browser.fingerprint();
        // DID WE LAND WHERE WE ASKED? `page.goto` resolves on ANY response, a 404 from a different
        // application included, so without this a wrong-origin landing was recorded `completed` and
        // the run walked on - the divergence surfacing steps later as an inexplicable failure
        // (found live, 2026-08-28). Compared on ORIGIN only: a redirect inside the target site is
        // ordinary and must not fail the step, while ending up on a different host is never what
        // the step asked for.
        const landed = browser.url();
        const wanted = originOf(navUrl);
        // The page's OWN url is the direct observation of where we ended up; the fingerprint's
        // origin is a derived cache key and only stands in when the url is unavailable.
        const actual = originOf(landed) ?? fingerprint?.origin ?? null;
        if (wanted !== null && actual !== null && actual !== '' && wanted !== actual) {
          return finishRecord(baseRecord, 'failed', stepStart, {
            tier: 'cache',
            fingerprint,
            screenshotPath,
            resolvedAction: { kind: 'navigate', url: navUrl },
            error: {
              message:
                `navigate landed on ${actual} instead of ${wanted} (asked for ${navUrl}, browser is at ${landed})` +
                (rebase.rebasedFrom ? `; the step's URL ${rebase.rebasedFrom} was rebased onto the Ekoa origin` : ''),
              recoverable: true,
            },
          });
        }
        return finishRecord(baseRecord, 'completed', stepStart, {
          tier: 'cache',
          fingerprint,
          screenshotPath,
          resolvedAction: { kind: 'navigate', url: navUrl },
          ...(rebase.rebasedFrom ? { note: `URL rebased from ${rebase.rebasedFrom} onto the Ekoa origin` } : {}),
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
          // THE SAME BROWSER LEASE OBJECT, not a copy and not a fresh one. The child
          // is a different run on the same owner, hence the same daemon and the same
          // profile: with a lease of its own it would queue behind the one this run
          // holds for its whole duration, while this run is blocked waiting for the
          // child - a deadlock, plus an idle backstop that reaped the waiting parent.
          // Sharing it also means the child continues on the page this run left open,
          // which is what a sub-automation is for. Passed by REFERENCE so the child
          // setting `used` is visible to the pass that has to send the release.
          browserLease,
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
          // THE WRITE GATE'S ANSWER, read structurally rather than from the message. Both
          // integration rails carry the executor's code on `details` (the composition root maps
          // `r.code` through), so an `awaiting_consent` refusal is recognised by its CODE - never
          // by matching prose, which is exactly how this refusal used to be classed "recoverable"
          // and handed on as if a retry could help.
          const code = typeof result.details === 'string' ? result.details : undefined;
          const awaitingConsent = code === 'awaiting_consent';
          // Differentiate "integration not connected" (awaiting_integration)
          // from other failures (recoverable; user can fix and retry).
          const notConnected = /not connected/i.test(result.error ?? '');
          return finishRecord(baseRecord, 'failed', stepStart, {
            tier: 'cache',
            error: {
              message: result.error ?? 'integration call failed',
              // NEITHER is recoverable. A write nobody approved is not a transient failure, and a
              // non-recoverable record is refused by `shouldAttemptFix` - so the self-heal fixer is
              // never invited to route around the gate it just hit.
              recoverable: !(notConnected || awaitingConsent),
              details: awaitingConsent
                ? {
                    kind: 'awaiting_integration_consent',
                    stepIndex: index,
                    integrationKey: step.integrationKey,
                    actionName: step.integrationAction,
                  }
                : result.details,
            },
          });
        }
        return finishRecord(baseRecord, 'completed', stepStart, { tier: 'cache' });
      }

      case 'browser': {
        if (!browser) return awaitingDaemonRecord(baseRecord, stepStart, index, 'browser');
        return await executeBrowserStep({ browser, daemonConnected, automation, step, index, runId, ctx, browserLease, inputs, baseRecord, stepStart, retryLedger: args.retryLedger });
      }

      case 'verify': {
        if (!browser) return awaitingDaemonRecord(baseRecord, stepStart, index, 'browser');
        return await executeVerifyStep({ browser, daemonConnected, automation, step, index, runId, ctx, browserLease, inputs, baseRecord, stepStart, previousStep: args.previousStep });
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

/** European-Portuguese failure surfaced when a browser/verify step cannot obtain a screenshot to
 *  resolve against. The vision tier is NEVER called with a blank image (it would only ever return a
 *  low-confidence guess, which then burns the fixer budget blind). Recoverable so the fixer / pause
 *  machinery still handles the step. */
const SCREENSHOT_UNAVAILABLE_MESSAGE =
  'captura de ecrã indisponível — o passo não pode ser resolvido visualmente';

/**
 * Guarantee a non-empty screenshot before a vision call. A capture can come back empty — a
 * page.screenshot() that failed on both of the local session's attempts, or a daemon observation
 * envelope missing `screenshotB64`. Force ONE fresh observation and re-read; return null when it is
 * STILL empty so the caller fails the step recoverably instead of resolving against a blank image.
 */
async function screenshotForVision(browser: BrowserSession, stepId: string): Promise<Buffer | null> {
  let png = browser.screenshotPng();
  if (png.length > 0) return png;
  await browser.observe({ stepId }).catch((err) => {
    console.warn(`[automation] re-observe for empty screenshot failed: ${errMsg(err)}`);
  });
  png = browser.screenshotPng();
  return png.length > 0 ? png : null;
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

  // 2. Tier 1: cache hit - with STEP_RETRY_BUDGET.deterministicRetries plain re-attempts of the
  // SAME action before anything expensive. Most cache misses are timing, not drift: the locator
  // was right and the page had not finished settling. One more act() costs milliseconds; the
  // vision re-ground below costs a model round-trip AND a fresh chance to resolve to something
  // subtly different from what this run already decided to do. Re-attempt, never re-decide.
  const cached = await lookupActionCache(automation.id, step.id, fingerprint, actor);
  if (cached) {
    const attempts = 1 + STEP_RETRY_BUDGET.deterministicRetries;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
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
        if (attempt < attempts) {
          console.warn(`[automation] cache action failed for ${automation.id}/${step.id} (attempt ${attempt}/${attempts}), re-attempting: ${errMsg(err)}`);
          continue;
        }
        // Deterministic retries spent. Fall through to vision (tier 'cache-then-vision').
        console.warn(`[automation] cache action failed for ${automation.id}/${step.id} after ${attempts} attempt(s), falling back to vision: ${errMsg(err)}`);
      }
    }
  }

  // 2b. The vision RE-GROUND is a budgeted step, not a fallthrough. Reaching here with a cache hit
  // means the cached action was wrong (or the page drifted) and we are about to spend a model call
  // re-deciding it. STEP_RETRY_BUDGET.visionRegroundsPerStep bounds that per step INDEX, so an
  // index the rehearsal fixer keeps returning to cannot re-ground on every visit: a second
  // re-ground at the same index would only re-learn that the cache is not the problem. Refuse
  // RECOVERABLY - the fixer is still free to patch the step, it just does not get another vision
  // call to arrive at the same place. A cache MISS is not a re-ground: that is the ordinary tier-2
  // resolution and is not counted here.
  if (cached && args.retryLedger && !args.retryLedger.claimVisionReground(index)) {
    const screenshotPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: 'cache-then-vision',
      fingerprint,
      screenshotPath,
      resolvedAction: cached.action,
      error: {
        message:
          `vision re-ground budget of ${STEP_RETRY_BUDGET.visionRegroundsPerStep} exhausted at step ${index + 1} ` +
          '- the cached action keeps failing and re-resolving it has already been tried',
        recoverable: true,
      },
    });
  }

  // 3. Tier 2: vision (EXPERT on max effort). The screenshot fed to vision
  // is the daemon's observation of the page going into the step. Guard the
  // empty-screenshot hole: never resolve against a blank image (§13.2).
  const screenshotPng = await screenshotForVision(browser, step.id);
  if (!screenshotPng) {
    const screenshotPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath,
      error: { message: SCREENSHOT_UNAVAILABLE_MESSAGE, recoverable: true },
    });
  }
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
  // from the daemon's held observation of the page. Same empty-screenshot
  // guard as executeBrowserStep — never verify against a blank image.
  const screenshotPng = await screenshotForVision(browser, step.id);
  if (!screenshotPng) {
    const emptyPath = await snap(browser, automation.id, runId, index);
    return finishRecord(baseRecord, 'failed', stepStart, {
      tier: cached ? 'cache-then-vision' : 'vision',
      fingerprint,
      screenshotPath: emptyPath,
      error: { message: SCREENSHOT_UNAVAILABLE_MESSAGE, recoverable: true },
    });
  }
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
      error: { message: `resultado não atingido: ${result.reasoning}`, recoverable: true },
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
      // CREDENTIAL BOUNDARY (Cofre R-4, invariant I2). A verifier-extracted value comes off a LIVE
      // PAGE of an authenticated session, so it can be a one-time code, a session token or a
      // password the page echoed. Two controls:
      //   (a) a secret-shaped KEY NAME is refused outright — the extracted value then never joins
      //       the shared `inputs` map, and so is never template-substituted into a downstream
      //       api_call URL/header/body whose RESOLVED form is persisted;
      //   (b) the log records the key and the LENGTH, never the value. It previously printed
      //       `${k}="${v}"` in cleartext to the process log.
      if (SECRET_SHAPED_INPUT_NAME.test(k)) {
        console.log(`[automation] verifier extraction refused for secret-shaped input "${k}" on step ${step.id}`);
        continue;
      }
      const current = (args.inputs as Record<string, unknown>)[k];
      if (current == null || (typeof current === 'string' && current.trim().length === 0)) {
        (args.inputs as Record<string, unknown>)[k] = v;
        console.log(
          `[automation] verifier extracted ${k} (${String(v ?? '').length} chars) from page on step ${step.id}`,
        );
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

/**
 * Run the credential gate for one step and translate its verdict into the loop's currency.
 *
 * THREE OUTCOMES, and the shape says which: `{}` = the gate had nothing to say (the overwhelmingly
 * common case, and the one that must cost nothing); `{ storageState }` = there is a live session
 * for the declared origin; `{ record }` = a failed step record the outer loop turns into a halt.
 *
 * A THROW FROM THE GATE IS NOT A HALT. `ensureSession` throws for the states a
 * `needs_credentials` banner would misdescribe — a locked item (the user's own kill switch), an
 * origin refusal, an incoherent request. Those become an ordinary non-recoverable step failure
 * carrying the module's own message, which is composed from ids and hosts and is safe to show.
 */
async function credentialGateRecord(
  input: CredentialGateInput,
  step: Step,
  /**
   * EVERY PAIRING THE ORG STILL HAS, live or not - the fleet listing that decides whether a
   * `needs-machine` refusal is a wait or a dead end, or `null` when this process has no listing at
   * all. See the `needs-machine` case below, and `machineRetired` for why `null` and `[]` differ.
   */
  knownPairings: readonly string[] | null,
  automationName: string,
  /**
   * Seam overrides for the gate. The run loop passes its per-run declaration memo so the gate's
   * `resolveStepOrigin` walk shares the reads locality already paid for; everything else stays the
   * gate's own `REAL_DEPS`.
   */
  deps: Partial<CredentialGateDeps> = {},
): Promise<{
  record?: StepRecord;
  storageState?: unknown;
  /** The origin `storageState` was checked out for; see `CredentialGateVerdict`'s `ready` member.
   *  Present exactly when `storageState` is. */
  origin?: string;
  /** P4.2 - the ceremony machine AND the portal it belongs to; never one without the other. */
  preferredPairing?: { origin: string; pairingId: string };
}> {
  const stepStart = Date.now();
  const base: StepRecord = { stepId: step.id, index: input.index, status: 'running', tier: 'cache', durationMs: 0 };
  let verdict: CredentialGateVerdict;
  try {
    verdict = await evaluateCredentialGate(input, deps);
  } catch (err) {
    return {
      record: finishRecord(base, 'failed', stepStart, {
        tier: 'cache',
        error: { message: credentialGateFailureMessage(err), recoverable: false },
      }),
    };
  }

  switch (verdict.kind) {
    case 'not-applicable':
      return {};
    case 'ready':
      return {
        storageState: verdict.storageState,
        origin: verdict.origin,
        ...(verdict.preferredPairing ? { preferredPairing: verdict.preferredPairing } : {}),
      };
    case 'needs-machine':
      // ---- A MACHINE THAT IS GONE, NOT ONE THAT IS ASLEEP -------------------------------------
      //
      // Checked FIRST, because the neutral halt below would be an unbounded retry against a state
      // that can never change. A ceremony session is bound to its machine's residential line
      // (`bridge/attended.ts` stamps `boundEgress: { kind: 'residential', pairingId }` beside
      // `establishedBy`), so REVOKING that machine makes `checkoutSession` refuse the session
      // outright - and the run never learns the ceremony pairing at all. That is why THIS is the
      // only place the question is asked: `resolveLocality` reads a preference it can only have
      // learned from a checkout that SUCCEEDED, and a checkout that succeeded proves the machine is
      // still listed, so its own copy of this branch was unreachable and is gone. The answer must be
      // terminal: `awaiting_daemon` is exempt from the failure ceiling (`NEUTRAL_BLOCKED_CODES`), so
      // a schedule would otherwise re-fire against retired hardware forever, uncounted, with nothing
      // the owner could do.
      //
      // `knownPairings` MAY BE `null`, and that is not the same as `[]`. `null` is "this process has
      // no fleet listing", which `machineRetired` answers NO to - not-knowing may never send a person
      // to repeat a ceremony. `[]` is the registry saying the org has no machines, which is a
      // retirement of everything it once had.
      //
      // The pairing named here is `boundEgress.pairingId`, which for every session this product can
      // actually emit IS the machine the ceremony happened on - the one writer stamps both from the
      // same id - so the words below are true of it.
      if (verdict.requiredPairingId && machineRetired(verdict.requiredPairingId, knownPairings)) {
        return {
          record: localityNeedsCeremonyRecord(
            step,
            input.index,
            SESSION_MACHINE_RETIRED_REASON,
            verdict.origin,
            automationName,
          ),
        };
      }
      // Honest routing: a healthy session with no way out of the network is a MACHINE problem, and
      // sending the user to the Cofre for it would be a lie. `awaiting_daemon` is the existing
      // state for "a machine of yours is needed"; P4 refines it into a `blocked` schedule outcome.
      return {
        record: finishRecord(base, 'failed', stepStart, {
          tier: 'cache',
          error: {
            message: verdict.reason,
            recoverable: false,
            details: { kind: 'awaiting_daemon', capability: 'browser', stepIndex: input.index },
          },
        }),
      };
    case 'needs-credentials':
      return {
        record: finishRecord(base, 'failed', stepStart, {
          tier: 'cache',
          error: {
            // The step message names the ORIGIN and nothing else. `credentialRequest` carries the
            // structure; this string is what a log line and a non-SSE client see.
            message: `no usable credential for ${verdict.request.origin} — establish it in the Cofre`,
            recoverable: false,
            details: { kind: 'needs_credentials', request: verdict.request },
          },
        }),
      };
  }
}

/**
 * The message a gate failure is allowed to carry.
 *
 * `ensureSession` composes its own messages from hosts, ids and fixed text and is safe to repeat —
 * that is the contract its module docblock states, and its `sanitizeLoginFailure` is what upholds
 * it. A VALIDATION error is different in kind: it comes from parsing the step's own declaration,
 * which is the one place a caller could have written something secret-shaped (`CredentialRef`'s
 * regex exists precisely because someone might put a value where a reference belongs). Zod's
 * message is a JSON dump of its issues; it does not include the offending value today, and this
 * does not depend on that staying true.
 */
function credentialGateFailureMessage(err: unknown): string {
  if ((err as { name?: unknown } | null)?.name === 'ZodError') {
    return 'this step\'s credential declaration is not valid — credentialRefs must be opaque cofre:<itemId> references';
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Step types that can reach a browser, and therefore have a LOCALITY to decide (P4.1).
 *
 * An `api_call`, `integration`, `local_command`, `sub_automation` or `ekoa_action` step is not on
 * this list and is never halted by a locality verdict: those either leave from the server by
 * design or are dispatched to the daemon by their own declaration, and halting an integration-only
 * run because some origin in the step list is adversarial would be a stop nobody can act on.
 */
const STEP_TYPES_NEEDING_BROWSER: ReadonlySet<Step['type']> = new Set<Step['type']>([
  'navigate',
  'wait',
  'browser',
  'verify',
]);

/**
 * The human-action kinds a LOGIN CEREMONY can actually clear (D-ADHOC-5).
 *
 * A ceremony is one thing: a headed browser at an origin, held while a person authenticates, and a
 * captured session at the end. `login`, `captcha` and `mfa` are all obstacles ON THE WAY TO that
 * session, and completing the ceremony genuinely gets past them.
 *
 * The four kinds NOT here are the point of the set existing. `payment` and `identity` are step-ups
 * INSIDE an already-authenticated flow - there is no session to capture that answers them, and the
 * ask would send someone to log in to fix a 3-D Secure screen. `signature` is I8's whole subject and
 * must never be routed anywhere near a login rail. `other` is the model saying it does not know,
 * which is not evidence for asking a person to walk to a machine.
 */
const CEREMONY_CLEARABLE_HUMAN_ACTIONS: ReadonlySet<string> = new Set<string>(['login', 'captcha', 'mfa']);

/** How many times one run may answer a login ask with the session it was already given. See the
 *  call site: once is a statement of fact, twice is a habit of ignoring sign-in walls. */
const MAX_SESSION_SATISFIED_LOGINS = 1;

/**
 * The step record for a login ask the run's own injected session already answers (S-login-step).
 *
 * Built by SUBTRACTION from the failed record rather than from a fresh base, so everything that
 * describes what actually happened - the timing, the tier, the screenshot, the captured log tail -
 * survives, and only the two fields that would keep the run stopped are dropped. Rebuilding it from
 * scratch would silently discard evidence, and a run whose timeline loses a step to a recovery is
 * exactly the kind of gap that makes a later failure unreadable.
 */
function satisfiedBySessionRecord(record: StepRecord): StepRecord {
  const { error: _refusal, humanAction: _ask, ...rest } = record;
  return {
    ...rest,
    status: 'completed',
    visionReasoning:
      'Sign-in was not performed: this run started with a stored session for this origin, so the page was already authenticated.',
  };
}

/** The reason text on an ad-hoc ceremony halt. Composed from the KIND and the HOST and nothing else
 *  - never from a failure body, which is page prose this product does not echo back. */
function adhocCeremonyReason(kind: string | null, origin: string): string {
  const wall =
    kind === 'captcha' ? 'a bot check' : kind === 'mfa' ? 'a second-factor prompt' : 'a sign-in wall';
  return `${origin} answered with ${wall}, and only a person at your machine can get past it`;
}

/**
 * The step that put the run on the page it is on: the nearest `navigate` at or before `index`,
 * reachable without stepping back over anything that is not a page action.
 *
 * WHY IT IS NEEDED AT ALL. The ad-hoc halt RETURNS the run, which disposes the browser and releases
 * the machine's profile lease, so by the time a human has finished the ceremony the page is gone. A
 * resume that restarted at the blocked step would drive a blank tab and fail for a reason with
 * nothing to do with the credential it just waited for.
 *
 * WHY THE WALK STOPS AT THE FIRST NON-BROWSER STEP, which is the part that matters. Re-running a
 * `navigate` is idempotent by construction - it STATES where it goes. Re-running an `integration`,
 * `api_call`, `local_command`, `sub_automation` or `ekoa_action` step is not: those are effects on
 * the user's behalf, and repeating one to recover a PAGE would send a second email or write a second
 * row. So the moment the walk meets one it gives up and answers `index`, the blocked step, which is
 * where every other credential halt resumes. That resume may then fail on a blank page - honest and
 * bounded, which a duplicated side effect is not.
 *
 * The browser steps BETWEEN the navigate and the halt ARE re-run, and that is the accepted cost of
 * getting back to a page: replaying how the run got there. They are page actions on a portal the run
 * could not reach at all without a session, which is the narrowest form this can take while still
 * working.
 */
function lastNavigationIndexAtOrBefore(steps: readonly Step[], index: number): number {
  for (let i = Math.min(index, steps.length - 1); i >= 0; i--) {
    const type = steps[i]?.type;
    if (type === 'navigate') return i;
    if (type && !STEP_TYPES_NEEDING_BROWSER.has(type)) return index;
  }
  return index;
}

/**
 * A step locality refused. Surfaced as `awaiting_daemon` — the EXISTING "a machine of yours is
 * needed" halt — with the locality's own reason as the message.
 *
 * Deliberately not a new RunStatus. `awaiting_daemon` already means exactly this, is already
 * threaded through the SSE union, the reloading-client recovery set and the UI, and the schedule
 * rail is where "blocked" is the useful word: `startRunForTrigger` maps this status to
 * `outcome: 'blocked'` with `awaiting_daemon` as its code, and the supervisor treats THAT code -
 * the environment one - as neutral against the failure ceiling. A second run status meaning the
 * same thing would have to be kept in step with the first forever.
 */
function localityBlockedRecord(step: Step, index: number, reason: string): StepRecord {
  const base: StepRecord = { stepId: step.id, index, status: 'running', tier: 'cache', durationMs: 0 };
  return finishRecord(base, 'failed', Date.now(), {
    tier: 'cache',
    error: {
      message: reason,
      recoverable: false,
      details: { kind: 'awaiting_daemon', capability: 'browser', stepIndex: index },
    },
  });
}

/**
 * A locality refusal only a PERSON can clear, as the halt that already means exactly that.
 *
 * WHY `needs_credentials` AND NOT A NEW STATUS. The act that clears it is establishing this
 * origin's session again - the same act, at the same portal, through the same `/cofre` deep link
 * the credential gate already sends people to. A new run status would need its own SSE member, its
 * own recovery set, its own badge copy and its own ceiling rule, all of them duplicating one that
 * exists and is already correct: `needs_credentials` is in `BLOCKED_RUN_STATUSES` (so the schedule
 * rail reports `blocked`, not `failed`) and deliberately NOT in `NEUTRAL_BLOCKED_CODES` (so it
 * drives the failure ceiling and auto-pauses rather than re-firing forever).
 *
 * `mode: 'ceremony'` because that is what is being asked for: a person at a headed browser, on a
 * machine they still own. `issueLoginRelayPrompt` is pure - it composes the prompt, it does not
 * register anything - so building it here costs nothing and lets the portal say WHERE to log in.
 *
 * THE MESSAGE NAMES A MACHINE IN WORDS, NEVER A PAIRING UUID. A pairing id is an opaque identifier
 * this product never shows a user; printing one reads as a fault code and names nothing they can
 * act on. The reason string comes from `locality.ts`, which composes it from the ACT that fixes it.
 */
function localityNeedsCeremonyRecord(
  step: Step,
  index: number,
  reason: string,
  origin: string,
  automationName: string,
): StepRecord {
  const base: StepRecord = { stepId: step.id, index, status: 'running', tier: 'cache', durationMs: 0 };
  const request = ceremonyCredentialRequest({ step, index, reason, origin, automationName });
  return finishRecord(base, 'failed', Date.now(), {
    tier: 'cache',
    error: {
      message: reason,
      recoverable: false,
      details: { kind: 'needs_credentials', request },
    },
  });
}

/**
 * THE ASK ITSELF, separated from the failed STEP RECORD that used to be the only way to raise it.
 *
 * The locality refusal above needs a record, because it is produced BEFORE its step runs and the
 * loop's one persist/emit/halt path is driven by a failed record. The ad-hoc adversarial halt
 * (docs/decisions.md 2026-08-24, D-ADHOC-5) is produced AFTER a step has already failed and already
 * been recorded - it converts a pause into a durable halt - so wrapping the ask in a second failure
 * record would overwrite the real one, which is the only description of what the page actually did.
 * Both callers want the same `RunCredentialRequest`; only one of them wants a record around it.
 *
 * `mode: 'ceremony'` in both cases because that is what is being asked for: a person at a headed
 * browser on a machine they own. `issueLoginRelayPrompt` is PURE - it composes the prompt, it
 * registers nothing - so building one costs nothing and lets the portal say where to log in.
 */
function ceremonyCredentialRequest(args: {
  step: Step;
  index: number;
  reason: string;
  origin: string;
  automationName: string;
  /** Where the re-dispatch picks up, when that is not the blocked step. See `RunCredentialRequest`. */
  resumeFromStepIndex?: number;
}): RunCredentialRequest {
  const reason = args.reason.slice(0, 500);
  return {
    stepIndex: args.index,
    ...(args.resumeFromStepIndex !== undefined ? { resumeFromStepIndex: args.resumeFromStepIndex } : {}),
    origin: args.origin,
    integrationKey: args.step.integrationKey ?? 'browser',
    portalDeepLink: cofrePortalDeepLink(args.origin),
    mode: 'ceremony',
    reason,
    ceremony: issueLoginRelayPrompt({
      automationName: args.automationName,
      siteOrigin: args.origin,
      reason,
    }),
  };
}

/**
 * The same refusal when no origin could be resolved to name in a ceremony request.
 *
 * A plain non-recoverable failure, which is TERMINAL on the schedule rail (it drives the failure
 * ceiling and eventually auto-pauses) - the property that matters. What it is not is
 * `awaiting_daemon`: falling back to the neutral halt because a field was missing would restore the
 * unbounded retry for the one case that has the least information to act on.
 */
function localityTerminalFailureRecord(step: Step, index: number, reason: string): StepRecord {
  const base: StepRecord = { stepId: step.id, index, status: 'running', tier: 'cache', durationMs: 0 };
  return finishRecord(base, 'failed', Date.now(), {
    tier: 'cache',
    error: { message: reason, recoverable: false },
  });
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
  const screenshotUrl = screenshotUrlFromPath(screenshotPath);
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
function extractAwaitingConsent(record: StepRecord): ConsentRequest | null {
  const details = record.error?.details;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== 'awaiting_consent') return null;
  const scope = d.approvalScope as Record<string, unknown> | undefined;
  return {
    stepIndex: typeof d.stepIndex === 'number' ? d.stepIndex : record.index,
    shape: String(d.shape ?? ''),
    argv: Array.isArray(d.argv) ? (d.argv as string[]) : [],
    description: String(d.description ?? ''),
    // Carried through verbatim, never re-derived: see the executor's note on approvalScope. A
    // record written before this field existed has no scope, and the resolver falls back to the
    // run's own owner/org with no machine — which is exactly what it did before.
    ...(scope && typeof scope.userId === 'string' && typeof scope.orgId === 'string'
      ? {
          approvalScope: {
            userId: scope.userId,
            orgId: scope.orgId,
            pairingId: typeof scope.pairingId === 'string' ? scope.pairingId : null,
          },
        }
      : {}),
  };
}

/**
 * Detect the write gate's refusal on an `integration` step.
 *
 * A DISTINCT `kind` from the `local_command`/`api_call` `awaiting_consent` record, on purpose: that
 * one carries a command SHAPE the run is awaiting and is answered through `resolveConsent` ->
 * `approved_commands`. An integration action's approval is a different store on a different key,
 * so letting this record enter the command-consent ceremony would show the user a dialog whose
 * "sempre" writes an approval this gate never reads.
 */
function extractAwaitingIntegrationConsent(
  record: StepRecord,
): { stepIndex: number; integrationKey: string; actionName: string } | null {
  const details = record.error?.details;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== 'awaiting_integration_consent') return null;
  return {
    stepIndex: typeof d.stepIndex === 'number' ? d.stepIndex : record.index,
    integrationKey: typeof d.integrationKey === 'string' ? d.integrationKey : 'unknown',
    actionName: typeof d.actionName === 'string' ? d.actionName : 'unknown',
  };
}

/**
 * Detect the needs_credentials failure record. Sibling of `extractAwaitingDaemon`.
 *
 * Re-VALIDATES through the shared schema rather than casting: the details blob is read back off a
 * step record that may have been persisted by another version of this engine, and a halt payload
 * that does not match the contract must fail to be a halt rather than be streamed as one.
 */
function extractNeedsCredentials(record: StepRecord): RunCredentialRequest | null {
  const details = record.error?.details;
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  if (d.kind !== 'needs_credentials') return null;
  const parsed = RunCredentialRequest.safeParse(d.request);
  return parsed.success ? parsed.data : null;
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
  // F-4: a CREDENTIAL-ADJACENT failure never reaches the fixer. When the typist cannot find the
  // form it expects, handing the page to an LLM to work out which field is the password is exactly
  // what invariant I5 forbids — the next action in that sequence types a decrypted credential into
  // whatever the model picked. An unfamiliar login form is a case for a human (relay or attended),
  // not for a guess. Checked FIRST so no step-type branch below can re-enable it.
  if (isCredentialAdjacentFailure(record.error)) return false;
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
