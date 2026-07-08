'use client';

/**
 * Settings Store
 *
 * Central store for platform behavior settings.
 * Fetches on app load, debounce-saves on change.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import { cacheVertical } from '@/lib/verticals/storage';

// ============================================
// TYPES
// ============================================

export interface PlatformSettings {
  general: {
    platformName: string;
    language: string;
    timezone: string;
    /**
     * Presentation profile for this deployment (see `@/lib/verticals`). Purely
     * cosmetic; defaults to 'generic'. Optional for backward-compat with
     * records written before verticals existed.
     */
    vertical?: 'generic' | 'legal';
  };
  chat: {
    showExampleCards: boolean;
    guidedMode: boolean;
    /** R2 — Guidance dial. Optional for backward-compat. Defaults to 'guide-me' for new accounts. */
    guidance?: 'guide-me' | 'standard' | 'just-build-it';
  };
  build: {
    showFileTreeByDefault: boolean;
  };
}

interface SettingsState {
  settings: PlatformSettings;
  isLoaded: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  saveError: string | null;

  // Actions
  fetchSettings: () => Promise<void>;
  updateSettings: (patch: DeepPartial<PlatformSettings>) => void;
  _saveToServer: (settings: PlatformSettings) => Promise<void>;
}

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ============================================
// DEFAULTS
// ============================================

const DEFAULT_SETTINGS: PlatformSettings = {
  general: {
    platformName: '',
    language: 'en',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  },
  chat: {
    showExampleCards: true,
    guidedMode: true,
    guidance: 'guide-me',
  },
  build: {
    showFileTreeByDefault: false,
  },
};

// ============================================
// DEBOUNCE
// ============================================

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 800;

// ============================================
// STORE
// ============================================

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  isLoading: false,
  isSaving: false,
  error: null,
  saveError: null,

  fetchSettings: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await tryCall(() => api.settings.get());
      if (res.ok) {
        const data = res.data as Record<string, unknown>;
        const settings: PlatformSettings = {
          general: {
            ...DEFAULT_SETTINGS.general,
            ...(data.general as Partial<PlatformSettings['general']> || {}),
          },
          chat: {
            ...DEFAULT_SETTINGS.chat,
            ...(data.chat as Partial<PlatformSettings['chat']> || {}),
          },
          build: {
            ...DEFAULT_SETTINGS.build,
            ...(data.build as Partial<PlatformSettings['build']> || {}),
          },
        };
        // Mirror the resolved vertical to localStorage so pre-auth surfaces
        // (e.g. /login) can present the right skin without refetching settings.
        cacheVertical(settings.general.vertical);
        set({ settings, isLoaded: true, isLoading: false });
      } else {
        set({ isLoaded: true, isLoading: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load settings',
        isLoading: false,
        isLoaded: true,
      });
    }
  },

  updateSettings: (patch: DeepPartial<PlatformSettings>) => {
    const current = get().settings;
    const merged: PlatformSettings = {
      general: { ...current.general, ...(patch.general || {}) },
      chat: { ...current.chat, ...(patch.chat || {}) },
      build: { ...current.build, ...(patch.build || {}) },
    };
    set({ settings: merged, saveError: null });
    // Keep the pre-auth vertical mirror in sync with in-memory changes too,
    // not just fetches - /login resolves from this cache.
    if (patch.general && 'vertical' in patch.general) {
      cacheVertical(merged.general.vertical);
    }

    // Debounce save
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      get()._saveToServer(merged);
    }, DEBOUNCE_MS);
  },

  _saveToServer: async (settings: PlatformSettings) => {
    set({ isSaving: true, saveError: null });
    // The org settings PATCH accepts a passthrough patch; the rich presentation
    // settings ride through unchanged while the typed fields are honoured.
    const res = await tryCall(() =>
      api.settings.update(settings as unknown as Parameters<typeof api.settings.update>[0]),
    );
    if (!res.ok) {
      set({ saveError: res.error.message || 'Failed to save settings' });
    }
    set({ isSaving: false });
  },
}));
