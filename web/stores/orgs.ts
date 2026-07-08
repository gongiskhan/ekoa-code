'use client';

/**
 * Orgs Store (Amendment 2, FC-501)
 *
 * Super-admin org management: create, list, rename orgs
 * (`POST /orgs`, `GET /orgs`, `PATCH /orgs/:id`, ch03 §3.8.4). Distinct from the
 * company store (`web/stores/company.ts`), which reads/writes the caller's OWN
 * org (`GET /org`, `PATCH /org`). The users page also consumes this list to
 * resolve an org id to its display name in the org-assignment column (FC-500).
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { OrgConfig } from '@ekoa/shared';

interface OrgsState {
  orgs: OrgConfig[];
  isLoading: boolean;
  error: string | null;

  fetchOrgs: () => Promise<void>;
  createOrg: (data: {
    name: string;
    displayName?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  renameOrg: (
    orgId: string,
    data: { name?: string; displayName?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useOrgsStore = create<OrgsState>()((set) => ({
  orgs: [],
  isLoading: false,
  error: null,

  fetchOrgs: async () => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.org.listOrgs());
    if (response.ok) {
      set({ orgs: response.data.items, isLoading: false });
    } else {
      set({ error: response.error.message || 'Failed to fetch orgs', isLoading: false });
    }
  },

  createOrg: async (data) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.org.createOrg(data));
    if (response.ok) {
      set((state) => ({ orgs: [...state.orgs, response.data], isLoading: false }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to create org';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  renameOrg: async (orgId, data) => {
    set({ error: null });
    const response = await tryCall(() => api.org.patchOrg({ id: orgId, ...data }));
    if (response.ok) {
      set((state) => ({
        orgs: state.orgs.map((org) => (org.id === orgId ? response.data : org)),
      }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to rename org';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  clearError: () => set({ error: null }),
}));
