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
} as const satisfies DomainDescriptorMap;
