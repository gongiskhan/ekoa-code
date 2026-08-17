// Schedules domain contract: one Schedule entity covering one-time and recurring work, with a
// target union (manual human task | automation run | integration action). A schedule is a
// RECURRING RUN ATTACHED TO A TARGET WITH FIXED PARAMETERS — deliberately NOT a second
// automation/workflow entity (docs/decisions.md 2026-08-17). Runs execute AS the schedule's
// owner: `ownerUserId`/`orgId` are server-stamped from the verified actor at creation and are
// the fire-time authority; nothing here can widen a caller's reach.
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/**
 * What a schedule fires. Three kinds:
 *  - `manual`: a human task. Firing creates a `pending` run (a to-do the owner completes or
 *    dismisses); nothing executes.
 *  - `automation`: starts a run of an automation the OWNER owns, headless, as the owner. The
 *    service refuses a target the creating actor does not own — a schedule must never become a
 *    way to run a peer's automation.
 *  - `integration_action`: executes an integration action with the fixed `args`, as the owner,
 *    through the ONE existing executor rail. A mutating action still meets the write gate: with
 *    no live standing approval for the exact (shape, destination) the fire records a `blocked`
 *    run and stops — the scheduler never approves, never retries into consent.
 */
export const ScheduleTarget = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('manual'),
    /** Optional guidance shown with the pending task. */
    instructions: z.string().max(4000).optional(),
  }),
  z.object({
    kind: z.literal('automation'),
    automationId: Id,
    /** Fixed run inputs, passed verbatim to every fire. */
    inputs: z.record(z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal('integration_action'),
    integrationKey: z.string().min(1).max(128),
    actionName: z.string().min(1).max(128),
    /** Fixed action arguments, passed verbatim to every fire. */
    args: z.record(z.unknown()).optional(),
  }),
]);
export type ScheduleTarget = z.infer<typeof ScheduleTarget>;

/**
 * Recurrence rule. Wall-clock semantics in an IANA timezone (`Europe/Lisbon` style), so
 * "every day at 09:00" stays 09:00 across DST. Cross-field requirements are enforced by the
 * service (kept out of zod so the schema survives JSON-Schema conversion for OpenAPI):
 * `at` is required for day/week/month; `weekdays` only with `every:'week'`; `monthDay` only
 * with `every:'month'`. DST edges: a skipped local time shifts forward by the gap (01:30 on a
 * spring-forward night fires at 02:30); a repeated local time fires on its first occurrence.
 */
export const RecurrenceRule = z.object({
  every: z.enum(['minute', 'hour', 'day', 'week', 'month']),
  interval: z.number().int().min(1).max(999),
  /** Wall-clock time of day, for day/week/month cadences. */
  at: z
    .object({
      hour: z.number().int().min(0).max(23),
      minute: z.number().int().min(0).max(59),
    })
    .optional(),
  /** Days of week (0 = Sunday .. 6 = Saturday), for `every: 'week'`. */
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  /** Day of month (1..31, clamped to the month's length), for `every: 'month'`. */
  monthDay: z.number().int().min(1).max(31).optional(),
  /** IANA timezone name; validated by the service against the runtime's tz database. */
  timezone: z.string().min(1).max(64),
});
export type RecurrenceRule = z.infer<typeof RecurrenceRule>;

/** When a schedule fires: exactly once at an absolute instant, or on a recurrence rule. */
export const ScheduleSpec = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: IsoTimestamp }),
  z.object({ kind: z.literal('recurring'), rule: RecurrenceRule }),
]);
export type ScheduleSpec = z.infer<typeof ScheduleSpec>;

/**
 * One fire of a schedule.
 * Status vocabulary: `running|ok|failed|blocked` for executing targets (`blocked` = the write
 * gate answered `awaiting_consent` — the owner approves through the existing integrations
 * surface, never here); `pending|done|dismissed` for manual tasks. `detail.code` is the
 * machine-readable outcome; user-facing text derives from the CODE, never from server prose.
 */
export const ScheduleRunStatus = z.enum([
  'running',
  'ok',
  'failed',
  'blocked',
  'pending',
  'done',
  'dismissed',
]);
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatus>;

export const ScheduleRun = z
  .object({
    id: Id,
    scheduleId: Id,
    status: ScheduleRunStatus,
    /** The occurrence this run realises (what the calendar said); `firedAt` is when it ran. */
    plannedFor: IsoTimestamp,
    firedAt: IsoTimestamp.optional(),
    finishedAt: IsoTimestamp.optional(),
    /** `auto` = the timer fired it; `manual` = run-now or a task the owner completed. */
    trigger: z.enum(['auto', 'manual']),
    detail: z
      .object({
        code: z.string().max(64).optional(),
        message: z.string().max(2000).optional(),
      })
      .optional(),
    /** Present for automation targets: the started automation run, for drill-down. */
    automationRunId: Id.optional(),
    /** Completion note on a manual task. */
    note: z.string().max(2000).optional(),
    ownerId: Id.optional(),
    orgId: Id.optional(),
  })
  .passthrough();
export type ScheduleRun = z.infer<typeof ScheduleRun>;

/** Summary of the most recent fire, denormalised onto the schedule for list rendering. */
export const ScheduleLastRun = z
  .object({
    runId: Id,
    status: ScheduleRunStatus,
    at: IsoTimestamp,
    code: z.string().max(64).optional(),
  })
  .passthrough();
export type ScheduleLastRun = z.infer<typeof ScheduleLastRun>;

export const Schedule = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().optional(),
    target: ScheduleTarget,
    spec: ScheduleSpec,
    enabled: z.boolean(),
    /** Next planned fire; null when exhausted (a fired `once`) or disabled. */
    nextRunAt: IsoTimestamp.nullable(),
    lastRun: ScheduleLastRun.optional(),
    consecutiveFailures: z.number().int().min(0).optional(),
    /** Set when the supervisor disabled the schedule after repeated failures. */
    autoPausedAt: IsoTimestamp.optional(),
    ownerId: Id.optional(),
    orgId: Id.optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type Schedule = z.infer<typeof Schedule>;

export const ScheduleCreateRequest = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  target: ScheduleTarget,
  spec: ScheduleSpec,
  /** Defaults to true. */
  enabled: z.boolean().optional(),
});
export type ScheduleCreateRequest = z.infer<typeof ScheduleCreateRequest>;

/** Partial update. Replacing `target`/`spec` re-validates exactly as create does and recomputes
 *  `nextRunAt` from now — a paused-then-edited schedule never fires a stale occurrence. */
export const SchedulePatch = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  target: ScheduleTarget.optional(),
  spec: ScheduleSpec.optional(),
  enabled: z.boolean().optional(),
});
export type SchedulePatch = z.infer<typeof SchedulePatch>;

export const ScheduleListResponse = itemsResponse(Schedule);
export type ScheduleListResponse = z.infer<typeof ScheduleListResponse>;

export const ScheduleRunListQuery = z.object({
  status: ScheduleRunStatus.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type ScheduleRunListQuery = z.infer<typeof ScheduleRunListQuery>;

export const ScheduleRunListResponse = itemsResponse(ScheduleRun);
export type ScheduleRunListResponse = z.infer<typeof ScheduleRunListResponse>;

/** Body for completing a `pending` manual task. */
export const ScheduleRunCompleteRequest = z.object({
  outcome: z.enum(['done', 'dismissed']),
  note: z.string().max(2000).optional(),
});
export type ScheduleRunCompleteRequest = z.infer<typeof ScheduleRunCompleteRequest>;

export const ScheduleRunResponse = z.object({ run: ScheduleRun });
export type ScheduleRunResponse = z.infer<typeof ScheduleRunResponse>;

/** Preview the next occurrences of a spec — the SERVER is the single source of occurrence
 *  math, so the create-form preview can never drift from what the supervisor will do. */
export const SchedulePreviewRequest = z.object({
  spec: ScheduleSpec,
  count: z.number().int().min(1).max(10).optional(),
});
export type SchedulePreviewRequest = z.infer<typeof SchedulePreviewRequest>;

export const SchedulePreviewResponse = z.object({
  occurrences: z.array(IsoTimestamp),
});
export type SchedulePreviewResponse = z.infer<typeof SchedulePreviewResponse>;

/**
 * Schedules is a CAPABILITY domain (Capability Contract rule 4): every route carries
 * `user-or-key` and the router mounts `requireUserOrApiKey`, so an outside client — or an
 * agent holding a user-scoped gateway key — can create and manage schedules ("agent-driven"
 * scheduling). The key is never wider than its user: fire-time authority is the stored owner,
 * and visibility is owner + org-admin, enforced in the service against the live role.
 *
 * `listAllRuns` and `completeRun` live under `/api/v1/schedules/runs...` and are mounted
 * BEFORE `/:id` so the literal segment wins over the id parameter.
 */
export const schedulesEndpoints = {
  list: {
    method: 'GET',
    path: '/api/v1/schedules',
    auth: 'user-or-key',
    response: ScheduleListResponse,
  },
  create: {
    method: 'POST',
    path: '/api/v1/schedules',
    auth: 'user-or-key',
    request: ScheduleCreateRequest,
    response: Schedule,
    successStatus: 201,
  },
  /** Org-wide run feed (the task inbox + history timeline). Mounted before `/:id`. */
  listAllRuns: {
    method: 'GET',
    path: '/api/v1/schedules/runs',
    auth: 'user-or-key',
    query: ScheduleRunListQuery,
    response: ScheduleRunListResponse,
  },
  completeRun: {
    method: 'POST',
    path: '/api/v1/schedules/runs/:runId/complete',
    auth: 'user-or-key',
    request: ScheduleRunCompleteRequest,
    response: ScheduleRunResponse,
  },
  preview: {
    method: 'POST',
    path: '/api/v1/schedules/preview',
    auth: 'user-or-key',
    request: SchedulePreviewRequest,
    response: SchedulePreviewResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/schedules/:id',
    auth: 'user-or-key',
    response: Schedule,
  },
  patch: {
    method: 'PATCH',
    path: '/api/v1/schedules/:id',
    auth: 'user-or-key',
    request: SchedulePatch,
    response: Schedule,
  },
  remove: {
    method: 'DELETE',
    path: '/api/v1/schedules/:id',
    auth: 'user-or-key',
    response: OkResponse,
  },
  /** Fire now, out of band: does not advance `nextRunAt`. 202 — the fire is asynchronous for
   *  executing targets; the answered run row is `running` (or `pending` for a manual task). */
  runNow: {
    method: 'POST',
    path: '/api/v1/schedules/:id/run-now',
    auth: 'user-or-key',
    response: ScheduleRunResponse,
    successStatus: 202,
  },
  listRuns: {
    method: 'GET',
    path: '/api/v1/schedules/:id/runs',
    auth: 'user-or-key',
    query: ScheduleRunListQuery,
    response: ScheduleRunListResponse,
  },
} as const satisfies DomainDescriptorMap;
