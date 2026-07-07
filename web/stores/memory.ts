'use client';

/**
 * Memory Store
 *
 * Manages memory entries: list, filter, create, update, delete, bulk actions.
 * Does NOT persist to localStorage -- data comes from the API.
 */

import { create } from 'zustand';
import * as api from '@/lib/api/client';

// ============================================
// Types
// ============================================

interface MemoryFilters {
  type: string;
  scope: string;
  visibility: string;
  tags: string[];
  search: string;
}

interface MemoryTag {
  tag: string;
  count: number;
}

type MemoryTab = 'overview' | 'core' | 'guardrails' | 'recent' | 'settings';

interface MemoryState {
  // Data
  memories: any[];
  stats: any | null;
  tags: MemoryTag[];

  // UI state
  activeTab: MemoryTab;
  selectedIds: Set<string>;
  filters: MemoryFilters;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sortBy: string;
  sortOrder: string;

  // Loading
  isLoading: boolean;
  isLoadingStats: boolean;
  error: string | null;

  // Actions
  fetchMemories: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchTags: () => Promise<void>;
  createMemory: (data: any) => Promise<{ success: boolean; error?: string }>;
  updateMemory: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
  deleteMemory: (id: string) => Promise<{ success: boolean; error?: string }>;
  bulkDeleteMemories: () => Promise<{ success: boolean; error?: string }>;
  updateMemoryTier: (id: string, tier: 'core' | 'active' | 'archive') => Promise<{ success: boolean; error?: string }>;

  // Tab actions
  setActiveTab: (tab: MemoryTab) => void;

  // Filter actions
  setFilter: (key: keyof MemoryFilters, value: any) => void;
  clearFilters: () => void;
  setPage: (page: number) => void;
  setSort: (sortBy: string, sortOrder: string) => void;

  // Selection actions
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;

  clearError: () => void;
}

// ============================================
// Default values
// ============================================

const DEFAULT_FILTERS: MemoryFilters = {
  type: '',
  scope: '',
  visibility: '',
  tags: [],
  search: '',
};

// ============================================
// Store
// ============================================

export const useMemoryStore = create<MemoryState>()((set, get) => ({
  // Initial state
  memories: [],
  stats: null,
  tags: [],
  activeTab: 'overview',
  selectedIds: new Set<string>(),
  filters: { ...DEFAULT_FILTERS },
  page: 1,
  limit: 12,
  total: 0,
  totalPages: 0,
  sortBy: 'createdAt',
  sortOrder: 'desc',
  isLoading: false,
  isLoadingStats: false,
  error: null,

  // -------------------------------------------
  // Fetch memories with current filters
  // -------------------------------------------
  fetchMemories: async () => {
    const { filters, page, limit, sortBy, sortOrder } = get();
    set({ isLoading: true, error: null });

    try {
      const params: api.MemorySearchParamsAPI = {
        page,
        limit,
        sortBy,
        sortOrder,
      };
      if (filters.type) params.type = filters.type;
      if (filters.scope) params.scope = filters.scope;
      if (filters.visibility) params.visibility = filters.visibility;
      if (filters.tags.length > 0) params.tags = filters.tags.join(',');
      if (filters.search) params.search = filters.search;

      const response = await api.getMemories(params);
      if (response.success && response.data) {
        const data = response.data as any;
        set({
          memories: data.memories ?? [],
          total: data.total ?? 0,
          totalPages: data.totalPages ?? 0,
          page: data.page ?? page,
          isLoading: false,
        });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch memories',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch memories',
        isLoading: false,
      });
    }
  },

  // -------------------------------------------
  // Fetch stats
  // -------------------------------------------
  fetchStats: async () => {
    set({ isLoadingStats: true });
    try {
      const response = await api.getMemoryStats();
      if (response.success && response.data) {
        set({ stats: response.data, isLoadingStats: false });
      } else {
        set({ isLoadingStats: false });
      }
    } catch {
      set({ isLoadingStats: false });
    }
  },

  // -------------------------------------------
  // Fetch tags
  // -------------------------------------------
  fetchTags: async () => {
    try {
      const response = await api.getMemoryTags();
      if (response.success && response.data) {
        set({ tags: (response.data as any).tags ?? response.data ?? [] });
      }
    } catch {
      // silently fail
    }
  },

  // -------------------------------------------
  // Create
  // -------------------------------------------
  createMemory: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.createMemory(data);
      if (response.success) {
        set({ isLoading: false });
        // Re-fetch to get updated list and stats
        get().fetchMemories();
        get().fetchStats();
        get().fetchTags();
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to create memory';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to create memory';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  // -------------------------------------------
  // Update
  // -------------------------------------------
  updateMemory: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.updateMemory(id, data);
      if (response.success) {
        set({ isLoading: false });
        get().fetchMemories();
        get().fetchStats();
        get().fetchTags();
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to update memory';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update memory';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  // -------------------------------------------
  // Delete
  // -------------------------------------------
  deleteMemory: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.deleteMemory(id);
      if (response.success) {
        set((state) => ({
          memories: state.memories.filter((m: any) => m.id !== id),
          selectedIds: (() => {
            const next = new Set(state.selectedIds);
            next.delete(id);
            return next;
          })(),
          isLoading: false,
        }));
        get().fetchStats();
        get().fetchTags();
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to delete memory';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete memory';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  // -------------------------------------------
  // Bulk delete
  // -------------------------------------------
  bulkDeleteMemories: async () => {
    const { selectedIds } = get();
    if (selectedIds.size === 0) return { success: true };

    set({ isLoading: true, error: null });
    try {
      const ids = Array.from(selectedIds);
      const response = await api.bulkDeleteMemories(ids);
      if (response.success) {
        set((state) => ({
          memories: state.memories.filter((m: any) => !selectedIds.has(m.id)),
          selectedIds: new Set<string>(),
          isLoading: false,
        }));
        get().fetchStats();
        get().fetchTags();
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to delete memories';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete memories';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  // -------------------------------------------
  // Update memory tier
  // -------------------------------------------
  updateMemoryTier: async (id, tier) => {
    set({ error: null });
    try {
      const response = await api.updateMemory(id, { tier });
      if (response.success) {
        get().fetchMemories();
        get().fetchStats();
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to update memory tier';
        set({ error: errorMsg });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update memory tier';
      set({ error: errorMsg });
      return { success: false, error: errorMsg };
    }
  },

  // -------------------------------------------
  // Tab
  // -------------------------------------------
  setActiveTab: (tab) => {
    set({ activeTab: tab });
  },

  // -------------------------------------------
  // Filters
  // -------------------------------------------
  setFilter: (key, value) => {
    set((state) => ({
      filters: { ...state.filters, [key]: value },
      page: 1, // reset to first page
    }));
    // Auto-refetch
    setTimeout(() => get().fetchMemories(), 0);
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS }, page: 1 });
    setTimeout(() => get().fetchMemories(), 0);
  },

  setPage: (page) => {
    set({ page });
    setTimeout(() => get().fetchMemories(), 0);
  },

  setSort: (sortBy, sortOrder) => {
    set({ sortBy, sortOrder, page: 1 });
    setTimeout(() => get().fetchMemories(), 0);
  },

  // -------------------------------------------
  // Selection
  // -------------------------------------------
  toggleSelect: (id) => {
    set((state) => {
      const next = new Set(state.selectedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedIds: next };
    });
  },

  selectAll: () => {
    set((state) => ({
      selectedIds: new Set(state.memories.map((m: any) => m.id)),
    }));
  },

  clearSelection: () => {
    set({ selectedIds: new Set<string>() });
  },

  clearError: () => set({ error: null }),
}));
