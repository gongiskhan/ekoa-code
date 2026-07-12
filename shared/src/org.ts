/** Org and branding contract — ch03 §3.8.4 (`/api/v1/org`, `/orgs`, `/branding`),
 *  plus the org anonymisation deny-list (ch17 §17.4 (b), ch04 §4.3; F10). */
import { z } from 'zod';
import { Id, itemsResponse, OkResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** Persisted design-system tokens (ch05 §5.6.4 brand research). Mirrors the extractor output
 *  (dembrandt, trimmed) and the web `StoredDesignSystem` shape rendered on the Design System tab.
 *  Every field optional so an older org record — or a partial research run — still validates. */
export const StoredDesignSystem = z
  .object({
    // Extractor output round-trips through the store, where an absent optional leaf comes back as
    // `null` (never `undefined`), so every optional leaf is `.nullish()` (accepts null | undefined).
    logo: z
      .object({
        url: z.string().nullish(),
        background: z.string().nullish(),
        width: z.number().nullish(),
        height: z.number().nullish(),
      })
      .nullish(),
    palette: z
      .array(
        z.object({
          hex: z.string(),
          count: z.number(),
          confidence: z.enum(['high', 'medium', 'low']),
          sources: z.array(z.string()),
        }),
      )
      .optional(),
    cssVariables: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
    typography: z
      .object({
        families: z.array(z.string()),
        styles: z.array(
          z.object({
            role: z.string().nullish(),
            fontFamily: z.string().nullish(),
            fontSize: z.string().nullish(),
            fontWeight: z.string().nullish(),
            lineHeight: z.string().nullish(),
          }),
        ),
      })
      .optional(),
    spacing: z
      .object({
        scaleType: z.string().nullish(),
        values: z.array(z.object({ px: z.string(), count: z.number() })),
      })
      .optional(),
    borderRadius: z
      .object({
        values: z.array(z.object({ value: z.string(), count: z.number() })),
        shapeLanguage: z.string(),
      })
      .optional(),
    shadows: z.array(z.object({ shadow: z.string(), count: z.number() })).optional(),
    primaryButton: z.record(z.string()).nullish(),
    frameworks: z.array(z.string()).optional(),
  })
  .passthrough();
export type StoredDesignSystem = z.infer<typeof StoredDesignSystem>;

/** Vision-model read of the site's overall feel (ch05 §5.6.4). Mirrors the web `VisualVibe`. */
export const VisualVibe = z
  .object({
    mood: z.string(),
    bullets: z.array(z.string()),
    shape: z.string(),
    density: z.string(),
    texture: z.string(),
    hero: z.string(),
  })
  .passthrough();
export type VisualVibe = z.infer<typeof VisualVibe>;

export const OrgBranding = z
  .object({
    logo: z.string().optional(),
    primaryColor: z.string().optional(),
    secondaryColor: z.string().optional(),
    accentColor: z.string().optional(),
    fontFamily: z.string().optional(),
    fonts: z.array(z.string()).optional(),
    toneOfVoice: z.string().optional(),
    instructions: z.string().optional(),
    websiteUrl: z.string().optional(),
    /** Extractor outputs attached server-side by the brand-research pipeline (ch05 §5.6.4). */
    designSystem: StoredDesignSystem.optional(),
    visualVibe: VisualVibe.optional(),
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
    /** Company display name read from the site (title / og:site_name / visible text). Applied
     *  to org.displayName, never merged into branding (the seeded bootstrap name is a
     *  placeholder research must be able to replace, as the old platform did). */
    companyName: z.string().optional(),
    websiteUrl: z.string().optional(),
    fonts: z.array(z.string()).optional(),
    fontFamily: z.string().optional(),
    toneOfVoice: z.string().optional(),
    /** Actionable visual-identity guidance the grounded synthesis writes (design notes). */
    instructions: z.string().optional(),
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
    /** Stamped on every org patch. The web branding page re-syncs its local editor state only
     *  when this changes (its research-refresh fingerprint), so it must be on the wire. */
    updatedAt: z.string().optional(),
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
