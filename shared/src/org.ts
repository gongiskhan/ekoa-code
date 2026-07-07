/** Org and branding contract — ch03 §3.8.4 (`/api/v1/org`, `/orgs`, `/branding`). */
import { z } from 'zod';
import { Id, itemsResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const OrgBranding = z
  .object({
    logo: z.string().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    websiteUrl: z.string().optional(),
  })
  .passthrough();
export type OrgBranding = z.infer<typeof OrgBranding>;

export const OrgConfig = z
  .object({
    id: Id,
    name: z.string(),
    displayName: z.string().optional(),
    branding: OrgBranding.optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type OrgConfig = z.infer<typeof OrgConfig>;

export const OrgUpdateRequest = z
  .object({
    name: z.string().optional(),
    displayName: z.string().optional(),
    branding: OrgBranding.optional(),
    settings: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type OrgUpdateRequest = z.infer<typeof OrgUpdateRequest>;

export const BrandingSaveRequest = z.object({
  branding: OrgBranding,
  displayName: z.string().optional(),
});
export type BrandingSaveRequest = z.infer<typeof BrandingSaveRequest>;

export const BrandingResearchRequest = z.object({
  websiteUrl: z.string(),
});
export type BrandingResearchRequest = z.infer<typeof BrandingResearchRequest>;

export const BrandingResearchResponse = z.object({ jobId: z.string() });
export type BrandingResearchResponse = z.infer<typeof BrandingResearchResponse>;

export const OrgCreateRequest = z.object({
  name: z.string(),
  displayName: z.string().optional(),
});
export type OrgCreateRequest = z.infer<typeof OrgCreateRequest>;

export const OrgPatch = z.object({
  name: z.string().optional(),
  displayName: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});
export type OrgPatch = z.infer<typeof OrgPatch>;

export const OrgListResponse = itemsResponse(OrgConfig);
export type OrgListResponse = z.infer<typeof OrgListResponse>;

export const orgEndpoints = {
  getOrg: {
    method: 'GET',
    path: '/api/v1/org',
    auth: 'user',
    response: OrgConfig,
  },
  updateOrg: {
    method: 'PATCH',
    path: '/api/v1/org',
    auth: 'org-admin',
    request: OrgUpdateRequest,
    response: OrgConfig,
  },
  saveBranding: {
    method: 'PUT',
    path: '/api/v1/branding',
    auth: 'org-admin',
    request: BrandingSaveRequest,
    response: OrgConfig,
  },
  researchBranding: {
    method: 'POST',
    path: '/api/v1/branding/research',
    auth: 'org-admin',
    request: BrandingResearchRequest,
    response: BrandingResearchResponse,
  },
  createOrg: {
    method: 'POST',
    path: '/api/v1/orgs',
    auth: 'super-admin',
    request: OrgCreateRequest,
    response: OrgConfig,
  },
  listOrgs: {
    method: 'GET',
    path: '/api/v1/orgs',
    auth: 'super-admin',
    response: OrgListResponse,
  },
  patchOrg: {
    method: 'PATCH',
    path: '/api/v1/orgs/:id',
    auth: 'super-admin',
    request: OrgPatch,
    response: OrgConfig,
  },
} as const satisfies DomainDescriptorMap;
