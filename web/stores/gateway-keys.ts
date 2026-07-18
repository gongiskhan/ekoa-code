'use client';

/**
 * Gateway API keys store (S4a/S4b, run 20260717). Self-service keys for stock Anthropic
 * clients (Claude Code) pointed at the LLM gateway. The minted secret exists ONLY in
 * `mintedKey` until the user dismisses the show-once panel - it is never listed again.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { GatewayKeySummary, GatewayKeyMintResponse } from '@ekoa/shared';

interface GatewayKeysState {
  keys: GatewayKeySummary[];
  isLoading: boolean;
  error: string | null;
  /** The just-minted key, held for the show-once panel; cleared on dismiss. */
  mintedKey: GatewayKeyMintResponse | null;

  fetchKeys: () => Promise<void>;
  mint: (label: string) => Promise<{ success: boolean; error?: string }>;
  revoke: (id: string) => Promise<{ success: boolean; error?: string }>;
  clearMinted: () => void;
  clearError: () => void;
}

export const useGatewayKeysStore = create<GatewayKeysState>()((set) => ({
  keys: [],
  isLoading: false,
  error: null,
  mintedKey: null,

  fetchKeys: async () => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.gatewayKeys.gatewayKeysList());
    if (response.ok) {
      set({ keys: response.data.items, isLoading: false });
    } else {
      set({ error: response.error.message || 'Failed to fetch keys', isLoading: false });
    }
  },

  mint: async (label) => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.gatewayKeys.gatewayKeysMint({ label }));
    if (response.ok) {
      const minted = response.data;
      set((state) => ({
        mintedKey: minted,
        keys: [
          { id: minted.id, label: minted.label, secretHint: minted.secretHint, createdAt: minted.createdAt },
          ...state.keys,
        ],
        isLoading: false,
      }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to mint key';
    set({ error: errorMsg, isLoading: false });
    return { success: false, error: errorMsg };
  },

  revoke: async (id) => {
    set({ error: null });
    const response = await tryCall(() => api.gatewayKeys.gatewayKeysRevoke({ id }));
    if (response.ok) {
      set((state) => ({
        keys: state.keys.map((k) => (k.id === id ? { ...k, revokedAt: new Date().toISOString() } : k)),
      }));
      return { success: true };
    }
    const errorMsg = response.error.message || 'Failed to revoke key';
    set({ error: errorMsg });
    return { success: false, error: errorMsg };
  },

  clearMinted: () => set({ mintedKey: null }),
  clearError: () => set({ error: null }),
}));
