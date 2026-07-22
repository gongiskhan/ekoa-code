/**
 * Ad-broker domain contract: a machine-to-machine Meta Ad Library search surface fronted for
 * an Apify actor (ch03 §3.3 error envelope; ch02 §2.2 descriptor). One cursor-paged POST.
 *
 * Auth is header-scoped (x-api-key == env AD_BROKER_API_KEY), the gateway.ts precedent — NOT a
 * JWT plane (a machine client has no org/activation/billing to admit). The cursor is an opaque
 * base64url token the caller echoes back verbatim; its internal shape is a Cortex private detail
 * (see api/src/ad-broker/service.ts) and MUST NOT be relied on by the client.
 */
import { z } from 'zod';
import type { DomainDescriptorMap } from './descriptor.js';

/** ISO 3166-1 alpha-2, uppercase (e.g. 'PT', 'US'). */
export const CountryCode = z.string().regex(/^[A-Z]{2}$/, 'countryCode must be a 2-letter ISO-3166 alpha-2 uppercase code');
/** Calendar date, no time component. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const AdActiveStatus = z.enum(['active', 'inactive', 'all']);
export type AdActiveStatus = z.infer<typeof AdActiveStatus>;

/**
 * Search request. EXACTLY ONE of `searchTerms` / `advertiserName` must be present (a keyword
 * search OR an advertiser lookup, never both/neither), and `dateFrom` must not be after `dateTo`.
 * Both invariants are expressed as refinements so a malformed body is a single 400 VALIDATION_FAILED.
 */
export const AdSearchRequest = z
  .object({
    searchTerms: z.string().min(1).max(256).optional(),
    advertiserName: z.string().min(1).max(256).optional(),
    countryCode: CountryCode,
    dateFrom: IsoDate.optional(),
    dateTo: IsoDate.optional(),
    activeStatus: AdActiveStatus.default('all'),
    pageSize: z.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((v) => (v.searchTerms === undefined) !== (v.advertiserName === undefined), {
    message: 'exactly one of searchTerms or advertiserName is required',
    path: ['searchTerms'],
  })
  .refine((v) => v.dateFrom === undefined || v.dateTo === undefined || v.dateFrom <= v.dateTo, {
    message: 'dateFrom must be on or before dateTo',
    path: ['dateFrom'],
  });
export type AdSearchRequest = z.infer<typeof AdSearchRequest>;

/** A single Ad Library archive record (flat; mirrors the Graph `ads_archive` fields we surface). */
export const AdRecord = z.object({
  id: z.string().min(1),
  advertiserName: z.string(),
  pageId: z.string(),
  snapshotUrl: z.string().url(),
  creativeBody: z.string(),
  countryCode: CountryCode,
  isActive: z.boolean(),
  startDate: IsoDate,
  endDate: IsoDate.nullable(),
  publisherPlatforms: z.array(z.string()),
});
export type AdRecord = z.infer<typeof AdRecord>;

/** Search response. `nextCursor === null` means the result set is exhausted; `records.length <= pageSize`. */
export const AdSearchResponse = z.object({
  records: z.array(AdRecord),
  nextCursor: z.string().nullable(),
});
export type AdSearchResponse = z.infer<typeof AdSearchResponse>;

export const adBrokerEndpoints = {
  search: {
    method: 'POST',
    path: '/api/v1/ad-broker/search',
    auth: 'header-scoped',
    request: AdSearchRequest,
    response: AdSearchResponse,
  },
} as const satisfies DomainDescriptorMap;
