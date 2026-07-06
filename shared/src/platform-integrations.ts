/** Platform integrations domain contract (ch03 §3.8.15): managed OAuth workspace connections. */
import { z } from 'zod';
import { itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const PlatformIntegration = z
  .object({
    provider: z.string(),
    connected: z.boolean(),
    email: z.string().optional(),
  })
  .passthrough();
export type PlatformIntegration = z.infer<typeof PlatformIntegration>;

export const PlatformIntegrationListResponse = itemsResponse(PlatformIntegration);
export type PlatformIntegrationListResponse = z.infer<typeof PlatformIntegrationListResponse>;

export const PlatformIntegrationStatusResponse = z.object({
  connected: z.boolean(),
  email: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type PlatformIntegrationStatusResponse = z.infer<typeof PlatformIntegrationStatusResponse>;

export const PlatformIntegrationConnectResponse = z.object({
  authUrl: z.string(),
  state: z.string(),
});
export type PlatformIntegrationConnectResponse = z.infer<typeof PlatformIntegrationConnectResponse>;

export const PlatformIntegrationDisconnectResponse = OkResponse;
export type PlatformIntegrationDisconnectResponse = z.infer<
  typeof PlatformIntegrationDisconnectResponse
>;

export const platformIntegrationsEndpoints: DomainDescriptorMap = {
  list: {
    method: 'GET',
    path: '/api/v1/platform-integrations',
    auth: 'user',
    response: PlatformIntegrationListResponse,
  },
  status: {
    method: 'GET',
    path: '/api/v1/platform-integrations/:provider',
    auth: 'user',
    response: PlatformIntegrationStatusResponse,
  },
  connect: {
    method: 'POST',
    path: '/api/v1/platform-integrations/:provider/connect',
    auth: 'org-admin',
    response: PlatformIntegrationConnectResponse,
  },
  disconnect: {
    method: 'DELETE',
    path: '/api/v1/platform-integrations/:provider',
    auth: 'org-admin',
    response: PlatformIntegrationDisconnectResponse,
  },
  oauthCallback: {
    method: 'GET',
    path: '/api/v1/oauth/:provider/callback',
    auth: 'public',
    kind: 'redirect',
  },
};
