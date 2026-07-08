'use client';

/**
 * Company Store
 *
 * Manages company configuration and branding. The UI label stays "Escritório";
 * the transport now targets the org domain (FC-040): getOrg / updateOrg /
 * saveBranding. The store's public method and field names are unchanged.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { OrgConfig, OrgBranding } from '@ekoa/shared';

interface CompanyState {
  // State
  company: OrgConfig | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchCompany: () => Promise<void>;
  updateCompany: (data: {
    displayName?: string;
    branding?: Partial<OrgBranding>;
    settings?: Record<string, unknown>;
  }) => Promise<{ success: boolean; error?: string }>;
  updateBranding: (branding: Record<string, unknown>, displayName?: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useCompanyStore = create<CompanyState>()((set) => ({
  company: null,
  isLoading: false,
  error: null,

  fetchCompany: async () => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.org.getOrg());
    if (response.ok) {
      set({ company: response.data, isLoading: false });
    } else {
      set({ error: response.error.message || 'Failed to fetch company', isLoading: false });
    }
  },

  updateCompany: async (data) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() =>
      api.org.updateOrg(data as unknown as Parameters<typeof api.org.updateOrg>[0]),
    );
    if (response.ok) {
      set({ company: response.data, isLoading: false });
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to update company';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  updateBranding: async (branding, displayName) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() =>
      api.org.saveBranding({ branding: branding as OrgBranding, displayName }),
    );
    if (response.ok) {
      set({ company: response.data, isLoading: false });
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to update branding';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  clearError: () => set({ error: null }),
}));
