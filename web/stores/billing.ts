/**
 * Billing Zustand store -- manages token usage and billing state for the UI.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';

/* ---------- Types ---------- */

export interface BillingUsage {
  tokensUsed: number;
  tokensBase: number;
  tokensRemaining: number;
  effectiveTotal: number;
  usagePercentage: number;
  creditBalanceUsd: number;
  creditTokens: number;
  overageEnabled: boolean;
  globalOverageEnabled: boolean;
  currentPeriodStart: string;
  periodResetDate: string;
  gaugeColor: 'green' | 'amber' | 'red';
  showWarning: boolean;
  isAdmin: boolean;
}

export interface DailyUsage {
  date: string;
  tokens: number;
  costUsd: number;
}

export interface UsageBreakdown {
  agentType: string;
  tokens: number;
  percentage: number;
}

export interface HistoryPage {
  entries: DailyUsage[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminUsageRow {
  userId: string;
  username: string;
  role: 'super-admin' | 'org-admin' | 'user';
  isActive: boolean;
  tokensUsed: number;
  tokensBase: number;
  tokensRemaining: number;
  /** Per-user override; null when the platform default applies. */
  tokenLimit: number | null;
  isCustomLimit: boolean;
  percentage: number;
  currentPeriodStart: string | null;
  lastLoginAt: string | null;
}

/* ---------- Store ---------- */

interface BillingState {
  usage: BillingUsage | null;
  history: HistoryPage | null;
  breakdown: UsageBreakdown[];
  allUsage: AdminUsageRow[] | null;
  isLoading: boolean;
  isHistoryLoading: boolean;
  isBreakdownLoading: boolean;
  isAllUsageLoading: boolean;
  error: string | null;
  warningDismissed: boolean;

  // Actions
  fetchUsage: () => Promise<void>;
  fetchHistory: (page?: number) => Promise<void>;
  fetchBreakdown: () => Promise<void>;
  fetchAllUsage: () => Promise<void>;
  resetUsageForUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
  setLimitForUser: (userId: string, tokenLimit: number | null) => Promise<{ success: boolean; error?: string }>;
  purchaseCredits: (amountUsd: number) => Promise<{ success: boolean; error?: string }>;
  toggleOverage: (enabled: boolean) => Promise<void>;
  toggleGlobalOverage: (enabled: boolean) => Promise<void>;
  dismissWarning: () => void;
}

export const useBillingStore = create<BillingState>((set, get) => ({
  usage: null,
  history: null,
  breakdown: [],
  allUsage: null,
  isLoading: false,
  isHistoryLoading: false,
  isBreakdownLoading: false,
  isAllUsageLoading: false,
  error: null,
  warningDismissed: false,

  fetchUsage: async () => {
    set({ isLoading: true, error: null });
    const result = await tryCall(() => api.billing.getUsage());
    if (result.ok) {
      // The wire contract is a passthrough superset; the UI consumes the rich
      // shape the server sends alongside the typed fields.
      set({ usage: result.data as unknown as BillingUsage, isLoading: false });
    } else {
      set({ isLoading: false, error: result.error.message || 'Failed to fetch usage' });
    }
  },

  fetchHistory: async (page = 1) => {
    set({ isHistoryLoading: true });
    const result = await tryCall(() => api.billing.getHistory({ page, limit: 10 }));
    if (result.ok) {
      const total = result.data.total;
      set({
        history: {
          entries: result.data.items as unknown as DailyUsage[],
          total,
          page,
          limit: 10,
          totalPages: Math.max(1, Math.ceil(total / 10)),
        },
        isHistoryLoading: false,
      });
    } else {
      set({ isHistoryLoading: false });
    }
  },

  fetchBreakdown: async () => {
    set({ isBreakdownLoading: true });
    const result = await tryCall(() => api.billing.getBreakdown());
    if (result.ok) {
      set({ breakdown: result.data.items, isBreakdownLoading: false });
    } else {
      set({ isBreakdownLoading: false });
    }
  },

  purchaseCredits: async (amountUsd: number) => {
    const result = await tryCall(() => api.billing.purchaseCredits({ amountUsd }));
    if (result.ok) {
      // Refresh usage to reflect new balance
      get().fetchUsage();
      return { success: true };
    }
    return { success: false, error: result.error.message || 'Purchase failed' };
  },

  toggleOverage: async (enabled: boolean) => {
    const result = await tryCall(() => api.billing.toggleOverage({ enabled }));
    if (result.ok) {
      const usage = get().usage;
      if (usage) {
        set({ usage: { ...usage, overageEnabled: enabled } });
      }
    }
  },

  toggleGlobalOverage: async (enabled: boolean) => {
    const result = await tryCall(() => api.billing.adminGlobalOverage({ enabled }));
    if (result.ok) {
      const usage = get().usage;
      if (usage) {
        set({ usage: { ...usage, globalOverageEnabled: enabled } });
      }
    }
  },

  dismissWarning: () => {
    set({ warningDismissed: true });
  },

  fetchAllUsage: async () => {
    set({ isAllUsageLoading: true });
    const result = await tryCall(() => api.billing.adminListUsage());
    if (result.ok) {
      set({ allUsage: result.data.items as unknown as AdminUsageRow[], isAllUsageLoading: false });
    } else {
      set({ isAllUsageLoading: false, error: result.error.message || 'Failed to load usage' });
    }
  },

  resetUsageForUser: async (userId: string) => {
    const result = await tryCall(() => api.billing.adminResetUsage({ userId }));
    if (result.ok) {
      await get().fetchAllUsage();
      return { success: true };
    }
    return { success: false, error: result.error.message || 'Reset failed' };
  },

  setLimitForUser: async (userId: string, tokenLimit: number | null) => {
    const result = await tryCall(() => api.billing.adminSetLimit({ userId, tokenLimit }));
    if (result.ok) {
      await get().fetchAllUsage();
      return { success: true };
    }
    return { success: false, error: result.error.message || 'Failed to update limit' };
  },
}));
