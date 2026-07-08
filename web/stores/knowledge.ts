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
 */

import { create } from 'zustand';
import { api, tryCall, getToken } from '@/lib/api';

// ============================================
// Types
// ============================================

export interface KnowledgeDocSummary {
  id: string;
  collection: string;
  title: string;
  sourceUrl?: string;
  sourceType: string;
  date: string;
  language: string;
  tags?: string[];
  snippet: string;
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
  collection: string;
  levels: number;
  maxPages: number;
  scope: 'same-domain' | 'any';
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
  scope?: string;
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
  sources: KnowledgeSource[];
  schedule: ScheduleInfo | null;
  uploads: UploadDoc[];

  // Loading / error
  loading: boolean;
  sourcesLoading: boolean;
  uploadsLoading: boolean;
  error: string | null;

  // Actions
  fetchCollections: () => Promise<void>;
  /** Paginated browse over the whole base (Fornecido tab). Searching the base is
   *  the agents' job (ripgrep, cited-or-silent) — no human search box; this list
   *  only browses + filters. */
  fetchDocs: (page?: number) => Promise<void>;
  ingest: (input: IngestInput) => Promise<{ success: boolean; error?: string }>;
  remove: (collection: string, id: string) => Promise<{ success: boolean; error?: string }>;
  setActiveCollection: (collection: string) => void;
  clearError: () => void;

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
  sources: [],
  schedule: null,
  uploads: [],
  loading: false,
  sourcesLoading: false,
  uploadsLoading: false,
  error: null,

  // -------------------------------------------
  // Fetch collection names
  // -------------------------------------------
  fetchCollections: async () => {
    const response = await tryCall(() => api.knowledge.listCollections());
    if (response.ok) {
      set({ collections: response.data.items ?? [] });
    }
    // silently fail otherwise -- the docs fetch surfaces a visible error if needed
  },

  // -------------------------------------------
  // Browse docs — paginated over the whole base (Fornecido tab). Uses the
  // documents list (collection filter + offset/limit), a filesystem browse — NOT a search.
  // -------------------------------------------
  fetchDocs: async (page = 0) => {
    const { activeCollection, DOCS_PAGE_SIZE } = get();
    set({ loading: true, error: null });
    const params: Record<string, unknown> = {
      offset: page * DOCS_PAGE_SIZE,
      limit: DOCS_PAGE_SIZE,
    };
    if (activeCollection) params.collection = activeCollection;
    const response = await tryCall(() => api.knowledge.listDocuments(params));
    if (response.ok) {
      set({
        docs: (response.data.items ?? []) as unknown as KnowledgeDocSummary[],
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
