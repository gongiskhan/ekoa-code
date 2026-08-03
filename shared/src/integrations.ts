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

export const integrationsEndpoints = {
  list: {
    method: 'GET',
    path: '/api/v1/integrations',
    auth: 'user',
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
} as const satisfies DomainDescriptorMap;
