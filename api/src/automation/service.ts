/**
 * automation/ service surface (ch03 §3.8.18, §3.6.3). The actor-scoped, one-function-per-route
 * API that `routes/automations.ts` calls — so a route never imports `data/` directly (ch02 routes
 * row) and never re-implements scoping. Every function takes the request `Actor`; every response is
 * shape-compatible with the `shared/automations.ts` contract (validated in the suite by parsing
 * against those zod schemas).
 *
 * Scoping (Amendment 2): automations are org-scoped + creator-owned (visible across the org, mutated
 * by their creator or an org-admin/super-admin). Runs are visible to the owner and org-admins.
 * Creation is org-admin-only by default with a flippable org setting for builder authoring
 * (`canCreateAutomation`). Cancel/resume/consent are owner-scoped and idempotent, driven by an
 * in-memory signal registry (single-process, FIXED-8) that binds the engine's `cancellation` /
 * `resumeSignal` hooks. This module wires NOTHING — the composition root binds `startRunForTrigger`
 * to the delivery pipeline and the engine's seams.
 */
import { randomUUID } from 'node:crypto';
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
} from '@ekoa/shared';
import { automations, automationRuns } from '../data/stores.js';
import { createMemory } from '../memory/index.js';
import { runAutomation, rehearseAutomation, scrubCredentials, type RunContext } from './engine.js';
import { planFromGoal as plannerPlanFromGoal } from './planner.js';
import { buildAutomationCatalog } from './catalog.js';
import { evictCacheForFingerprint } from './cache.js';
import { approveCommandShape, revokeCommandShape, listApprovedShapes, listApprovedCommandRecords } from './consent.js';
import { runEventEmitterFactory } from './seams.js';
import { screenshotUrlFromPath } from './persistence.js';
import type { Automation, Step, StepType, RunRecord, StepRecord } from './types.js';

// ============================================================================
// Errors (the router maps `.code` onto the ch03 error envelope, CONV-2)
// ============================================================================

export type AutomationErrorCode = 'NOT_FOUND' | 'FORBIDDEN' | 'VALIDATION';
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

function mapWireStepToEngine(s: { stepId?: string; description?: string; tool?: string; argv?: string[] }, i: number): Step {
  const type = (typeof s.tool === 'string' && VALID_STEP_TYPES.has(s.tool) ? s.tool : 'browser') as StepType;
  return { id: s.stepId ?? `step-${i}-${randomUUID().slice(0, 6)}`, description: s.description ?? '', type };
}

function toWireAutomation(doc: StoredAutomation): WireAutomation {
  return {
    id: doc.id,
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    plan: { steps: doc.steps.map((s) => ({ stepId: s.id, description: s.description, tool: s.type })) },
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

/** Read scope: an automation is visible across its org. */
function canReadAutomation(doc: StoredAutomation, actor: Actor): boolean {
  return actor.role === 'super-admin' || doc.orgId === actor.orgId;
}
/** Write scope: the creator, or an org-admin in the same org, or a super-admin. */
function canWriteAutomation(doc: StoredAutomation, actor: Actor): boolean {
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

interface RunSignals { ownerUserId: string; orgId: string; cancelled: boolean; resumeFlag: boolean }
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
  return rows.map(toWireAutomation);
}

export async function getAutomation(actor: Actor, id: string): Promise<WireAutomation> {
  return toWireAutomation(await loadAutomationForRead(actor, id));
}

/** Creation authority: org-admin/super-admin, or a builder when the org enables builder authoring. */
export function canCreateAutomation(actor: Actor, orgSettings?: { allowBuilderAutomations?: boolean }): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === 'builder' && orgSettings?.allowBuilderAutomations === true;
}

export async function createAutomation(
  actor: Actor,
  input: { name: string; description?: string; plan?: { steps?: Array<{ stepId?: string; description?: string; tool?: string; argv?: string[] }> }; visibility?: 'private' | 'org' },
  orgSettings?: { allowBuilderAutomations?: boolean },
): Promise<WireAutomation> {
  if (!canCreateAutomation(actor, orgSettings)) {
    throw new AutomationServiceError('FORBIDDEN', 'not authorized to create automations');
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const doc: StoredAutomation = {
    id,
    name: input.name,
    description: input.description ?? '',
    steps: (input.plan?.steps ?? []).map(mapWireStepToEngine),
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
  const now = new Date().toISOString();
  const updated = (await automations.update(id, (cur) => ({
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
    ...(patch.plan?.steps ? { steps: patch.plan.steps.map(mapWireStepToEngine) } : {}),
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
  const catalog = await buildAutomationCatalog(actor.userId, actor.role === 'super-admin');
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
  opts: { kind: 'normal' | 'rehearsal'; inputs?: Record<string, unknown>; goal?: string },
): Promise<string> {
  const runId = randomUUID();
  const sig: RunSignals = { ownerUserId: owner.userId, orgId: owner.orgId, cancelled: false, resumeFlag: false };
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

export async function startRun(actor: Actor, id: string, input: { inputs?: Record<string, unknown> } = {}): Promise<{ runId: string }> {
  const automation = (await automations.get(id)) as StoredAutomation | null;
  if (!automation || !canReadAutomation(automation, actor)) throw new AutomationServiceError('NOT_FOUND', 'automation not found');
  // A user run must be owned by the actor (the engine's ownership guard); a super-admin runs it as
  // the automation's owner (server-trusted).
  let owner: { userId: string; orgId: string };
  if (automation.ownerUserId === actor.userId) owner = { userId: actor.userId, orgId: actor.orgId };
  else if (actor.role === 'super-admin') owner = { userId: automation.ownerUserId, orgId: automation.orgId };
  else throw new AutomationServiceError('FORBIDDEN', 'not authorized to run this automation');

  const runId = await startRunInternal(id, owner, { kind: 'normal', ...(input.inputs ? { inputs: input.inputs } : {}) });
  return { runId };
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
  // Defense-in-depth: only persist a STANDING command approval when the run is genuinely awaiting
  // consent — never let an approval be injected against a run that never asked for one.
  const awaitingConsent = run.status === 'awaiting_consent';
  let persisted = false;
  if (input.decision === 'always' && awaitingConsent) {
    await approveCommandShape(ownerUserId, input.shape);
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

export async function buildCatalog(actor: Actor): Promise<WireCatalogResponse> {
  const catalog = await buildAutomationCatalog(actor.userId, actor.role === 'super-admin');
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
  const revoked = await revokeCommandShape(actor.userId, input.shape);
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
