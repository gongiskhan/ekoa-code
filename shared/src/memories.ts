/** Memories domain contract (ch03 §3.8.19): memory CRUD, signals, tags, stats. */
import { z } from 'zod';
import { Id, IsoTimestamp, listResponse, itemsResponse, OkResponse, Visibility } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** The memory tiers the product actually branches on (resolver + dashboard). Responses stay a
 *  permissive string so legacy documents keep validating; REQUESTS are constrained, which is what
 *  stops a client writing `tier: 'archived'` and having it injected forever. */
export const MemoryTier = z.enum(['core', 'active', 'archive', 'guardrail']);
export type MemoryTier = z.infer<typeof MemoryTier>;

export const Memory = z
  .object({
    id: Id,
    type: z.string(),
    tier: z.string(),
    tags: z.array(z.string()),
    content: z.string().optional(),
    userId: Id.optional(),
    orgId: Id,
    visibility: Visibility,
    verified: z.boolean().optional(),
    score: z.number().optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type Memory = z.infer<typeof Memory>;

export const MemoryCreateRequest = z.object({
  type: z.string(),
  // `title` was absent from this schema while the server read `body.title` and the dashboard
  // rendered `memory.title`: zod stripped it on every create, so API-created memories were
  // untitled. Additive + optional, so no existing client breaks.
  title: z.string().optional(),
  tier: MemoryTier.optional(),
  tags: z.array(z.string()).optional(),
  content: z.string(),
  visibility: Visibility.optional(),
});
export type MemoryCreateRequest = z.infer<typeof MemoryCreateRequest>;

export const MemoryPatch = z.object({
  type: z.string().optional(),
  // `title` was missing here too (see MemoryCreateRequest): a PATCH { title } was stripped by zod,
  // so renaming a memory silently no-op'd with a 200 while the dashboard's edit modal sends it.
  title: z.string().optional(),
  tier: MemoryTier.optional(),
  tags: z.array(z.string()).optional(),
  content: z.string().optional(),
  verified: z.boolean().optional(),
  visibility: Visibility.optional(),
});
export type MemoryPatch = z.infer<typeof MemoryPatch>;

export const MemoryStats = z
  .object({
    total: z.number().int().nonnegative(),
    byType: z.record(z.number()).optional(),
    byTier: z.record(z.number()).optional(),
    byVisibility: z.record(z.number()).optional(),
    verified: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type MemoryStats = z.infer<typeof MemoryStats>;

export const MemoryListQuery = z.object({
  type: z.string().optional(),
  scope: z.string().optional(),
  visibility: Visibility.optional(),
  tags: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});
export type MemoryListQuery = z.infer<typeof MemoryListQuery>;

export const MemoryListResponse = listResponse(Memory);
export type MemoryListResponse = z.infer<typeof MemoryListResponse>;

export const MemoryBulkDeleteRequest = z.object({ ids: z.array(Id) });
export type MemoryBulkDeleteRequest = z.infer<typeof MemoryBulkDeleteRequest>;

export const MemorySignalRequest = z.object({
  runId: Id,
  signal: z.enum(['positive', 'negative']),
});
export type MemorySignalRequest = z.infer<typeof MemorySignalRequest>;

export const MemorySignalResponse = z
  .object({
    affectedMemories: z.number().int().nonnegative(),
    adjustedScores: z.number().int().nonnegative(),
  })
  .passthrough();
export type MemorySignalResponse = z.infer<typeof MemorySignalResponse>;

export const MemoryTag = z.object({ tag: z.string(), count: z.number().int().nonnegative() });
export type MemoryTag = z.infer<typeof MemoryTag>;

export const MemoryTagsResponse = itemsResponse(MemoryTag);
export type MemoryTagsResponse = z.infer<typeof MemoryTagsResponse>;

export const memoriesEndpoints = {
  list: {
    method: 'GET',
    path: '/api/v1/memories',
    auth: 'user',
    query: MemoryListQuery,
    response: MemoryListResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/memories/:id',
    auth: 'user',
    response: Memory,
  },
  create: {
    method: 'POST',
    path: '/api/v1/memories',
    auth: 'user',
    request: MemoryCreateRequest,
    response: Memory,
  },
  update: {
    method: 'PATCH',
    path: '/api/v1/memories/:id',
    auth: 'user',
    request: MemoryPatch,
    response: Memory,
  },
  delete: {
    method: 'DELETE',
    path: '/api/v1/memories/:id',
    auth: 'user',
    response: OkResponse,
  },
  bulkDelete: {
    method: 'POST',
    path: '/api/v1/memories/bulk-delete',
    auth: 'user',
    request: MemoryBulkDeleteRequest,
    response: OkResponse,
  },
  submitSignal: {
    method: 'POST',
    path: '/api/v1/memories/signals',
    auth: 'user',
    request: MemorySignalRequest,
    response: MemorySignalResponse,
  },
  listTags: {
    method: 'GET',
    path: '/api/v1/memories/tags',
    auth: 'user',
    response: MemoryTagsResponse,
  },
  stats: {
    method: 'GET',
    path: '/api/v1/memories/stats',
    auth: 'user',
    response: MemoryStats,
  },
} as const satisfies DomainDescriptorMap;
