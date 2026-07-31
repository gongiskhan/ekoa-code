// Automations domain contract (ch03 §3.8.18, §3.6.3): automations CRUD, plan-from-goal, runs, consent, catalog, approved commands.
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse, Language, Visibility } from './common.js';
import { AutomationRunEvent } from './events.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** Run status machine (ch03 §3.6.3; ops-inventory §17). */
export const RunStatus = z.enum([
  'idle',
  'running',
  'completed',
  'failed',
  'cancelled',
  'awaiting_integration',
  'paused_for_user',
  'awaiting_consent',
  'awaiting_daemon',
]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A step in an automation plan. */
export const PlanStep = z
  .object({
    stepId: Id.optional(),
    index: z.number().int().optional(),
    description: z.string().optional(),
    tool: z.string().optional(),
    argv: z.array(z.string()).optional(),
  })
  .passthrough();
export type PlanStep = z.infer<typeof PlanStep>;

/** The planned step sequence for an automation. `status` carries the outcome: `ok` |
 *  `awaiting_integration` | `plan_failed` (F29 — the model could not produce a usable plan; the
 *  human-readable cause is on `reason`) | `plan_unavailable` (the model egress itself failed —
 *  outage/credential, not the user's goal; `reason` carries the retry-soon message). */
export const Plan = z
  .object({
    steps: z.array(PlanStep).optional(),
    status: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();
export type Plan = z.infer<typeof Plan>;

export const Automation = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string().optional(),
    plan: Plan.optional(),
    status: z.string().optional(),
    ownerId: Id.optional(),
    orgId: Id.optional(),
    visibility: Visibility.optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type Automation = z.infer<typeof Automation>;

export const AutomationCreateRequest = z
  .object({
    name: z.string(),
    description: z.string().optional(),
    plan: Plan.optional(),
    visibility: Visibility.optional(),
  })
  .passthrough();
export type AutomationCreateRequest = z.infer<typeof AutomationCreateRequest>;

export const AutomationPatch = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    plan: Plan.optional(),
    status: z.string().optional(),
    visibility: Visibility.optional(),
  })
  .passthrough();
export type AutomationPatch = z.infer<typeof AutomationPatch>;

/** Plan-from-goal request (language-carrying, ch03 §3.4). */
export const PlanRequest = z.object({
  goal: z.string(),
  name: z.string().optional(),
  automationId: Id.optional(),
  language: Language,
});
export type PlanRequest = z.infer<typeof PlanRequest>;

/**
 * Landmine 9: plan-from-goal is not pure planning - it persists the automation
 * and starts a rehearsal run, so the response names both side effects.
 */
export const PlanResponse = z.object({
  plan: Plan,
  automation: Automation.optional(),
  runId: Id.optional(),
  rehearsing: z.boolean().optional(),
});
export type PlanResponse = z.infer<typeof PlanResponse>;

/**
 * A run's per-step record as serialized for the Histórico detail (ch03 §3.6.3). Lean by design:
 * carries the outcome fields the UI renders (status, tier, duration, a one-line error) plus the
 * served screenshot URL (`/automation-screenshots/...`, a capability path) — never the disk
 * `screenshotPath` (the client must not know the storage layout) and never the heavy per-step
 * output payload. All fields optional + passthrough so the serializer can stay tolerant.
 */
export const RunStepRecord = z
  .object({
    stepId: z.string().optional(),
    index: z.number().int().optional(),
    status: z.string().optional(),
    tier: z.string().optional(),
    durationMs: z.number().optional(),
    error: z
      .object({ message: z.string(), recoverable: z.boolean().optional() })
      .passthrough()
      .optional(),
    screenshotUrl: z.string().optional(),
  })
  .passthrough();
export type RunStepRecord = z.infer<typeof RunStepRecord>;

export const RunRecord = z
  .object({
    id: Id,
    automationId: Id,
    status: RunStatus,
    inputs: z.record(z.unknown()).optional(),
    summary: z.string().optional(),
    startedAt: IsoTimestamp.optional(),
    finishedAt: IsoTimestamp.optional(),
    ownerId: Id.optional(),
    orgId: Id.optional(),
    /** Per-step outcomes for the run detail view (screenshots, status, timing). Optional so a lean
     *  list response may omit them; present on GET /runs/:id and the list serialization. */
    steps: z.array(RunStepRecord).optional(),
  })
  .passthrough();
export type RunRecord = z.infer<typeof RunRecord>;

/** Max length of a caller-supplied idempotency key (slice E4). Long enough for a UUID, a
 *  `<client>:<uuid>` tag or a hash; short enough that the dedupe `_id` derivation stays cheap. */
export const IDEMPOTENCY_KEY_MAX = 128;

/** A caller-chosen idempotency key: 1..128 chars, opaque to the server (never parsed, only
 *  hashed with the automation + run-owner ids into the dedupe key). */
export const IdempotencyKey = z.string().min(1).max(IDEMPOTENCY_KEY_MAX);
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/**
 * Run-create body. `idempotencyKey` (slice E4, ADDITIVE + optional) makes a create at-most-once
 * for the (automation, run owner, key) triple: the first call answers **202 {runId}**, every later
 * call with the same key answers **200** with the SAME runId and starts nothing.
 *
 * The key may equally be sent as the `Idempotency-Key` REQUEST HEADER (the conventional spelling an
 * HTTP client library sets). The two are the same field: if BOTH are present and DISAGREE the
 * request is refused with VALIDATION_FAILED — a body/header mismatch is a client bug, and silently
 * picking one of them is exactly how a retry ends up executing twice.
 *
 * Absent (no field, no header) the endpoint behaves exactly as before: every POST mints a fresh run.
 */
export const RunCreateRequest = z.object({
  inputs: z.record(z.unknown()).optional(),
  idempotencyKey: IdempotencyKey.optional(),
});
export type RunCreateRequest = z.infer<typeof RunCreateRequest>;

export const RunCreateResponse = z.object({ runId: Id });
export type RunCreateResponse = z.infer<typeof RunCreateResponse>;

/**
 * One step's captured log (slice E4). `log` is a BOUNDED tail — the engine keeps at most
 * `RUN_LOG_STEP_MAX_CHARS` per step while the run streams, and the endpoint re-caps whatever it
 * serves — so `truncated: true` means "output was dropped", never "the step failed". A step that
 * produced no capturable output is simply absent from the list.
 */
export const RunLogStep = z.object({
  stepIndex: z.number().int().nonnegative(),
  log: z.string(),
  truncated: z.boolean(),
});
export type RunLogStep = z.infer<typeof RunLogStep>;

/** Per-step logs for one run (GET /automations/runs/:id/logs), owner-scoped exactly like the run
 *  record itself — a run the caller may not see answers the same uniform NOT_FOUND. */
export const RunLogsResponse = z.object({
  runId: Id,
  steps: z.array(RunLogStep),
});
export type RunLogsResponse = z.infer<typeof RunLogsResponse>;

/** Wire-visible bounds of the logs surface (slice E4). Pinned in the contract so a client can size
 *  its own buffers: per step, and across the whole run's response. */
export const RUN_LOG_STEP_MAX_CHARS = 16 * 1024;
export const RUN_LOG_TOTAL_MAX_CHARS = 128 * 1024;

export const RunCancelResponse = z.object({ cancelled: z.boolean() });
export type RunCancelResponse = z.infer<typeof RunCancelResponse>;

export const RunResumeResponse = z.object({ resumed: z.boolean() });
export type RunResumeResponse = z.infer<typeof RunResumeResponse>;

export const ConsentRequest = z.object({
  decision: z.enum(['once', 'always', 'stop']),
  shape: z.string(),
});
export type ConsentRequest = z.infer<typeof ConsentRequest>;

export const ConsentResult = z
  .object({
    decision: z.enum(['once', 'always', 'stop']).optional(),
    resumed: z.boolean().optional(),
    persisted: z.boolean().optional(),
  })
  .passthrough();
export type ConsentResult = z.infer<typeof ConsentResult>;

export const StepFeedbackRequest = z.object({
  kind: z.string(),
  note: z.string().optional(),
});
export type StepFeedbackRequest = z.infer<typeof StepFeedbackRequest>;

export const StepFeedbackResponse = z.object({
  ok: z.literal(true),
  evicted: z.boolean().optional(),
});
export type StepFeedbackResponse = z.infer<typeof StepFeedbackResponse>;

export const CatalogEntry = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();
export type CatalogEntry = z.infer<typeof CatalogEntry>;

export const CatalogResponse = z.object({
  automations: z.array(CatalogEntry),
  integrationActions: z.array(CatalogEntry),
});
export type CatalogResponse = z.infer<typeof CatalogResponse>;

export const ApprovedCommand = z
  .object({
    shape: z.string(),
    description: z.string().optional(),
    createdAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type ApprovedCommand = z.infer<typeof ApprovedCommand>;

export const RevokeApprovedCommandRequest = z.object({ shape: z.string() });
export type RevokeApprovedCommandRequest = z.infer<typeof RevokeApprovedCommandRequest>;

export const RevokeApprovedCommandResponse = z.object({
  revoked: z.boolean(),
  remaining: z.number().int().nonnegative(),
});
export type RevokeApprovedCommandResponse = z.infer<typeof RevokeApprovedCommandResponse>;

export const AutomationListResponse = itemsResponse(Automation);
export type AutomationListResponse = z.infer<typeof AutomationListResponse>;

export const RunListResponse = itemsResponse(RunRecord);
export type RunListResponse = z.infer<typeof RunListResponse>;

export const ApprovedCommandListResponse = itemsResponse(ApprovedCommand);
export type ApprovedCommandListResponse = z.infer<typeof ApprovedCommandListResponse>;

export const RunListQuery = z.object({
  automationId: Id.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type RunListQuery = z.infer<typeof RunListQuery>;

/**
 * Automations is a CAPABILITY domain (Capability Contract rule 4): every route below the router
 * carries AuthClass `user-or-key` and the router mounts `requireUserOrApiKey` — a platform JWT
 * delegates to requireAuth untouched, an `ekoa_gk_` gateway key admits the same call, so an
 * outside client can drive a run without a browser session.
 *
 * TWO DELIBERATE EXCEPTIONS:
 *  - `events` stays `token-query`. It is the run's SSE stream and its `?token=` is a real platform
 *    JWT (jti-bearing); admitting a key here would let a key ride a durable session token that
 *    survives the key's revocation (E1 review, binding constraint). A key holder polls instead.
 *  - `create`'s AuthClass names the CREDENTIAL class, not the role: creation is still org-admin by
 *    default, enforced in the service (`canCreateAutomation`) against the role the middleware
 *    re-reads live from the users store on every key call. A builder's key is refused exactly as a
 *    builder's JWT is.
 */
export const automationsEndpoints = {
  list: {
    method: 'GET',
    path: '/api/v1/automations',
    auth: 'user-or-key',
    response: AutomationListResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/automations/:id',
    auth: 'user-or-key',
    response: Automation,
  },
  create: {
    method: 'POST',
    path: '/api/v1/automations',
    auth: 'user-or-key',
    request: AutomationCreateRequest,
    response: Automation,
  },
  patch: {
    method: 'PATCH',
    path: '/api/v1/automations/:id',
    auth: 'user-or-key',
    request: AutomationPatch,
    response: Automation,
  },
  remove: {
    method: 'DELETE',
    path: '/api/v1/automations/:id',
    auth: 'user-or-key',
    response: OkResponse,
  },
  plan: {
    method: 'POST',
    path: '/api/v1/automations/plan',
    auth: 'user-or-key',
    request: PlanRequest,
    response: PlanResponse,
    language: true,
  },
  createRun: {
    method: 'POST',
    path: '/api/v1/automations/:id/runs',
    auth: 'user-or-key',
    request: RunCreateRequest,
    response: RunCreateResponse,
  },
  listRuns: {
    method: 'GET',
    path: '/api/v1/automations/runs',
    auth: 'user-or-key',
    query: RunListQuery,
    response: RunListResponse,
  },
  getRun: {
    method: 'GET',
    path: '/api/v1/automations/runs/:id',
    auth: 'user-or-key',
    response: RunRecord,
  },
  getRunLogs: {
    method: 'GET',
    path: '/api/v1/automations/runs/:id/logs',
    auth: 'user-or-key',
    response: RunLogsResponse,
  },
  cancelRun: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/cancel',
    auth: 'user-or-key',
    response: RunCancelResponse,
  },
  resumeRun: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/resume',
    auth: 'user-or-key',
    response: RunResumeResponse,
  },
  consent: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/consent',
    auth: 'user-or-key',
    request: ConsentRequest,
    response: ConsentResult,
  },
  stepFeedback: {
    method: 'POST',
    path: '/api/v1/automations/runs/:id/steps/:stepId/feedback',
    auth: 'user-or-key',
    request: StepFeedbackRequest,
    response: StepFeedbackResponse,
  },
  events: {
    method: 'GET',
    path: '/api/v1/automations/runs/:id/events',
    auth: 'token-query',
    kind: 'sse',
    response: AutomationRunEvent,
  },
  catalog: {
    method: 'GET',
    path: '/api/v1/automations/catalog',
    auth: 'user-or-key',
    response: CatalogResponse,
  },
  approvedCommands: {
    method: 'GET',
    path: '/api/v1/automations/approved-commands',
    auth: 'user-or-key',
    response: ApprovedCommandListResponse,
  },
  revokeApprovedCommand: {
    method: 'POST',
    path: '/api/v1/automations/approved-commands/revoke',
    auth: 'user-or-key',
    request: RevokeApprovedCommandRequest,
    response: RevokeApprovedCommandResponse,
  },
} as const satisfies DomainDescriptorMap;
