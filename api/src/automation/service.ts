/**
 * automation/ service surface (ch03 §3.8.18, §3.6.3). The actor-scoped, one-function-per-route
 * API that `routes/automations.ts` calls — so a route never imports `data/` directly (ch02 routes
 * row) and never re-implements scoping. Every function takes the request `Actor`; every response is
 * shape-compatible with the `shared/automations.ts` contract (validated in the suite by parsing
 * against those zod schemas).
 *
 * Scoping (Amendment 2): automations are org-scoped + creator-owned (visible across the org, mutated
 * by their creator or an org-admin/super-admin) — UNLESS marked `visibility: 'private'`, which is
 * owner-only on every read and write path and invisible even to an org-admin/super-admin (see
 * `isVisibleTo`). Runs are visible to the owner and org-admins.
 * Creation is org-admin-only by default with a flippable org setting for builder authoring
 * (`canCreateAutomation`). Cancel/resume/consent are owner-scoped and idempotent, driven by an
 * in-memory signal registry (single-process, FIXED-8) that binds the engine's `cancellation` /
 * `resumeSignal` hooks. This module wires NOTHING — the composition root binds `startRunForTrigger`
 * to the delivery pipeline and the engine's seams.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import type {
  Automation as WireAutomation,
  RunRecord as WireRunRecord,
  PlanResponse as WirePlanResponse,
  ConsentResult as WireConsentResult,
  CatalogResponse as WireCatalogResponse,
  ApprovedCommand as WireApprovedCommand,
  StepFeedbackResponse as WireStepFeedbackResponse,
  RevokeApprovedCommandResponse as WireRevokeResponse,
  RunLogsResponse as WireRunLogsResponse,
  LocalBrowserCapture,
} from '@ekoa/shared';
import { automations, automationRuns, automationRunIdempotency } from '../data/stores.js';
import { logActivity } from '../data/activity.js';
import { createMemory } from '../memory/index.js';
import { runAutomation, rehearseAutomation, scrubCredentials, SECRET_SHAPED_INPUT_NAME, type RunContext } from './engine.js';
import { HEAL_BUDGET, REPLAY_BUDGET } from './budgets.js';
import { planFromGoal as plannerPlanFromGoal } from './planner.js';
import { buildAutomationCatalog } from './catalog.js';
import { evictCacheForFingerprint } from './cache.js';
import { approveCommandShape, revokeCommandShape, listApprovedShapes, listApprovedCommandRecords } from './consent.js';
import { runEventEmitterFactory, resumeLearnDriver } from './seams.js';
import { clearCredentialWaiter } from './credential-waiters.js';
import { replayIntegrationAction } from './replay-action.js';
import { resolveBoundAutomation } from './integration-automations.js';
import { classifyReplayDrift, healDriftedRecipe, writesIn, type HealDeps } from './self-heal.js';
import {
  compileInjectedCalls,
  deriveLessons,
  internalApiCalls,
  redactCaptures,
  MAX_COMPILED_CALLS,
  type CapturedExchange,
} from './network-capture.js';
import {
  capturedCallsStore,
  type CaptureKey,
  type CapturedCallsStore,
} from '../integrations/captured-calls-store.js';
import {
  integrationRecipeStore,
  type RecipeDraft,
  type RecipeWriteResult,
} from '../integrations/recipe-store.js';
import { forgetRecipe } from '../integrations/recipe-lifecycle.js';
import { mintSiteIntegrationForAutomation, type MintResult } from '../integrations/definition-mint.js';
import { secretRegistryFromValues, type SecretRegistry } from '../security/redaction.js';
import { screenshotUrlFromPath, runLogsFromSteps } from './persistence.js';
import type { Automation, Step, StepType, RunRecord, StepRecord } from './types.js';

// ============================================================================
// Errors (the router maps `.code` onto the ch03 error envelope, CONV-2)
// ============================================================================

/** `IDEMPOTENCY_UNRESOLVED` (slice E4): the dedupe store contradicted itself — it refused our
 *  claim as a duplicate and then reported no mapping, repeatedly. The caller did nothing wrong and
 *  retrying the SAME key is safe, so the router answers it as INTERNAL (500), never a 4xx. */
export type AutomationErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION' | 'IDEMPOTENCY_UNRESOLVED';
export class AutomationServiceError extends Error {
  constructor(public readonly code: AutomationErrorCode, message: string) {
    super(message);
    this.name = 'AutomationServiceError';
  }
}

// ============================================================================
// Stored shapes + wire mappers
// ============================================================================

type StoredAutomation = Automation & { orgId: string; visibility?: 'private' | 'org' };
type StoredRun = RunRecord & {
  ownerUserId?: string;
  orgId?: string;
  /**
   * K3 (D-CORNERSTONE-LEARN-ON-RESUME): the integration-action identity of a STORABLE (named,
   * read) action run that halted `needs_credentials` - what the post-ceremony learn re-run needs
   * to route the same action back through the executor rail. Written only by
   * `runAutomationForAction`'s halt branch; never projected to the wire (`toWireRun` is an
   * explicit field list). `args` are the action args (never credentials - those live only under
   * `inputs.credentials`, which is scrubbed before persist).
   */
  actionRetry?: { integrationKey: string; actionName: string; args: Record<string, unknown> };
};

const VALID_STEP_TYPES: ReadonlySet<string> = new Set([
  'browser', 'verify', 'integration', 'sub_automation', 'navigate', 'wait', 'local_command', 'api_call', 'ekoa_action',
]);

/**
 * The engine parameters each step type needs that the WIRE step cannot carry.
 *
 * `PlanStep` reaches this module as `{stepId, description, tool}` and `mapWireStepToEngine` builds
 * an engine `Step` from those three fields only. That narrowness is deliberate: engine `Step`
 * (automation/types.ts) also carries `commandTemplate` (a local command), `apiRequest` (an arbitrary
 * outbound HTTP call), `ekoaAction`, and the `declaration` that governs WHERE a step runs and which
 * Cofre items it may reference (E-2). This is a `user-or-key` capability surface, so widening the
 * mapper would hand any gateway-key holder those authoring powers - a decision for the owner, not a
 * mapper detail.
 *
 * `integration` USED TO BE IN THIS TABLE and is not any more (2026-08-06). It is the one
 * parametrised type the wire now carries, because it differs in KIND from the rest: it names a
 * package the run's own org already has, it is resolved at execution under the run's principal
 * like every other rail, and a mutating action still meets the write gate and comes back
 * `awaiting_consent` without a live approval. The worst it can express is a call the same caller
 * could already make through `POST /integrations/:key/actions/:name/execute`. The others stay out:
 * a local command, an arbitrary outbound HTTP request and a Cofre-referencing declaration are new
 * powers, not a new spelling of an existing one.
 *
 * What was NOT deliberate was storing the step anyway. A `tool` in this table can only ever fail at
 * execution, and it fails blaming the caller for a field the API itself discarded - `integration
 * step <id> missing integrationKey or integrationAction` (engine.ts), `local_command step <id>
 * missing commandTemplate.argv`, `navigate step <id> missing url`. The client supplied those fields;
 * the mapper dropped them; `toWireAutomation` then projected the stored step back as
 * `{stepId, description, tool}` so the loss was invisible until the run failed. Refuse at the door
 * instead, naming the fields that cannot be expressed.
 *
 * The supported route for these is the planner: `POST /api/v1/automations/plan` turns a goal into
 * engine-native steps (planner.ts `normaliseStep` sets `integrationKey`/`integrationAction`/
 * `argsTemplate`/`commandTemplate`/...), persists the automation, and the caller runs it with
 * `POST /api/v1/automations/:id/runs`.
 */
const STEP_TYPE_UNCARRIED_PARAMS: Readonly<Record<string, string>> = {
  navigate: 'url',
  sub_automation: 'subAutomationId',
  local_command: 'commandTemplate.argv',
  api_call: 'apiRequest.method, apiRequest.url',
  ekoa_action: 'ekoaAction.artifactSlug, ekoaAction.capabilityName',
};

/** The step types this endpoint CAN express end to end. Derived, so the two lists cannot drift. */
const WIRE_AUTHORABLE_STEP_TYPES: readonly string[] = [...VALID_STEP_TYPES].filter(
  (t) => !(t in STEP_TYPE_UNCARRIED_PARAMS),
);

/**
 * A wire step -> the engine step, or a VALIDATION refusal.
 *
 * An ABSENT `tool` keeps its historical default of `browser`: the contract marks the field optional
 * and the wire view always emits one, so omitting it is a legal way to say "a browser step". Only a
 * value that is not a step type is refused - it used to be silently coerced to `browser`, which
 * turned a typo into a running automation that does something else.
 */
function mapWireStepToEngine(
  s: {
    stepId?: string;
    description?: string;
    tool?: string;
    argv?: string[];
    integrationKey?: string;
    integrationAction?: string;
    argsTemplate?: Record<string, string>;
  },
  i: number,
): Step {
  const where = `O passo ${i + 1}${s.stepId ? ` (stepId="${s.stepId}")` : ''}`;
  const tool = s.tool ?? 'browser';
  if (!VALID_STEP_TYPES.has(tool)) {
    throw new AutomationServiceError(
      'VALIDATION',
      `${where} tem tool=${JSON.stringify(tool.slice(0, 40))}, que não é um tipo de passo. ` +
        `Tipos válidos neste endpoint: ${WIRE_AUTHORABLE_STEP_TYPES.join(', ')}.`,
    );
  }
  const uncarried = STEP_TYPE_UNCARRIED_PARAMS[tool];
  if (uncarried) {
    throw new AutomationServiceError(
      'VALIDATION',
      `${where} tem tool="${tool}", que precisa de ${uncarried} - campos que o plano deste endpoint não transporta, ` +
        `pelo que o passo falharia na execução. Crie a automação com POST /api/v1/automations/plan ` +
        `(o planeador constrói estes passos) e execute-a com POST /api/v1/automations/{id}/runs.`,
    );
  }
  const base: Step = {
    id: s.stepId ?? `step-${i}-${randomUUID().slice(0, 6)}`,
    description: s.description ?? '',
    type: tool as StepType,
  };
  if (tool !== 'integration') return base;

  // The ONE parametrised type this endpoint carries. Shape is checked here so a step that cannot
  // run is refused at authoring rather than at 3am; WHICH integration and WHETHER the action may
  // run are NOT decided here on purpose - the engine resolves the package under the run's own
  // principal and the write gate re-evaluates every mutating action at call time, so duplicating
  // either would be a second copy of a decision that must stay in one place.
  if (!s.integrationKey || !s.integrationAction) {
    throw new AutomationServiceError(
      'VALIDATION',
      `${where} tem tool="integration" mas não indica ${!s.integrationKey ? 'integrationKey' : 'integrationAction'}. ` +
        `Um passo de integração precisa de ambos - use GET /api/v1/integrations para os valores válidos.`,
    );
  }
  return {
    ...base,
    integrationKey: s.integrationKey,
    integrationAction: s.integrationAction,
    ...(s.argsTemplate ? { argsTemplate: s.argsTemplate } : {}),
  };
}

function toWireAutomation(doc: StoredAutomation): WireAutomation {
  return {
    id: doc.id,
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    // The parametrised fields travel BACK too. Projecting only {stepId, description, tool} is what
    // made the original loss invisible: a client could not see that what it sent was not what was
    // stored, and found out only when the run failed.
    plan: {
      steps: doc.steps.map((s) => ({
        stepId: s.id,
        description: s.description,
        tool: s.type,
        ...(s.integrationKey ? { integrationKey: s.integrationKey } : {}),
        ...(s.integrationAction ? { integrationAction: s.integrationAction } : {}),
        ...(s.argsTemplate ? { argsTemplate: s.argsTemplate } : {}),
      })),
    },
    ownerId: doc.ownerUserId,
    orgId: doc.orgId,
    ...(doc.visibility ? { visibility: doc.visibility } : {}),
    // Integration-managed automations: the UI's "Gerida pela integração" chip + editor
    // banner/backlink key off `source` (wire Automation is passthrough).
    ...(doc.source ? { source: doc.source } : {}),
    ...(doc.inputSchema ? { inputSchema: doc.inputSchema } : {}),
    ...(doc.createdAt ? { createdAt: doc.createdAt } : {}),
    ...(doc.updatedAt ? { updatedAt: doc.updatedAt } : {}),
  };
}

function toWireRun(doc: StoredRun): WireRunRecord {
  // Defense-in-depth: the engine already scrubs `credentials` before persistence, but never
  // return it on the wire even if a legacy row carries it (credential boundary, §5.6.7).
  const wireInputs = doc.inputs && 'credentials' in doc.inputs
    ? Object.fromEntries(Object.entries(doc.inputs).filter(([k]) => k !== 'credentials'))
    : doc.inputs;
  return {
    id: doc.id,
    automationId: doc.automationId,
    status: doc.status,
    ...(wireInputs ? { inputs: wireInputs } : {}),
    ...(doc.rehearsalSummary?.reason ? { summary: doc.rehearsalSummary.reason } : {}),
    ...(doc.startedAt ? { startedAt: doc.startedAt } : {}),
    ...(doc.endedAt ? { finishedAt: doc.endedAt } : {}),
    ...(doc.ownerUserId ? { ownerId: doc.ownerUserId } : {}),
    ...(doc.orgId ? { orgId: doc.orgId } : {}),
    ...(Array.isArray(doc.steps) ? { steps: doc.steps.map(toWireStep) } : {}),
    // The pending question, when there is one. `POST /runs/:id/consent` is `user-or-key` and its
    // body REQUIRES `shape`, so withholding this made the gate unanswerable by exactly the callers
    // the endpoint's auth class invites: a key holder could read `status: 'awaiting_consent'` and
    // had nowhere to learn what was being asked or which shape to echo back. The only carrier of
    // the shape was the SSE `runAwaitingConsent` event, and no event stream is key-reachable.
    //
    // THREE fields only. `argv` is the raw command line, which the engine shows a human solely
    // behind an explicit "what exactly will run?" toggle, and `approvalScope` is server-written
    // bookkeeping its own type marks as never caller-supplied. Neither goes public as a side
    // effect of making the gate answerable.
    ...(doc.consentRequest
      ? {
          consentRequest: {
            stepIndex: doc.consentRequest.stepIndex,
            description: doc.consentRequest.description,
            shape: doc.consentRequest.shape,
          },
        }
      : {}),
    // The credential halt, for the same reason (P3.1) and with one more: this state SURVIVES a
    // reload, so the run resource — not an SSE frame the client was not connected for — is the
    // primary carrier. Forwarded WHOLE rather than field-picked, because every field on the shape
    // is already published and none of them can hold a value (`shared/src/cofre.ts`).
    ...(doc.credentialRequest ? { credentialRequest: doc.credentialRequest } : {}),
  };
}

/**
 * A stored StepRecord → the lean wire step (shared RunStepRecord). Maps the disk `screenshotPath`
 * to the served `screenshotUrl` capability path so the Histórico detail renders thumbnails without
 * knowing the storage layout; drops the heavy `output`, `resolvedAction`, `fingerprint`, and the
 * structured error `details` to keep the run list/detail response bounded.
 */
function toWireStep(s: StepRecord): Record<string, unknown> {
  return {
    stepId: s.stepId,
    index: s.index,
    status: s.status,
    tier: s.tier,
    durationMs: s.durationMs,
    ...(s.error ? { error: { message: s.error.message, recoverable: s.error.recoverable } } : {}),
    ...(screenshotUrlFromPath(s.screenshotPath) ? { screenshotUrl: screenshotUrlFromPath(s.screenshotPath) } : {}),
  };
}

// ============================================================================
// Authorization helpers
// ============================================================================

const isAdmin = (actor: Actor): boolean => actor.role === 'super-admin' || actor.role === 'org-admin';

/**
 * THE PRIVATE GATE. `visibility: 'private'` means OWNER-ONLY, and it is enforced, not decorative:
 * the field is accepted on create/patch, echoed by `toWireAutomation`, and published in the
 * OpenAPI document, so an API client reads it as access control and must be right to.
 *
 * WHO CAN SEE A PRIVATE AUTOMATION: its owner. NOBODY else — not an org-admin, not a super-admin.
 * That is not a new rule; it is the ONE rule this codebase already has for the ONE other resource
 * carrying the same `visibility: 'private' | 'org'` field. `OwnerVisibilityScoped` (data/scoped.ts,
 * behind memory/) says it verbatim: "private row of another user — invisible even to the org
 * admin", and it grants no super-admin exception either. `canSeeRun` below is deliberately NOT the
 * analogue: a run carries no visibility field at all, so "owner + org-admin" is that resource's
 * DEFAULT scope, never a decision about an explicit private marker. When the two candidate house
 * rules disagree, the one that governs this exact field wins.
 *
 * THE DEFAULT IS NOT PRIVATE. `visibility` is optional and absent on every row written before it
 * existed; all of those are org-visible today. Only the literal string 'private' hides a row —
 * 'org' and absent keep exactly the behaviour they have always had. Reading "absent" as private
 * (which is what `OwnerVisibilityScoped.listVisible`'s `visibility === 'org'` test would do here)
 * would silently retire the existing estate from every org's list.
 *
 * A hidden automation answers the uniform NOT_FOUND every caller path already uses for a missing
 * one — identical status AND body, so nothing here is an existence oracle. That is why the gate
 * sits inside `canReadAutomation`/`canWriteAutomation` rather than beside them: every mutation
 * path (patch, delete, run-create, plan-onto-existing) gates on one of those two first, so a
 * caller who may not READ a private automation cannot probe for it with a write either.
 */
function isVisibleTo(doc: Pick<StoredAutomation, 'visibility' | 'ownerUserId'>, actor: { userId: string }): boolean {
  if (doc.visibility !== 'private') return true;
  return doc.ownerUserId === actor.userId;
}

/** Read scope: an automation is visible across its org — except a private one, owner-only. */
function canReadAutomation(doc: StoredAutomation, actor: Actor): boolean {
  if (!isVisibleTo(doc, actor)) return false;
  return actor.role === 'super-admin' || doc.orgId === actor.orgId;
}
/** Write scope: the creator, or an org-admin in the same org, or a super-admin — and never an
 *  automation the actor cannot even see (someone else's private one). */
function canWriteAutomation(doc: StoredAutomation, actor: Actor): boolean {
  if (!isVisibleTo(doc, actor)) return false;
  if (actor.role === 'super-admin') return true;
  if (doc.orgId !== actor.orgId) return false;
  return doc.ownerUserId === actor.userId || actor.role === 'org-admin';
}
/** Run visibility: the owner, an org-admin in the run's org, or a super-admin. */
function canSeeRun(run: StoredRun, actor: Actor): boolean {
  if (actor.role === 'super-admin') return true;
  if (run.orgId !== actor.orgId) return false;
  return run.ownerUserId === actor.userId || actor.role === 'org-admin';
}

/** Cancel/resume/consent/step-feedback are OWNER-scoped (§5.6.7): only the run's own user (or a
 *  super-admin for platform ops) may mutate a run or touch the owner's consent/cache/memory. An
 *  org-admin has READ visibility (canSeeRun) but must NOT be able to inject a standing command
 *  approval into another member's account or drive their local execution. */
function isRunOwner(run: StoredRun, actor: Actor): boolean {
  if (actor.role === 'super-admin') return true;
  return run.orgId === actor.orgId && run.ownerUserId === actor.userId;
}

async function loadAutomationForRead(actor: Actor, id: string): Promise<StoredAutomation> {
  const doc = (await automations.get(id)) as StoredAutomation | null;
  if (!doc || !canReadAutomation(doc, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
  return doc;
}

// ============================================================================
// In-memory run signal registry (§5.3.1 owner-scoped idempotent cancel/resume)
// ============================================================================

interface RunSignals {
  ownerUserId: string;
  orgId: string;
  cancelled: boolean;
  resumeFlag: boolean;
  /** Shapes approved for THIS run only ("permitir uma vez"). Never persisted — see RunContext. */
  runApprovedShapes: Set<string>;
}
const signals = new Map<string, RunSignals>();

function makeCtx(runId: string, sig: RunSignals, extra: Partial<RunContext> = {}): RunContext {
  return {
    ownerUserId: sig.ownerUserId,
    orgId: sig.orgId,
    triggeredBy: 'user',
    visitedAutomationIds: new Set(),
    traceId: runId,
    cancellation: { isCancelled: () => sig.cancelled },
    resumeSignal: { shouldResume: () => sig.resumeFlag, clear: () => { sig.resumeFlag = false; } },
    runApprovedShapes: {
      has: (shape) => sig.runApprovedShapes.has(shape),
      add: (shape) => { sig.runApprovedShapes.add(shape); },
    },
    ...extra,
  };
}

/** Test-only: clear the run signal registry. */
export function __resetAutomationServiceForTests(): void {
  signals.clear();
}

// ============================================================================
// Automations CRUD
// ============================================================================

export async function listAutomations(actor: Actor): Promise<WireAutomation[]> {
  const rows = (await automations.find(
    actor.role === 'super-admin' ? {} : { orgId: actor.orgId },
    { updatedAt: -1 },
  )) as unknown as StoredAutomation[];
  // The LIST must not hand back what GET /:id refuses. Filtered in memory through the SAME
  // predicate the by-id path uses (exactly as OwnerVisibilityScoped.listVisible does) rather than
  // as a query clause, so the two read paths can never drift apart.
  return rows.filter((doc) => isVisibleTo(doc, actor)).map(toWireAutomation);
}

export async function getAutomation(actor: Actor, id: string): Promise<WireAutomation> {
  return toWireAutomation(await loadAutomationForRead(actor, id));
}

/** Creation authority: org-admin/super-admin, or a plain user when the org enables member authoring.
 *  The persisted org-setting key `allowBuilderAutomations` keeps its wire name (data compatibility);
 *  only the role value it grants was renamed `builder` → `user` (H1). */
export function canCreateAutomation(actor: Actor, orgSettings?: { allowBuilderAutomations?: boolean }): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === 'user' && orgSettings?.allowBuilderAutomations === true;
}

export async function createAutomation(
  actor: Actor,
  // The steps type mirrors mapWireStepToEngine's input — the integration-step fields ride the
  // wire since 2026-08-06 (the mapper widening above); the old narrower type here silently
  // predated them while the runtime already carried them end to end.
  input: {
    name: string;
    description?: string;
    plan?: { steps?: Array<Parameters<typeof mapWireStepToEngine>[0]> };
    visibility?: 'private' | 'org';
  },
  orgSettings?: { allowBuilderAutomations?: boolean },
): Promise<WireAutomation> {
  if (!canCreateAutomation(actor, orgSettings)) {
    throw new AutomationServiceError('FORBIDDEN', 'not authorized to create automations');
  }
  // Map (and refuse) BEFORE minting anything: a step the engine could only fail on is never stored.
  const steps = (input.plan?.steps ?? []).map(mapWireStepToEngine);
  const id = randomUUID();
  const now = new Date().toISOString();
  const doc: StoredAutomation = {
    id,
    name: input.name,
    description: input.description ?? '',
    steps,
    ownerUserId: actor.userId,
    orgId: actor.orgId,
    ...(input.visibility ? { visibility: input.visibility } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await automations.insert({ _id: id, ...doc } as never);
  return toWireAutomation(doc);
}

export async function patchAutomation(
  actor: Actor,
  id: string,
  patch: { name?: string; description?: string; plan?: { steps?: Array<{ stepId?: string; description?: string; tool?: string; argv?: string[] }> }; visibility?: 'private' | 'org' },
): Promise<WireAutomation> {
  const doc = (await automations.get(id)) as StoredAutomation | null;
  if (!doc || !canReadAutomation(doc, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
  if (!canWriteAutomation(doc, actor)) throw new AutomationServiceError('FORBIDDEN', 'not authorized to modify this automation');
  // Map (and refuse) OUTSIDE the update callback: a refusal must leave the stored plan untouched,
  // not throw halfway through a write. Authorization still answers first - an actor who may not
  // write this automation gets FORBIDDEN whatever the steps look like.
  const steps = patch.plan?.steps ? patch.plan.steps.map(mapWireStepToEngine) : undefined;
  const now = new Date().toISOString();
  const updated = (await automations.update(id, (cur) => ({
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(steps ? { steps } : {}),
    updatedAt: now,
  }))) as unknown as StoredAutomation | null;
  if (!updated) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
  return toWireAutomation(updated);
}

export async function deleteAutomation(actor: Actor, id: string): Promise<{ ok: true }> {
  const doc = (await automations.get(id)) as StoredAutomation | null;
  if (!doc || !canReadAutomation(doc, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
  if (!canWriteAutomation(doc, actor)) throw new AutomationServiceError('FORBIDDEN', 'not authorized to delete this automation');
  await automations.delete(id);
  return { ok: true };
}

// ============================================================================
// Plan-from-goal (Landmine 9: persists the automation AND starts a rehearsal run)
// ============================================================================

export async function planFromGoal(
  actor: Actor,
  input: { goal: string; name?: string; automationId?: string; language?: string },
  orgSettings?: { allowBuilderAutomations?: boolean },
): Promise<WirePlanResponse> {
  void input.language; // language is carried on the wire (ch03 §3.4); the planner output is language-agnostic
  // Creation authority (Amendment 2): plan-from-goal PERSISTS a new automation (landmine 9), so it
  // is subject to the same gate as POST /automations — a builder in an org without builder-authoring
  // cannot create one via /plan. Updating an existing automation is guarded by canWriteAutomation below.
  if (!input.automationId && !canCreateAutomation(actor, orgSettings)) {
    throw new AutomationServiceError('FORBIDDEN', 'not authorized to create automations');
  }
  const catalog = await buildAutomationCatalog(actor);
  const result = await plannerPlanFromGoal({ goal: input.goal, userId: actor.userId, catalog, ...(input.name ? { automationName: input.name } : {}) });

  if (result.status === 'unavailable') {
    // Egress outage (dead credential, provider down, empty transport): the honest wire status is
    // "service unavailable, retry soon" — NEVER plan_failed's "rephrase your goal", which blames
    // the user for an infrastructure failure. Nothing persisted, no run started.
    console.warn(`[automation] plan-from-goal unavailable (egress outage): ${result.detail}`);
    return {
      plan: { status: 'plan_unavailable', steps: [], reason: 'O serviço de IA está indisponível de momento. Tente novamente dentro de instantes.' },
      rehearsing: false,
    };
  }
  if (result.status === 'failed') {
    // F29: the model could not produce a usable plan. A STRUCTURED outcome (mirrors the
    // awaiting_integration branch): nothing persisted, no run started — NOT a thrown Error the
    // route would mask as an opaque 500. The wire `reason` is a fixed GENERIC message: the detailed
    // violations can quote raw model output (a hallucinated auth header / api-key), so they stay
    // server-side only (Codex checkpoint finding), never returned to the client.
    console.warn(`[automation] plan-from-goal failed:\n${result.violations.map((v) => `- ${v}`).join('\n')}`);
    return {
      plan: { status: 'plan_failed', steps: [], reason: 'O modelo não conseguiu criar um plano válido. Reformule o objetivo e tente novamente.' },
      rehearsing: false,
    };
  }
  if (result.status !== 'ok') {
    // Needs an integration: no automation persisted, no run started.
    return { plan: { status: 'awaiting_integration', steps: [] }, rehearsing: false };
  }

  // Persist the automation (create, or update an existing one when automationId is given).
  const now = new Date().toISOString();
  let doc: StoredAutomation;
  if (input.automationId) {
    const existing = (await automations.get(input.automationId)) as StoredAutomation | null;
    if (!existing || !canWriteAutomation(existing, actor)) throw new AutomationServiceError('FORBIDDEN', 'cannot update this automation');
    doc = {
      ...existing,
      name: result.name,
      description: result.description,
      steps: result.steps,
      ...(result.inputSchema ? { inputSchema: result.inputSchema } : {}),
      updatedAt: now,
    };
    await automations.update(doc.id, () => ({ _id: doc.id, ...doc } as never));
  } else {
    const id = randomUUID();
    doc = {
      id,
      name: result.name,
      description: result.description,
      steps: result.steps,
      ...(result.inputSchema ? { inputSchema: result.inputSchema } : {}),
      ownerUserId: actor.userId,
      orgId: actor.orgId,
      createdAt: now,
      updatedAt: now,
    };
    await automations.insert({ _id: id, ...doc } as never);
  }

  // MINT-ON-PLAN (D-CORNERSTONE-MINT-SHAPE): the planned automation becomes a wrapper action on a
  // per-site tenant integration, so the ordinary action rail can learn a recipe for it. Contained:
  // a mint refusal or error never fails the plan (the plan is the primary contract). A row whose
  // provenance names a TEMPLATE (`source.templateKey` not `plan:`-stamped) is integration-managed
  // and is never re-minted from here - its wrapper belongs to the provisioner.
  let minted: MintResult | null = null;
  const planStamp = `plan:${doc.id}`;
  const managedByTemplate = doc.source !== undefined && doc.source.templateKey !== planStamp;
  if (!managedByTemplate) {
    try {
      minted = await mintSiteIntegrationForAutomation(actor, {
        automationId: doc.id,
        goal: input.goal,
        name: doc.name,
        ...(doc.description !== undefined ? { description: doc.description } : {}),
        steps: doc.steps,
        ...(doc.source?.templateKey === planStamp
          ? { existingSource: doc.source }
          : {}),
      });
      if (minted.minted) {
        console.warn(`[automation] mint-on-plan: ${minted.integrationKey}/${minted.actionName} (${minted.basis}${minted.createdDefinition ? ', new definition' : ''})`);
        if (doc.source?.integrationKey !== minted.integrationKey || doc.source?.templateKey !== planStamp) {
          doc = { ...doc, source: { integrationKey: minted.integrationKey, templateKey: planStamp }, updatedAt: new Date().toISOString() };
          await automations.update(doc.id, () => ({ _id: doc.id, ...doc } as never));
        }
      } else {
        console.warn(`[automation] mint-on-plan skipped: ${minted.reason}`);
      }
    } catch (err) {
      console.warn(`[automation] mint-on-plan errored (plan unaffected): ${err instanceof Error ? err.message : String(err)}`);
      minted = null;
    }
  }

  // Start a REHEARSAL run (the plan endpoint's documented double side effect) and respond early.
  const runId = await startRunInternal(doc.id, { userId: actor.userId, orgId: actor.orgId }, { kind: 'rehearsal', goal: input.goal });

  return {
    plan: { steps: doc.steps.map((s) => ({ stepId: s.id, description: s.description, tool: s.type })), status: 'ok' },
    automation: toWireAutomation(doc),
    runId,
    rehearsing: true,
    ...(minted?.minted
      ? { integration: { key: minted.integrationKey, actionName: minted.actionName } }
      : minted
        ? { integrationSkipped: minted.reason }
        : {}),
  };
}

// ============================================================================
// Runs
// ============================================================================

/**
 * Register a run's signals + persist an initial `running` record synchronously (§5.2 step 1-2:
 * register first, respond early), then fire the engine async. The engine re-inserts the same run id
 * (a dup no-op) and takes over the record. Returns the pre-minted run id.
 */
async function startRunInternal(
  automationId: string,
  owner: { userId: string; orgId: string },
  opts: { kind: 'normal' | 'rehearsal'; inputs?: Record<string, unknown>; goal?: string; runId?: string },
): Promise<string> {
  // The id may be pre-minted by the caller (the idempotent create records the mapping BEFORE the
  // run exists, so it must know the id first). Absent → mint here, exactly as before.
  const runId = opts.runId ?? randomUUID();
  const sig: RunSignals = {
    ownerUserId: owner.userId,
    orgId: owner.orgId,
    cancelled: false,
    resumeFlag: false,
    runApprovedShapes: new Set<string>(),
  };
  signals.set(runId, sig);

  const initial: StoredRun = {
    id: runId,
    automationId,
    startedAt: new Date().toISOString(),
    status: 'running',
    // CREDENTIAL BOUNDARY (§5.6.7): the register-first insert persists the row BEFORE the engine
    // runs, and the engine's later insert is a duplicate no-op — so THIS write is the one that
    // sticks. Scrub credentials here too, never only in the engine (Codex round-2).
    inputs: scrubCredentials(opts.inputs ?? {}),
    steps: [],
    triggeredBy: 'user',
    ownerUserId: owner.userId,
    orgId: owner.orgId,
    kind: opts.kind,
  };
  await automationRuns.insert({ _id: runId, ...initial } as never);

  const ctx = makeCtx(runId, sig);
  const emit = runEventEmitterFactory(runId); // the run's SSE stream (bound at the composition root)
  const run = opts.kind === 'rehearsal'
    ? rehearseAutomation(automationId, ctx, { runId, ...(emit ? { emit } : {}), ...(opts.goal ? { goal: opts.goal } : {}), ...(opts.inputs ? { inputs: opts.inputs } : {}) })
    : runAutomation(automationId, ctx, { runId, ...(emit ? { emit } : {}), ...(opts.inputs ? { inputs: opts.inputs } : {}) });
  void run.catch(() => undefined).finally(() => signals.delete(runId));
  return runId;
}

/** Run-create input (the shared RunCreateRequest, plus nothing else). */
export interface RunCreateInput {
  inputs?: Record<string, unknown>;
  /** Slice E4: makes the create at-most-once for (automation, run owner, key). */
  idempotencyKey?: string;
}

/**
 * Per-call context the ROUTE knows and the Actor does not: which credential admitted the call, and
 * the caller's username for the audit row. Trace only — nothing here is ever branched on
 * (Capability Contract rule 3: `x-client` is read into the audit principal and never read again).
 */
export interface RunCreateCallContext {
  /** Present ONLY when a gateway key admitted the call (res.locals.apiKeyPrincipal). */
  principal?: { keyId: string; xClient?: string };
  /** Registo username (the shared Actor type does not carry one). */
  username?: string;
}

export interface RunCreateOutcome {
  runId: string;
  /** false = an idempotent replay: this run already existed and NOTHING was started. */
  created: boolean;
}

/** How many times a keyed create may re-attempt its dedupe claim before failing closed. Each
 *  extra attempt only happens when a concurrent caller rolled ITS mapping back mid-flight. */
const RUN_CLAIM_ATTEMPTS = 5;

/**
 * The dedupe document id: sha256 over the automation, the RUN OWNER, and the caller's key.
 *
 * All three matter. Without the automation two different automations share a key; without the
 * owner one tenant's key collides with another's (and could hand back a run they may not even
 * see); without the key there is no idempotency at all.
 *
 * The three components are JSON-ENCODED, not `|`-joined. A separator-joined string is only
 * injective if no component can contain the separator, and that premise was false: an
 * integration-provisioned automation's id is `${integrationKey}-${templateKey}`
 * (integration-automations.ts), not a UUID, so the "both ids are server-minted UUIDs" argument did
 * not hold (E4 review finding 5). JSON.stringify escapes quotes and backslashes, which makes the
 * encoding injective for ANY three strings — no assumption about their alphabets survives here.
 */
function runDedupeId(automationId: string, ownerUserId: string, key: string): string {
  return createHash('sha256').update(JSON.stringify([automationId, ownerUserId, key])).digest('hex');
}

/**
 * One audit row per KEY-ADMITTED run create, carrying the keyId and the trace-only `x-client`.
 * Written BEFORE the engine is fired, so nothing reaches the caller unaudited (the memvault
 * discipline). JWT-admitted creates are unchanged — the dashboard drives this same endpoint and
 * this slice does not alter its behaviour.
 */
async function auditRunCreate(
  actor: Actor,
  call: RunCreateCallContext,
  meta: { automationId: string; runId: string; idempotent: boolean },
): Promise<void> {
  if (!call.principal) return;
  await logActivity(
    { userId: actor.userId, username: call.username ?? actor.userId, orgId: actor.orgId },
    'automations',
    'automation_run_create',
    { now: () => Date.now(), genId: () => randomUUID() },
    {
      automationId: meta.automationId,
      runId: meta.runId,
      idempotent: meta.idempotent,
      keyId: call.principal.keyId,
      ...(call.principal.xClient ? { xClient: call.principal.xClient } : {}),
    },
  );
}

/**
 * Start a run. With no `idempotencyKey` the behaviour is exactly as it always was: a fresh run per
 * call (`created: true` → the route's 202).
 *
 * With a key, the create is AT-MOST-ONCE for (automation, run owner, key):
 *   1. authorize (an unauthorized caller must never be able to plant a mapping),
 *   2. INSERT the mapping first, on a deterministic `_id` — the duplicate-key refusal is what
 *      settles a concurrent race, so the loser of two simultaneous POSTs reads the winner's runId
 *      instead of starting a second run,
 *   3. only then create the run.
 *
 * A DUPLICATE ANSWERS THE MAPPING, ALWAYS — it is never re-validated against the runs store. If
 * the run is gone (deleted, reaped, or a mid-flight failure), the honest answer is still "this key
 * was already accepted, and this is the run it named": `GET /runs/:id` then 404s and the caller
 * knows. Re-creating instead would resurrect exactly the double execution the key exists to
 * prevent — a client retrying a POST cannot be told apart from one whose run was deleted.
 *
 * The one case that DOES roll the mapping back is a run that never started at all (the audit or the
 * run-row insert threw): there is nothing to be idempotent about, and leaving the mapping would
 * poison the key permanently.
 *
 * THE TWO INTERACT, AND THE LOSER CAN BE HANDED A RUN THAT NEVER EXISTED (E4 review finding 3).
 * Ordering: A claims the mapping → B is refused, reads it, answers 200 with A's runId → A's own
 * start throws and rolls the mapping back. B now holds a runId whose run does not exist and never
 * will. The condition is self-healing — the key is free again, so B's retry with the SAME key
 * starts a real run — but a client must not treat 200 as "definitely accepted, just poll it": a
 * 404 from the following `GET /runs/:id` means the create did not take, and the correct response
 * is to POST again with the same key. That is stated on the wire contract too
 * (shared/src/automations.ts RunCreateRequest), because a client cannot infer it.
 *
 * WHAT NEVER HAPPENS IS PROCEEDING UNCLAIMED. If the store keeps refusing the claim while also
 * reporting no mapping, the call FAILS (IDEMPOTENCY_UNRESOLVED) instead of starting a run with no
 * dedupe row — an unrecorded run would let the next retry start a second one, which is the exact
 * thing the key exists to prevent (E4 review finding 2).
 */
export async function startRun(
  actor: Actor,
  id: string,
  input: RunCreateInput = {},
  call: RunCreateCallContext = {},
): Promise<RunCreateOutcome> {
  const automation = (await automations.get(id)) as StoredAutomation | null;
  if (!automation || !canReadAutomation(automation, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
  // A user run must be owned by the actor (the engine's ownership guard); a super-admin runs it as
  // the automation's owner (server-trusted).
  let owner: { userId: string; orgId: string };
  if (automation.ownerUserId === actor.userId) owner = { userId: actor.userId, orgId: actor.orgId };
  else if (actor.role === 'super-admin') owner = { userId: automation.ownerUserId, orgId: automation.orgId };
  else throw new AutomationServiceError('FORBIDDEN', 'not authorized to run this automation');

  const key = input.idempotencyKey;
  const runId = randomUUID();
  const dedupeId = key ? runDedupeId(id, owner.userId, key) : undefined;

  let claimed = dedupeId === undefined;
  if (dedupeId) {
    // Retry, because a refusal followed by a MISSING mapping means a concurrent caller rolled its
    // own mapping back (its run never started) in the window between our insert and our read.
    // Re-claiming keeps the guarantee for this key. The loop NEVER falls through unclaimed: an
    // unrecorded run would let the next retry start a second one.
    for (let attempt = 0; attempt < RUN_CLAIM_ATTEMPTS && !claimed; attempt += 1) {
      claimed = await automationRunIdempotency.insert({ _id: dedupeId, runId, at: new Date().toISOString() });
      if (claimed) break;
      const existing = await automationRunIdempotency.get(dedupeId);
      if (existing) {
        await auditRunCreate(actor, call, { automationId: id, runId: existing.runId, idempotent: true });
        return { runId: existing.runId, created: false };
      }
    }
    if (!claimed) {
      // Refused as a duplicate AND absent, every attempt: the store is contradicting itself (or a
      // pathological rollback storm). FAIL CLOSED — nothing started, no row written, and the same
      // key is safe to retry.
      console.error(`[automations] idempotency claim unresolved after ${RUN_CLAIM_ATTEMPTS} attempts (automation=${id})`);
      throw new AutomationServiceError('IDEMPOTENCY_UNRESOLVED', 'could not establish the idempotency claim');
    }
  }

  try {
    // Audited BEFORE the engine is fired: nothing reaches the caller unaudited (the memvault
    // discipline), and a failed audit rolls the mapping back with the run it never started.
    await auditRunCreate(actor, call, { automationId: id, runId, idempotent: false });
    await startRunInternal(id, owner, { kind: 'normal', runId, ...(input.inputs ? { inputs: input.inputs } : {}) });
  } catch (err) {
    // Nothing started → the mapping must not survive to answer a retry with a run that will never
    // exist. Best effort: a failed rollback is strictly better than a failed start going unreported.
    if (dedupeId && claimed) await automationRunIdempotency.delete(dedupeId).catch(() => false);
    throw err;
  }
  return { runId, created: true };
}

export async function listRuns(actor: Actor, query: { automationId?: string; limit?: number } = {}): Promise<WireRunRecord[]> {
  const filter: Record<string, unknown> = {};
  if (actor.role !== 'super-admin') filter.orgId = actor.orgId;
  if (query.automationId) filter.automationId = query.automationId;
  // Builders see only their own runs; org-admins/super-admins see the org's.
  if (!isAdmin(actor)) filter.ownerUserId = actor.userId;
  const rows = (await automationRuns.find(filter, { startedAt: -1 })) as unknown as StoredRun[];
  const limited = typeof query.limit === 'number' ? rows.slice(0, query.limit) : rows;
  return limited.map(toWireRun);
}

export async function getRunRecord(actor: Actor, runId: string): Promise<WireRunRecord> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  if (!run || !canSeeRun(run, actor)) throw new AutomationServiceError('NOT_FOUND', 'run not found');
  return toWireRun(run);
}

/**
 * Per-step logs for one run (slice E4). Visibility is EXACTLY `getRunRecord`'s — the same
 * `canSeeRun` predicate, the same uniform NOT_FOUND for a missing run and for another tenant's
 * run, so the logs endpoint can never become an existence oracle the run endpoint is not.
 *
 * The response is bounded by construction (persistence.runLogsFromSteps re-applies the per-step
 * and per-run caps to whatever is on disk), so a 5 MB captured stdout cannot become a 5 MB body.
 */
export async function getRunLogs(actor: Actor, runId: string): Promise<WireRunLogsResponse> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  if (!run || !canSeeRun(run, actor)) throw new AutomationServiceError('NOT_FOUND', 'run not found');
  return { runId: run.id, steps: runLogsFromSteps(Array.isArray(run.steps) ? run.steps : []) };
}

/** Owner-scoped idempotent cancel (§5.3.1). Cancelling a terminal/unknown/unauthorized run is a
 *  no-op → `{ cancelled: false }`. */
export async function cancelRun(actor: Actor, runId: string): Promise<{ cancelled: boolean }> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  if (!run || !isRunOwner(run, actor)) return { cancelled: false };
  const sig = signals.get(runId);
  // Un-park it first: a cancelled run must not be woken later by an unrelated Cofre mint. The
  // re-dispatcher re-checks the row and would refuse anyway, so this is hygiene rather than a gate.
  clearCredentialWaiter(runId);
  if (!sig || sig.cancelled) return { cancelled: false };
  sig.cancelled = true; // engine observes this at the next loop check / resume poll
  return { cancelled: true };
}

/**
 * Resume a halted run. Two mechanisms behind one owner-scoped door, because they are two genuinely
 * different halts and the caller should not have to know which one it is looking at:
 *
 *   - `paused_for_user` — the engine process is ALIVE, blocked in `waitForResumeOrCancel` polling
 *     `resumeFlag`. Flipping the flag is the whole resume. No signals, no live process, no resume.
 *   - `needs_credentials` — the engine process is GONE. The run halted and returned, and its state
 *     lives only in the store. Resuming means DISPATCHING it again from the step that stopped it,
 *     which is why this branch does not touch `resumeFlag` at all: there is nobody to signal.
 *
 * A run in any other status is a no-op, as before. Idempotent in both directions: a second call for
 * an already-resumed credential halt sees a `running` row and answers false rather than starting a
 * duplicate engine pass.
 */
export async function resumeRun(actor: Actor, runId: string): Promise<{ resumed: boolean }> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  if (!run || !isRunOwner(run, actor)) return { resumed: false };

  if (run.status === 'needs_credentials') {
    return { resumed: await dispatchCredentialResume(run) };
  }

  const sig = signals.get(runId);
  if (!sig || run.status !== 'paused_for_user') return { resumed: false };
  sig.resumeFlag = true;
  return { resumed: true };
}

/**
 * Re-dispatch a run parked in `needs_credentials`, from the step that parked it.
 *
 * THE OBSERVER'S HALF of the resume (P3.1). Bound at the composition root as the
 * `CredentialResumeDriver`, so a Cofre mint reaches it without `cofre/` ever importing
 * `automation/`. It re-reads the run rather than trusting the caller: the registry is process-local
 * and best-effort, so "this run is waiting" must be re-established from the durable row before
 * anything starts, or a stale waiter could re-run a run that already completed.
 *
 * FIRE-AND-FORGET on purpose. It is called from inside a Cofre mint; making that mint wait for an
 * automation to finish would be an unrelated latency (and an unrelated failure) on the path where a
 * user just typed a password.
 */
export function redispatchRunAwaitingCredentials(runId: string): void {
  void (async () => {
    const run = (await automationRuns.get(runId)) as StoredRun | null;
    if (!run || run.status !== 'needs_credentials') return;
    await dispatchCredentialResume(run);
  })().catch(() => undefined);
}

/**
 * The shared body: restart `run` at its halted step. Answers false when the run does not carry
 * enough to be resumed, which is the honest outcome for a row written before this state existed.
 */
async function dispatchCredentialResume(run: StoredRun): Promise<boolean> {
  const owner = run.ownerUserId;
  const orgId = run.orgId;
  if (!owner || !orgId) return false;
  // WHERE THE NEW PASS STARTS. `stepIndex` names the step the HUMAN was told about; the optional
  // `resumeFromStepIndex` names where the run can actually pick up, and the two differ for exactly
  // one halt - the ad-hoc adversarial one, which fires mid-run on a page that is gone by the time
  // anyone answers it (docs/decisions.md 2026-08-24, D-ADHOC-5). Falling back to `stepIndex` keeps
  // every gate-raised halt, and every row written before this field existed, exactly as it was.
  const resumeFrom = run.credentialRequest?.resumeFromStepIndex ?? run.credentialRequest?.stepIndex ?? 0;

  // THE CLAIM, and it is not decoration. Resume is driven from TWO independent places by design —
  // the server-side observer and the client's own call after it unlocks a credential — and they
  // routinely fire within milliseconds of each other on the same mint. Both would read a
  // `needs_credentials` row and both would dispatch, running two engine passes over one run id:
  // duplicated step effects, and two writers racing the same record. A live signal set IS the "a
  // pass is already in flight" fact (it is created here and deleted only when that pass returns),
  // and both legs run in this process, so claiming it before anything starts is enough. The
  // persisted flip to `running` happens inside the engine; this closes the window before it.
  if (signals.has(run.id)) return false;

  // A fresh signal set for the new pass: the old one was deleted when the halted run returned.
  const sig: RunSignals = {
    ownerUserId: owner,
    orgId,
    cancelled: false,
    resumeFlag: false,
    runApprovedShapes: new Set<string>(),
  };
  signals.set(run.id, sig);
  clearCredentialWaiter(run.id);

  const ctx = makeCtx(run.id, sig);
  // The halted run's own non-secret config, back onto the new pass's context: `{{config.…}}` must
  // mean on resume exactly what it meant on the pass that halted (found live, 2026-09-01 - the
  // resumed navigate had lost the tenant's portal address and failed on the no-destination guard).
  if (run.configValues) ctx.configValues = run.configValues;
  const emit = runEventEmitterFactory(run.id);
  // `run.inputs` is the PERSISTED copy, so it has already been through `scrubCredentials` — the
  // resumed run starts with no `inputs.credentials`. That is correct rather than lossy: the reason
  // this run halted is that the credential was missing, and the credential gate re-establishes the
  // session from the Cofre on the way back in. A resumed run must never depend on a decrypted bag
  // that was only ever in the memory of a process that has since returned.
  const started = runAutomation(run.automationId, ctx, {
    runId: run.id,
    resumeFromStepIndex: resumeFrom,
    ...(emit ? { emit } : {}),
    ...(run.inputs ? { inputs: run.inputs } : {}),
  });
  // K3 (D-CORNERSTONE-LEARN-ON-RESUME): the resumed pass runs UNINSTRUMENTED - the engine has no
  // learn concept, and threading capture through the resume was rejected as the riskiest surface.
  // Instead, when the resumed pass COMPLETES and the parked row carried the storable action's
  // identity, one background learn-armed re-execution goes back through the full executor rail
  // (the seam is `executeUserIntegrationAction` at the composition root), where replay-first,
  // consent, capture and learnFromRun run exactly as on any other execution. Reads only by
  // construction (`actionRetry` is stamped only for storable actions). Every failure is swallowed:
  // this is a learning by-product riding a fire-and-forget resume, never a second failure mode.
  void started
    .then(async (result) => {
      // Widened like runAutomationForAction's own gate: engine RunStatus has no 'succeeded', but
      // the action rail accepts both spellings, and this gate must not be narrower than that one.
      const finalStatus: string = result.status;
      if (finalStatus !== 'completed' && finalStatus !== 'succeeded') return;
      // RE-READ, never the closure row (adversarial-review finding): the `actionRetry` stamp is
      // written AFTER the engine's halt returns (the engine persists the halt, parks the waiter and
      // emits before resolving, then the action mount stamps), so a ceremony completed inside that
      // window re-dispatched off a row read BEFORE the stamp landed - and the learn silently never
      // fired on exactly the first-contact flow it exists for. The fresh read closes the window.
      const fresh = (await automationRuns.get(run.id)) as StoredRun | null;
      const retry = fresh?.actionRetry;
      const driver = resumeLearnDriver();
      if (!retry || !driver) return;
      await driver({
        orgId,
        ownerUserId: owner,
        integrationKey: retry.integrationKey,
        actionName: retry.actionName,
        args: retry.args ?? {},
      });
    })
    .catch(() => undefined)
    .finally(() => signals.delete(run.id));
  return true;
}

/** Resolve first-time consent for a local_command shape (once / always / stop). 'always' persists
 *  the shape to the approved-commands store; 'stop' cancels the run. */
export async function resolveConsent(
  actor: Actor,
  runId: string,
  input: { decision: 'once' | 'always' | 'stop'; shape: string },
): Promise<WireConsentResult> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  if (!run) throw new AutomationServiceError('NOT_FOUND', 'run not found');
  if (!isRunOwner(run, actor)) throw new AutomationServiceError('FORBIDDEN', 'not authorized for this run');
  const sig = signals.get(runId);
  const ownerUserId = run.ownerUserId ?? actor.userId;

  if (input.decision === 'stop') {
    if (sig) sig.cancelled = true;
    return { decision: 'stop', resumed: false, persisted: false };
  }
  // A standing approval must be bound to the shape the run is ACTUALLY awaiting, not to one the
  // caller supplies. Checking only `status === 'awaiting_consent'` let a caller bank an approval
  // for a shape the user was never shown: no prompt, no SSE event, nothing in the UI, and a later
  // local_command matching it then runs unprompted. That is the same class command-shape.ts says
  // it closed from the other end (over-generalising an approval the user DID grant); this is the
  // inverse — granting one they never saw. `signals` is in-memory, so a run left awaiting_consent
  // by a restart would otherwise be a permanent injection window in the durable store.
  const pendingShape = run.consentRequest?.shape;
  const awaitingConsent = run.status === 'awaiting_consent' && !!pendingShape;
  let persisted = false;
  // The shape check binds BOTH surviving answers, not just the durable one — `stop` already
  // returned above. A mismatched `once` is the same caller-supplied shape with a shorter blast
  // radius, and letting it through would leave the cheaper half of the hole open.
  if (awaitingConsent && input.shape !== pendingShape) {
    throw new AutomationServiceError(
      'FORBIDDEN',
      'consent shape does not match the shape this run is awaiting',
    );
  }
  // "Permitir uma vez": approve for THIS RUN and nothing more. It persists nothing (that is the
  // point) but it must still be RECORDED somewhere the re-run can see, or the step re-checks the
  // durable store, finds nothing, and asks again — the loop this closes. The record dies with the
  // run, so a restart re-asks, which is the safe direction to fail.
  if (input.decision === 'once' && awaitingConsent && sig) {
    sig.runApprovedShapes.add(input.shape);
  }
  if (input.decision === 'always' && awaitingConsent) {
    // Bank it in the scope the RUN recorded when it asked — not one re-derived here. J-7 keys an
    // approval on owner + org + machine, and the executor looks it up with the connected daemon's
    // real `pairingId`; writing `pairingId: null` from this side stored a row that lookup could
    // never read, so "approve always" re-prompted forever on any machine actually able to run the
    // command. The fallback keeps a run that paused before `approvalScope` existed resolvable.
    await approveCommandShape(
      run.consentRequest?.approvalScope ?? {
        userId: ownerUserId,
        orgId: run.orgId ?? actor.orgId,
        pairingId: null,
      },
      input.shape,
    );
    persisted = true;
  }
  const resumed = !!sig;
  if (sig) sig.resumeFlag = true;
  return { decision: input.decision, resumed, persisted };
}

// ============================================================================
// Step feedback (§5.6.7, §11.6): evict fingerprint-matched cache + maybe a correction memory
// ============================================================================

export async function submitStepFeedback(
  actor: Actor,
  runId: string,
  stepId: string,
  input: { kind: string; note?: string },
): Promise<WireStepFeedbackResponse> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  // Owner-scoped: step feedback evicts the owner's cache entries and may write a correction memory
  // into the owner's memory (§5.6.7, §11.6), so an org-admin must not drive another member's memory.
  if (!run || !isRunOwner(run, actor)) throw new AutomationServiceError('NOT_FOUND', 'run not found');
  const step = run.steps.find((s) => s.stepId === stepId);
  if (!step) throw new AutomationServiceError('NOT_FOUND', 'step not found');

  let evicted = false;
  const negative = input.kind === 'thumbs_down' || input.kind === 'correction';
  if (negative && step.fingerprint) {
    const removed = await evictCacheForFingerprint(run.automationId, stepId, step.fingerprint, actor);
    evicted = removed.actionsRemoved + removed.assertionsRemoved > 0;
  }

  // Deterministic correction-memory writer (no model call): a correction note becomes a
  // user-correction memory tagged to the automation, so future planning/injection can learn from it.
  if (input.kind === 'correction' && input.note && input.note.trim().length > 0) {
    const deps = { now: () => Date.now(), genId: () => randomUUID() };
    await createMemory(
      actor,
      {
        title: `Automation correction: ${stepId}`,
        content: input.note.trim(),
        type: 'user-correction',
        tags: [`automation:${run.automationId}`, `step:${stepId}`, 'user-correction'],
        tier: 'active',
        visibility: 'private',
      },
      deps,
    ).catch(() => undefined);
  }

  // Record the feedback on the step (best-effort).
  await automationRuns.update(runId, (cur) => {
    const steps = ((cur as unknown as StoredRun).steps ?? []).map((s) =>
      s.stepId === stepId ? { ...s, feedback: { kind: input.kind, note: input.note, submittedAt: new Date().toISOString() } } : s,
    );
    return { ...cur, steps } as never;
  }).catch(() => null);

  return { ok: true, evicted };
}

// ============================================================================
// Catalog + approved commands
// ============================================================================

/** Private gate: subsumed. `buildAutomationCatalog` queries `{ ownerUserId }` (catalog.ts), so the
 *  catalog is already strictly owner-only — a stricter scope than the private gate, for every
 *  role including super-admin (the flag it takes widens only integration/ekoa actions). */
export async function buildCatalog(actor: Actor): Promise<WireCatalogResponse> {
  const catalog = await buildAutomationCatalog(actor);
  return {
    automations: catalog.automations.map((a) => ({ key: a.id, name: a.name, ...(a.description ? { description: a.description } : {}), type: 'automation' })),
    integrationActions: catalog.integrationActions.map((e) => ({ key: `${e.integrationKey}.${e.actionName}`, name: `${e.integrationKey}.${e.actionName}`, ...(e.description ? { description: e.description } : {}), type: 'integration-action' })),
  };
}

export async function listApprovedCommands(actor: Actor): Promise<WireApprovedCommand[]> {
  const rows = await listApprovedCommandRecords(actor.userId);
  return rows.map((r) => ({ shape: r.shape, ...(r.createdAt ? { createdAt: r.createdAt } : {}) }));
}

export async function revokeApprovedCommand(actor: Actor, input: { shape: string }): Promise<WireRevokeResponse> {
  const revoked = await revokeCommandShape({ userId: actor.userId, orgId: actor.orgId }, input.shape);
  const remaining = (await listApprovedShapes(actor.userId)).length;
  return { revoked, remaining };
}

// ============================================================================
// Trigger delivery entry (bound at the composition root to the events/ pipeline)
// ============================================================================

export interface TriggerRunInput {
  automationId: string;
  /** Server-trusted owner (from the trigger record, NEVER the inbound payload — §5.6.7). */
  ownerUserId: string;
  orgId: string;
  triggeredBy: 'webhook' | 'listener' | 'schedule';
  /** The trigger event payload; steps read it as {{event.*}}. */
  event?: RunContext['triggerEvent'];
  inputs?: Record<string, unknown>;
}

export interface TriggerRunOutcome {
  /**
   * THREE outcomes, because "not completed" was hiding two different things (P4.1).
   *
   * `blocked` is a run that stopped ON PURPOSE, waiting for its owner: a browser step whose origin
   * is bridge-only with no machine connected (`awaiting_daemon`), an action awaiting a standing
   * approval (`awaiting_consent`), or a credential only a person can establish
   * (`needs_credentials`) - the three of `BLOCKED_RUN_STATUSES`. Nothing about any of them is
   * retryable by a machine, and calling them `failed` was actively harmful on the schedule rail -
   * twenty nights with the laptop shut would auto-pause a perfectly good schedule
   * (`FAILURE_CEILING`), and the owner would find it disabled rather than waiting.
   */
  outcome: 'completed' | 'failed' | 'blocked';
  /**
   * WHICH block, verbatim: the run status that produced it. Load-bearing, not a label - the
   * blocked causes get OPPOSITE treatment on the schedule rail (`schedules/supervisor.ts`, where
   * only `awaiting_daemon` is in `NEUTRAL_BLOCKED_CODES`), and collapsing them to one word is what
   * removed the cap on repeated unattended logins. Present only for `outcome: 'blocked'`.
   */
  code?: string;
  /** A permanent failure (e.g. the automation no longer exists) must NOT be retried by the delivery
   *  pipeline; a transient one re-enters the retry schedule. */
  permanent: boolean;
  runId?: string;
}

/**
 * Run statuses that mean "waiting for the owner", not "failed".
 *
 * All three are halts the engine takes DELIBERATELY and persists, and all three are resolved by a
 * person doing something - starting their machine, approving an action, establishing a credential -
 * rather than by anything retrying. Every other non-`completed` status stays a failure.
 *
 * They are NOT interchangeable downstream, which is why `code` carries which one it was: waiting
 * for a machine resolves by itself the moment the laptop is opened, and waiting for a credential or
 * an approval does not resolve by waiting at all.
 *
 * `awaiting_consent` WAS MISSING, and the omission was visible to users. The same halt already
 * reports `blocked` from the OTHER schedule target kind - `mapIntegrationOutcome`
 * (`schedules/supervisor.ts`) answers `status: 'blocked', code: 'awaiting_consent'` for an
 * integration action, the schedules surface carries copy for that code, and the supervisor's own
 * docblock lists `awaiting_consent` beside `needs_credentials` as a block on a human act. Only the
 * AUTOMATION rail disagreed: a scheduled automation halting for first-time `local_command` consent
 * came back `failed`, and the owner's badge read "Failed" for a run sitting waiting on their
 * approval. Including it costs nothing on the ceiling - `awaiting_consent` is deliberately NOT in
 * `NEUTRAL_BLOCKED_CODES`, so it still counts and still auto-pauses - and what changes is that the
 * two rails now say the same word about the same halt.
 */
const BLOCKED_RUN_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_daemon',
  'awaiting_consent',
  'needs_credentials',
]);

/**
 * Run an automation under a trigger's server-trusted owner and AWAIT its terminal status. A
 * non-`completed` terminal state is reported as a delivery failure EXCEPT the three that mean "this
 * is waiting for you" (`BLOCKED_RUN_STATUSES`), which report `blocked` plus the status as `code`; a
 * missing automation is a PERMANENT failure (never retried). The engine runs one attempt - retry
 * lives in `events/`.
 */
export async function startRunForTrigger(input: TriggerRunInput): Promise<TriggerRunOutcome> {
  // Delivery-side cross-org guard (Codex G8, defense-in-depth alongside the trigger-creation check):
  // the engine skips the owner check for triggered runs, so verify HERE that the target automation
  // belongs to the trigger owner's org. A foreign/unknown automation is a PERMANENT failure — never
  // executed, never retried.
  const target = (await automations.get(input.automationId)) as StoredAutomation | null;
  if (!target || target.orgId !== input.orgId) {
    return { outcome: 'failed', permanent: true };
  }
  // The private gate reaches the DELIVERY path too. Trigger creation validates its target through
  // `getAutomation` (routes/triggers.ts), so it is already gated — but the trigger record OUTLIVES
  // that check: the automation can be flipped to private afterwards, and the engine deliberately
  // skips its owner check for non-user runs. Without this, a stale trigger would keep executing
  // (and streaming) another member's private automation under a server-trusted owner. The trigger
  // owner is judged as a plain member; a private automation that is not theirs is a PERMANENT
  // failure — the delivery pipeline must not retry an authorization refusal.
  if (!isVisibleTo(target, { userId: input.ownerUserId })) {
    return { outcome: 'failed', permanent: true };
  }
  const ctx: RunContext = {
    ownerUserId: input.ownerUserId,
    orgId: input.orgId,
    triggeredBy: input.triggeredBy,
    visitedAutomationIds: new Set(),
    traceId: randomUUID(),
    ...(input.event ? { triggerEvent: input.event } : {}),
  };
  try {
    const runId = randomUUID();
    const emit = runEventEmitterFactory(runId); // trigger runs stream too (§3.6.3)
    const result = await runAutomation(input.automationId, ctx, { runId, ...(emit ? { emit } : {}), ...(input.inputs ? { inputs: input.inputs } : {}) });
    const outcome: TriggerRunOutcome['outcome'] = result.status === 'completed'
      ? 'completed'
      : BLOCKED_RUN_STATUSES.has(result.status)
        ? 'blocked'
        : 'failed';
    return {
      outcome,
      ...(outcome === 'blocked' ? { code: result.status } : {}),
      permanent: false,
      runId: result.runId,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing automation is permanent (the delivery pipeline must not retry it).
    const permanent = /automation not found/i.test(message);
    return { outcome: 'failed', permanent };
  }
}

// --- Automation-backed integration actions (integração-por-automação; carried B25) -----------

/**
 * How many captured exchanges ONE RUN may hold in this process before the oldest are dropped.
 *
 * The machine bounds its recorder per LEASE at 400 (`clients/bridge/src/browser/capture.ts`) and
 * drains onto every frame, so without a bound here a run of N browser steps could accumulate N*400
 * exchanges of up to ~128KB each - inside the API process every tenant shares. Generous against the
 * compile, which distils at most `MAX_COMPILED_CALLS` distinct calls out of whatever it is handed.
 */
export const MAX_RUN_CAPTURED_EXCHANGES = 400;

/**
 * How many evidence documents one learn may write. The evidence is what a human reads next to the
 * recipe, and a recipe is at most `MAX_COMPILED_CALLS` calls; twice that leaves room for the
 * repeats (a paginated list, a retried call) that explain what the compile deduplicated, and still
 * bounds one pass to a few dozen documents rather than one per request a heavy page made.
 */
export const MAX_PERSISTED_EVIDENCE = MAX_COMPILED_CALLS * 2;

export interface ActionRunBinding {
  /**
   * The id the PACKAGE declares. On a shipped package this is a placeholder its author wrote
   * (`citius-notificacoes-template`) and is not the id of anything - see `automationTemplate`.
   */
  automationId: string;
  /**
   * The package template this binding names, when it names one (`IntegrationActionAutomationBinding
   * .automationTemplate`). Present ⇒ the real row is found by PROVENANCE for this org, because the
   * id above is a placeholder; `resolveBoundAutomation` is the one place that join happens. Absent
   * ⇒ the binding names a real automation directly (a builder-authored action) and the id is used
   * as-is, which is byte-for-byte the behaviour that predates this field.
   */
  automationTemplate?: string;
  /** Maps automationInputName -> argKey; absent = pass args through. */
  argMap?: Record<string, string>;
  /** Nest the action's decrypted credential fields under `inputs.credentials`. */
  passCredentials?: boolean;
}

export interface ActionRunInput {
  binding: ActionRunBinding;
  args: Record<string, unknown>;
  credentialFields: Record<string, unknown>;
  orgId: string;
  ownerUserId: string;
  /**
   * The integration's NON-SECRET config projection (`IntegrationConfig.publicConfigValues`), passed
   * to the engine as `RunContext.configValues` so a template can read `{{config.<key>}}`.
   *
   * A package declares a `configSchema` and the tenant fills it in; nothing on the automation path
   * read those values, so a per-tenant address field like the citius package's `portal_url` was
   * inert. Optional at the seam (Rule 7 additive): a caller that omits it leaves every
   * `{{config.…}}` reference resolving to the empty string, which is what it resolved to before.
   */
  configValues?: Record<string, string>;
  /** Which action asked (slice P2). Present ⇒ its compiled recipe is tried before the automation
   *  runs, and the run that does happen is instrumented so the action can learn one. Absent ⇒
   *  exactly the pre-P2 behaviour: straight to the automation, learning nothing. */
  integrationKey?: string;
  actionName?: string;
  /**
   * The owner's answer to THIS action's write approval, as `integrations/action-consent.ts` gave
   * it - `true` only when a human actually approved a mutating action, never for a read that
   * simply was not gated.
   *
   * It is the KEY to the replay's write gate. Without it that gate has no way to ever open, which
   * is not a gate: it is a permanent refusal that a reviewer reads as protection.
   */
  writeAssent?: boolean;
  /**
   * THE ACTION'S DECLARED EFFECT (`IntegrationAction.mutates`).
   *
   * It answers a question `writeAssent` cannot: does this action write at all. A discovery pass over
   * a WRITE action routinely compiles only the reads it happened to watch underneath it - the write
   * itself may be a form post, a non-JSON response, or a login-shaped body the compile drops. Storing
   * that read-only recipe would make every later run replay the reads, answer `ok` and report SUCCESS
   * while the write never happened. So the learn refuses to compile one, and the replay refuses to
   * run one (`does-not-cover`), and the action goes on writing by its authored steps.
   *
   * OPTIONAL AT THE SEAM, DEFINITE INSIDE IT (Rule 7 additive). A caller that predates the field
   * leaves it absent, and this function reads that the way the rest of the repo reads `mutates`:
   * ONLY A LITERAL `false` IS A READ (`integrations/action-consent.ts`, `actionRequiresConsent`).
   * Absent, `"false"`, `0`, `null` - every one of those is a WRITE here, which costs a caller that
   * cannot say the OPTIMISATION and never the correctness: the action still runs its authored steps.
   * The normalisation happens once, at the top of `runAutomationForAction`, and everything below is
   * handed a definite boolean.
   */
  mutates?: boolean;
}

export interface ActionRunResult {
  success: boolean;
  /** `needs_credentials` (additive, cornerstone K2): the engine run is PARKED awaiting a credential
   *  ceremony, not failed - the run/SSE plane carries the ceremony UX; this code lets the ACTION
   *  surface and the schedules supervisor tell the two apart (the old flattening to
   *  `automation_failed` is the ledgered finding
   *  `needs-credentials-halt-flattens-to-automation-failed-at-the-action-surface`). */
  code?: 'unknown_automation' | 'forbidden' | 'automation_failed' | 'awaiting_consent' | 'needs_credentials';
  error?: string;
  data?: unknown;
}

/**
 * THE ONE ENVELOPE an automation-backed action answers in - from BOTH legs of this function.
 *
 * A replay must be indistinguishable from the run it replaces, and the envelope is the first thing
 * a consumer touches. The replay leg used to answer `{replayed, recipeVersion, output}` while the
 * automation leg answered `{runId, status, summary, output}`, and the consumers are written against
 * the second: `integrations/event-sources/user-defined-poll.ts` unwraps `output` only when it sees
 * BOTH a string `runId` and a string `status`, so a replayed poll resolved the package's
 * `listenerConfig` paths against the ENVELOPE instead of the action's output - every path read
 * `undefined`, the listener adopted no cursor and reported an empty provider, forever (nothing
 * clears a recipe that keeps succeeding). That is the silent-empty failure mode that module exists
 * to avoid, reached by the one path it could not see.
 *
 * So there is one shape and one constructor, and the two legs differ only in the fields that say
 * WHICH leg ran.
 */
export interface ActionRunEnvelope {
  /**
   * The execution this answer came from. An automation run's id on the automation leg; on the
   * replay leg the `replay-…` id the replay's own browser lease and daemon frames are ledgered
   * under - so it names something real either way. The prefix is what distinguishes them: there is
   * no `automationRuns` document behind a replay, because no engine run happened.
   */
  runId: string;
  status: string;
  summary?: string;
  /** The action's OWN answer - what every consumer's field paths are written against. */
  output: unknown;
  /** Present and `true` only on the replay leg. */
  replayed?: boolean;
  /** Which compiled recipe answered. Present only on the replay leg. */
  recipeVersion?: number;
  /** Replay wall-clock (K4). Present only on the replay leg. */
  replayMs?: number;
}

function actionRunEnvelope(e: ActionRunEnvelope): ActionRunEnvelope {
  return {
    runId: e.runId,
    status: e.status,
    ...(e.summary !== undefined ? { summary: e.summary } : {}),
    output: e.output,
    ...(e.replayed !== undefined ? { replayed: e.replayed } : {}),
    ...(e.recipeVersion !== undefined ? { recipeVersion: e.recipeVersion } : {}),
    ...(e.replayMs !== undefined ? { replayMs: e.replayMs } : {}),
  };
}

/** Injected so the unit lane can drive the whole spine without a store, a daemon or a browser. */
export interface ActionRunDeps {
  replay?: typeof replayIntegrationAction;
  /** The engine entry. Injected only so the learn/heal wiring can be driven deterministically. */
  run?: typeof runAutomation;
  /** The org-scoped recipe writes. Default: the real store. */
  putRecipe?: (orgId: string, key: string, actionName: string, draft: RecipeDraft, opts: { secrets?: SecretRegistry; learnedRunMs?: number }) => Promise<RecipeWriteResult>;
  supersedeRecipe?: HealDeps['supersedeRecipe'];
  /** K4: the replay usage bump. Best-effort; default: the real store. */
  recordReplay?: (orgId: string, key: string, actionName: string, input: { ms?: number }) => Promise<void>;
  /** The recipe read: the evidence a new recipe supersedes, plus the heal streak (K6). Default: the store. */
  getRecipe?: (orgId: string, key: string, actionName: string) => Promise<{ capturedCallsRef?: string; stats?: { driftStreak?: number } } | null>;
  /**
   * Drop an action's recipe. The escape hatch for a recipe the replay's write gate refuses.
   *
   * It answers with the recipe it DROPPED (null ⇒ there was none), because that recipe is the only
   * thing that names its `capturedCallsRef` - see `integrations/recipe-lifecycle.ts`. It used to be
   * a boolean, and the narrowing is what orphaned a pass's evidence on every clear.
   */
  clearRecipe?: (
    orgId: string,
    key: string,
    actionName: string,
  ) => Promise<{ version?: number; capturedCallsRef?: string } | null>;
  /** Where the raw evidence lands - and, on a supersede, where the old evidence is dropped from. */
  captures?: Pick<CapturedCallsStore, 'appendCapturedCall'> & Partial<Pick<CapturedCallsStore, 'discardCapture'>>;
  captureId?: () => string;
}

/** What the executor's automation seam hands over. Declared structurally rather than imported from
 *  `integrations/action-executor.ts`, which is a lower tier this module does not depend on. */
export interface AutomationBackedCall {
  binding: unknown;
  args: Record<string, unknown>;
  credentialFields: Record<string, unknown>;
  orgId: string;
  ownerUserId: string;
  integrationKey?: string;
  actionName?: string;
  writeAssent?: boolean;
  mutates?: boolean;
  /**
   * The integration's NON-SECRET config projection (`IntegrationConfig.publicConfigValues`) - the
   * executor has sent it since the citius rebuild, and this seam DROPPED it (found live,
   * 2026-09-01): every `{{config.…}}` in a shipped template resolved to the empty string, the
   * empty navigate failed, and the rehearsal fixer relocated the run onto a model-invented origin
   * (the real CITIUS portal). Declared on BOTH sides of the seam now, because the drop was
   * invisible precisely while one side sent a field the other never named.
   */
  configValues?: Record<string, string>;
}

/**
 * THE SEAM, as one named thing (Capability Contract rule 1).
 *
 * `server.ts` binds the executor's `runAutomationBackedAction` to this, and it is the ONLY mapping
 * from the executor's call shape onto `ActionRunInput`. It lives here rather than inline in
 * `buildApp` for one reason: which fields cross the seam is a security decision - the action's
 * identity and the owner's write assent both ride it - and a mapping that exists only inside a
 * 3000-line composition root is a mapping no test can enter through. The acceptance suite drives
 * the real executor through THIS function, so a field dropped here fails a test rather than
 * silently disabling the spine in production.
 *
 * `deps` is empty in production and is how the suite supplies its stores and its engine.
 */
export function automationBackedActionHandler(deps: ActionRunDeps = {}) {
  return async (b: AutomationBackedCall): Promise<{
    success: boolean;
    /** Exactly `ActionRunResult`'s codes - every one of them is an `IntegrationErrorCode`, which is
     *  what lets `server.ts` bind this straight onto the executor's seam with no widening cast. */
    code?: ActionRunResult['code'];
    error?: string;
    data?: unknown;
  }> => {
    const out = await runAutomationForAction({
      binding: b.binding as ActionRunBinding,
      args: b.args,
      credentialFields: b.credentialFields,
      orgId: b.orgId,
      ownerUserId: b.ownerUserId,
      // Names the action so the seam can try its compiled recipe before running the automation,
      // and so the run it does perform can learn one. Absent from a caller that predates the
      // fields, which is exactly the old behaviour.
      ...(b.integrationKey !== undefined ? { integrationKey: b.integrationKey } : {}),
      ...(b.actionName !== undefined ? { actionName: b.actionName } : {}),
      // The owner's answer to this action's write approval, decided once by the executor's own
      // gate. Absent from a caller that predates the field, which is the closed direction.
      ...(b.writeAssent !== undefined ? { writeAssent: b.writeAssent } : {}),
      // What the action DECLARES it does. A caller that predates the field leaves it absent, which
      // reads as "not known to write" - the pre-P2 behaviour, and the only honest default: a caller
      // that cannot say is not a caller that said no.
      ...(b.mutates !== undefined ? { mutates: b.mutates } : {}),
      // The non-secret config projection, forwarded onto `RunContext.configValues` so a shipped
      // template's `{{config.…}}` resolves to the TENANT'S value. This line is the whole of the
      // 2026-09-01 live fix: both ends existed (the executor sent it, `ActionRunInput` accepted
      // it) and this mapping - the one place the two shapes meet - silently lost it.
      ...(b.configValues !== undefined ? { configValues: b.configValues } : {}),
    }, deps);
    return {
      success: out.success,
      ...(out.code ? { code: out.code } : {}),
      ...(out.error ? { error: out.error } : {}),
      ...(out.data !== undefined ? { data: out.data } : {}),
    };
  };
}

/** Surface the run's structured output (last api_call/ekoa_action step output), old semantics. */
async function extractActionRunOutput(runId: string): Promise<unknown> {
  const record = (await automationRuns.get(runId)) as { steps?: Array<{ output?: { kind?: string; responseBody?: string; responseBodyIsJson?: boolean; result?: unknown } }> } | null;
  if (!record || !Array.isArray(record.steps)) return undefined;
  for (let i = record.steps.length - 1; i >= 0; i -= 1) {
    const out = record.steps[i]?.output;
    if (!out) continue;
    if (out.kind === 'api_call') {
      if (out.responseBodyIsJson && typeof out.responseBody === 'string') {
        try { return JSON.parse(out.responseBody); } catch { return out.responseBody; }
      }
      return out.responseBody;
    }
    if (out.kind === 'ekoa_action') return out.result;
  }
  return undefined;
}

/**
 * Run the automation bound to an integration action on behalf of the (verified) owner and map
 * the outcome onto the executor's result contract (carried runAutomationBackedAction semantics:
 * unknown_automation / forbidden / automation_failed; CREDENTIAL BOUNDARY — secrets only ever
 * nest under `inputs.credentials`, never top-level, never in error text).
 *
 * Private gate: subsumed. The owner check below is `ownerUserId !== input.ownerUserId` — strictly
 * owner-only regardless of visibility — so a private automation is already unreachable to anyone
 * but its owner on this path.
 */
export async function runAutomationForAction(
  input: ActionRunInput,
  deps: ActionRunDeps = {},
): Promise<ActionRunResult> {
  // The run's live credential values, as ONE registry. Built here rather than inside the replay so
  // the proof that no credential rode into a resolved URL runs against the values that actually
  // exist on this run - the check was inert until this line existed, because the mount passed none.
  //
  // MINUS THE VALUES THE CONFIG ROW PUBLISHES IN PLAINTEXT (found live, 2026-09-01). The
  // credential ciphertext encrypts the WHOLE config bag - declared-non-secret fields included - so
  // a package's `portal_url` was registered as a secret here, and `redactCaptures` then ate the
  // portal's own origin out of every captured URL: `templateUrl` could parse none of them, the
  // compile produced zero calls, and no config-addressed package could ever learn a recipe. A
  // value that is simultaneously in `publicConfigValues` is by declaration not a secret; masking
  // it protects nothing and corrupts everything it appears in.
  const publicConfigVals = new Set(Object.values(input.configValues ?? {}));
  const secrets = secretRegistryFromValues(
    Object.values(input.credentialFields).filter((v) => typeof v !== 'string' || !publicConfigVals.has(v)),
  );
  /** Named ⇒ this action can carry a recipe, so its recipe is TRIED. Unnamed callers behave exactly
   *  as they did pre-P2: straight to the automation, replaying nothing and learning nothing. */
  const named = Boolean(input.integrationKey && input.actionName);
  /**
   * DOES THIS ACTION WRITE? Read fail-closed, exactly once, here.
   *
   * This repo has one reading of `mutates` and it is `actionRequiresConsent`'s: only a LITERAL
   * `false` is a read. `mutates` comes off a `config.json` that is parsed rather than
   * schema-validated and off Mongo rows an agent authored, so absent / `"false"` / `0` / `null`
   * all mean WRITE. Everything below is handed this boolean rather than re-reading the field.
   */
  const mutating = input.mutates !== false;
  /**
   * COULD THIS RUN PRODUCE A STORED RECIPE AT ALL? Decided BEFORE anything is armed.
   *
   * A mutating action stores no recipe in this slice, by two refusals that are one rule read from
   * both sides: a compiled call set that WRITES was never shown to the human who approved the
   * action, and one that does NOT write cannot be the whole of an action that does. So for a
   * mutating action the learning pass is not merely wasted - the machine's recorder holds the LIVE
   * HEADER VALUES of an authenticated session while it is armed (`clients/bridge/src/browser/
   * capture.ts`), so arming it for a run that can never produce a recipe extends a credential's
   * exposure window for no benefit whatsoever. The decision therefore happens here, before the
   * engine is called, and not inside `learnFromRun` after the values have already been held,
   * shipped and compiled.
   *
   * The REPLAY is still tried for a mutating action (`named` above, not this): a recipe an older
   * build stored has to be seen to be refused and cleared.
   */
  const storable = named && !mutating;

  // ── 1. REPLAY FIRST (slice P2.3) ───────────────────────────────────────────────────────────
  //
  // If this action has learned a recipe, it replays the site's own API calls with no model in the
  // loop - which is the entire point of the spine. EVERY outcome except `ok` falls THROUGH to the
  // automation below, so the worst case of a replay that cannot proceed is exactly the run this
  // function performed before the recipe existed.
  //
  // ── WHY `write-gate` FALLS THROUGH TOO, WHICH IT DID NOT ──────────────────────────────────
  //
  // It used to answer `awaiting_consent`, and that answer named a consent NOBODY COULD EVER GIVE.
  // Look at what can actually arrive here: the executor refuses an unapproved write BEFORE this
  // seam, so `writeAssent` is `true` for an approved write and `false` only when the action is
  // declared `mutates: false`. A `mutates: false` action is never put to a human at all -
  // `checkActionConsent` answers `not_mutating`, and there is no approval flow to enter. So the
  // action was BRICKED: `putRecipe` refuses to overwrite and `supersedeRecipe` only bumps, so every
  // later run replayed, hit the same gate, and failed, with no control its owner could touch.
  //
  // A read-declared action learning a POST is ORDINARY rather than anomalous - plenty of portals
  // serve a search over POST - so the defect is in the RECIPE, not in the action. The recipe is
  // therefore what gets refused: it is cleared, and the action runs the way it ran before it ever
  // learned anything. Nothing that was working is lost.
  //
  // This does NOT make the gate decorative, which was the original argument for refusing outright.
  // The gate stops the REPLAY from issuing a call set no human ever saw. The automation path runs
  // the action's own authored steps - precisely what the owner approved when they approved the
  // action. Declining to optimise a write is the conservative choice, not a bypass of one.
  let driftReason: string | undefined;
  if (named) {
    const replay = deps.replay ?? replayIntegrationAction;
    // THE REPLAY'S OWN EXECUTION ID, minted here rather than inside the browser helper, because it
    // is now two things: the id the daemon ledgers this replay's frames and lease under, and the
    // `runId` of the envelope below. One id for one execution - a second one invented at the
    // envelope would name nothing an operator could look up.
    const replayRunId = `replay-${randomUUID()}`;
    const replayStartedAt = Date.now();
    // K6 (REPLAY_BUDGET): the ATTEMPT is bounded, not only its per-call transports. On the ceiling
    // the race resolves to a fall-through and the authored run answers - and the abandoned attempt
    // is ABORTED, not merely ignored (review fix): the signal stops it issuing further calls, so
    // it releases the owner's browser lease promptly instead of making the fall-through run queue
    // behind it, and an assented write recipe cannot keep writing concurrently with the authored
    // re-run (bounded to the one call already in flight).
    const replayAbort = new AbortController();
    let replayTimer: NodeJS.Timeout | undefined;
    const replayTimeout = new Promise<{ outcome: 'no-recipe'; reason: string }>((resolve) => {
      replayTimer = setTimeout(() => {
        replayAbort.abort();
        resolve({ outcome: 'no-recipe', reason: `replay exceeded ${REPLAY_BUDGET.maxWallClockMs}ms` });
      }, REPLAY_BUDGET.maxWallClockMs);
    });
    const result = await Promise.race([
      replay({
        orgId: input.orgId,
        ownerUserId: input.ownerUserId,
        integrationKey: input.integrationKey!,
        actionName: input.actionName!,
        args: input.args,
        runId: replayRunId,
        secrets,
        signal: replayAbort.signal,
        ...(input.writeAssent !== undefined ? { writeAssent: input.writeAssent } : {}),
        mutates: mutating,
      }).catch((err: unknown) => {
        // A replay that THREW is a fall-through like any other. It is an optimisation on the hot
        // path of every automation-backed action; a defect in it must not be able to break actions
        // that worked before it existed.
        console.warn(`[automation] recipe replay failed for ${input.integrationKey}/${input.actionName}: ${err instanceof Error ? err.message : String(err)}`);
        return { outcome: 'no-recipe', reason: 'replay threw' } as const;
      }),
      replayTimeout,
    ]).finally(() => clearTimeout(replayTimer));
    if (result.outcome === 'ok') {
      const replayMs = Date.now() - replayStartedAt;
      // K4: bump the recipe's usage stats. Best-effort AFTER the answer is decided - a stats write
      // must never turn a replay that worked into a failure.
      const recordReplay = deps.recordReplay
        ?? ((o: string, k: string, a: string, i: { ms?: number }) => integrationRecipeStore.recordReplay(o, k, a, i));
      void recordReplay(input.orgId, input.integrationKey!, input.actionName!, { ms: replayMs })
        .catch(() => undefined);
      return {
        success: true,
        // THE SAME ENVELOPE THE AUTOMATION LEG ANSWERS IN. See `ActionRunEnvelope`: a consumer that
        // has to recognise a second shape is a consumer that will one day fail to, silently.
        data: actionRunEnvelope({
          runId: replayRunId,
          status: 'completed',
          summary: `replayed ${result.calls.length} call(s) of recipe v${result.recipeVersion}`,
          output: result.data,
          replayed: true,
          recipeVersion: result.recipeVersion,
          replayMs,
        }),
      };
    }
    if (result.outcome === 'arguments-uncovered') {
      // THE RECIPE IS TOO NARROW FOR THIS CALLER, AND IT OWNS THE ACTION'S ONLY SLOT. Cleared for
      // exactly the reasons the two refusals below are: `putRecipe` refuses to overwrite and a
      // supersede needs a drift that can never fire here, so leaving it in place means this action
      // can never learn a recipe that serves this argument set - for the life of the row, silently.
      // The listener shape reaches this on its SECOND tick: the establishing one calls with `{}`.
      //
      // A caller can therefore cost this action its optimisation by passing an argument the recipe
      // has no hole for. That is a cost, not a hole: the caller already had the authority to run the
      // action, the answer stays correct (the authored steps see every argument), and the very next
      // pass learns a recipe from the wider set.
      await clearRefusedRecipe(input, result.reason, deps);
    }
    if (result.outcome === 'write-gate') {
      // REFUSE THE RECIPE, KEEP THE ACTION. Cleared rather than left in place, because a recipe the
      // gate will not run is one this action would otherwise pay a doomed replay attempt for on
      // every single run - and `learnFromRun` below now declines to store its replacement, so this
      // settles rather than thrashing the store.
      await clearRefusedRecipe(
        input,
        `it replays ${result.blocked}, which writes, and no human has been shown that call set`,
        deps,
      );
    }
    if (result.outcome === 'does-not-cover') {
      // THE READ-LEARNS-A-WRITE SHAPE, CAUGHT AT REPLAY. Falling through is not a fallback here, it
      // is the fix: the automation below runs the action's authored steps, which is the path that
      // actually performs the write. The recipe is CLEARED for the same reason a write-gated one is
      // (it can never run, so leaving it costs a doomed attempt every run) - and `learnFromRun`
      // declines to compile its replacement for a mutating action, so this settles rather than
      // thrashing. LOUD, because a capability the product advertises is off for this action.
      await clearRefusedRecipe(input, result.reason, deps);
    }
    // DRIFT ROUTES TO A HEAL. `classifyReplayDrift` is what separates "the site changed" (re-learn
    // it) from "the route is missing" (re-learning would fail the same way) and from a refusal a
    // heal must never route around.
    if (classifyReplayDrift(result) === 'recipe_drift') {
      driftReason = (result as { reason: string }).reason;
    }
  }

  // THE BINDING IS RESOLVED, NOT READ. A shipped package's `automationId` is a placeholder; the row
  // this org runs is joined by provenance. Fetching the literal is what made every automation-backed
  // action on every shipped package answer `unknown_automation` (docs/findings.md
  // `citius-listener-blocked`). `bound.id` is the id from here down - the fetch, the run and the
  // failure message must all name the same automation or the message sends a human to the wrong row.
  const bound = await resolveBoundAutomation(input.orgId, input.integrationKey, input.binding);
  const automation = bound.row;
  if (!automation) {
    return { success: false, code: 'unknown_automation', error: `automation not found: ${bound.id}` };
  }
  if (automation.ownerUserId !== input.ownerUserId) {
    return { success: false, code: 'forbidden', error: `forbidden: not the owner of automation ${bound.id}` };
  }

  const inputs: Record<string, unknown> = {};
  if (input.binding.argMap) {
    for (const [inputName, argKey] of Object.entries(input.binding.argMap)) {
      if (Object.prototype.hasOwnProperty.call(input.args, argKey)) inputs[inputName] = input.args[argKey];
    }
  } else {
    Object.assign(inputs, input.args);
  }
  if (input.binding.passCredentials) inputs.credentials = { ...input.credentialFields };

  const ctx: RunContext = {
    ownerUserId: input.ownerUserId,
    orgId: input.orgId,
    triggeredBy: 'agent',
    ...(input.configValues ? { configValues: input.configValues } : {}),
    visitedAutomationIds: new Set(),
    traceId: randomUUID(),
    // The registry the replay above already used, handed to the engine so both legs of this
    // function redact against the same live values (the engine seeds it further from
    // `inputs.credentials` as it goes).
    secrets,
  };
  const runId = randomUUID();
  const emit = runEventEmitterFactory(runId);

  // ── 2. THE RUN, INSTRUMENTED - BUT ONLY IF THE INSTRUMENT CAN PAY FOR ITSELF (P2.1/P2.2) ───
  //
  // The automation drives its authored steps exactly as it always has. Underneath it, the machine
  // records what the page's own JavaScript asks the server for, and the sink below collects it.
  // This is the LEARNING pass, and it is the run that was going to happen anyway.
  //
  // `storable`, NOT `named`. The recorder is a credential holding while it is armed - it keeps the
  // live value of every header name the authenticated page sends, because that map is what an
  // injected replay resolves names against. Arming it for an action whose recipe can never be
  // stored (see `storable` above) would hold those values, ship a full pass's request and response
  // bodies across the wire, redact them twice and compile them - to reach a refusal that was
  // already decidable before the run started. The wasted work is the least of it.
  //
  // AND IT IS BOUNDED. This array holds one pass's worth of request AND response bodies inside the
  // SHARED API PROCESS, fed by a sink the machine drains onto every frame. The machine's own
  // recorder is bounded for exactly this reason (`clients/bridge/src/browser/capture.ts`,
  // "an unbounded recorder attached to a long headed session is a memory leak on somebody's
  // laptop") - but it is bounded PER FRAME, and a run has as many frames as it has steps, so an
  // unbounded accumulator here multiplied that bound by the length of the run and moved it onto a
  // process every tenant shares. Oldest-first, the same discipline and for the same reason: a pass
  // drives toward an outcome, and the calls that matter are the ones nearest it.
  const captured: LocalBrowserCapture[] = [];
  const run = deps.run ?? runAutomation;
  const runStartedAt = Date.now();
  const result = await run(bound.id, ctx, {
    runId,
    inputs,
    ...(emit ? { emit } : {}),
    ...(storable
      ? {
        observeNetwork: (batch: LocalBrowserCapture[]) => {
          captured.push(...batch);
          if (captured.length > MAX_RUN_CAPTURED_EXCHANGES) {
            captured.splice(0, captured.length - MAX_RUN_CAPTURED_EXCHANGES);
          }
        },
      }
      : {}),
  });
  // K4: the authored run's wall-clock - the "before" the recipe's replay stats compare against.
  // Includes any human-pause time, honestly: that is the cost the user experienced.
  const runMs = Date.now() - runStartedAt;
  const status: string = result.status;
  if (status === 'completed' || status === 'succeeded') {
    // ── 3. COMPILE WHAT THE PASS SAW ─────────────────────────────────────────────────────────
    //
    // Only from a run that SUCCEEDED. A recipe distilled from a pass that ended on a sign-in wall
    // replays nothing and reports success forever, which is worse than having no recipe at all -
    // the run's own status is the goal gate, and it is a stricter one than a second vision opinion.
    //
    // THE ANSWER IS READ FIRST, because the learn needs it. A recipe has to reproduce the answer
    // this run gave, and the only way to know which captured call did that is to compare them - so
    // `extractActionRunOutput` moved above the learn rather than below it.
    const output = await extractActionRunOutput(result.runId);
    if (storable) {
      await learnFromRun({ input, secrets, captured, runOutput: output, driftReason, runMs, deps }).catch((err: unknown) => {
        // Learning is a by-product. A store hiccup must not turn a run that WORKED into a failure.
        console.warn(`[automation] could not compile a recipe for ${input.integrationKey}/${input.actionName}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    return {
      success: true,
      data: actionRunEnvelope({ runId: result.runId, status: result.status, summary: result.summary, output }),
    };
  }
  // A CREDENTIAL HALT IS PARKED, NOT FAILED (K2). The run row persists `needs_credentials`, the
  // waiter is registered, the SSE frame is out - this envelope must say the same thing to the
  // action caller instead of the misleading `automation_failed` it used to flatten to.
  if (status === 'needs_credentials') {
    // K3: stamp the action identity onto the parked row so the post-ceremony resume can fire the
    // ONE background learn-armed re-execution (the resumed engine pass itself cannot learn).
    // STORABLE only: a mutating action must never be re-executed behind its owner's back, and an
    // unnamed caller has nothing to learn for. Best-effort - a failed stamp costs the first-contact
    // learning latency, never the halt.
    if (storable && input.integrationKey && input.actionName) {
      // CREDENTIALS ARE REFERENCES, NEVER VALUES - even on this parked row (Codex checkpoint fix).
      // `input.args` is caller-supplied and could carry a secret-shaped value; the persisted `inputs`
      // already go through `scrubCredentials`, and this stamp must not be the one place a raw token
      // survives in `automation_runs`. Two layers, the run's own: drop secret-NAMED keys
      // (SECRET_SHAPED_INPUT_NAME), then redact any value matching a live credential
      // (`secrets.redactDeep`). The re-run re-resolves its credentials from the Cofre, so nothing
      // load-bearing is lost.
      const scrubbedArgs = secrets.redactDeep(
        Object.fromEntries(Object.entries(input.args).filter(([k]) => !SECRET_SHAPED_INPUT_NAME.test(k))),
      ) as Record<string, unknown>;
      const actionRetry = { integrationKey: input.integrationKey, actionName: input.actionName, args: scrubbedArgs };
      await automationRuns.update(result.runId, (doc) => ({ ...(doc as object), actionRetry } as never)).catch(() => undefined);
    }
    return {
      success: false,
      code: 'needs_credentials',
      error: `A sequência de passos está à espera de uma credencial para continuar (run ${result.runId}).`,
      data: { runId: result.runId, status: result.status },
    };
  }
  return {
    success: false,
    code: 'automation_failed',
    // Engine status text only — never contains credentialFields.
    error: result.error || result.summary || `automation ${bound.id} did not complete (status=${result.status})`,
    data: { runId: result.runId, status: result.status },
  };
}

/**
 * WHAT THE RUN LEARNED, written down (slices P2.1, P2.2, P2.4).
 *
 * The compile is pure and model-free (`network-capture.ts`), which is exactly why the second run
 * costs nothing: no part of turning captured exchanges into a recipe consults a model.
 *
 * THREE DECISIONS LIVE HERE.
 *
 *  - NOTHING IS WRITTEN WHEN NOTHING WAS LEARNED. A pass that captured no internal API call
 *    compiles zero replayable calls, and storing that would be storing a permanent "this action is
 *    DOM-only" - which `putRecipe` then refuses to overwrite, so the action could never learn again
 *    even after the site started using an API. Writing nothing keeps the next run's learning free.
 *  - A DRIFT SUPERSEDES; everything else PUTS. `putRecipe` refuses to overwrite by design, so that
 *    every replacement carries the `supersedes` lineage - which means the only legitimate way to
 *    replace a recipe is through the heal, and the only thing that justifies a heal is drift.
 *  - THE EVIDENCE IS WRITTEN FIRST AND IS DURABLE ONLY IF THE RECIPE IS. The recipe carries
 *    `capturedCallsRef` pointing INTO the evidence, so writing the recipe first would publish a
 *    pointer to evidence that may not land. The order therefore stays evidence-then-recipe, and the
 *    orphan that order creates is COLLECTED ON EVERY EXIT, A THROW INCLUDED - which is what the
 *    `finally` below is for, and what the earlier `if (!stored)` was not. See it for the failure it
 *    left open.
 */
async function learnFromRun(args: {
  input: ActionRunInput;
  secrets: SecretRegistry;
  captured: LocalBrowserCapture[];
  /** What the run itself answered. The compile correlates it with the captured calls so the replay
   *  can give the SAME answer; `undefined` means the run answered nothing, and so will the replay. */
  runOutput: unknown;
  driftReason?: string;
  /** The authored run's wall-clock (K4) - stored as the recipe's `learnedRunMs`, the "before". */
  runMs?: number;
  deps: ActionRunDeps;
}): Promise<void> {
  const { input, secrets, captured, runOutput, driftReason, runMs, deps } = args;
  const integrationKey = input.integrationKey!;
  const actionName = input.actionName!;
  if (captured.length === 0) return;

  const exchanges = redactCaptures(captured, secrets);
  const compiled = compileInjectedCalls(exchanges, { inputs: input.args, runOutput });
  if (compiled.refusedBecause !== undefined) {
    // NEVER SILENT. A refusal here means this action will keep paying for a full vision run forever,
    // which is a real (and correct) cost the operator should be able to see a reason for.
    console.warn(
      `[automation] not compiling a recipe for ${integrationKey}/${actionName}: ${compiled.refusedBecause}`,
    );
    return;
  }
  const injectedCalls = compiled.calls;
  if (injectedCalls.length === 0) {
    // NEVER SILENT EITHER (2026-09-01): "the pass captured traffic but none of it compiled" is a
    // different diagnosis from "the page made no internal calls", and with this exit silent the
    // two were indistinguishable through two live debugging rounds. Names only - method, path,
    // status, type - never a body, a query or a header value.
    const seen = exchanges.slice(0, 8).map((x) => {
      let path = '?';
      try { path = new URL(x.url).pathname; } catch { /* keep the placeholder */ }
      return `${x.method} ${path} [${x.resourceType} ${x.status} ${x.contentType ?? 'no-type'}]`;
    });
    console.warn(
      `[automation] no injectable call among ${exchanges.length} captured exchange(s) for ` +
        `${integrationKey}/${actionName}: ${seen.join('; ')}`,
    );
    return;
  }

  const captureId = (deps.captureId ?? randomUUID)();
  const draft: RecipeDraft = {
    // PROVENANCE, never an input to anything: which action this recipe belongs to. The learning
    // pass is the action's own automation, so there is no separate goal statement to record - and
    // inventing prose here would put a string nobody wrote into a stored document.
    goal: `replay of ${integrationKey}/${actionName}`,
    injectedCalls,
    // NO SCRIPTED STEPS. A locator learned from ONE pass on ONE page state is precisely the brittle
    // artefact the injected-call path exists to avoid, and the flow's DOM work is already the
    // automation's authored steps - which still run whenever the replay cannot.
    scriptedSteps: [],
    // WHICH CALL IS THE ANSWER, as the compile correlated it against this run's own output. Absent
    // when the run answered nothing - which is every browser-only automation this repo ships, and
    // is the honest thing for the replay to reproduce.
    ...(compiled.answerCallIndex !== undefined
      ? { answersWith: { callIndex: compiled.answerCallIndex, matchedBy: 'run-output-identity' as const } }
      : {}),
    lessons: deriveLessons(exchanges),
    capturedCallsRef: captureId,
  };

  // ── A RECIPE THAT WRITES IS NOT STORED, BY EITHER ROUTE ───────────────────────────────────
  //
  // An assent is a human answering a question about an ACTION. It is not, and cannot be, an
  // approval of a per-CALL set that was compiled afterwards from traffic nobody looked at: the
  // owner approved "send_message may write", never "issue these four POSTs to these four URLs".
  // Storing a write recipe on the strength of the action's assent would silently widen one answer
  // into authority over an arbitrary set - so the learn stops here, and the action keeps writing by
  // its authored steps, which ARE what the human approved.
  //
  // This slice has no surface that shows a human a compiled call set and takes an answer about it,
  // so there is deliberately no `writeAssent` that opens this. Saying that plainly beats shipping a
  // gate whose key is a field nobody sets (see `docs/decisions.md`).
  const writes = writesIn(draft);
  if (writes.length > 0) {
    console.warn(
      `[automation] not storing a recipe for ${integrationKey}/${actionName}: it contains ` +
        `${writes.length} call(s)/step(s) that write (${writes.slice(0, 3).join(', ')}), and no human has ` +
        'been shown that call set. The action keeps running its authored steps.',
    );
    return;
  }

  // ── …AND NEITHER IS ONE THAT DOES NOT COVER THE ACTION'S DECLARED WRITE ──────────────────
  //
  // THE WORST FAILURE THIS SPINE CAN HAVE, and the two refusals are one rule read from both sides.
  // A `mutates` action whose compile CONTAINS a write is refused above (nobody approved that call
  // set). A `mutates` action whose compile contains NO write must be refused too - replaying it
  // would issue the reads, answer `ok`, and report SUCCESS while the write never happened, and
  // nobody finds out until somebody checks the far system.
  //
  // THE SECOND HALF IS NOT ENFORCED HERE, AND DELIBERATELY SO. It is decided by `storable` in
  // `runAutomationForAction`, BEFORE the run - because it is the only one of these refusals that is
  // knowable in advance, and knowing it in advance is what lets the recorder stay disarmed. A
  // duplicate `input.mutates` check on this line would be unreachable (nothing calls this function
  // for a mutating action), and an unreachable gate is a gate a reviewer trusts and a mutation test
  // cannot kill. One decision, at the point where it also buys something.
  //
  // A recipe is not allowed to be a SUBSET of its action. Together the two refusals mean a mutating
  // action stores no recipe at all in this slice, and that is stated rather than engineered around:
  // there is no surface here that shows a human a compiled call set and takes an answer about it, so
  // there is nothing that could make one safe. The action keeps writing by its authored steps, at
  // full cost, correctly.

  const captures = deps.captures ?? capturedCallsStore;
  const evidenceKey: CaptureKey = { orgId: input.orgId, integrationKey, actionName, captureId };
  await persistEvidence(captures, evidenceKey, exchanges, secrets);

  // ── EVERY EXIT FROM HERE ON TAKES THE EVIDENCE WITH IT, INCLUDING A THROW ────────────────
  //
  // The evidence has to be written FIRST - the recipe carries `capturedCallsRef` INTO it, so writing
  // the recipe first would publish a pointer to documents that may never arrive. The consequence is
  // that a write which does not land leaves a full pass's request and response bodies - the most
  // sensitive thing this pipeline touches - with nothing pointing at them and nothing that would
  // ever collect them.
  //
  // IT IS A `finally` BECAUSE A THROW IS ONE OF THE WAYS A WRITE DOES NOT LAND, and the collector
  // that only handled the RETURNING exits was the whole defect. `putRecipe` does not merely answer
  // `exists`/`notfound`; it THROWS at its persistence-boundary proof (`assertCarriesNoValues`,
  // `assertAnswerPointsAtACall`), and so does any store error. That throw propagates to the caller's
  // `.catch`, which logs and reports the run as the success it was - so the discard simply never
  // ran. And it repeats: the refusal is a property of the pass, decided at the store, so EVERY later
  // run of that action writes a fresh pile, unbounded, with the recipe absent (so `priorCaptureRef`
  // cannot reach them), no TTL, and no collector left that can.
  let stored = false;
  try {
    // The recipe about to be replaced - read BEFORE the write, because after it the pointer is the
    // new one. Carries the head of the supersede discard AND the heal streak (K6).
    const getRecipe = deps.getRecipe ?? ((o, k, a) => integrationRecipeStore.getRecipe(o, k, a));
    const prior = await getRecipe(input.orgId, integrationKey, actionName).catch(() => null);
    const supersededCaptureRef = prior?.capturedCallsRef;

    if (driftReason !== undefined) {
      // ── THE HEAL CEILING (K6, HEAL_BUDGET) ──────────────────────────────────────────────────
      //
      // The streak on the CURRENT recipe counts its lineage's consecutive heals with no successful
      // replay between them. At the ceiling this heal does not supersede: it CLEARS. A site that
      // drifts on every single visit is not learnable, and the honest steady state is the authored
      // run at full cost - not a version counter climbing forever while every replay is doomed.
      // The clear is the same lifecycle path every other refusal takes (evidence goes with it), and
      // a LATER pass may still learn a fresh recipe that sticks - `putRecipe` starts a clean v1.
      const streak = prior?.stats?.driftStreak ?? 0;
      if (streak >= HEAL_BUDGET.maxConsecutiveDriftHeals) {
        console.warn(
          `[automation] not healing ${integrationKey}/${actionName}: ${streak} consecutive heals ` +
            'never replayed once (HEAL_BUDGET). The recipe is cleared; the action runs its authored steps.',
        );
        await clearRefusedRecipe(input, `heal ceiling: ${streak} consecutive drift-heals with no successful replay`, deps);
        return;
      }
      const supersedeRecipe = deps.supersedeRecipe
        ?? ((orgId, key, action, next, opts) =>
          integrationRecipeStore.supersedeRecipe(orgId, key, action, next, {
            ...(opts ?? {}),
            ...(runMs !== undefined ? { learnedRunMs: runMs } : {}),
          }));
      const healed = await healDriftedRecipe(
        {
          orgId: input.orgId,
          integrationKey,
          actionName,
          reason: driftReason,
          secrets,
          // NO ASSENT IS INHERITED HERE, and that is the point. A heal RE-AUTHORS the call set: the
          // draft is compiled from a fresh pass and can name calls nothing has ever shown anybody.
          // Carrying the action's old answer forward would let one approval, given once about an
          // action, silently authorise every future set the system writes for itself. The heal is
          // read-only by construction (a draft containing writes never reaches this line, refused
          // above), so nothing legitimate is blocked by leaving this closed.
        },
        draft,
        { supersedeRecipe },
      );
      if (healed.outcome !== 'healed') {
        console.warn(`[automation] the re-learned recipe for ${integrationKey}/${actionName} did not go live: ${healed.outcome}`);
      }
      stored = healed.outcome === 'healed';
    } else {
      const putRecipe = deps.putRecipe
        ?? ((orgId, key, action, d, opts) => integrationRecipeStore.putRecipe(orgId, key, action, d, opts));
      const written = await putRecipe(input.orgId, integrationKey, actionName, draft, {
        secrets,
        ...(runMs !== undefined ? { learnedRunMs: runMs } : {}),
      });
      if (written.verdict === 'notfound') {
        // NOT SILENT (the `global`-definition case). A recipe is tenant data and is written onto the
        // org's OWN definition row, so an org running an action off somebody else's published/global
        // definition has no row to write to and can never learn. That is a real and defensible
        // limitation - one tenant's learning must not land on a row every org reads - but a learn
        // that vanishes without a word is indistinguishable from a broken one.
        console.warn(
          `[automation] ${integrationKey}/${actionName} cannot store a recipe in org ${input.orgId}: ` +
            'the org has no definition row of its own for this integration (it is running a published ' +
            'or global definition). Learning is per-tenant; this action will keep using its automation.',
        );
      }
      stored = written.verdict === 'ok';
    }

    // ── THE RAW EVIDENCE ENDS ITS LIFE HERE (capture -> learn -> compile -> DISCARD) ────────
    //
    // The captures collection exists BECAUSE this data is unbounded and short-lived; the compiled
    // recipe is the durable artefact. Every learn wrote a new captureId and nothing ever removed
    // the old one, so a weekly action accumulated a fresh pile of full request/response bodies
    // every week, forever.
    //
    // The CURRENT recipe's evidence stays (it is what `capturedCallsRef` points at, and the reason
    // a human can see what the live recipe was distilled from). What goes is the evidence behind
    // the recipe this write just replaced. Discarded only once the new recipe is actually live, and
    // never fatal: a leaked capture is untidy, losing the evidence for a recipe that failed to
    // store would be destroying the only record of the pass.
    if (stored && supersededCaptureRef && supersededCaptureRef !== captureId) {
      await discardEvidence({ ...evidenceKey, captureId: supersededCaptureRef }, deps);
    }
  } finally {
    // Evidence becomes DURABLE only once the thing it is evidence for is. `discardEvidence` swallows
    // and logs its own failures, so this can never replace the exception on its way past.
    if (!stored) await discardEvidence(evidenceKey, deps);
  }
}

/**
 * Drop one capture's evidence, answering how many documents went. Best effort and loud on failure.
 *
 * ONE FUNCTION FOR EVERY END OF THE LIFECYCLE: the evidence behind a recipe that has been REPLACED,
 * the evidence behind a recipe that never LANDED, and - through `forgetRecipe`, which takes this as
 * its discard seam - the evidence behind a recipe that was CLEARED. They are the same operation on
 * the same collection with the same failure posture, and a second copy would be a second thing to
 * forget. It is also the ONE place `deps.captures` is read for a discard, so a suite that injects a
 * captures store without `discardCapture` gets the same no-op on all three paths.
 */
async function discardEvidence(key: CaptureKey, deps: ActionRunDeps): Promise<number> {
  const captures = deps.captures ?? capturedCallsStore;
  if (typeof captures.discardCapture !== 'function') return 0;
  try {
    return await captures.discardCapture(key);
  } catch (err) {
    console.warn(
      `[automation] the evidence ${key.captureId} of ${key.integrationKey}/${key.actionName} ` +
        `was not discarded: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}

/**
 * A recipe one of the replay's refusals will never run, removed so it cannot cost a doomed attempt
 * on every later run - and so the action can learn a usable one instead.
 *
 * `reason` is the WHOLE explanation and is passed by each caller, because the three refusals that
 * reach here are different facts: a call set that writes with nobody's assent, one that does not
 * perform the action's declared write, and one too narrow for this run's arguments. A single
 * hard-coded sentence here said "which writes" about all of them, which was false for two.
 *
 * Loud, because this is the system throwing away something it learned: the owner's action is fine
 * and keeps working, but a capability the product advertises (this action replays deterministically)
 * is not available for it, and the reason is worth a line in the log rather than a silent downgrade.
 *
 * AND THE EVIDENCE GOES WITH IT. Not here - `forgetRecipe` (`integrations/recipe-lifecycle.ts`) is
 * the one implementation of that pairing, shared with the owner's own clear on the route, because a
 * removal path that has to REMEMBER to collect is a removal path that will one day be added without
 * doing so. This one was: it narrowed the dropped recipe to a boolean, which discarded the only
 * pointer into the pass's stored request and response bodies (see that module's header).
 */
async function clearRefusedRecipe(input: ActionRunInput, reason: string, deps: ActionRunDeps): Promise<void> {
  try {
    // ── OWNERSHIP (K6, closing `clear-refused-recipe-is-ownership-ungated`) ────────────────────
    //
    // Recipe WRITES are single-writer by construction - only the bound automation's owner reaches
    // `learnFromRun` (the owner check sits between the replay and the learn) - but this clear used
    // to run BEFORE that check, so a same-org peer whose replay refused (`arguments-uncovered` on
    // an argument shape the recipe has no hole for is the ordinary case) destroyed the OWNER's
    // recipe and its evidence, and the next learn restarted at v1 with the lineage erased: a
    // clear/relearn thrash cycle between two users that also destroyed the drift history. The one
    // writer rule now covers the destructive path too: a non-owner's refusal falls through to the
    // automation leg (where `forbidden` answers them), and the recipe stands.
    // A MISSING automation row is an ORPHANED binding, and the clear proceeds (review finding):
    // the replay short-circuit answers BEFORE the automation is fetched, so a recipe whose bound
    // automation was deleted would otherwise keep answering forever with no refusal path able to
    // remove it. Nothing is widened - the binding's automationId comes off the definition, never
    // the caller.
    // Resolved, not read, for the same reason the run leg resolves: on a shipped package the
    // literal id fetches nothing, so this gate would read EVERY caller as the orphan case and let
    // a non-owner destroy the owner's recipe - the exact hole K6 closed, reopened by a placeholder.
    const automation = (await resolveBoundAutomation(input.orgId, input.integrationKey, input.binding)).row;
    if (automation && automation.ownerUserId !== input.ownerUserId) {
      console.warn(
        `[automation] not discarding the recipe for ${input.integrationKey}/${input.actionName}: ` +
          `the caller does not own its bound automation (${reason}).`,
      );
      return;
    }
    const { dropped } = await forgetRecipe(
      { orgId: input.orgId, integrationKey: input.integrationKey!, actionName: input.actionName! },
      {
        ...(deps.clearRecipe
          ? { clearRecipe: (o: string, k: string, a: string) => deps.clearRecipe!(o, k, a) }
          : {}),
        // The SAME evidence seam the two other discard paths use, so a suite that injects a
        // captures store sees this discard on it too, and one that injects a store WITHOUT
        // `discardCapture` gets the same no-op it gets there.
        discardCapture: (key: CaptureKey) => discardEvidence(key, deps),
      },
    );
    console.warn(
      `[automation] the learned recipe for ${input.integrationKey}/${input.actionName} ` +
        `${dropped ? 'has been discarded' : 'was already gone'}: ${reason}. ` +
        'The action runs its authored steps instead.',
    );
  } catch (err) {
    console.warn(
      `[automation] could not discard the refused recipe for ${input.integrationKey}/${input.actionName}: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Append the pass's evidence, one document per exchange - AND ONLY THE EXCHANGES THAT COULD MATTER.
 *
 * WHAT IS WRITTEN, AND WHY IT IS NOT EVERYTHING. The evidence exists so a human can see what the
 * recipe was distilled from, and the only exchanges a recipe is ever distilled from are the site's
 * own internal API calls (`internalApiCalls` - the exact filter the compile applies). A heavy SPA
 * makes hundreds of other requests per frame; writing one Mongo document each turned "keep the
 * evidence for this recipe" into "mirror a browser session into the database", for data this
 * pipeline is otherwise most careful about. Bounded on top of that, because the filter is a filter
 * and not a ceiling: at most `MAX_PERSISTED_EVIDENCE` documents, the newest kept, so a paginated
 * repeat of the same call is still visible next to the calls that became the recipe.
 *
 * The LESSONS are derived from the whole pass before this point (a 429 anywhere in it is a lesson),
 * so nothing that informed the recipe is lost by writing less down.
 *
 * A FAILED APPEND IS NOT A FAILED LEARN. The evidence is diagnostic while the recipe is the artefact
 * that makes runs work. Losing an exchange to a duplicate `_id` or a store hiccup must not throw
 * away what the pass learned, so each append is individually tolerant.
 *
 * A REFUSED append is different in kind and is deliberately not distinguished here: the store
 * refuses an exchange whose redacted form still carries a live credential, which is the third leg
 * doing its job. That exchange is dropped; the recipe (which carries no values by construction, and
 * is re-proven at its own store) is unaffected.
 */
async function persistEvidence(
  captures: Pick<CapturedCallsStore, 'appendCapturedCall'>,
  key: CaptureKey,
  exchanges: readonly CapturedExchange[],
  secrets: SecretRegistry,
): Promise<void> {
  const worthKeeping = internalApiCalls(exchanges);
  const kept = worthKeeping.slice(Math.max(0, worthKeeping.length - MAX_PERSISTED_EVIDENCE));
  for (let seq = 0; seq < kept.length; seq += 1) {
    try {
      await captures.appendCapturedCall(key, seq, kept[seq]!, { secrets });
    } catch (err) {
      console.warn(`[automation] evidence ${seq} of ${key.integrationKey}/${key.actionName} was not stored: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
