'use client';

/**
 * Pipedream Store
 *
 * Drives the "Ligações externas alargadas" section on the integrations page:
 * the platform master toggle, connected-account list, and the Connect Link
 * flow. The toggle persists through the generic settings update intent
 * (`settings.integration.pipedreamEnabled`); everything else routes through the
 * `ekoa.pipedream` domain handler.
 */

import { create } from 'zustand';
import { wsAction } from '@/lib/api/client';

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

interface ConnectToken {
  token: string;
  connectLinkUrl: string;
  expiresAt: string;
}

/** The global Pipedream project keys an admin enters to enable Connect. */
export interface PipedreamConfigInput {
  clientId: string;
  clientSecret: string;
  projectId: string;
  environment: 'development' | 'production';
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

export const usePipedreamStore = create<PipedreamState>()((set, get) => ({
  status: null,
  accounts: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchStatus: async () => {
    set({ isLoading: true, error: null });
    const res = await wsAction<PipedreamStatus>('ekoa.pipedream', 'status');
    if (res.success && res.data) {
      set({ status: res.data, isLoading: false });
    } else {
      set({ isLoading: false, error: res.error?.message || 'Falha ao obter o estado da Pipedream' });
    }
  },

  fetchAccounts: async () => {
    const res = await wsAction<{ accounts: PipedreamAccount[] }>('ekoa.pipedream', 'list-accounts');
    if (res.success && res.data) {
      set({ accounts: Array.isArray(res.data.accounts) ? res.data.accounts : [] });
    }
  },

  setEnabled: async (enabled: boolean) => {
    set({ isSaving: true });
    // Optimistic: reflect the toggle immediately, reconcile from the server after.
    const prev = get().status;
    if (prev) set({ status: { ...prev, enabled } });
    const res = await wsAction('ekoa.settings', 'update', { integration: { pipedreamEnabled: enabled } });
    if (res.success) {
      await get().fetchStatus();
      set({ isSaving: false });
      return { success: true };
    }
    // Revert on failure.
    if (prev) set({ status: prev });
    set({ isSaving: false });
    return { success: false, error: res.error?.message || 'Falha ao guardar a definição' };
  },

  configure: async (input: PipedreamConfigInput) => {
    set({ isSaving: true });
    const res = await wsAction<{ id: string; configured: boolean }>('ekoa.pipedream', 'configure', {
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      projectId: input.projectId,
      environment: input.environment,
    });
    if (res.success) {
      await get().fetchStatus();
      set({ isSaving: false });
      return { success: true };
    }
    set({ isSaving: false });
    return { success: false, error: res.error?.message || 'Falha ao guardar a configuração' };
  },

  removeConfig: async () => {
    set({ isSaving: true });
    const res = await wsAction<{ deleted: boolean }>('ekoa.pipedream', 'remove-config');
    if (res.success) {
      set({ accounts: [] });
      await get().fetchStatus();
      set({ isSaving: false });
      return { success: true };
    }
    set({ isSaving: false });
    return { success: false, error: res.error?.message || 'Falha ao remover a configuração' };
  },

  getConnectToken: async () => {
    const res = await wsAction<ConnectToken>('ekoa.pipedream', 'connect-token');
    if (res.success && res.data?.connectLinkUrl) {
      return { success: true, connectLinkUrl: res.data.connectLinkUrl };
    }
    return { success: false, error: res.error?.message || 'Não foi possível iniciar a ligação' };
  },

  disconnectAccount: async (accountId: string) => {
    const res = await wsAction<{ deleted: boolean }>('ekoa.pipedream', 'disconnect-account', { accountId });
    if (res.success && res.data?.deleted) {
      set((state) => ({ accounts: state.accounts.filter((a) => a.id !== accountId) }));
      return { success: true };
    }
    return { success: false, error: res.error?.message || 'Falha ao desligar o serviço' };
  },
}));
