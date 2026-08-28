// Automations domain contract (ch03 §3.8.18, §3.6.3): automations CRUD, plan-from-goal, runs, consent, catalog, approved commands.
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse, Language, Visibility } from './common.js';
import { AutomationRunEvent } from './events.js';
import { RunCredentialRequest } from './cofre.js';
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
  // The Cofre holds no usable credential for an origin the run needs (P3.1). Additive under Rule 7:
  // an old client that does not know the member renders it as an unknown status rather than
  // failing, and no persisted run written before this existed can carry it. The full set is pinned
  // by `api/tests/contract/run-status.test.ts` so the next member is a deliberate act.
  'needs_credentials',
]);
export type RunStatus = z.infer<typeof RunStatus>;

/** A step in an automation plan. */
/**
 * A planned step.
 *
 * THE PARAMETRISED FIELDS ARE DELIBERATELY LIMITED TO `integration`. The engine's own `Step`
 * additionally carries `commandTemplate` (a local command), `apiRequest` (an arbitrary outbound
 * HTTP call), `ekoaAction`, `subAutomationId` and `declaration` (which governs WHERE a step runs
 * and which Cofre items it may reference). This endpoint is `user-or-key`, so carrying those would
 * hand every gateway-key holder those authoring powers; they stay unauthorable here and the
 * service refuses a step that needs them, naming `POST /automations/plan` instead.
 *
 * `integration` is different in kind, not merely in degree: it can only ever name an integration
 * the RUN's own org already has, it is resolved at execution under the run's principal like any
 * other rail, and a mutating action still passes the write gate and comes back `awaiting_consent`
 * without a live approval. So the worst an authored integration step can express is a call the
 * caller could already make through
 * `POST /integrations/:key/actions/:name/execute`.
 */
export const PlanStep = z
  .object({
    stepId: Id.optional(),
    index: z.number().int().optional(),
    description: z.string().optional(),
    tool: z.string().optional(),
    argv: z.array(z.string()).optional(),
    /** `tool: 'integration'` only — which package, which action, and its argument template. */
    integrationKey: z.string().min(1).max(128).optional(),
    integrationAction: z.string().min(1).max(128).optional(),
    /** Values are strings: a literal, or a `{{input.x}}` reference the engine interpolates. */
    argsTemplate: z.record(z.string()).optional(),
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
 *
 * `integration` (additive, mint-on-plan): the per-site integration + wrapper action the plan
 * minted for this automation, when it did. Absent on plans that mint nothing (no outside origin,
 * unwritable row, mint refusal) - the plan itself is unaffected either way.
 */
export const PlanResponse = z.object({
  plan: Plan,
  automation: Automation.optional(),
  runId: Id.optional(),
  rehearsing: z.boolean().optional(),
  integration: z.object({ key: z.string(), actionName: z.string() }).optional(),
  /**
   * WHY no integration was minted, when none was (additive). Absent on a successful mint. A coded
   * reason rather than prose: the surface owns the wording, and "nothing happened" with no reason
   * was the first thing a live run stumbled on - the plan succeeded, the mint declined, and the
   * user had only a generic sentence and a server log to tell them apart.
   */
  integrationSkipped: z
    .enum(['no-origin', 'no-key', 'row-not-writable', 'published-row', 'store-error'])
    .optional(),
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

/**
 * What a run parked at `awaiting_consent` is asking a human to authorise — the command-shape
 * gate a `local_command` or `api_call` step raises before it runs.
 *
 * Published because `POST /runs/:id/consent` is `user-or-key` and its body REQUIRES `shape`,
 * while the only carrier of that shape was the SSE `runAwaitingConsent` event — and there is no
 * event stream on the key-reachable surface. A key holder could therefore read
 * `status: 'awaiting_consent'` and had no published way to learn what was being asked or which
 * shape to echo back: an endpoint whose auth class invites a caller who cannot use it.
 *
 * `argv` is deliberately NOT here. It is the raw command line, which the engine shows a human
 * only behind an explicit "what exactly will run?" toggle; `description` is the published
 * human-readable form. Widening this to the argv is a separate decision, not a side effect of
 * making the gate answerable. `approvalScope` is server-written bookkeeping and never leaves.
 */
export const RunConsentRequest = z.object({
  /** Index of the step that is blocked, matching `RunStepRecord.index`. */
  stepIndex: z.number().int(),
  /** Plain-English statement of what will run: "run cat to read a file". */
  description: z.string(),
  /** Fingerprint of the exact command shape being approved — echo it back to `/consent`. */
  shape: z.string(),
});
export type RunConsentRequest = z.infer<typeof RunConsentRequest>;

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
    /** Present exactly while `status === 'awaiting_consent'`; cleared when the run resumes. */
    consentRequest: RunConsentRequest.optional(),
    /**
     * Present exactly while `status === 'needs_credentials'`. This is the field a RELOADING client
     * reads: the halt survives the process and the page, so the banner must be reconstructible from
     * the run resource alone rather than from an SSE frame that was emitted before the reload.
     */
    credentialRequest: RunCredentialRequest.optional(),
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
 * picking one of them is exactly how a retry ends up executing twice. The header must appear AT
 * MOST ONCE for the same reason: repeated header lines are refused, never joined.
 *
 * Absent (no field, no header) the endpoint behaves exactly as before: every POST mints a fresh run.
 *
 * A 200 REPLAY IS "ALREADY ACCEPTED", NOT "CERTAINLY RUNNING". In one narrow interleaving the run
 * named by a replay never came into existence: the caller that won the key had its own start fail
 * and roll the claim back after this reply was already sent. A client must therefore treat a 404
 * from the following `GET /automations/runs/:id` as "the create did not take" and POST AGAIN WITH
 * THE SAME KEY — the rollback freed the key, so the retry starts a real run. (Retrying is always
 * safe: that is the point of the key.)
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
    successStatus: 201,
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
    /** 202 started a run; 200 is an idempotent replay of the SAME runId, started nothing. The
     *  status code is the only signal — the body is byte-identical either way. */
    successStatus: [202, 200],
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
