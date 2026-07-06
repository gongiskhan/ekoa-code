/** Company space contract (ch03 §3.8.12): deployed-artifact running state, logs, start/stop. */
import { z } from 'zod';
import { Id, IsoTimestamp, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const CompanySpaceEntry = z
  .object({
    artifactId: Id,
    name: z.string().optional(),
    status: z.enum(['running', 'stopped', 'starting', 'stopping', 'error']),
    url: z.string().optional(),
    deploymentId: z.string().optional(),
    logsUrl: z.string().optional(),
    lastLogAt: IsoTimestamp.optional(),
    startedAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type CompanySpaceEntry = z.infer<typeof CompanySpaceEntry>;

export const CompanySpaceListResponse = itemsResponse(CompanySpaceEntry);
export type CompanySpaceListResponse = z.infer<typeof CompanySpaceListResponse>;

export const CompanySpaceGetResponse = CompanySpaceEntry;
export type CompanySpaceGetResponse = z.infer<typeof CompanySpaceGetResponse>;

export const CompanySpaceStartResponse = z.object({
  status: z.string(),
  url: z.string().optional(),
  deploymentId: z.string().optional(),
});
export type CompanySpaceStartResponse = z.infer<typeof CompanySpaceStartResponse>;

export const CompanySpaceStopResponse = OkResponse;
export type CompanySpaceStopResponse = z.infer<typeof CompanySpaceStopResponse>;

export const companySpaceEndpoints: DomainDescriptorMap = {
  list: {
    method: 'GET',
    path: '/api/v1/company-space',
    auth: 'user',
    response: CompanySpaceListResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/company-space/:artifactId',
    auth: 'user',
    response: CompanySpaceGetResponse,
  },
  start: {
    method: 'POST',
    path: '/api/v1/company-space/:artifactId/start',
    auth: 'user',
    response: CompanySpaceStartResponse,
  },
  stop: {
    method: 'POST',
    path: '/api/v1/company-space/:artifactId/stop',
    auth: 'user',
    response: CompanySpaceStopResponse,
  },
};
