/** Org and branding contract — ch03 §3.8.4 (`/api/v1/org`, `/orgs`, `/branding`),
 *  plus the org anonymisation deny-list (ch17 §17.4 (b), ch04 §4.3; F10). */
import { z } from 'zod';
import { Id, itemsResponse, OkResponse } from './common.js';
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

/** Structured output of the TOOL-LESS brand-research agent (ch05 §5.6.4). Keys align with
 *  OrgBranding so a valid result merge-writes onto the org's branding; `summary`/`confidence`
 *  are research metadata (kept on the job record, never written to branding). Colors and fonts
 *  are PROPOSALS from brand knowledge — the agent cannot browse — flagged by `confidence`. */
export const BrandResearchResult = z
  .object({
    logo: z.string().optional(),
    primaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    websiteUrl: z.string().optional(),
    fonts: z.array(z.string()).optional(),
    toneOfVoice: z.string().optional(),
    summary: z.string().optional(),
    confidence: z.enum(['low', 'medium', 'high']).optional(),
  })
  .passthrough();
export type BrandResearchResult = z.infer<typeof BrandResearchResult>;

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

/** One deny-list entry, METADATA ONLY — the cleartext party name is write-only and never
 *  returned by any endpoint (ch04 §4.3.4; it is org-scoped-encrypted at rest). */
export const DenyListEntry = z
  .object({
    id: Id,
    entityClass: z.string(),
    addedBy: z.string(),
    addedAt: z.string(),
  })
  .passthrough();
export type DenyListEntry = z.infer<typeof DenyListEntry>;

/** The CLOSED set of entity classes (ch17 §17.5 token shapes). A free string here would let
 *  the secret literal itself be laundered into plaintext rest/audit/responses via this field. */
export const DenyListEntityClass = z.enum(['NIF', 'NIPC', 'NISS', 'IBAN', 'CC', 'UTENTE', 'PROCESSO', 'PARTY', 'PERSON']);
export type DenyListEntityClass = z.infer<typeof DenyListEntityClass>;

export const DenyListCreateRequest = z.object({
  /** The literal to mask at egress (a firm client/matter/party name — §17.4 (b)). */
  value: z.string().min(1).max(500),
  entityClass: DenyListEntityClass.optional(),
});
export type DenyListCreateRequest = z.infer<typeof DenyListCreateRequest>;

export const DenyListListResponse = itemsResponse(DenyListEntry);
export type DenyListListResponse = z.infer<typeof DenyListListResponse>;

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
  listDenyList: {
    method: 'GET',
    path: '/api/v1/org/deny-list',
    auth: 'org-admin',
    response: DenyListListResponse,
  },
  addDenyListEntry: {
    method: 'POST',
    path: '/api/v1/org/deny-list',
    auth: 'org-admin',
    request: DenyListCreateRequest,
    response: DenyListEntry,
  },
  removeDenyListEntry: {
    method: 'DELETE',
    path: '/api/v1/org/deny-list/:id',
    auth: 'org-admin',
    response: OkResponse,
  },
} as const satisfies DomainDescriptorMap;
