/** Knowledge domain contract (ch03 §3.8.20): org-partitioned vault CRUD, sources, uploads, heal ops. */
import { z } from 'zod';
import { Id, IsoTimestamp, listResponse, itemsResponse, OkResponse, PaginationQuery, Language } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const KnowledgeDocSummary = z
  .object({
    id: Id,
    collection: z.string(),
    title: z.string(),
    sourceUrl: z.string().optional(),
    sourceType: z.string().optional(),
    language: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    chunks: z.number().int().nonnegative().optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummary>;

export const KnowledgeSource = z
  .object({
    id: Id,
    url: z.string(),
    type: z.string().optional(),
    collection: z.string().optional(),
    seedTemplate: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
    lastCrawledAt: IsoTimestamp.optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;

export const SourceInput = z
  .object({
    url: z.string(),
    type: z.string().optional(),
    collection: z.string().optional(),
    seedTemplate: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();
export type SourceInput = z.infer<typeof SourceInput>;

export const UploadDoc = z
  .object({
    id: Id,
    uploadId: z.string().optional(),
    filename: z.string(),
    collection: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    contentType: z.string().optional(),
    indexedAt: IsoTimestamp.optional(),
    createdAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type UploadDoc = z.infer<typeof UploadDoc>;

export const IndexStatus = z
  .object({
    status: z.string(),
    documentCount: z.number().int().nonnegative().optional(),
    collectionCount: z.number().int().nonnegative().optional(),
    lastIndexedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type IndexStatus = z.infer<typeof IndexStatus>;

export const CollectionsResponse = itemsResponse(z.string());
export type CollectionsResponse = z.infer<typeof CollectionsResponse>;

export const DocumentsQuery = PaginationQuery.extend({
  collection: z.string().optional(),
});
export type DocumentsQuery = z.infer<typeof DocumentsQuery>;

export const DocumentsResponse = listResponse(KnowledgeDocSummary);
export type DocumentsResponse = z.infer<typeof DocumentsResponse>;

export const CreateDocumentRequest = z.object({
  collection: z.string(),
  title: z.string(),
  text: z.string(),
  sourceUrl: z.string().optional(),
  sourceType: z.string().optional(),
  language: Language.optional(),
});
export type CreateDocumentRequest = z.infer<typeof CreateDocumentRequest>;

export const CreateDocumentResponse = z.object({ id: z.string() });
export type CreateDocumentResponse = z.infer<typeof CreateDocumentResponse>;

export const SourcesResponse = itemsResponse(KnowledgeSource);
export type SourcesResponse = z.infer<typeof SourcesResponse>;

export const CrawlStartResponse = z.object({
  started: z.boolean(),
  alreadyRunning: z.boolean(),
});
export type CrawlStartResponse = z.infer<typeof CrawlStartResponse>;

export const CrawlStatusResponse = z
  .object({
    running: z.boolean(),
    progress: z.number().optional(),
    stats: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type CrawlStatusResponse = z.infer<typeof CrawlStatusResponse>;

export const RefreshScheduleResponse = z
  .object({
    schedule: z.record(z.unknown()).nullable(),
  })
  .passthrough();
export type RefreshScheduleResponse = z.infer<typeof RefreshScheduleResponse>;

export const UploadsResponse = itemsResponse(UploadDoc);
export type UploadsResponse = z.infer<typeof UploadsResponse>;

export const CreateUploadResponse = z
  .object({
    uploadId: z.string(),
  })
  .passthrough();
export type CreateUploadResponse = z.infer<typeof CreateUploadResponse>;

export const DeleteUploadResponse = z.object({
  removed: z.boolean(),
  docsRemoved: z.number().int().nonnegative(),
});
export type DeleteUploadResponse = z.infer<typeof DeleteUploadResponse>;

export const ReindexResponse = z.object({ started: z.boolean() });
export type ReindexResponse = z.infer<typeof ReindexResponse>;

export const knowledgeEndpoints = {
  listCollections: {
    method: 'GET',
    path: '/api/v1/knowledge/collections',
    auth: 'user',
    response: CollectionsResponse,
  },
  listDocuments: {
    method: 'GET',
    path: '/api/v1/knowledge/documents',
    auth: 'user',
    query: DocumentsQuery,
    response: DocumentsResponse,
  },
  createDocument: {
    method: 'POST',
    path: '/api/v1/knowledge/documents',
    auth: 'user',
    request: CreateDocumentRequest,
    response: CreateDocumentResponse,
  },
  deleteDocument: {
    method: 'DELETE',
    path: '/api/v1/knowledge/collections/:collection/documents/:id',
    auth: 'user',
    response: OkResponse,
  },
  listSources: {
    method: 'GET',
    path: '/api/v1/knowledge/sources',
    auth: 'user',
    response: SourcesResponse,
  },
  createSource: {
    method: 'POST',
    path: '/api/v1/knowledge/sources',
    auth: 'user',
    request: SourceInput,
    response: KnowledgeSource,
  },
  updateSource: {
    method: 'PATCH',
    path: '/api/v1/knowledge/sources/:id',
    auth: 'user',
    request: SourceInput.partial(),
    response: KnowledgeSource,
  },
  deleteSource: {
    method: 'DELETE',
    path: '/api/v1/knowledge/sources/:id',
    auth: 'user',
    response: OkResponse,
  },
  crawlSource: {
    method: 'POST',
    path: '/api/v1/knowledge/sources/:id/crawl',
    auth: 'user',
    response: CrawlStartResponse,
  },
  crawlStatus: {
    method: 'GET',
    path: '/api/v1/knowledge/sources/:id/crawl',
    auth: 'user',
    response: CrawlStatusResponse,
  },
  refreshSchedule: {
    method: 'GET',
    path: '/api/v1/knowledge/refresh-schedule',
    auth: 'user',
    response: RefreshScheduleResponse,
  },
  listUploads: {
    method: 'GET',
    path: '/api/v1/knowledge/uploads',
    auth: 'user',
    response: UploadsResponse,
  },
  createUpload: {
    method: 'POST',
    path: '/api/v1/knowledge/uploads',
    auth: 'user',
    response: CreateUploadResponse,
    kind: 'binary',
  },
  deleteUpload: {
    method: 'DELETE',
    path: '/api/v1/knowledge/uploads/:id',
    auth: 'user',
    response: DeleteUploadResponse,
  },
  reindex: {
    method: 'POST',
    path: '/api/v1/knowledge/reindex',
    auth: 'org-admin',
    response: ReindexResponse,
  },
  indexStatus: {
    method: 'GET',
    path: '/api/v1/knowledge/index-status',
    auth: 'org-admin',
    response: IndexStatus,
  },
} as const satisfies DomainDescriptorMap;
