'use client';

/**
 * Company Store
 *
 * Manages company configuration and branding.
 */

import { create } from 'zustand';
import * as api from '@/lib/api/client';
import type { CompanyConfig, CompanyBranding } from '@/lib/api/client';

interface CompanyState {
  // State
  company: CompanyConfig | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchCompany: () => Promise<void>;
  updateCompany: (data: {
    displayName?: string;
    branding?: Partial<CompanyBranding>;
    settings?: Partial<CompanyConfig['settings']>;
  }) => Promise<{ success: boolean; error?: string }>;
  updateBranding: (branding: Partial<CompanyBranding>, displayName?: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

export const useCompanyStore = create<CompanyState>()((set) => ({
  company: null,
  isLoading: false,
  error: null,

  fetchCompany: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.getCompany();
      if (response.success && response.data) {
        set({ company: response.data, isLoading: false });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch company',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch company',
        isLoading: false,
      });
    }
  },

  updateCompany: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.updateCompany(data);
      if (response.success && response.data) {
        set({ company: response.data, isLoading: false });
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to update company';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update company';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  updateBranding: async (branding, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.updateCompanyBranding(branding, displayName);
      if (response.success && response.data) {
        set({ company: response.data, isLoading: false });
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to update branding';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update branding';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  clearError: () => set({ error: null }),
}));
