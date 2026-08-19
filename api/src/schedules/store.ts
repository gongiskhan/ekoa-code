/**
 * Schedule store — the typed layer over the `schedules` / `schedule_runs` collections
 * (registered in data/stores.ts; the generic Store gives _rev CAS + deterministic-_id insert).
 *
 * Tenancy (the memvault discipline):
 *  - `orgId` + `ownerUserId` are SERVER-STAMPED from the verified actor at creation, never a body.
 *  - Reads: owner sees own; org-admin sees the org's; super-admin sees all (the automations
 *    listRuns precedent). Mutations are OWNER-ONLY (+ super-admin): a schedule fires as its
 *    owner, so letting an org-admin edit a peer's schedule would let one principal aim another
 *    principal's authority.
 *  - A hidden row and a missing row answer the IDENTICAL `null` — routes turn both into one
 *    uniform NOT_FOUND envelope (no existence oracle).
 */
import { createHash } from 'node:crypto';
import type { Actor, ScheduleLastRun, ScheduleRunStatus, ScheduleSpec, ScheduleTarget } from '@ekoa/shared';
import { schedules, scheduleRuns } from '../data/stores.js';
import type { Doc } from '../data/store.js';

export interface ScheduleDoc extends Doc {
  _id: string;
  orgId: string;
  ownerUserId: string;
  name: string;
  description?: string;
  target: ScheduleTarget;
  spec: ScheduleSpec;
  enabled: boolean;
  /** Next planned fire (ISO); null = disabled or exhausted. The supervisor's due query. */
  nextRunAt: string | null;
  lastRun?: ScheduleLastRun;
  consecutiveFailures: number;
  /**
   * Consecutive fires that ended in a NEUTRAL block (`supervisor.ts` `NEUTRAL_BLOCKED_CODES`).
   * Separate from `consecutiveFailures` precisely because a neutral block is not a failure: it
   * drives the COOLDOWN below and never the ceiling. Reset by any non-neutral outcome, and by an
   * owner re-enabling the schedule.
   */
  consecutiveNeutralBlocks?: number;
  /**
   * While this instant is in the future the supervisor advances the pointer WITHOUT firing: no run
   * row, no automation run, no notification. A neutral halt is one that waiting fixes, so the way
   * to bound its cost is to wait LONGER rather than to count it (`neutralBackoffMs`).
   */
  neutralBackoffUntil?: string | null;
  /** When the owner was last told about a CONTINUING neutral block, for the re-notify floor. */
  lastNeutralNotifiedAt?: string;
  autoPausedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRunDoc extends Doc {
  _id: string;
  scheduleId: string;
  orgId: string;
  ownerUserId: string;
  status: ScheduleRunStatus;
  plannedFor: string;
  firedAt?: string;
  finishedAt?: string;
  trigger: 'auto' | 'manual';
  detail?: { code?: string; message?: string };
  automationRunId?: string;
  note?: string;
  createdAt: string;
}

const isAdmin = (a: Actor): boolean => a.role === 'org-admin' || a.role === 'super-admin';

/** Read visibility. Empty-orgId actors match nothing (the house fail-closed rule). */
export function canSeeSchedule(doc: Pick<ScheduleDoc, 'orgId' | 'ownerUserId'>, actor: Actor): boolean {
  if (actor.role === 'super-admin') return true;
  if (!actor.orgId || doc.orgId !== actor.orgId) return false;
  return doc.ownerUserId === actor.userId || isAdmin(actor);
}

/** Write authority: the owner, or a super-admin. */
export function canEditSchedule(doc: Pick<ScheduleDoc, 'orgId' | 'ownerUserId'>, actor: Actor): boolean {
  if (actor.role === 'super-admin') return true;
  if (!actor.orgId || doc.orgId !== actor.orgId) return false;
  return doc.ownerUserId === actor.userId;
}

export async function getSchedule(id: string, actor: Actor): Promise<ScheduleDoc | null> {
  const doc = (await schedules.get(id)) as ScheduleDoc | null;
  if (!doc || !canSeeSchedule(doc, actor)) return null;
  return doc;
}

export async function listSchedules(actor: Actor): Promise<ScheduleDoc[]> {
  const filter: Record<string, unknown> = {};
  if (actor.role !== 'super-admin') {
    if (!actor.orgId) return [];
    filter.orgId = actor.orgId;
    if (!isAdmin(actor)) filter.ownerUserId = actor.userId;
  }
  return (await schedules.find(filter, { createdAt: -1 })) as ScheduleDoc[];
}

export async function insertSchedule(doc: ScheduleDoc): Promise<boolean> {
  return schedules.insert(doc as Doc);
}

/** CAS update; the authorisation is re-asserted INSIDE the mutator (Store.update re-reads on a
 *  lost race, so a pre-checked gate can be stale — the definition-store discipline). Returns
 *  null when missing OR refused: callers answer one uniform NOT_FOUND. */
export async function updateSchedule(
  id: string,
  actor: Actor,
  mutate: (cur: ScheduleDoc) => ScheduleDoc,
): Promise<ScheduleDoc | null> {
  let refused = false;
  const next = await schedules.update(id, (cur) => {
    refused = !canEditSchedule(cur as ScheduleDoc, actor);
    if (refused) return cur;
    return mutate(cur as ScheduleDoc) as Doc;
  });
  if (!next || refused) return null;
  return next as ScheduleDoc;
}

/** The supervisor's own advance (no actor — the fire runs under the stored owner). */
export async function updateScheduleSystem(
  id: string,
  mutate: (cur: ScheduleDoc) => ScheduleDoc,
): Promise<ScheduleDoc | null> {
  const next = await schedules.update(id, (cur) => mutate(cur as ScheduleDoc) as Doc);
  return (next as ScheduleDoc | null) ?? null;
}

export async function deleteSchedule(id: string): Promise<boolean> {
  const deleted = await schedules.delete(id);
  if (deleted) await scheduleRuns.deleteMany({ scheduleId: id });
  return deleted;
}

/** Every enabled schedule due at `nowIso` (the supervisor tick's read). */
export async function listDueSchedules(nowIso: string): Promise<ScheduleDoc[]> {
  const rows = (await schedules.find({ enabled: true }, { nextRunAt: 1 })) as ScheduleDoc[];
  return rows.filter((s) => s.nextRunAt !== null && s.nextRunAt <= nowIso);
}

/** Deterministic run id for a timer fire: at-most-once per (schedule, occurrence) across
 *  crashes — the insert IS the claim (§4.3.2). */
export function occurrenceRunId(scheduleId: string, plannedForIso: string): string {
  return createHash('sha256').update(JSON.stringify([scheduleId, plannedForIso])).digest('hex').slice(0, 32);
}

/** Claim + record a fire in one insert. False = this occurrence was already claimed. */
export async function insertRun(doc: ScheduleRunDoc): Promise<boolean> {
  return scheduleRuns.insert(doc as Doc);
}

export async function finalizeRun(
  runId: string,
  patch: Partial<Pick<ScheduleRunDoc, 'status' | 'finishedAt' | 'detail' | 'automationRunId' | 'note'>>,
): Promise<ScheduleRunDoc | null> {
  const next = await scheduleRuns.update(runId, (cur) => ({ ...cur, ...patch }) as Doc);
  return (next as ScheduleRunDoc | null) ?? null;
}

export async function getRun(runId: string, actor: Actor): Promise<ScheduleRunDoc | null> {
  const doc = (await scheduleRuns.get(runId)) as ScheduleRunDoc | null;
  if (!doc || !canSeeSchedule(doc, actor)) return null;
  return doc;
}

/** Owner-only run mutation (completing a manual task drives the owner's own task list). */
export async function updateRunAsOwner(
  runId: string,
  actor: Actor,
  mutate: (cur: ScheduleRunDoc) => ScheduleRunDoc,
): Promise<ScheduleRunDoc | null> {
  let refused = false;
  const next = await scheduleRuns.update(runId, (cur) => {
    refused = !canEditSchedule(cur as ScheduleRunDoc, actor);
    if (refused) return cur;
    return mutate(cur as ScheduleRunDoc) as Doc;
  });
  if (!next || refused) return null;
  return next as ScheduleRunDoc;
}

/** One schedule's history. The caller has already proved it may SEE the schedule, so no tenancy
 *  filter here - but the declared `status` narrowing is applied, same shape as the org feed. */
export async function listRunsForSchedule(
  scheduleId: string,
  query: { status?: ScheduleRunStatus; limit: number },
): Promise<ScheduleRunDoc[]> {
  const filter: Record<string, unknown> = { scheduleId };
  if (query.status) filter.status = query.status;
  const rows = (await scheduleRuns.find(filter, { plannedFor: -1 })) as ScheduleRunDoc[];
  return rows.slice(0, query.limit);
}

export async function listRunsForActor(
  actor: Actor,
  query: { status?: ScheduleRunStatus; limit: number },
): Promise<ScheduleRunDoc[]> {
  const filter: Record<string, unknown> = {};
  if (actor.role !== 'super-admin') {
    if (!actor.orgId) return [];
    filter.orgId = actor.orgId;
    if (!isAdmin(actor)) filter.ownerUserId = actor.userId;
  }
  if (query.status) filter.status = query.status;
  const rows = (await scheduleRuns.find(filter, { plannedFor: -1 })) as ScheduleRunDoc[];
  return rows.slice(0, query.limit);
}
