/** Integrations domain contract (ch03 §3.8.13): definitions, active catalog, configs, session capture. */
import { z } from 'zod';
import { IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const IntegrationDefinition = z
  .object({
    key: z.string(),
    displayName: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    icon: z.string().optional(),
    authType: z.string().optional(),
    userCreated: z.boolean().optional(),
    actions: z.array(z.record(z.unknown())).optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type IntegrationDefinition = z.infer<typeof IntegrationDefinition>;

export const ActiveIntegration = z
  .object({
    key: z.string(),
    displayName: z.string().optional(),
    actions: z.array(z.record(z.unknown())).optional(),
    webhookEvents: z.array(z.record(z.unknown())).optional(),
    listenerEvents: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export type ActiveIntegration = z.infer<typeof ActiveIntegration>;

export const IntegrationConfigSummary = z
  .object({
    integrationKey: z.string(),
    enabled: z.boolean().optional(),
    displayName: z.string().optional(),
    configuredFields: z.array(z.string()).optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type IntegrationConfigSummary = z.infer<typeof IntegrationConfigSummary>;

/** Capture STATUS metadata only (ch05 session-connect). The captured Playwright storageState /
 *  cookies are SECRET, consumed in-memory by the automation engine (§5.6.7, invariant I2), and
 *  MUST NEVER be serialized to a client - so this nested shape is bounded to status metadata, not
 *  an open record that could carry the storageState. */
export const SessionSnapshot = z.object({
  status: z.enum(['none', 'waiting_login', 'captured', 'failed']),
  capturedAt: z.string().nullable().optional(),
  message: z.string().optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

/** One per-action row of a session status: automation-binding STATUS metadata only (never
 *  session secrets — same bound as SessionSnapshot above). Not exported: exercised through
 *  SessionCaptureStatus by the contract suite. */
const SessionActionRow = z
  .object({
    actionName: z.string(),
    description: z.string().optional(),
    mutates: z.boolean().optional(),
    automationTemplate: z.string().nullable().optional(),
    automationId: z.string().nullable().optional(),
    automationName: z.string().nullable().optional(),
    provisioned: z.boolean().optional(),
  })
  .passthrough();

/** Capture-capability metadata for the dashboard's session-connect panel: whether this
 *  environment can run a capture at all, and the operator-facing message when it cannot. */
const SessionConnectInfo = z.object({
  supported: z.boolean(),
  available: z.boolean(),
  loginUrl: z.string().optional(),
  message: z.string().optional(),
});

export const SessionCaptureStatus = z
  .object({
    integrationKey: z.string().optional(),
    status: z.string(),
    sessionConnect: SessionConnectInfo.optional(),
    session: SessionSnapshot.optional(),
    actions: z.array(SessionActionRow).optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type SessionCaptureStatus = z.infer<typeof SessionCaptureStatus>;

export const IntegrationDefinitionListResponse = itemsResponse(IntegrationDefinition);
export type IntegrationDefinitionListResponse = z.infer<typeof IntegrationDefinitionListResponse>;

export const ActiveIntegrationListResponse = itemsResponse(ActiveIntegration);
export type ActiveIntegrationListResponse = z.infer<typeof ActiveIntegrationListResponse>;

export const IntegrationConfigListResponse = itemsResponse(IntegrationConfigSummary);
export type IntegrationConfigListResponse = z.infer<typeof IntegrationConfigListResponse>;

export const CreateConfigRequest = z.object({
  integrationKey: z.string(),
  configValues: z.record(z.unknown()),
});
export type CreateConfigRequest = z.infer<typeof CreateConfigRequest>;

export const UpdateConfigRequest = z.object({
  enabled: z.boolean().optional(),
  configValues: z.record(z.unknown()).optional(),
});
export type UpdateConfigRequest = z.infer<typeof UpdateConfigRequest>;

export const RefreshRegistryResponse = z.object({
  count: z.number().int().nonnegative(),
  keys: z.array(z.string()),
});
export type RefreshRegistryResponse = z.infer<typeof RefreshRegistryResponse>;

export const ConnectSessionResponse = z.object({
  started: z.boolean(),
  // Status metadata only (see SessionSnapshot) - never the captured storageState.
  session: z.object({
    status: z.enum(['waiting_login', 'failed']),
    message: z.string().optional(),
  }),
});
export type ConnectSessionResponse = z.infer<typeof ConnectSessionResponse>;

export const ProvisionAutomationsResponse = z.object({
  provisioned: z.boolean(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  actions: z.array(z.record(z.unknown())),
});
export type ProvisionAutomationsResponse = z.infer<typeof ProvisionAutomationsResponse>;

/* --- Definition sharing (slice E1) ---------------------------------------------------------- */

/**
 * The visibility a TENANT may set on its own integration definition. Deliberately a TWO-value
 * enum: `global` is the cross-org tier and a super-admin review gate, so the wire contract of the
 * tenant route cannot even EXPRESS "publish to every org" — a `{"visibility":"global"}` body is a
 * 400 at the schema, before any handler or store gate is consulted. The only route to `global` is
 * the separate super-admin toggle below.
 *
 * Declared here rather than reusing `common.ts`'s `Visibility` so the exclusion is local and
 * load-bearing: this contract must not widen because some other domain's sharing model gains a
 * tier.
 */
export const TenantDefinitionVisibility = z.enum(['private', 'org']);
export type TenantDefinitionVisibility = z.infer<typeof TenantDefinitionVisibility>;

/** The full three-tier visibility a definition can REPORT (the read side does include `global`). */
export const DefinitionVisibility = z.enum(['private', 'org', 'global']);
export type DefinitionVisibility = z.infer<typeof DefinitionVisibility>;

export const SetDefinitionVisibilityRequest = z.object({ visibility: TenantDefinitionVisibility });
export type SetDefinitionVisibilityRequest = z.infer<typeof SetDefinitionVisibilityRequest>;

export const SetDefinitionGlobalRequest = z.object({ global: z.boolean() });
export type SetDefinitionGlobalRequest = z.infer<typeof SetDefinitionGlobalRequest>;

/**
 * Both sharing writes answer the same echo: the house `ok` flag plus the visibility now stored.
 * The definition VIEW is deliberately NOT the response — the read projection drops the storage
 * envelope (`_id`, `orgId`, `userId`, `visibility`) on purpose, so it cannot report the one field
 * these routes change.
 */
export const DefinitionVisibilityResponse = z.object({
  ok: z.literal(true),
  visibility: DefinitionVisibility,
});
export type DefinitionVisibilityResponse = z.infer<typeof DefinitionVisibilityResponse>;

/* --- The write gate (slice C2) --------------------------------------------------------------- */

/**
 * A human's answer to "may this action write on my behalf".
 *
 *   `once`   — this run only. Single-use and short-lived: the next execution CLAIMS it (atomically
 *              deleting it), so it can never authorise a second write.
 *   `always` — a standing approval, 90 days, revocable.
 *
 * There is deliberately no `never`: refusing is simply not approving, and a persisted "no" would be
 * a second thing to expire, revoke and reason about for no behavioural gain.
 */
export const IntegrationActionApprovalDecision = z.enum(['once', 'always']);
export type IntegrationActionApprovalDecision = z.infer<typeof IntegrationActionApprovalDecision>;

/**
 * The per-action approval row the dashboard renders. `shape` is the fingerprint of the action's
 * executable content (method + URL + templates, or the bound automation): it is what an approval is
 * keyed on, so re-authoring an action does not inherit the approval given to the old one — and it
 * is what the client must echo back when the user confirms, so an approval can only ever be banked
 * for the shape the human was actually shown.
 */
export const IntegrationActionApproval = z.object({
  actionName: z.string(),
  description: z.string(),
  /** Human-readable statement of what runs, e.g. `POST https://slack.com/api/chat.postMessage`. */
  target: z.string(),
  shape: z.string(),
  /** Whether this action is gated at all. Fail-closed: anything but a literal `mutates:false`. */
  requiresConsent: z.boolean(),
  /** The live decision covering THIS shape, or null when the action still needs an answer. */
  decision: IntegrationActionApprovalDecision.nullable(),
  expiresAt: IsoTimestamp.nullable(),
});
export type IntegrationActionApproval = z.infer<typeof IntegrationActionApproval>;

export const IntegrationActionApprovalListResponse = itemsResponse(IntegrationActionApproval);
export type IntegrationActionApprovalListResponse = z.infer<typeof IntegrationActionApprovalListResponse>;

/**
 * `shape` is REQUIRED, and it is the anti-TOCTOU half of this endpoint: the server refuses an
 * approval whose shape no longer matches the stored action. Same reasoning as the automations
 * domain's `ConsentRequest` carrying the command shape — without it a caller could bank an approval
 * for a shape the user never saw, which is the inverse of consent.
 */
export const ApproveIntegrationActionRequest = z.object({
  decision: IntegrationActionApprovalDecision,
  shape: z.string(),
});
export type ApproveIntegrationActionRequest = z.infer<typeof ApproveIntegrationActionRequest>;

export const ApproveIntegrationActionResponse = z.object({
  ok: z.literal(true),
  decision: IntegrationActionApprovalDecision,
  expiresAt: IsoTimestamp,
});
export type ApproveIntegrationActionResponse = z.infer<typeof ApproveIntegrationActionResponse>;

export const RevokeIntegrationActionApprovalResponse = z.object({
  ok: z.literal(true),
  /** How many approval rows were removed — every decision and every past shape (see the route). */
  revoked: z.number().int().nonnegative(),
});
export type RevokeIntegrationActionApprovalResponse = z.infer<typeof RevokeIntegrationActionApprovalResponse>;

/* --- Per-integration LESSONS (slice C3) ------------------------------------------------------ */

/**
 * The ceiling on a lessons body, in the units `String.length` and zod's `.max()` both count.
 * ONE constant: the wire refusal, the api seam's own check and the dashboard's character counter
 * all read it, because a limit that lives in two places eventually disagrees — and the surface
 * that disagreed would be the one that silently truncates somebody's notes.
 *
 * 20k characters (~5k tokens) is generous for accumulated prose and bounded enough that an
 * integration's lessons cannot quietly become the dominant cost of every run that loads it.
 */
export const INTEGRATION_LESSONS_MAX_CHARS = 20_000;

/**
 * What an integration's lessons look like to a caller.
 *
 * `editable` is the honest statement of WHICH view was served. Lessons are free text a human
 * writes AND text that reaches a model prompt, so the api keeps two views: the BYTE-EXACT one for
 * the principals who may save the definition (otherwise an edit cycle round-trips a redaction into
 * stored documentation — A3 review F3), and the SCRUBBED one for everyone else (A2 review F7). A
 * client must not offer an edit over a `false`: the write would be refused.
 *
 * `updatedAt` is the optimistic-concurrency token, echoed back on a write.
 */
export const IntegrationLessonsView = z.object({
  key: z.string(),
  lessons: z.string(),
  editable: z.boolean(),
  updatedAt: IsoTimestamp,
});
export type IntegrationLessonsView = z.infer<typeof IntegrationLessonsView>;

/**
 * `lessons` is bounded AT THE SCHEMA, so an over-length body is a 400 before any handler runs and
 * the refusal cannot be forgotten by a second caller. Nothing anywhere trims: a truncated note is
 * worse than a rejected one, because the author believes it was recorded.
 *
 * `expectedUpdatedAt` is OPTIONAL and its absence means something specific — "overwrite whatever
 * is stored". Present, it is the row revision the editor loaded, and a mismatch is refused with
 * the current text rather than clobbered.
 */
export const SetIntegrationLessonsRequest = z.object({
  lessons: z.string().max(INTEGRATION_LESSONS_MAX_CHARS),
  expectedUpdatedAt: IsoTimestamp.optional(),
});
export type SetIntegrationLessonsRequest = z.infer<typeof SetIntegrationLessonsRequest>;

/* --- The PUBLIC capability surface (slice D1) ------------------------------------------------ */

/**
 * Path params of the two capability routes. Declared so two facts are CONTRACTUAL rather than
 * only implemented: a segment has a shape, and a malformed one is a 400 rather than a 404
 * (descriptor.ts `params`). Deliberately permissive — a grammar stricter than the store's own
 * would turn a legitimately-named authored integration into a 400 it can never recover from —
 * but BOUNDED, because these segments are echoed into audit metadata.
 */
export const IntegrationKeyParams = z.object({ key: z.string().min(1).max(120) });
export type IntegrationKeyParams = z.infer<typeof IntegrationKeyParams>;

export const IntegrationActionParams = z.object({
  key: z.string().min(1).max(120),
  actionName: z.string().min(1).max(120),
});
export type IntegrationActionParams = z.infer<typeof IntegrationActionParams>;

/**
 * What a capability client needs to know about ONE action in order to call it — the facts the
 * definition's own `actions[]` record cannot carry because they are derived, per-caller, or both.
 *
 * WHY THIS IS A SIBLING OF THE DEFINITION AND NOT A SECOND COPY OF IT. The definition (with its
 * `httpConfig`, `argsSchema`, `returnSchema`) rides on `integration` below, projected by the ONE
 * registry projection every other read uses. Nothing here re-states it. What is here is:
 *   - `backingType`/`transport` — HOW it runs, resolved once by the executor's own resolver
 *     (`resolveBackingType`), never re-derived by a client from the action's shape;
 *   - `target` — WHERE it writes, in the words the consent dialog shows a human;
 *   - `shape` — the approval fingerprint, so a client that hits the write gate can hand the user
 *     the exact token `POST …/approval` demands (that route is `auth: 'user'` — see below);
 *   - `requiresApproval` — the FAIL-CLOSED reading of `mutates` (only a literal `false` is a read),
 *     which is the executor's rule and not something a client should re-implement off the raw field;
 *   - `approved` — whether a live approval of the CALLER's own already covers this exact shape.
 *
 * `approved` is ADVISORY and says so: the gate is re-evaluated inside the executor at call time (a
 * `once` approval is CLAIMED there, atomically), so `true` here is "no prompt is pending as of this
 * read", never a promise that the next execute will run.
 */
export const IntegrationCapabilityAction = z.object({
  actionName: z.string(),
  description: z.string(),
  /** `api-call | bash-cli | browser-steps`, or `invalid` for a package that contradicts itself. */
  backingType: z.string(),
  /** Wire protocol the action needs; `http` unless the package declares otherwise. */
  transport: z.string(),
  /** Human-readable destination, e.g. `POST https://slack.com/api/chat.postMessage`. */
  target: z.string(),
  /** Fingerprint of the action's executable content — the token an approval is keyed on. */
  shape: z.string(),
  requiresApproval: z.boolean(),
  /** Advisory (see above): a live approval of the caller's covers this exact shape right now. */
  approved: z.boolean(),
});
export type IntegrationCapabilityAction = z.infer<typeof IntegrationCapabilityAction>;

/**
 * The capability view of one integration: the definition exactly as the list emits it, plus the
 * per-action execution metadata and whether this caller can actually reach a credential.
 *
 * `integration` is the SAME `IntegrationDefinition` projection `GET /api/v1/integrations` returns —
 * one projection, not a second one that could drift from it (Rule 1). That projection is where the
 * tenancy rules live: it drops the storage envelope, reveals `id`/`visibility` only for a row of
 * the caller's OWN org, and runs the secret-redaction pass on both tiers, so a cross-org `global`
 * row never tells the reader which org authored it.
 */
export const IntegrationCapability = z.object({
  integration: IntegrationDefinition,
  /**
   * Can an execute reach a credential today? Mirrors the executor's own two checks exactly
   * (`not_connected` / `disabled`): a config that exists and is enabled, or an integration whose
   * `authType` is `none` and needs no config at all.
   */
  connected: z.boolean(),
  actions: z.array(IntegrationCapabilityAction),
});
export type IntegrationCapability = z.infer<typeof IntegrationCapability>;

/**
 * Execute request. `args` and NOTHING ELSE — there is deliberately no field naming an org, a user,
 * an owner or a credential. Tenancy comes from the verified principal and only from it (Rule 5),
 * and because zod strips unknown keys a body that invents `orgId` is silently inert rather than
 * influential. The same reasoning as the knowledge/memvault capability requests.
 */
export const ExecuteIntegrationActionRequest = z.object({
  args: z.record(z.unknown()).optional(),
});
export type ExecuteIntegrationActionRequest = z.infer<typeof ExecuteIntegrationActionRequest>;

/**
 * Execute response — the OUTCOME of a call that was addressed correctly and permitted.
 *
 * THE SPLIT, stated because a client's error handling depends on it:
 *   - the request could not be ADDRESSED (unknown/invisible integration or action) -> 404 envelope;
 *   - the request was not PERMITTED (a `mutates` action with no live human approval) -> 403
 *     envelope carrying `details.code = 'awaiting_consent'` and `details.consentRequest`;
 *   - anything else -> 200 and THIS body, including a failed outcome. A remote 500, a locked
 *     credential, a disabled integration and a transport timeout are results of the routed call,
 *     not failures of Cortex, and they are exactly what the other three rails (automation step,
 *     listener tick, agent tool) already receive as a result object. One vocabulary, four rails.
 *
 * `data` is the action's own result (the upstream body, or the automation's output), already
 * deep-redacted of the caller's credential values by the executor. The executor's request/response
 * DUMP is deliberately absent: it is an operator-facing diagnostic, not part of a public contract.
 */
export const ExecuteIntegrationActionResponse = z.object({
  success: z.boolean(),
  /** Upstream HTTP status, for an `api-call` action that reached the remote. */
  status: z.number().int().optional(),
  data: z.unknown().optional(),
  /** Machine-readable outcome token when `success` is false (the executor's own vocabulary). */
  code: z.string().optional(),
  /** Human-readable failure message, credential-redacted. */
  error: z.string().optional(),
});
export type ExecuteIntegrationActionResponse = z.infer<typeof ExecuteIntegrationActionResponse>;

/**
 * What a human must be shown to answer the write gate. Rides inside the 403's `details` rather
 * than in a 2xx body: nothing executed, so there is no result to carry it. Declared here so a
 * client (and the contract suite) can type the refusal instead of reading loose strings.
 */
export const IntegrationActionConsentRequest = z.object({
  integrationKey: z.string(),
  actionName: z.string(),
  description: z.string(),
  target: z.string(),
  shape: z.string(),
});
export type IntegrationActionConsentRequest = z.infer<typeof IntegrationActionConsentRequest>;

export const integrationsEndpoints = {
  /**
   * The definition list — the CAPABILITY DISCOVERY endpoint since D1.
   *
   * THE FLIP: `user` -> `user-or-key`. Additive in the strict sense (Rule 7): the body is the same
   * `{ items: IntegrationDefinition[] }` the dashboard has always read, produced by the same
   * tenant-scoped `listDefinitionsFor(actor)` under the same actor. A platform JWT reaches it
   * byte-identically (`requireUserOrApiKey` delegates to `requireAuth` untouched); what changed is
   * that a per-user gateway key now reaches it too, so an outside client can DISCOVER which
   * integrations its user has before calling `getIntegration`/`executeAction` below.
   *
   * Flipping an auth class adds no descriptor, so the schema-coverage pin is untouched by it — but
   * it DOES publish this endpoint into `docs/openapi/cortex.v1.json`, which is the whole point:
   * the spec is definitionally the key-reachable surface.
   */
  list: {
    method: 'GET',
    path: '/api/v1/integrations',
    auth: 'user-or-key',
    response: IntegrationDefinitionListResponse,
  },
  listActive: {
    method: 'GET',
    path: '/api/v1/integrations/active',
    auth: 'user',
    response: ActiveIntegrationListResponse,
  },
  listConfigs: {
    method: 'GET',
    path: '/api/v1/integrations/configs',
    auth: 'user',
    response: IntegrationConfigListResponse,
  },
  createConfig: {
    method: 'POST',
    path: '/api/v1/integrations/configs',
    auth: 'user',
    request: CreateConfigRequest,
    response: IntegrationConfigSummary,
  },
  updateConfig: {
    method: 'PATCH',
    path: '/api/v1/integrations/configs/:integrationKey',
    auth: 'user',
    request: UpdateConfigRequest,
    response: IntegrationConfigSummary,
  },
  deleteSkill: {
    method: 'DELETE',
    path: '/api/v1/integrations/:key',
    auth: 'user',
    response: OkResponse,
  },
  refresh: {
    method: 'POST',
    path: '/api/v1/integrations/refresh',
    auth: 'org-admin',
    response: RefreshRegistryResponse,
  },
  sessionStatus: {
    method: 'GET',
    path: '/api/v1/integrations/:key/session',
    auth: 'user',
    response: SessionCaptureStatus,
  },
  connectSession: {
    method: 'POST',
    path: '/api/v1/integrations/:key/session',
    auth: 'user',
    response: ConnectSessionResponse,
  },
  provisionAutomations: {
    method: 'POST',
    path: '/api/v1/integrations/:key/provision-automations',
    auth: 'user',
    response: ProvisionAutomationsResponse,
  },
  /**
   * The TENANT sharing surface: an owner (or their org-admin) flips their own definition between
   * `private` and `org`. `auth: 'user'` and NOT `user-or-key` on purpose — an agent holding a
   * gateway key must never be able to re-gate a tenant's sharing on the tenant's behalf.
   */
  setVisibility: {
    method: 'PATCH',
    path: '/api/v1/integrations/definitions/:id/visibility',
    auth: 'user',
    request: SetDefinitionVisibilityRequest,
    response: DefinitionVisibilityResponse,
  },
  /**
   * The cross-org `global` tier — the human review gate. `auth: 'super-admin'` matches the route's
   * `requireRole('super-admin')` mount and the `artifacts.setFeatured` precedent (the other
   * super-admin-only publish toggle). Not `user-or-key`: a key-bearing agent can never publish a
   * definition to every org.
   */
  setGlobal: {
    method: 'POST',
    path: '/api/v1/integrations/definitions/:id/global',
    auth: 'super-admin',
    request: SetDefinitionGlobalRequest,
    response: DefinitionVisibilityResponse,
  },
  /**
   * The write gate's READ side: every action of an integration with its target, its shape and the
   * live approval (if any). `auth: 'user'` — see the note on the write below.
   */
  listActionApprovals: {
    method: 'GET',
    path: '/api/v1/integrations/:key/action-approvals',
    auth: 'user',
    response: IntegrationActionApprovalListResponse,
  },
  /**
   * Approve a mutating action.
   *
   * `auth: 'user'` and emphatically NOT `user-or-key`. The whole point of the gate is that a WRITE
   * needs a HUMAN (RUN_SPEC criterion 6), and a gateway key is an agent. If this were
   * `user-or-key`, an agent refused at the execution gate could call this endpoint with the very
   * shape it was just handed and then retry — a gate that grants its own exemption is not a gate.
   * Precedent in this same domain: `setVisibility` is `user` for the same reason.
   */
  approveAction: {
    method: 'POST',
    path: '/api/v1/integrations/:key/actions/:actionName/approval',
    auth: 'user',
    request: ApproveIntegrationActionRequest,
    response: ApproveIntegrationActionResponse,
  },
  /** Revoke every approval this user holds for this action — both decisions, every past shape. */
  revokeActionApproval: {
    method: 'DELETE',
    path: '/api/v1/integrations/:key/actions/:actionName/approval',
    auth: 'user',
    response: RevokeIntegrationActionApprovalResponse,
  },

  /* --- Per-integration LESSONS (slice C3) ---------------------------------------------------- */

  /**
   * Read / replace the operational knowledge an integration has accumulated.
   *
   * `auth: 'user'` on BOTH, and this is a DEVIATION from RUN_SPEC criterion 7's literal wording
   * (which lists `lessons` on the user-or-key capability surface), journaled in docs/decisions.md:
   *  - the READ an agent needs is not this endpoint. Lessons reach a model through the server-side
   *    `load_context` seam, already scrubbed. A key-reachable GET would add a way to pull a
   *    tenant's free text out over an API key without adding any capability the agent lacks.
   *  - the WRITE is free text that lands in the caller's OWN FUTURE PROMPTS. A key-bearing agent
   *    writing it is injecting its own context — what Rule 8 forbids the provider from doing — and
   *    is the same self-exemption C2 refused when it made all three consent descriptors `user`.
   * Narrow is the reversible direction: widening an auth class later is additive (Rule 7).
   */
  getLessons: {
    method: 'GET',
    path: '/api/v1/integrations/:key/lessons',
    auth: 'user',
    params: IntegrationKeyParams,
    response: IntegrationLessonsView,
  },
  setLessons: {
    method: 'PATCH',
    path: '/api/v1/integrations/:key/lessons',
    auth: 'user',
    params: IntegrationKeyParams,
    request: SetIntegrationLessonsRequest,
    response: IntegrationLessonsView,
  },

  /* --- The PUBLIC capability surface (slice D1) ---------------------------------------------- */

  /**
   * GET one integration as a CAPABILITY: the definition plus how each of its actions runs, where
   * it writes, and whether it needs (or already has) a human approval.
   *
   * `auth: 'user-or-key'` — a per-user gateway key reaches it, and every call still identifies a
   * user (Rule 4). The row is resolved UNDER THAT USER through the tenant-scoped registry, so a
   * key that names an integration its user cannot see gets the same 404 as one that names an
   * integration that does not exist: no existence oracle, and no consumer-specific branch anywhere
   * on the path (Rule 3).
   */
  getIntegration: {
    method: 'GET',
    path: '/api/v1/integrations/:key',
    auth: 'user-or-key',
    params: IntegrationKeyParams,
    response: IntegrationCapability,
  },

  /**
   * EXECUTE one action of one integration under the calling user's own credentials.
   *
   * THE WRITE GATE IS INHERITED, NOT RE-IMPLEMENTED. This route calls
   * `executeUserIntegrationAction`, which is where C2 put `checkActionConsent` precisely so that
   * every rail — this one, the automation `integration` step, the listener tick, the agent tool —
   * meets the same gate instead of four callers each remembering to ask. A `mutates` action with
   * no live approval therefore answers 403 with `details.code = 'awaiting_consent'` and the
   * descriptor the human must be shown, and NOTHING has left the process: the gate sits before the
   * credential is even loaded.
   *
   * AND THE KEY CANNOT ANSWER ITS OWN PROMPT. `approveAction` above is `auth: 'user'`, deliberately
   * not `user-or-key`: an agent refused here would otherwise POST the very shape it was just handed
   * and retry, and a gate that grants its own exemption is not a gate.
   */
  executeAction: {
    method: 'POST',
    path: '/api/v1/integrations/:key/actions/:actionName/execute',
    auth: 'user-or-key',
    params: IntegrationActionParams,
    request: ExecuteIntegrationActionRequest,
    response: ExecuteIntegrationActionResponse,
    /** An action may legitimately call a slow remote; the executor's own ceiling is 30s. */
    timeoutMs: 60_000,
  },
} as const satisfies DomainDescriptorMap;
