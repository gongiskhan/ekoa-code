/**
 * Schedule service — validation + the route-facing operations. Thin routes, testable service
 * (the memvault split). Execution lives in supervisor.ts; this module never executes a target,
 * it only validates, persists and projects.
 *
 * Target validation happens at CREATE and at every target PATCH — and is deliberately
 * re-verified AT FIRE TIME by the execution rails themselves (`startRunForTrigger` re-checks
 * org + visibility; the action executor re-runs the write gate), because a stored schedule
 * outlives its creation-time checks. The check here exists for honest 400s, not as the gate.
 */
import type {
  Actor,
  Schedule,
  ScheduleCreateRequest,
  SchedulePatch,
  ScheduleRun,
  ScheduleRunCompleteRequest,
  ScheduleSpec,
  ScheduleTarget,
} from '@ekoa/shared';
import { automations } from '../data/stores.js';
import { resolveDefinition } from '../integrations/definition-registry.js';
import { nextOccurrence, occurrencesOf, validateSpec } from './recurrence.js';
import {
  deleteSchedule,
  getRun,
  getSchedule,
  insertSchedule,
  listRunsForActor,
  listRunsForSchedule,
  listSchedules,
  updateRunAsOwner,
  updateSchedule,
  type ScheduleDoc,
  type ScheduleRunDoc,
} from './store.js';

export class ScheduleServiceError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'VALIDATION' | 'FORBIDDEN',
    message: string,
    /** Machine-readable cause for the envelope's details (the UI derives copy from it). */
    public readonly cause_code?: string,
  ) {
    super(message);
  }
}

export interface ScheduleServiceDeps {
  now: () => number;
  genId: () => string;
}

// ---------------------------------------------------------------------------
// Wire projection
// ---------------------------------------------------------------------------

export function toWireSchedule(doc: ScheduleDoc): Schedule {
  return {
    id: doc._id,
    name: doc.name,
    ...(doc.description ? { description: doc.description } : {}),
    target: doc.target,
    spec: doc.spec,
    enabled: doc.enabled,
    nextRunAt: doc.nextRunAt,
    ...(doc.lastRun ? { lastRun: doc.lastRun } : {}),
    consecutiveFailures: doc.consecutiveFailures,
    ...(doc.autoPausedAt ? { autoPausedAt: doc.autoPausedAt } : {}),
    ownerId: doc.ownerUserId,
    orgId: doc.orgId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function toWireRun(doc: ScheduleRunDoc): ScheduleRun {
  return {
    id: doc._id,
    scheduleId: doc.scheduleId,
    status: doc.status,
    plannedFor: doc.plannedFor,
    ...(doc.firedAt ? { firedAt: doc.firedAt } : {}),
    ...(doc.finishedAt ? { finishedAt: doc.finishedAt } : {}),
    trigger: doc.trigger,
    ...(doc.detail ? { detail: doc.detail } : {}),
    ...(doc.automationRunId ? { automationRunId: doc.automationRunId } : {}),
    ...(doc.note ? { note: doc.note } : {}),
    ownerId: doc.ownerUserId,
    orgId: doc.orgId,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Spec cross-field rules (recurrence.ts owns them). Throws VALIDATION with the code. */
function assertSpecValid(spec: ScheduleSpec, now: Date): void {
  const code = validateSpec(spec, now);
  if (code) throw new ScheduleServiceError('VALIDATION', 'Agendamento inválido.', code);
}

/**
 * Target existence/authority checks, against the CREATING actor:
 *  - automation: must resolve AND be owned by the actor. A schedule fires as its owner, so
 *    scheduling a peer's (or even an org-shared) automation would aim someone else's authority;
 *    the refusal is a uniform not-found (no existence oracle over org automations).
 *  - integration_action: the definition must resolve for the actor and declare the action.
 *    `mutates` is NOT refused here — the write gate answers at fire time (`blocked` runs), and
 *    the UI surfaces the approval flow; refusing at create would ban scheduling a write the
 *    owner has already approved.
 */
async function assertTargetValid(target: ScheduleTarget, actor: Actor): Promise<void> {
  if (target.kind === 'automation') {
    const doc = (await automations.get(target.automationId)) as
      | { ownerUserId?: string; orgId?: string }
      | null;
    if (!doc || doc.orgId !== actor.orgId || doc.ownerUserId !== actor.userId) {
      throw new ScheduleServiceError('VALIDATION', 'Automação não encontrada.', 'unknown_automation');
    }
    return;
  }
  if (target.kind === 'integration_action') {
    const def = await resolveDefinition(actor, target.integrationKey);
    const action = def?.actions.find((a) => a.actionName === target.actionName);
    if (!action) {
      throw new ScheduleServiceError('VALIDATION', 'Ação de integração não encontrada.', 'unknown_action');
    }
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function createSchedule(
  actor: Actor,
  body: ScheduleCreateRequest,
  deps: ScheduleServiceDeps,
): Promise<Schedule> {
  if (!actor.orgId || !actor.userId) throw new ScheduleServiceError('FORBIDDEN', 'Sem organização.');
  const now = new Date(deps.now());
  assertSpecValid(body.spec, now);
  await assertTargetValid(body.target, actor);

  const enabled = body.enabled ?? true;
  const next = enabled ? nextOccurrence(body.spec, now, now) : null;
  if (enabled && !next) {
    throw new ScheduleServiceError('VALIDATION', 'Agendamento sem ocorrências futuras.', 'no_future_occurrence');
  }
  const nowIso = now.toISOString();
  const doc: ScheduleDoc = {
    _id: deps.genId(),
    orgId: actor.orgId,
    ownerUserId: actor.userId,
    name: body.name,
    ...(body.description ? { description: body.description } : {}),
    target: body.target,
    spec: body.spec,
    enabled,
    nextRunAt: next ? next.toISOString() : null,
    consecutiveFailures: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const inserted = await insertSchedule(doc);
  if (!inserted) throw new ScheduleServiceError('VALIDATION', 'Identificador já existe.', 'id_taken');
  return toWireSchedule(doc);
}

export async function listForActor(actor: Actor): Promise<Schedule[]> {
  return (await listSchedules(actor)).map(toWireSchedule);
}

export async function getForActor(actor: Actor, id: string): Promise<Schedule> {
  const doc = await getSchedule(id, actor);
  if (!doc) throw new ScheduleServiceError('NOT_FOUND', 'Agendamento não encontrado.');
  return toWireSchedule(doc);
}

export async function patchSchedule(
  actor: Actor,
  id: string,
  body: SchedulePatch,
  deps: ScheduleServiceDeps,
): Promise<Schedule> {
  const now = new Date(deps.now());
  // Validate the replacement halves BEFORE the CAS (the mutator must stay synchronous).
  if (body.spec) assertSpecValid(body.spec, now);
  if (body.target) await assertTargetValid(body.target, actor);

  const next = await updateSchedule(id, actor, (cur) => {
    const spec = body.spec ?? cur.spec;
    const enabled = body.enabled ?? cur.enabled;
    // Recompute from NOW whenever the spec or the enabled state changes — a paused-then-edited
    // schedule must never fire a stale occurrence; the anchor for stride cadences stays the
    // schedule's creation so "every 2 hours" does not re-align on unrelated edits.
    const cadenceChanged = body.spec !== undefined || body.enabled !== undefined;
    const nextRunAt = !enabled
      ? null
      : cadenceChanged || cur.nextRunAt === null
        ? (nextOccurrence(spec, now, new Date(cur.createdAt))?.toISOString() ?? null)
        : cur.nextRunAt;
    const out: ScheduleDoc = {
      ...cur,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.target !== undefined ? { target: body.target } : {}),
      spec,
      enabled,
      nextRunAt,
      updatedAt: new Date(deps.now()).toISOString(),
    };
    // A human re-enable clears the failure ceiling and the auto-pause stamp ("I fixed it").
    if (body.enabled === true) {
      out.consecutiveFailures = 0;
      delete out.autoPausedAt;
    }
    return out;
  });
  if (!next) throw new ScheduleServiceError('NOT_FOUND', 'Agendamento não encontrado.');
  return toWireSchedule(next);
}

export async function removeSchedule(actor: Actor, id: string): Promise<void> {
  const doc = await getSchedule(id, actor);
  if (!doc || !(doc.ownerUserId === actor.userId || actor.role === 'super-admin')) {
    throw new ScheduleServiceError('NOT_FOUND', 'Agendamento não encontrado.');
  }
  await deleteSchedule(id);
}

export async function listRuns(actor: Actor, scheduleId: string, limit: number): Promise<ScheduleRun[]> {
  const doc = await getSchedule(scheduleId, actor);
  if (!doc) throw new ScheduleServiceError('NOT_FOUND', 'Agendamento não encontrado.');
  return (await listRunsForSchedule(scheduleId, limit)).map(toWireRun);
}

export async function listAllRuns(
  actor: Actor,
  query: { status?: ScheduleRun['status']; limit: number },
): Promise<ScheduleRun[]> {
  return (await listRunsForActor(actor, query)).map(toWireRun);
}

/** Complete or dismiss a PENDING manual task. Owner-only; any other state is a uniform
 *  not-found (a completed task is gone from the pending world, and a peer's task never
 *  existed for you). */
export async function completeRun(
  actor: Actor,
  runId: string,
  body: ScheduleRunCompleteRequest,
  deps: ScheduleServiceDeps,
): Promise<ScheduleRun> {
  const existing = await getRun(runId, actor);
  if (!existing || existing.status !== 'pending') {
    throw new ScheduleServiceError('NOT_FOUND', 'Tarefa não encontrada.');
  }
  const nowIso = new Date(deps.now()).toISOString();
  const next = await updateRunAsOwner(runId, actor, (cur) => ({
    ...cur,
    status: cur.status === 'pending' ? (body.outcome === 'done' ? 'done' : 'dismissed') : cur.status,
    finishedAt: nowIso,
    ...(body.note ? { note: body.note } : {}),
  }));
  if (!next) throw new ScheduleServiceError('NOT_FOUND', 'Tarefa não encontrada.');
  // Reflect the completion on the schedule's lastRun (best-effort; the run row is the truth).
  await updateSchedule(next.scheduleId, actor, (cur) => ({
    ...cur,
    lastRun: { runId: next._id, status: next.status, at: nowIso },
    updatedAt: nowIso,
  })).catch(() => null);
  return toWireRun(next);
}

export function previewSpec(spec: ScheduleSpec, count: number, deps: ScheduleServiceDeps): string[] {
  const now = new Date(deps.now());
  assertSpecValid(spec, now);
  return occurrencesOf(spec, now, now, count).map((d) => d.toISOString());
}
