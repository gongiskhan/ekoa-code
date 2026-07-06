/** Pipedream domain contract (ch03 §3.8.16): org-scoped connect config + accounts. */
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const PipedreamAccount = z
  .object({
    id: Id,
    name: z.string().optional(),
    app: z.string().optional(),
    externalUserId: z.string().optional(),
    healthy: z.boolean().optional(),
    createdAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type PipedreamAccount = z.infer<typeof PipedreamAccount>;

export const PipedreamStatus = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  accountCount: z.number().int().nonnegative(),
});
export type PipedreamStatus = z.infer<typeof PipedreamStatus>;

export const PipedreamAccountsResponse = itemsResponse(PipedreamAccount);
export type PipedreamAccountsResponse = z.infer<typeof PipedreamAccountsResponse>;

export const PipedreamConfigRequest = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  projectId: z.string(),
  environment: z.string(),
});
export type PipedreamConfigRequest = z.infer<typeof PipedreamConfigRequest>;

export const PipedreamConfigResponse = z.object({
  id: Id,
  configured: z.boolean(),
});
export type PipedreamConfigResponse = z.infer<typeof PipedreamConfigResponse>;

export const PipedreamConnectTokenResponse = z.object({
  token: z.string(),
  connectLinkUrl: z.string(),
  expiresAt: IsoTimestamp,
});
export type PipedreamConnectTokenResponse = z.infer<typeof PipedreamConnectTokenResponse>;

export const pipedreamEndpoints: DomainDescriptorMap = {
  status: {
    method: 'GET',
    path: '/api/v1/pipedream',
    auth: 'user',
    response: PipedreamStatus,
  },
  listAccounts: {
    method: 'GET',
    path: '/api/v1/pipedream/accounts',
    auth: 'user',
    response: PipedreamAccountsResponse,
  },
  configure: {
    method: 'PUT',
    path: '/api/v1/pipedream/config',
    auth: 'org-admin',
    request: PipedreamConfigRequest,
    response: PipedreamConfigResponse,
  },
  removeConfig: {
    method: 'DELETE',
    path: '/api/v1/pipedream/config',
    auth: 'org-admin',
    response: OkResponse,
  },
  connectToken: {
    method: 'POST',
    path: '/api/v1/pipedream/connect-token',
    auth: 'user',
    response: PipedreamConnectTokenResponse,
  },
  disconnectAccount: {
    method: 'DELETE',
    path: '/api/v1/pipedream/accounts/:accountId',
    auth: 'user',
    response: OkResponse,
  },
};
