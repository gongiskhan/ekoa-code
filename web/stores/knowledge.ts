'use client';

/**
 * Knowledge Store -- "O que a Ekoa sabe" (the KNOWLEDGE vault editor).
 *
 * Mirrors stores/memory.ts: no localStorage persistence, all data comes from the
 * backend via the typed `knowledge` domain client.
 *
 * Semantics: knowledge is explicit-write-only (every doc is ingested
 * intentionally with provenance) and search is CITED-OR-SILENT -- an empty or
 * unmatched query returns no passages rather than fabricating a guess.
 *
 * WS8a: the browse list (`fetchCollections`/`fetchDocs`) now takes a `scope` --
 * 'org' (default, the caller's own vault, unchanged) or 'shared' (the reserved
 * `_shared` legal corpus, read-only, browsable by every org). `search` is a THIRD,
 * separate surface: `POST /api/v1/knowledge/search` already unions org + `_shared`
 * for any query regardless of the browse scope, so it needs no scope of its own --
 * a hit just carries which partition it came from (`scope` on the hit itself).
 */

import { create } from 'zustand';
import { api, tryCall, getToken } from '@/lib/api';

// ============================================
// Types
// ============================================

/**
 * A row from the browse list (`listDocuments`) - mirrors `shared/src/knowledge.ts`
 * `KnowledgeDocSummary` field-for-field. WS8c fix: every field beyond `id`/`collection`/`title`
 * used to be typed REQUIRED here (`sourceType`, `date`, `language`, `snippet`) even though the
 * server never sends `date` (the real field is `createdAt`) or `snippet` at all on a browse row
 * (only a SEARCH hit carries a snippet) - `fetchDocs` bridged the gap with `as unknown as
 * KnowledgeDocSummary[]`, a cast that made the mismatch invisible instead of fixing it. A type
 * that lies plus a cast that hides it is how the next reader gets a runtime `undefined`.
 */
export interface KnowledgeDocSummary {
  id: string;
  collection: string;
  title: string;
  sourceUrl?: string;
  sourceType?: string;
  language?: string;
  size?: number;
  chunks?: number;
  createdAt?: string;
  updatedAt?: string;
  /** WS8a: which partition this row came from ('org' when omitted, the pre-WS8a-only value). */
  scope?: KnowledgeScope;
}

export interface KnowledgePassage {
  id: string;
  collection: string;
  title: string;
  sourceUrl?: string;
  date: string;
  snippet: string;
  score: number;
}

/** Which partition a browse or search result came from (WS8a): the caller's own org vault, or
 *  the reserved `_shared` corpus opened read-only for browsing (searches always union both). */
export type KnowledgeScope = 'org' | 'shared';

/** A search hit - mirrors `shared/src/knowledge.ts` `KnowledgeSearchHit`. */
export interface KnowledgeSearchHit {
  collection: string;
  docId: string;
  title?: string;
  snippet?: string;
  score?: number;
  sourceUrl?: string;
  scope: KnowledgeScope;
}

export interface IngestInput {
  collection: string;
  title: string;
  text: string;
  sourceUrl?: string;
  sourceType?: string;
  language?: string;
}

export interface KnowledgeCrawlSummary {
  fetched: number;
  ingested: number;
  updated: number;
  unchanged: number;
  discovered: number;
  failed: number;
  capped: boolean;
  pendingRemaining?: number;
  durationMs: number;
  finishedAt: string;
  error?: string;
}

/** A URL template expanded over a numeric range into many seed URLs ({n} placeholder). */
export interface SeedTemplate {
  url: string;
  from: number;
  to: number;
  step?: number;
}

export interface KnowledgeSource {
  id: string;
  label: string;
  url: string;
  /** Anchor crawler (default when absent), Lotus Domino harvest, or a declared-but-not-yet-
   *  executed JSON API ingest (WS8c OPEN item - see docs/dev-parity.md). */
  kind?: 'crawl' | 'api' | 'domino';
  /** WS8c: an honest, human-readable reason this source ships disabled (e.g. a wholesale
   *  failure on its last live run) - present only when disabled-with-a-stated-reason. */
  disabledReason?: string;
  collection: string;
  levels: number;
  maxPages: number;
  /** Link-follow scope during a crawl (never named `scope` - that name is reserved on this
   *  domain for the `_shared` browse partition, WS8a). */
  crawlScope: 'same-domain' | 'any';
  enabled: boolean;
  /** Render with a headless browser before extracting — for JS/SPA sites. */
  render?: boolean;
  /** Optional request User-Agent override (e.g. Googlebot for SSR-on-bot sites). */
  userAgent?: string;
  /** Additional seed URLs the frontier also starts from. */
  seeds?: string[];
  /** A URL template expanded over a numeric range into many seed URLs. */
  seedTemplate?: SeedTemplate;
  seedId?: string;
  lastCrawledAt?: string | null;
  lastRefreshAt?: string | null;
  lastResult?: KnowledgeCrawlSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceInput {
  label?: string;
  url: string;
  collection: string;
  levels?: number;
  maxPages?: number;
  crawlScope?: string;
  enabled?: boolean;
  render?: boolean;
  userAgent?: string;
  seeds?: string[];
  /** A valid template sets it; `null` explicitly clears it on edit; `undefined` leaves it. */
  seedTemplate?: SeedTemplate | null;
}

export interface CrawlProgress {
  sourceId: string;
  state: 'running' | 'done' | 'error';
  fetched: number;
  ingested: number;
  updated: number;
  unchanged: number;
  discovered: number;
  failed: number;
  queued: number;
  capped: boolean;
  startedAt: string;
  error?: string;
}

export interface ScheduleInfo {
  enabled: boolean;
  hour: number;
  nextRunAt: string;
}

export interface CrawlStats {
  total: number;
  pending: number;
  ok: number;
  error: number;
  withDoc: number;
}

export interface UploadDoc {
  id: string;
  filename: string;
  mimeType: string;
  collection: string;
  bytes: number;
  docIds: string[];
  chunkCount: number;
  charCount: number;
  status: 'indexed' | 'stored';
  extractKind: string;
  uploadedAt: string;
  uploadedBy: string;
}

interface KnowledgeState {
  // Data
  collections: string[];
  docs: KnowledgeDocSummary[];
  /** Total docs matching the current browse filter (for pagination). */
  docsTotal: number;
  /** Current 0-based browse page. */
  docsPage: number;
  activeCollection: string;
  /** WS8a: which vault the Fornecido browse list + collection chips address. */
  scope: KnowledgeScope;
  sources: KnowledgeSource[];
  schedule: ScheduleInfo | null;
  uploads: UploadDoc[];

  // Search (WS8a) - a separate surface from the browse list above; always unions org + `_shared`.
  searchQuery: string;
  searchHits: KnowledgeSearchHit[];
  searching: boolean;
  searchError: string | null;

  // Loading / error
  loading: boolean;
  sourcesLoading: boolean;
  uploadsLoading: boolean;
  error: string | null;

  // Actions
  fetchCollections: () => Promise<void>;
  /** Paginated browse over the whole base (Fornecido tab), scoped to `scope`. */
  fetchDocs: (page?: number) => Promise<void>;
  /** Switch the Fornecido browse between the org's own vault and the shared public corpus.
   *  Resets the collection filter + page (a filter from one scope rarely names a collection
   *  in the other) and refetches both collections and the first doc page. */
  setScope: (scope: KnowledgeScope) => void;
  ingest: (input: IngestInput) => Promise<{ success: boolean; error?: string }>;
  remove: (collection: string, id: string) => Promise<{ success: boolean; error?: string }>;
  setActiveCollection: (collection: string) => void;
  clearError: () => void;

  /** Free-text search over org + `_shared` (`POST /api/v1/knowledge/search`). Empty/blank query
   *  clears the results rather than issuing a request (cited-or-silent applies to the box too). */
  search: (query: string) => Promise<void>;
  clearSearch: () => void;

  /** Page size for the Fornecido browse list. */
  readonly DOCS_PAGE_SIZE: number;

  // Crawl sources
  fetchSources: () => Promise<void>;
  addSource: (input: SourceInput) => Promise<{ success: boolean; error?: string }>;
  updateSource: (id: string, input: SourceInput) => Promise<{ success: boolean; error?: string }>;
  deleteSource: (id: string) => Promise<{ success: boolean; error?: string }>;
  startCrawl: (id: string) => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }>;
  fetchCrawlStatus: (id: string) => Promise<{ running: boolean; progress: CrawlProgress | null; stats: CrawlStats | null }>;
  fetchSchedule: () => Promise<void>;

  // Document uploads
  fetchUploads: () => Promise<void>;
  uploadDocument: (file: File, collection: string) => Promise<{ success: boolean; error?: string }>;
  unindexDocument: (id: string) => Promise<{ success: boolean; error?: string }>;
}

// ============================================
// Store
// ============================================

export const useKnowledgeStore = create<KnowledgeState>()((set, get) => ({
  DOCS_PAGE_SIZE: 20,
  collections: [],
  docs: [],
  docsTotal: 0,
  docsPage: 0,
  activeCollection: '',
  scope: 'org',
  sources: [],
  schedule: null,
  uploads: [],
  searchQuery: '',
  searchHits: [],
  searching: false,
  searchError: null,
  loading: false,
  sourcesLoading: false,
  uploadsLoading: false,
  error: null,

  // -------------------------------------------
  // Fetch collection names (WS8a: scoped to `scope` - 'org' by default, byte-identical to the
  // pre-WS8a request; 'shared' lists the reserved `_shared` corpus's collections instead).
  // -------------------------------------------
  fetchCollections: async () => {
    const { scope } = get();
    const response = await tryCall(() => api.knowledge.listCollections({ scope }));
    if (response.ok) {
      set({ collections: response.data.items ?? [] });
    }
    // silently fail otherwise -- the docs fetch surfaces a visible error if needed
  },

  // -------------------------------------------
  // Browse docs - paginated over the whole base (Fornecido tab), scoped to `scope`. Uses the
  // documents list (collection filter + offset/limit), a filesystem browse — NOT a search.
  // -------------------------------------------
  fetchDocs: async (page = 0) => {
    const { activeCollection, DOCS_PAGE_SIZE, scope } = get();
    set({ loading: true, error: null });
    const params: Record<string, unknown> = {
      offset: page * DOCS_PAGE_SIZE,
      limit: DOCS_PAGE_SIZE,
      scope,
    };
    if (activeCollection) params.collection = activeCollection;
    const response = await tryCall(() => api.knowledge.listDocuments(params));
    if (response.ok) {
      set({
        docs: response.data.items ?? [],
        docsTotal: response.data.total ?? 0,
        docsPage: page,
        loading: false,
      });
    } else {
      set({
        error: response.error.message || 'Falha ao carregar a base de conhecimento',
        loading: false,
      });
    }
  },

  // -------------------------------------------
  // Switch the Fornecido browse scope (WS8a).
  // -------------------------------------------
  setScope: (scope) => {
    if (get().scope === scope) return;
    set({ scope, activeCollection: '' });
    void get().fetchCollections();
    void get().fetchDocs(0);
  },

  // -------------------------------------------
  // Free-text search (WS8a) - POST /api/v1/knowledge/search, already unions org + `_shared`.
  // -------------------------------------------
  search: async (query) => {
    const trimmed = query.trim();
    set({ searchQuery: query });
    if (!trimmed) {
      set({ searchHits: [], searching: false, searchError: null });
      return;
    }
    set({ searching: true, searchError: null });
    const response = await tryCall(() => api.knowledge.searchKnowledge({ query: trimmed, limit: 20 }));
    // Stale-response guard: only apply the result if the query box still matches what we asked
    // for (a slow early request must not clobber a faster later one).
    if (get().searchQuery.trim() !== trimmed) return;
    if (response.ok) {
      set({ searchHits: (response.data.hits ?? []) as unknown as KnowledgeSearchHit[], searching: false });
    } else {
      set({ searchError: response.error.message || 'Falha na pesquisa', searching: false, searchHits: [] });
    }
  },

  clearSearch: () => set({ searchQuery: '', searchHits: [], searching: false, searchError: null }),

  // -------------------------------------------
  // Ingest a new doc
  // -------------------------------------------
  ingest: async (input) => {
    set({ loading: true, error: null });
    const response = await tryCall(() =>
      api.knowledge.createDocument(input as unknown as Parameters<typeof api.knowledge.createDocument>[0]),
    );
    if (response.ok) {
      set({ loading: false });
      // Refresh the visible list + collections (a new collection may exist now).
      await get().fetchCollections();
      await get().fetchDocs(0);
      return { success: true };
    }
    const errorMsg = response.error.message || 'Falha ao guardar o documento';
    set({ error: errorMsg, loading: false });
    return { success: false, error: errorMsg };
  },

  // -------------------------------------------
  // Delete a doc
  // -------------------------------------------
  remove: async (collection, id) => {
    set({ error: null });
    const response = await tryCall(() => api.knowledge.deleteDocument({ collection, id }));
    if (response.ok) {
      // Refresh collections, then refetch the page — CLAMPED, so deleting the
      // last item on the last page doesn't leave us past the end (empty page).
      await get().fetchCollections();
      const newTotal = Math.max(0, get().docsTotal - 1);
      const lastPage = Math.max(0, Math.ceil(newTotal / get().DOCS_PAGE_SIZE) - 1);
      await get().fetchDocs(Math.min(get().docsPage, lastPage));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Falha ao eliminar o documento';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  // -------------------------------------------
  // UI state
  // -------------------------------------------
  setActiveCollection: (collection) => {
    set({ activeCollection: collection });
    void get().fetchDocs(0); // new filter → back to page 1
  },

  clearError: () => set({ error: null }),

  // -------------------------------------------
  // Crawl sources
  // -------------------------------------------
  fetchSources: async () => {
    set({ sourcesLoading: true });
    const response = await tryCall(() => api.knowledge.listSources());
    if (response.ok) {
      set({ sources: (response.data.items ?? []) as unknown as KnowledgeSource[], sourcesLoading: false });
    } else {
      set({ sourcesLoading: false, error: response.error.message || 'Falha ao carregar as fontes' });
    }
  },

  addSource: async (input) => {
    set({ error: null });
    const response = await tryCall(() =>
      api.knowledge.createSource({ ...input } as unknown as Parameters<typeof api.knowledge.createSource>[0]),
    );
    if (response.ok) {
      await get().fetchSources();
      return { success: true };
    }
    const errorMsg = response.error.message || 'Falha ao adicionar a fonte';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  updateSource: async (id, input) => {
    set({ error: null });
    const response = await tryCall(() =>
      api.knowledge.updateSource({ id, ...input } as unknown as Parameters<typeof api.knowledge.updateSource>[0]),
    );
    if (response.ok) {
      await get().fetchSources();
      return { success: true };
    }
    const errorMsg = response.error.message || 'Falha ao atualizar a fonte';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  deleteSource: async (id) => {
    set({ error: null });
    const response = await tryCall(() => api.knowledge.deleteSource({ id }));
    if (response.ok) {
      set((state) => ({ sources: state.sources.filter((s) => s.id !== id) }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Falha ao eliminar a fonte';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  startCrawl: async (id) => {
    set({ error: null });
    const response = await tryCall(() => api.knowledge.crawlSource({ id }));
    if (response.ok) {
      return { success: true, alreadyRunning: response.data.alreadyRunning };
    }
    const errorMsg = response.error.message || 'Falha ao iniciar a atualização';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  fetchCrawlStatus: async (id) => {
    const response = await tryCall(() => api.knowledge.crawlStatus({ id }));
    if (response.ok) {
      const data = response.data as unknown as {
        running: boolean;
        progress?: CrawlProgress | null;
        stats?: CrawlStats | null;
      };
      return {
        running: data.running,
        progress: data.progress ?? null,
        stats: data.stats ?? null,
      };
    }
    return { running: false, progress: null, stats: null };
  },

  fetchSchedule: async () => {
    const response = await tryCall(() => api.knowledge.refreshSchedule());
    if (response.ok) {
      set({ schedule: (response.data.schedule ?? null) as unknown as ScheduleInfo | null });
    }
    // non-fatal — schedule banner just won't show
  },

  // -------------------------------------------
  // Document uploads
  // -------------------------------------------
  fetchUploads: async () => {
    set({ uploadsLoading: true });
    const response = await tryCall(() => api.knowledge.listUploads());
    if (response.ok) {
      set({ uploads: (response.data.items ?? []) as unknown as UploadDoc[], uploadsLoading: false });
    } else {
      set({ uploadsLoading: false, error: response.error.message || 'Falha ao carregar os documentos' });
    }
  },

  uploadDocument: async (file, collection) => {
    set({ error: null });
    if (!getToken()) return { success: false, error: 'Sessão expirada' };
    const response = await tryCall(() =>
      api.knowledge.createUpload(
        {},
        {
          rawBody: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'x-filename': encodeURIComponent(file.name),
            'x-collection': collection,
          },
        },
      ),
    );
    if (!response.ok) {
      const msg = response.error.message || 'Falha no carregamento';
      set({ error: msg });
      return { success: false, error: msg };
    }
    await get().fetchUploads();
    // A new collection + new docs now exist; refresh both so the Fornecido
    // browse (list, count, pagination) reflects the upload immediately.
    await get().fetchCollections();
    await get().fetchDocs(0);
    return { success: true };
  },

  unindexDocument: async (id) => {
    set({ error: null });
    const response = await tryCall(() => api.knowledge.deleteUpload({ id }));
    if (response.ok) {
      set((state) => ({ uploads: state.uploads.filter((u) => u.id !== id) }));
      await get().fetchCollections();
      await get().fetchDocs(0); // the removed doc leaves the Fornecido browse too
      return { success: true };
    }
    const errorMsg = response.error.message || 'Falha ao remover o documento';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },
}));
