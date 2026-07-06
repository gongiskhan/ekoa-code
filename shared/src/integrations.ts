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

export const SessionCaptureStatus = z
  .object({
    integrationKey: z.string().optional(),
    status: z.string(),
    session: z.record(z.unknown()).optional(),
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
  session: z.record(z.unknown()),
});
export type ConnectSessionResponse = z.infer<typeof ConnectSessionResponse>;

export const ProvisionAutomationsResponse = z.object({
  provisioned: z.boolean(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  actions: z.array(z.record(z.unknown())),
});
export type ProvisionAutomationsResponse = z.infer<typeof ProvisionAutomationsResponse>;

export const integrationsEndpoints: DomainDescriptorMap = {
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
};
