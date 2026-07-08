'use client';

/**
 * Pipedream Store
 *
 * Drives the "Ligações externas alargadas" section on the integrations page:
 * the platform master toggle, connected-account list, and the Connect Link
 * flow. The toggle persists through the settings update endpoint
 * (`settings.integration.pipedreamEnabled`, FC-044); everything else routes
 * through the `pipedream` domain.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';

export interface PipedreamStatus {
  configured: boolean;
  enabled: boolean;
  accountCount: number;
}

export interface PipedreamAccount {
  id: string;
  app: string;
  name: string;
  healthy: boolean;
}

interface PipedreamState {
  status: PipedreamStatus | null;
  accounts: PipedreamAccount[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchStatus: () => Promise<void>;
  fetchAccounts: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  configure: (input: PipedreamConfigInput) => Promise<{ success: boolean; error?: string }>;
  removeConfig: () => Promise<{ success: boolean; error?: string }>;
  getConnectToken: () => Promise<{ success: boolean; connectLinkUrl?: string; error?: string }>;
  disconnectAccount: (accountId: string) => Promise<{ success: boolean; error?: string }>;
}

/** The global Pipedream project keys an admin enters to enable Connect. */
export interface PipedreamConfigInput {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: 'development' | 'production';
}

export const usePipedreamStore = create<PipedreamState>()((set, get) => ({
  status: null,
  accounts: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchStatus: async () => {
    set({ isLoading: true, error: null });
    const res = await tryCall(() => api.pipedream.status());
    if (res.ok) {
      set({ status: res.data, isLoading: false });
    } else {
      set({ isLoading: false, error: res.error.message || 'Falha ao obter o estado da Pipedream' });
    }
  },

  fetchAccounts: async () => {
    const res = await tryCall(() => api.pipedream.listAccounts());
    if (res.ok) {
      set({ accounts: res.data.items as unknown as PipedreamAccount[] });
    }
  },

  setEnabled: async (enabled: boolean) => {
    set({ isSaving: true });
    // Optimistic: reflect the toggle immediately, reconcile from the server after.
    const prev = get().status;
    if (prev) set({ status: { ...prev, enabled } });
    // FC-044: the pipedream enable flag is a settings field - persist it through the
    // settings update endpoint, not a cross-domain write into the pipedream domain.
    const res = await tryCall(() => api.settings.update({ integration: { pipedreamEnabled: enabled } }));
    if (res.ok) {
      await get().fetchStatus();
      set({ isSaving: false });
      return { success: true };
    }
    // Revert on failure.
    if (prev) set({ status: prev });
    set({ isSaving: false });
    return { success: false, error: res.error.message || 'Falha ao guardar a definição' };
  },

  configure: async (input: PipedreamConfigInput) => {
    set({ isSaving: true });
    const res = await tryCall(() =>
      api.pipedream.configure({
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        projectId: input.projectId,
        environment: input.environment,
      }),
    );
    if (res.ok) {
      await get().fetchStatus();
      set({ isSaving: false });
      return { success: true };
    }
    set({ isSaving: false });
    return { success: false, error: res.error.message || 'Falha ao guardar a configuração' };
  },

  removeConfig: async () => {
    set({ isSaving: true });
    const res = await tryCall(() => api.pipedream.removeConfig());
    if (res.ok) {
      set({ accounts: [] });
      await get().fetchStatus();
      set({ isSaving: false });
      return { success: true };
    }
    set({ isSaving: false });
    return { success: false, error: res.error.message || 'Falha ao remover a configuração' };
  },

  getConnectToken: async () => {
    const res = await tryCall(() => api.pipedream.connectToken());
    if (res.ok && res.data.connectLinkUrl) {
      return { success: true, connectLinkUrl: res.data.connectLinkUrl };
    }
    return { success: false, error: res.ok ? 'Não foi possível iniciar a ligação' : res.error.message };
  },

  disconnectAccount: async (accountId: string) => {
    const res = await tryCall(() => api.pipedream.disconnectAccount({ accountId }));
    if (res.ok) {
      set((state) => ({ accounts: state.accounts.filter((a) => a.id !== accountId) }));
      return { success: true };
    }
    return { success: false, error: res.error.message || 'Falha ao desligar o serviço' };
  },
}));
