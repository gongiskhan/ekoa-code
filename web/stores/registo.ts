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
  /** The API hides `anonymisation.*` rows by default (registo-anon-audit-actor-blank mitigation,
   *  docs/findings.md, `readRegisto` in api/src/services/platform-crud.ts): a single chat/build
   *  turn's Agent SDK subprocess writes many of these per one human action, most now correctly
   *  `'system'`-attributed rather than a person, so left in they would swamp every
   *  human-attributable row. This is the one-click, VISIBLE opt back in - never a silent filter -
   *  surfaced as a notice + toggle on the page, not tucked into the generic filters bar. */
  includeAnonymisation: boolean;
}

const DEFAULT_FILTERS: RegistoFilters = {
  userId: '',
  type: '',
  from: '',
  to: '',
  orgId: '',
  includeAnonymisation: false,
};

const PAGE_SIZE = 50;

interface RegistoState {
  entries: RegistoEntry[];
  total: number;
  filters: RegistoFilters;
  isLoading: boolean;
  error: string | null;

  fetchRegisto: () => Promise<void>;
  setFilter: (key: Exclude<keyof RegistoFilters, 'includeAnonymisation'>, value: string) => void;
  /** The one-click toggle for the masking-events default filter (see RegistoFilters doc).
   *  Refetches immediately - it is a visible switch, not a "remember to click Apply" filter. */
  setIncludeAnonymisation: (value: boolean) => void;
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
    if (filters.includeAnonymisation) query.includeAnonymisation = 'true';

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

  setIncludeAnonymisation: (value) => {
    set((state) => ({ filters: { ...state.filters, includeAnonymisation: value } }));
    void get().fetchRegisto();
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
    void get().fetchRegisto();
  },

  clearError: () => set({ error: null }),
}));
