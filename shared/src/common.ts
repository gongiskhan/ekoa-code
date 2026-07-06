import { z } from 'zod';

/** Shared primitives used across domains. ISO-8601 UTC timestamps (ch03 §3.4).
 *  Accepts both `Z` and explicit-offset forms; the server mints UTC. (A trailing
 *  `.or(z.string())` would make the datetime check dead, so it is deliberately absent.) */
export const IsoTimestamp = z.string().datetime({ offset: true });
export const Id = z.string().min(1);

/** Uniform list-with-total envelope for paginated reads (ch03 §3.4). */
export const listResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative() });

/** Simple items wrapper (non-paginated collections). */
export const itemsResponse = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item) });

export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

/** Pagination query shared by list endpoints. */
export const PaginationQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

/** Language field for endpoints producing user-visible model output (ch03 §3.4). */
export const Language = z.enum(['pt', 'en']).default('pt');

/** Org sharing visibility (Amendment 2): default private. */
export const Visibility = z.enum(['private', 'org']);

/** The three-role model (Amendment 2). */
export const Role = z.enum(['super-admin', 'org-admin', 'builder']);
export type Role = z.infer<typeof Role>;

/** Reference to a staged upload by opaque id (ch03 §3.4). */
export const UploadRef = z.object({
  uploadId: z.string(),
  displayName: z.string().optional(),
});
export type UploadRef = z.infer<typeof UploadRef>;
