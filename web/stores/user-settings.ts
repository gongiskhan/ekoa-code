'use client';

/**
 * User Settings Store (Amendment 2, FC-504/FC-506/FC-507)
 *
 * The two per-user toggles that ride `user_settings` (not org settings):
 *   - `build.verifyBuilds`  — verify each build (default ON, FC-507)
 *   - `memory.autoExtract`  — automatic memory extraction (default ON, FC-504)
 *
 * Read from the merged view `GET /api/v1/settings` (which carries the caller's
 * per-user toggles alongside org settings) and written through the per-user
 * patch `PATCH /api/v1/settings/me` (ch03 §3.8.5). Kept separate from the org
 * settings store (`web/stores/settings.ts`, `PATCH /settings`, org-admin) so the
 * two write paths never cross.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';

interface UserSettingsState {
  verifyBuilds: boolean;
  autoExtract: boolean;
  isLoaded: boolean;
  isSaving: boolean;

  fetchUserSettings: () => Promise<void>;
  setVerifyBuilds: (value: boolean) => Promise<void>;
  setAutoExtract: (value: boolean) => Promise<void>;
}

export const useUserSettingsStore = create<UserSettingsState>()((set, get) => ({
  // Both default ON (P-12 re-resolved / Part 6), matched until the server view loads.
  verifyBuilds: true,
  autoExtract: true,
  isLoaded: false,
  isSaving: false,

  fetchUserSettings: async () => {
    const res = await tryCall(() => api.settings.get());
    if (res.ok) {
      const data = res.data as { build?: { verifyBuilds?: boolean }; memory?: { autoExtract?: boolean } };
      set({
        verifyBuilds: data.build?.verifyBuilds ?? true,
        autoExtract: data.memory?.autoExtract ?? true,
        isLoaded: true,
      });
    } else {
      set({ isLoaded: true });
    }
  },

  setVerifyBuilds: async (value) => {
    const previous = get().verifyBuilds;
    set({ verifyBuilds: value, isSaving: true });
    const res = await tryCall(() => api.settings.updateMe({ build: { verifyBuilds: value } }));
    if (!res.ok) set({ verifyBuilds: previous });
    set({ isSaving: false });
  },

  setAutoExtract: async (value) => {
    const previous = get().autoExtract;
    set({ autoExtract: value, isSaving: true });
    const res = await tryCall(() => api.settings.updateMe({ memory: { autoExtract: value } }));
    if (!res.ok) set({ autoExtract: previous });
    set({ isSaving: false });
  },
}));
