/**
 * Knowledge domain contract (ch03 §3.8.20): org-partitioned vault CRUD, sources, uploads, heal ops.
 *
 * SLICE E5 adds the two READ capabilities the vault already implemented in-process but never
 * exposed — `searchKnowledge` and `readKnowledgeDoc` — plus the `user-or-key` flip on the two
 * browse endpoints a key-holding client needs (`listCollections`, `listDocuments`). Nothing on the
 * WRITE/admin half moves: ingestion stays platform-session-only in this slice.
 *
 * Neither new request carries an org/tenant field, and neither ever will: the only partition a
 * caller can address is the one its verified principal already names (Capability Contract rule 5).
 * Searches additionally consult the reserved read-only `_shared` corpus; each hit says WHICH
 * partition it came from via `scope`, and the underlying org id never surfaces on the wire.
 */
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

// --- Search + read (slice E5) ----------------------------------------------------------------

/**
 * Vault SEGMENT grammar. Mirrors `SEGMENT_RE` in api/src/knowledge/paths.ts, which re-validates
 * server-side and is the real jail — this is the contract-level statement of the same fact, so a
 * client knows the shape before it calls.
 *
 * The load-bearing consequence: a collection and a docId are each exactly ONE path segment, '/'
 * is unrepresentable in both, and neither can be '.' or '..'. That is why `readKnowledgeDoc`
 * addresses a document with two ordinary express `:params` rather than the wildcard/query-param
 * dance memvault needed for its multi-segment permalinks (shared/src/memvault.ts).
 */
export const KNOWLEDGE_SEGMENT_RE = /^[a-zA-Z0-9._-]{1,100}$/;
export const KnowledgeSegment = z
  .string()
  .regex(KNOWLEDGE_SEGMENT_RE)
  // '.' and '..' match the charset; they are refused separately, exactly as isSafeSegment does.
  .refine((s) => s !== '.' && s !== '..', { message: 'reserved path segment' });
export type KnowledgeSegment = z.infer<typeof KnowledgeSegment>;

/** Free-text search over the caller's OWN org partition plus the reserved `_shared` corpus, and
 *  nothing else. No tenant field: there is no other partition to ask for. */
export const KnowledgeSearchRequest = z.object({
  query: z.string().min(1).max(1_000),
  /** Maximum hits RETURNED. With `collection` set it also bounds recall — see below. */
  limit: z.coerce.number().int().positive().max(50).optional(),
  /**
   * Narrow to one collection. Same segment grammar as the vault directory it names.
   *
   * HONEST BEHAVIOUR, because it changes what you get back and a client cannot see it otherwise:
   * this is a POST-FILTER over a relevance-ranked page, NOT a `WHERE collection = ?` scan. The
   * lexical index has no collection predicate, and giving it one would change the shape the
   * in-process agent tools already depend on. So the server fetches a bounded window of the
   * best-scoring matches for `query` ACROSS the caller's collections and then keeps the ones in
   * `collection`.
   *
   * The consequence: a collection whose matches are outranked by other collections can be
   * UNDER-REPORTED, and `limit` is part of that bound. A document that loses to 40 competitors
   * elsewhere returns 0 hits at `limit: 1` and 1 hit at `limit: 50`. Treat a filtered search as
   * "the best matches for this query, restricted to this collection" — never as "every document in
   * this collection matching this query". To enumerate a collection exhaustively, page
   * `GET /api/v1/knowledge/documents?collection=…`, which IS a full scan.
   */
  collection: KnowledgeSegment.optional(),
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequest>;

/**
 * A hit names the document and shows why it matched. `title`/`snippet`/`score` are index-derived
 * presentation and stay optional — never something a client should key logic on. `scope` is the
 * one field a client SHOULD branch on: a `shared` hit belongs to the public corpus, so it is
 * readable by every org and deletable by none.
 */
export const KnowledgeSearchHit = z.object({
  collection: z.string(),
  docId: z.string(),
  title: z.string().optional(),
  snippet: z.string().optional(),
  score: z.number().optional(),
  sourceUrl: z.string().optional(),
  scope: z.enum(['org', 'shared']),
});
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHit>;

export const KnowledgeSearchResponse = z.object({ hits: z.array(KnowledgeSearchHit) });
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponse>;

/** Path params of `readKnowledgeDoc` — validated against the segment grammar before any read. */
export const KnowledgeDocParams = z.object({ collection: KnowledgeSegment, docId: KnowledgeSegment });
export type KnowledgeDocParams = z.infer<typeof KnowledgeDocParams>;

/**
 * One document: the list summary a client already knows, plus the markdown body and the partition
 * it was served from.
 *
 * `createdAtRaw` carries a creation stamp that is NOT RFC-3339, and it exists because the reserved
 * `_shared` corpus is imported offline with the SOURCE's stamp preserved verbatim — a legal corpus
 * routinely carries date-only values like "2020-01-01". `createdAt` (IsoTimestamp) is emitted only
 * when the stamp actually validates; otherwise the verbatim text lands here instead, so the body a
 * client validates is always contract-valid and nothing is silently dropped. Exactly one of the two
 * is present when the document has a stamp at all.
 */
export const KnowledgeDocumentResponse = KnowledgeDocSummary.extend({
  contentMd: z.string(),
  scope: z.enum(['org', 'shared']),
  createdAtRaw: z.string().max(128).optional(),
});
export type KnowledgeDocumentResponse = z.infer<typeof KnowledgeDocumentResponse>;

export const knowledgeEndpoints = {
  // --- The `user-or-key` READ surface (slice E5). A gateway-key client browses, searches and
  // reads; it cannot ingest, delete, upload, manage sources or heal the index — those stay
  // `user`/`org-admin` below, and opening ingestion to keys is explicitly a later decision.
  listCollections: {
    method: 'GET',
    path: '/api/v1/knowledge/collections',
    auth: 'user-or-key',
    response: CollectionsResponse,
  },
  listDocuments: {
    method: 'GET',
    path: '/api/v1/knowledge/documents',
    auth: 'user-or-key',
    query: DocumentsQuery,
    response: DocumentsResponse,
  },
  searchKnowledge: {
    method: 'POST',
    path: '/api/v1/knowledge/search',
    auth: 'user-or-key',
    request: KnowledgeSearchRequest,
    response: KnowledgeSearchResponse,
  },
  /** Two ordinary path params: both segments are '/'-free by grammar (KnowledgeSegment). */
  readKnowledgeDoc: {
    method: 'GET',
    path: '/api/v1/knowledge/documents/:collection/:docId',
    auth: 'user-or-key',
    /** The route safeParses `req.params` against this and answers 400 on a miss, so the segment
     *  grammar and the 400 are both contract facts rather than route-only ones (E6 review F3). */
    params: KnowledgeDocParams,
    response: KnowledgeDocumentResponse,
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
