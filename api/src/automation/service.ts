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
} from '@ekoa/shared';
import { automations, automationRuns, automationRunIdempotency } from '../data/stores.js';
import { logActivity } from '../data/activity.js';
import { createMemory } from '../memory/index.js';
import { runAutomation, rehearseAutomation, scrubCredentials, type RunContext } from './engine.js';
import { planFromGoal as plannerPlanFromGoal } from './planner.js';
import { buildAutomationCatalog } from './catalog.js';
import { evictCacheForFingerprint } from './cache.js';
import { approveCommandShape, revokeCommandShape, listApprovedShapes, listApprovedCommandRecords } from './consent.js';
import { runEventEmitterFactory } from './seams.js';
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
type StoredRun = RunRecord & { ownerUserId?: string; orgId?: string };

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

  // Start a REHEARSAL run (the plan endpoint's documented double side effect) and respond early.
  const runId = await startRunInternal(doc.id, { userId: actor.userId, orgId: actor.orgId }, { kind: 'rehearsal', goal: input.goal });

  return {
    plan: { steps: doc.steps.map((s) => ({ stepId: s.id, description: s.description, tool: s.type })), status: 'ok' },
    automation: toWireAutomation(doc),
    runId,
    rehearsing: true,
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
  if (!sig || sig.cancelled) return { cancelled: false };
  sig.cancelled = true; // engine observes this at the next loop check / resume poll
  return { cancelled: true };
}

/** Resume a paused-for-user run (§5.6.7). A run that is not currently paused is a no-op. */
export async function resumeRun(actor: Actor, runId: string): Promise<{ resumed: boolean }> {
  const run = (await automationRuns.get(runId)) as StoredRun | null;
  if (!run || !isRunOwner(run, actor)) return { resumed: false };
  const sig = signals.get(runId);
  if (!sig || run.status !== 'paused_for_user') return { resumed: false };
  sig.resumeFlag = true;
  return { resumed: true };
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
  triggeredBy: 'webhook' | 'listener';
  /** The trigger event payload; steps read it as {{event.*}}. */
  event?: RunContext['triggerEvent'];
  inputs?: Record<string, unknown>;
}

export interface TriggerRunOutcome {
  outcome: 'completed' | 'failed';
  /** A permanent failure (e.g. the automation no longer exists) must NOT be retried by the delivery
   *  pipeline; a transient one re-enters the retry schedule. */
  permanent: boolean;
  runId?: string;
}

/**
 * Run an automation under a trigger's server-trusted owner and AWAIT its terminal status. A
 * non-`completed` terminal state is reported as a delivery failure; a missing automation is a
 * PERMANENT failure (never retried). The engine runs one attempt — retry lives in `events/`.
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
    return { outcome: result.status === 'completed' ? 'completed' : 'failed', permanent: false, runId: result.runId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing automation is permanent (the delivery pipeline must not retry it).
    const permanent = /automation not found/i.test(message);
    return { outcome: 'failed', permanent };
  }
}

// --- Automation-backed integration actions (integração-por-automação; carried B25) -----------

export interface ActionRunBinding {
  automationId: string;
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
}

export interface ActionRunResult {
  success: boolean;
  code?: 'unknown_automation' | 'forbidden' | 'automation_failed';
  error?: string;
  data?: unknown;
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
export async function runAutomationForAction(input: ActionRunInput): Promise<ActionRunResult> {
  const automation = (await automations.get(input.binding.automationId)) as { ownerUserId?: string } | null;
  if (!automation) {
    return { success: false, code: 'unknown_automation', error: `automation not found: ${input.binding.automationId}` };
  }
  if (automation.ownerUserId !== input.ownerUserId) {
    return { success: false, code: 'forbidden', error: `forbidden: not the owner of automation ${input.binding.automationId}` };
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
    visitedAutomationIds: new Set(),
    traceId: randomUUID(),
  };
  const runId = randomUUID();
  const emit = runEventEmitterFactory(runId);
  const result = await runAutomation(input.binding.automationId, ctx, { runId, inputs, ...(emit ? { emit } : {}) });
  const status: string = result.status;
  if (status === 'completed' || status === 'succeeded') {
    const output = await extractActionRunOutput(result.runId);
    return { success: true, data: { runId: result.runId, status: result.status, summary: result.summary, output } };
  }
  return {
    success: false,
    code: 'automation_failed',
    // Engine status text only — never contains credentialFields.
    error: result.error || result.summary || `automation ${input.binding.automationId} did not complete (status=${result.status})`,
    data: { runId: result.runId, status: result.status },
  };
}
