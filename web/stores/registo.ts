'use client';

/**
 * Registo Store (Amendment 2, FC-502)
 *
 * The org activity read surface (`GET /api/v1/registo`, ch03 §3.8.24): metadata
 * and artifacts only, never chat or message bodies. An org-admin sees its own
 * org; a super-admin may pass `orgId` to cross orgs. Filters: user, action type,
 * date range (from/to). Read-only — the single audit write path is server-side.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { RegistoEntry, RegistoQuery } from '@ekoa/shared';

export interface RegistoFilters {
  userId: string;
  type: string;
  from: string;
  to: string;
  orgId: string;
}

const DEFAULT_FILTERS: RegistoFilters = {
  userId: '',
  type: '',
  from: '',
  to: '',
  orgId: '',
};

const PAGE_SIZE = 50;

interface RegistoState {
  entries: RegistoEntry[];
  total: number;
  filters: RegistoFilters;
  isLoading: boolean;
  error: string | null;

  fetchRegisto: () => Promise<void>;
  setFilter: (key: keyof RegistoFilters, value: string) => void;
  clearFilters: () => void;
  clearError: () => void;
}

/** Turn ISO-date inputs (yyyy-mm-dd) into the day-bounded ISO instants the query expects. */
function toIso(value: string, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  const suffix = endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z';
  return `${value}${suffix}`;
}

export const useRegistoStore = create<RegistoState>()((set, get) => ({
  entries: [],
  total: 0,
  filters: { ...DEFAULT_FILTERS },
  isLoading: false,
  error: null,

  fetchRegisto: async () => {
    const { filters } = get();
    set({ isLoading: true, error: null });

    const query: RegistoQuery = { limit: PAGE_SIZE };
    if (filters.userId) query.userId = filters.userId;
    if (filters.type) query.type = filters.type;
    const from = toIso(filters.from, false);
    const to = toIso(filters.to, true);
    if (from) query.from = from;
    if (to) query.to = to;
    if (filters.orgId) query.orgId = filters.orgId;

    const response = await tryCall(() =>
      api.registo.listRegisto(query as unknown as Record<string, unknown>),
    );
    if (response.ok) {
      set({ entries: response.data.items, total: response.data.total, isLoading: false });
    } else {
      set({ error: response.error.message || 'Failed to fetch registo', isLoading: false });
    }
  },

  setFilter: (key, value) => {
    set((state) => ({ filters: { ...state.filters, [key]: value } }));
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    void get().fetchRegisto();
  },

  clearError: () => set({ error: null }),
}));
