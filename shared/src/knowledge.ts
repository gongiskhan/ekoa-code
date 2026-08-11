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

/**
 * Which partition a browse call addressed (WS8a): the caller's OWN org vault (default, unchanged
 * behaviour) or the reserved `_shared` corpus opened READ-ONLY for browsing. Mirrors the `scope`
 * field a search hit already carries (see {@link KnowledgeSearchHit}) - one name for the same
 * concept across both capability reads.
 */
export const KnowledgeScope = z.enum(['org', 'shared']);
export type KnowledgeScope = z.infer<typeof KnowledgeScope>;

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
    /** WS8a: which partition this row came from. Optional/additive - omitted by any caller that
     *  predates the field, and always 'org' when omitted (the historical, only behaviour). */
    scope: KnowledgeScope.optional(),
  })
  .passthrough();
export type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummary>;

/**
 * A URL template expanded over a numeric range into many seed URLs (WS8c). The `{n}` placeholder
 * is substituted with each value from `from` to `to` inclusive, stepping by `step` - lets one
 * source enumerate an id space (`…/lei.php?nid={n}` over 1..4040) directly, past the anchor-depth
 * budget. NOTE: this is a DIFFERENT concept from `seedId` below (the internal idempotent-seed
 * marker) - an earlier slice conflated the two names on the wire (`seedTemplate` carried the
 * `seedId` STRING); WS8c splits them back into their own fields, matching what the store's own
 * `SeedTemplate`/`KnowledgeSource.seedId` TypeScript shapes already expected.
 */
export const SeedTemplate = z.object({
  url: z.string(),
  from: z.number().int(),
  to: z.number().int(),
  step: z.number().int().positive().optional(),
});
export type SeedTemplate = z.infer<typeof SeedTemplate>;

/** One Domino database this source's harvest walks (WS8c - see {@link DominoSourceConfig}). */
export const DominoDatabase = z.object({
  /** Database file, e.g. `jstj.nsf`. */
  db: z.string(),
  /** View name override (falls back to the source's default view). */
  view: z.string().optional(),
  /** Max ReadViewEntries pages walked for THIS database, per run. */
  maxPages: z.number().int().positive().optional(),
});
export type DominoDatabase = z.infer<typeof DominoDatabase>;

/**
 * A Lotus Domino harvest source (WS8c - e.g. dgsi.pt). Domino's `?ReadViewEntries` XML API
 * enumerates a view's entries (with document UNIDs) with no JS rendering needed; each entry's
 * document is then fetched at `<db>/0/<unid>?OpenDocument`. One source can cover many court
 * databases (`kind: 'domino'` on {@link KnowledgeSource}).
 */
export const DominoSourceConfig = z.object({
  /** Server base, e.g. `https://www.dgsi.pt`. */
  baseUrl: z.string(),
  /** Default view name for every database (e.g. `Por Ano`). */
  view: z.string().optional(),
  /** ReadViewEntries page size (default 1000). */
  count: z.number().int().positive().optional(),
  databases: z.array(DominoDatabase).min(1),
});
export type DominoSourceConfig = z.infer<typeof DominoSourceConfig>;

/** One crawl/refresh run's outcome (WS8c) - the Sources tab's per-source result line and the
 *  live `crawlStatus` progress share this shape (progress is the SAME fields mid-run). */
export const KnowledgeCrawlSummary = z.object({
  fetched: z.number().int().nonnegative(),
  ingested: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  discovered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** True when the per-run page budget was hit - more frontier remains for the next run. */
  capped: z.boolean(),
  /** Frontier size after this run (pages still `pending`) - absent for a Domino harvest, which
   *  has no anchor frontier. */
  pendingRemaining: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative(),
  finishedAt: IsoTimestamp,
  /** Present only when the whole run failed before completing. */
  error: z.string().optional(),
});
export type KnowledgeCrawlSummary = z.infer<typeof KnowledgeCrawlSummary>;

/** A crawl's live in-flight progress (WS8c) - the same counters as {@link KnowledgeCrawlSummary}
 *  plus the run's identity/state, polled by `crawlStatus` while `started`/`alreadyRunning`. */
export const CrawlProgress = z.object({
  sourceId: z.string(),
  state: z.enum(['running', 'done', 'error']),
  fetched: z.number().int().nonnegative(),
  ingested: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  discovered: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  capped: z.boolean(),
  startedAt: IsoTimestamp,
  error: z.string().optional(),
});
export type CrawlProgress = z.infer<typeof CrawlProgress>;

/** Ledger page counts for a source (WS8c) - "X indexed / Y still queued" on the Sources tab. */
export const CrawlLedgerStats = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  ok: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
  withDoc: z.number().int().nonnegative(),
});
export type CrawlLedgerStats = z.infer<typeof CrawlLedgerStats>;

export const KnowledgeSource = z
  .object({
    id: Id,
    label: z.string().optional(),
    url: z.string(),
    type: z.string().optional(),
    collection: z.string().optional(),
    levels: z.number().int().positive().optional(),
    maxPages: z.number().int().positive().optional(),
    /** Link-follow scope during a crawl: the seed's own domain, or any domain discovered along
     *  the way (WS8c). Deliberately NOT named `scope` - that name is reserved on this whole
     *  domain for the `_shared`-corpus browse partition ({@link KnowledgeScope}), and no other
     *  request/query field may spell it (enforced by tests/contract/knowledge.test.ts). */
    crawlScope: z.enum(['same-domain', 'any']).optional(),
    enabled: z.boolean().optional(),
    /** Render each page with a headless browser before extracting - JS/SPA sources (WS8c). */
    render: z.boolean().optional(),
    userAgent: z.string().optional(),
    seeds: z.array(z.string()).optional(),
    seedTemplate: SeedTemplate.nullable().optional(),
    domino: DominoSourceConfig.optional(),
    /** Internal idempotent-seed marker (WS8b/8c) - set only on a source the startup seeder
     *  created; a hand-added source never carries it. NOT the same field as `seedTemplate`
     *  above (see that field's doc for the WS8c split). */
    seedId: z.string().optional(),
    /** WS8c: an honest, human-readable reason a seeded source ships `enabled: false` (e.g. a
     *  wholesale failure on its last live run that this build could not diagnose offline) -
     *  present only when disabled-with-a-stated-reason, never fabricated. */
    disabledReason: z.string().optional(),
    lastCrawledAt: IsoTimestamp.optional(),
    lastRefreshAt: IsoTimestamp.optional(),
    lastResult: KnowledgeCrawlSummary.nullable().optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;

export const SourceInput = z
  .object({
    label: z.string().optional(),
    url: z.string(),
    type: z.string().optional(),
    collection: z.string().optional(),
    levels: z.number().int().positive().optional(),
    maxPages: z.number().int().positive().optional(),
    /** See {@link KnowledgeSource.crawlScope} - same field, same "never named `scope`" rule. */
    crawlScope: z.enum(['same-domain', 'any']).optional(),
    enabled: z.boolean().optional(),
    render: z.boolean().optional(),
    userAgent: z.string().optional(),
    seeds: z.array(z.string()).optional(),
    seedTemplate: SeedTemplate.nullable().optional(),
    domino: DominoSourceConfig.optional(),
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

/**
 * WS8a: `scope` opts a browse call into the reserved `_shared` corpus instead of the caller's own
 * org vault. Additive and optional - an absent value is 'org', byte-identical to the pre-WS8a
 * behaviour. This is NOT a tenant selector: the only two values are "mine" and "the one public
 * corpus every org already searches" - there is no way to name another org's partition here, same
 * as every other knowledge query/request shape (ch03 §3.8.20 invariant).
 */
export const CollectionsQuery = z.object({
  scope: KnowledgeScope.optional(),
});
export type CollectionsQuery = z.infer<typeof CollectionsQuery>;

export const DocumentsQuery = PaginationQuery.extend({
  collection: z.string().optional(),
  /** WS8a: see {@link CollectionsQuery.scope}. */
  scope: KnowledgeScope.optional(),
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

/**
 * WS8c: `progress`/`stats` are now their REAL shapes - `progress` was `z.number()` (never
 * matching what the crawl engine actually emits, {@link CrawlProgress}) and `stats` was an
 * untyped record. Both are additive-safe changes (the fields were already optional / unread by
 * anything conforming to the old, wrong shape).
 */
export const CrawlStatusResponse = z
  .object({
    running: z.boolean(),
    progress: CrawlProgress.nullable().optional(),
    stats: CrawlLedgerStats.nullable().optional(),
  })
  .passthrough();
export type CrawlStatusResponse = z.infer<typeof CrawlStatusResponse>;

/** The nightly refresh schedule (WS8c: `schedule` is now its real shape, not an untyped record). */
export const ScheduleInfo = z.object({
  enabled: z.boolean(),
  hour: z.number().int().min(0).max(23),
  nextRunAt: IsoTimestamp,
});
export type ScheduleInfo = z.infer<typeof ScheduleInfo>;

export const RefreshScheduleResponse = z
  .object({
    schedule: ScheduleInfo.nullable(),
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
    query: CollectionsQuery,
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
  /**
   * WS8c: gated to `super-admin`, not the `user` tier the rest of the sources surface uses.
   * Triggering a crawl WRITES into the reserved `_shared` corpus (every org's read-only legal
   * spine) - unlike browsing it (WS8a, open to any authenticated org actor because search
   * already grants that read for free), starting a crawl is a genuinely privileged action with
   * no equivalent implicit grant, so it gets the platform's narrowest ordinary role.
   */
  crawlSource: {
    method: 'POST',
    path: '/api/v1/knowledge/sources/:id/crawl',
    auth: 'super-admin',
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
