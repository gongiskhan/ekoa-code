/**
 * Billing Zustand store -- manages token usage and billing state for the UI.
 */

import { create } from 'zustand';
import { wsAction } from '@/lib/api/client';

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
  role: 'super-admin' | 'admin' | 'builder';
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
  /**
   * Provisional in-flight token delta from streaming usage_progress SSE
   * events. Added to displayed totals only; reset to 0 by fetchUsage and
   * by usage_updated. Never persisted server-side.
   */
  inflightDelta: number;

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
  applyUsageProgress: (provisionalDelta: number) => void;
  resetInflightDelta: () => void;
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
  inflightDelta: 0,

  fetchUsage: async () => {
    set({ isLoading: true, error: null });
    const result = await wsAction<BillingUsage>('ekoa.billing', 'get-usage');
    if (result.success && result.data) {
      set({ usage: result.data, isLoading: false, inflightDelta: 0 });
    } else {
      set({ isLoading: false, error: result.error?.message || 'Failed to fetch usage' });
    }
  },

  fetchHistory: async (page = 1) => {
    set({ isHistoryLoading: true });
    const result = await wsAction<HistoryPage>('ekoa.billing', 'get-history', { page, limit: 10 });
    if (result.success && result.data) {
      set({ history: result.data, isHistoryLoading: false });
    } else {
      set({ isHistoryLoading: false });
    }
  },

  fetchBreakdown: async () => {
    set({ isBreakdownLoading: true });
    const result = await wsAction<{ breakdown: UsageBreakdown[] }>('ekoa.billing', 'get-breakdown');
    if (result.success && result.data) {
      set({ breakdown: result.data.breakdown, isBreakdownLoading: false });
    } else {
      set({ isBreakdownLoading: false });
    }
  },

  purchaseCredits: async (amountUsd: number) => {
    const result = await wsAction<{ success: boolean; newBalance: number }>('ekoa.billing', 'purchase-credits', { amountUsd });
    if (result.success && result.data) {
      // Refresh usage to reflect new balance
      get().fetchUsage();
      return { success: true };
    }
    return { success: false, error: result.error?.message || 'Purchase failed' };
  },

  toggleOverage: async (enabled: boolean) => {
    const result = await wsAction<{ overageEnabled: boolean }>('ekoa.billing', 'toggle-overage', { enabled });
    if (result.success) {
      const usage = get().usage;
      if (usage) {
        set({ usage: { ...usage, overageEnabled: enabled } });
      }
    }
  },

  toggleGlobalOverage: async (enabled: boolean) => {
    const result = await wsAction<{ globalOverageEnabled: boolean }>('ekoa.billing', 'admin-global-overage', { enabled });
    if (result.success) {
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
    const result = await wsAction<{ rows: AdminUsageRow[] }>('ekoa.billing', 'admin-list-usage');
    if (result.success && result.data) {
      set({ allUsage: result.data.rows, isAllUsageLoading: false });
    } else {
      set({ isAllUsageLoading: false, error: result.error?.message || 'Failed to load usage' });
    }
  },

  resetUsageForUser: async (userId: string) => {
    const result = await wsAction<{ userId: string; tokensUsed: number }>('ekoa.billing', 'admin-reset-usage', { userId });
    if (result.success) {
      await get().fetchAllUsage();
      return { success: true };
    }
    return { success: false, error: result.error?.message || 'Reset failed' };
  },

  setLimitForUser: async (userId: string, tokenLimit: number | null) => {
    const result = await wsAction<{ userId: string; tokenLimit: number | null }>(
      'ekoa.billing',
      'admin-set-limit',
      { userId, tokenLimit },
    );
    if (result.success) {
      await get().fetchAllUsage();
      return { success: true };
    }
    return { success: false, error: result.error?.message || 'Failed to update limit' };
  },

  applyUsageProgress: (provisionalDelta: number) => {
    if (!Number.isFinite(provisionalDelta) || provisionalDelta < 0) return;
    // Each usage_progress carries the cumulative provisional delta for the
    // active call, so replace rather than add. Keeps the meter monotonic
    // even if events arrive out of order (Math.max).
    set({ inflightDelta: Math.max(get().inflightDelta, Math.floor(provisionalDelta)) });
  },

  resetInflightDelta: () => {
    set({ inflightDelta: 0 });
  },
}));
