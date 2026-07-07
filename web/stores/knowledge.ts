'use client';

/**
 * Knowledge Store -- "O que a Ekoa sabe" (the KNOWLEDGE vault editor).
 *
 * Mirrors stores/memory.ts: no localStorage persistence, all data comes from the
 * backend via wsAction('ekoa.knowledge', intent, params). The backend handler
 * supersedes the stale ekoa.knowledge recipe app.
 *
 * Semantics: knowledge is explicit-write-only (every doc is ingested
 * intentionally with provenance) and search is CITED-OR-SILENT -- an empty or
 * unmatched query returns no passages rather than fabricating a guess.
 */

import { create } from 'zustand';
import { wsAction, getApiBaseUrl } from '@/lib/api/client';

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
    try {
      const response = await wsAction<{ collections: string[] }>('ekoa.knowledge', 'list-collections');
      if (response.success && response.data) {
        set({ collections: response.data.collections ?? [] });
      }
    } catch {
      // silently fail -- the docs fetch surfaces a visible error if needed
    }
  },

  // -------------------------------------------
  // Browse docs — paginated over the whole base (Fornecido tab). Uses the `list`
  // intent (collection filter + offset/limit), a filesystem browse — NOT a search.
  // -------------------------------------------
  fetchDocs: async (page = 0) => {
    const { activeCollection, DOCS_PAGE_SIZE } = get();
    set({ loading: true, error: null });
    try {
      const params: Record<string, unknown> = {
        offset: page * DOCS_PAGE_SIZE,
        limit: DOCS_PAGE_SIZE,
      };
      if (activeCollection) params.collection = activeCollection;
      const response = await wsAction<{ docs: KnowledgeDocSummary[]; total: number }>(
        'ekoa.knowledge',
        'list',
        params,
      );
      if (response.success && response.data) {
        set({
          docs: response.data.docs ?? [],
          docsTotal: response.data.total ?? 0,
          docsPage: page,
          loading: false,
        });
      } else {
        set({
          error: response.error?.message || 'Falha ao carregar a base de conhecimento',
          loading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Falha ao carregar a base de conhecimento',
        loading: false,
      });
    }
  },

  // -------------------------------------------
  // Ingest a new doc
  // -------------------------------------------
  ingest: async (input) => {
    set({ loading: true, error: null });
    try {
      const response = await wsAction('ekoa.knowledge', 'ingest', input);
      if (response.success) {
        set({ loading: false });
        // Refresh the visible list + collections (a new collection may exist now).
        await get().fetchCollections();
        await get().fetchDocs(0);
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Falha ao guardar o documento';
      set({ error: errorMsg, loading: false });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao guardar o documento';
      set({ error: errorMsg, loading: false });
      return { success: false, error: errorMsg };
    }
  },

  // -------------------------------------------
  // Delete a doc
  // -------------------------------------------
  remove: async (collection, id) => {
    set({ error: null });
    try {
      const response = await wsAction<{ deleted: boolean }>('ekoa.knowledge', 'delete', { collection, id });
      if (response.success) {
        // Refresh collections, then refetch the page — CLAMPED, so deleting the
        // last item on the last page doesn't leave us past the end (empty page).
        await get().fetchCollections();
        const newTotal = Math.max(0, get().docsTotal - 1);
        const lastPage = Math.max(0, Math.ceil(newTotal / get().DOCS_PAGE_SIZE) - 1);
        await get().fetchDocs(Math.min(get().docsPage, lastPage));
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Falha ao eliminar o documento';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao eliminar o documento';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
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
    try {
      const response = await wsAction<{ sources: KnowledgeSource[] }>('ekoa.knowledge', 'list-sources');
      if (response.success && response.data) {
        set({ sources: response.data.sources ?? [], sourcesLoading: false });
      } else {
        set({ sourcesLoading: false, error: response.error?.message || 'Falha ao carregar as fontes' });
      }
    } catch (error) {
      set({
        sourcesLoading: false,
        error: error instanceof Error ? error.message : 'Falha ao carregar as fontes',
      });
    }
  },

  addSource: async (input) => {
    set({ error: null });
    try {
      const response = await wsAction('ekoa.knowledge', 'add-source', { ...input });
      if (response.success) {
        await get().fetchSources();
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Falha ao adicionar a fonte';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao adicionar a fonte';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  updateSource: async (id, input) => {
    set({ error: null });
    try {
      const response = await wsAction('ekoa.knowledge', 'update-source', { id, ...input });
      if (response.success) {
        await get().fetchSources();
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Falha ao atualizar a fonte';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao atualizar a fonte';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  deleteSource: async (id) => {
    set({ error: null });
    try {
      const response = await wsAction<{ deleted: boolean }>('ekoa.knowledge', 'delete-source', { id });
      if (response.success) {
        set((state) => ({ sources: state.sources.filter((s) => s.id !== id) }));
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Falha ao eliminar a fonte';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao eliminar a fonte';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  startCrawl: async (id) => {
    set({ error: null });
    try {
      const response = await wsAction<{ started: boolean; alreadyRunning: boolean }>(
        'ekoa.knowledge',
        'crawl-source',
        { id },
      );
      if (response.success) {
        return { success: true, alreadyRunning: response.data?.alreadyRunning };
      }
      const errorMsg = response.error?.message || 'Falha ao iniciar a atualização';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao iniciar a atualização';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  fetchCrawlStatus: async (id) => {
    try {
      const response = await wsAction<{ running: boolean; progress: CrawlProgress | null; stats: CrawlStats | null }>(
        'ekoa.knowledge',
        'crawl-status',
        { id },
      );
      if (response.success && response.data) {
        return {
          running: response.data.running,
          progress: response.data.progress,
          stats: response.data.stats ?? null,
        };
      }
    } catch {
      // transient — caller keeps polling
    }
    return { running: false, progress: null, stats: null };
  },

  fetchSchedule: async () => {
    try {
      const response = await wsAction<{ schedule: ScheduleInfo }>('ekoa.knowledge', 'refresh-schedule');
      if (response.success && response.data) {
        set({ schedule: response.data.schedule });
      }
    } catch {
      // non-fatal — schedule banner just won't show
    }
  },

  // -------------------------------------------
  // Document uploads
  // -------------------------------------------
  fetchUploads: async () => {
    set({ uploadsLoading: true });
    try {
      const response = await wsAction<{ uploads: UploadDoc[] }>('ekoa.knowledge', 'list-uploads');
      if (response.success && response.data) {
        set({ uploads: response.data.uploads ?? [], uploadsLoading: false });
      } else {
        set({ uploadsLoading: false, error: response.error?.message || 'Falha ao carregar os documentos' });
      }
    } catch (error) {
      set({
        uploadsLoading: false,
        error: error instanceof Error ? error.message : 'Falha ao carregar os documentos',
      });
    }
  },

  uploadDocument: async (file, collection) => {
    set({ error: null });
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('ekoa_token') : null;
      if (!token) return { success: false, error: 'Sessão expirada' };
      const res = await fetch(`${getApiBaseUrl()}/api/v1/knowledge/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': file.type || 'application/octet-stream',
          'x-filename': encodeURIComponent(file.name),
          'x-collection': collection,
        },
        body: file,
      });
      if (!res.ok) {
        let msg = `Falha no carregamento (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          /* keep default */
        }
        set({ error: msg });
        return { success: false, error: msg };
      }
      await get().fetchUploads();
      // A new collection + new docs now exist; refresh both so the Fornecido
      // browse (list, count, pagination) reflects the upload immediately.
      await get().fetchCollections();
      await get().fetchDocs(0);
      return { success: true };
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Falha no carregamento';
      set({ error: msg });
      return { success: false, error: msg };
    }
  },

  unindexDocument: async (id) => {
    set({ error: null });
    try {
      const response = await wsAction<{ removed: boolean; docsRemoved: number }>(
        'ekoa.knowledge',
        'unindex-document',
        { id },
      );
      if (response.success) {
        set((state) => ({ uploads: state.uploads.filter((u) => u.id !== id) }));
        await get().fetchCollections();
        await get().fetchDocs(0); // the removed doc leaves the Fornecido browse too
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Falha ao remover o documento';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Falha ao remover o documento';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },
}));
