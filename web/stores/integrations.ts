'use client';

/**
 * Integrations Store
 *
 * Manages integration skills, configurations, and access control.
 */

import { create } from 'zustand';
import * as api from '@/lib/api/client';
import { getConnection } from '@/lib/cortex/connection';
import type {
  IntegrationSkill,
  IntegrationCompanyConfig,
  ActiveIntegration,
  IntegrationBuilderOutput,
  IntegrationSessionStatus,
} from '@/lib/api/client';

export interface PlatformIntegrationStatus {
  connected: boolean;
  email?: string;
  expiresAt?: string;
}

/** One event a webhook-capable integration can publish (from its skill config). */
export interface WebhookEventOption {
  name: string;
  labelPt: string;
}

/**
 * The `list-skills` intent returns the raw StoredIntegrationSkill, which carries
 * a `scope` ('global' | 'user:<id>'), the owning user, and (for webhook-capable
 * integrations) a `webhookConfig`. The shared `IntegrationSkill` API type omits
 * these, so we widen it locally. All three fields are optional, so an
 * `IntegrationSkill[]` payload assigns cleanly onto this shape.
 */
export interface IntegrationSkillScoped extends IntegrationSkill {
  scope?: 'global' | `user:${string}` | string;
  ownerUserId?: string;
  webhookConfig?: { events?: WebhookEventOption[] };
}

/** True when a skill was created by a user (sandbox scope) rather than shipped. */
export function isUserScopedSkill(skill: IntegrationSkillScoped): boolean {
  return typeof skill.scope === 'string' && skill.scope.startsWith('user:');
}

// ---- Browser-session polling bookkeeping (module scope, not store state) ----
// Timers and in-flight guards are per integration key; the store only holds
// the last-known IntegrationSessionStatus snapshot per key.

const SESSION_POLL_INTERVAL_MS = 2_000;
const SESSION_POLL_MAX_MS = 7 * 60 * 1_000;

const sessionPollTimers = new Map<string, ReturnType<typeof setInterval>>();
const sessionPollStartedAt = new Map<string, number>();
const sessionStatusInFlight = new Set<string>();

interface IntegrationsState {
  // State
  skills: IntegrationSkillScoped[];
  configs: IntegrationCompanyConfig[];
  activeIntegrations: ActiveIntegration[];
  isLoading: boolean;
  error: string | null;

  // Platform integration state
  platformStatuses: Record<string, PlatformIntegrationStatus>;

  // Browser-session state (session-connect integrations), keyed by integrationKey
  sessionStatuses: Record<string, IntegrationSessionStatus>;
  sessionBusy: Record<string, boolean>;
  sessionPolling: Record<string, boolean>;

  // Actions
  fetchSkills: () => Promise<void>;
  fetchConfigs: () => Promise<void>;
  fetchActiveIntegrations: () => Promise<void>;
  fetchAll: () => Promise<void>;
  configureIntegration: (
    integrationKey: string,
    configValues: Record<string, string | number | boolean>
  ) => Promise<{ success: boolean; error?: string }>;
  setEnabled: (
    integrationKey: string,
    enabled: boolean
  ) => Promise<{ success: boolean; error?: string }>;
  deleteSkill: (integrationKey: string) => Promise<{ success: boolean; error?: string }>;
  refreshRegistry: () => Promise<{ success: boolean; error?: string }>;
  loadIntegrationPackage: (integrationKey: string) => Promise<{ success: boolean; data?: IntegrationBuilderOutput; sessionId?: string; error?: string }>;
  saveIntegrationPackage: (pkg: IntegrationBuilderOutput) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;

  // Platform integration actions
  connectPlatform: (provider: 'google' | 'microsoft') => Promise<{ authUrl: string; state: string }>;
  disconnectPlatform: (provider: 'google' | 'microsoft') => Promise<void>;
  fetchPlatformStatus: (provider: 'google' | 'microsoft') => Promise<void>;
  fetchAllPlatformStatuses: () => Promise<void>;

  // Browser-session actions
  refreshSessionStatus: (integrationKey: string) => Promise<void>;
  connectSession: (integrationKey: string) => Promise<{ success: boolean; error?: string }>;
  provisionAutomations: (integrationKey: string) => Promise<{ success: boolean; error?: string }>;
  cancelSessionWait: (integrationKey: string) => void;

  // Helpers
  isConfigured: (integrationKey: string) => boolean;
  isEnabled: (integrationKey: string) => boolean;
  getSkillByKey: (integrationKey: string) => IntegrationSkillScoped | undefined;
  getConfigByKey: (integrationKey: string) => IntegrationCompanyConfig | undefined;
}

export const useIntegrationsStore = create<IntegrationsState>()((set, get) => ({
  skills: [],
  configs: [],
  activeIntegrations: [],
  isLoading: false,
  error: null,
  platformStatuses: {},
  sessionStatuses: {},
  sessionBusy: {},
  sessionPolling: {},

  fetchSkills: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.listIntegrationSkills();
      if (response.success && response.data) {
        set({ skills: response.data, isLoading: false });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch integration skills',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch integration skills',
        isLoading: false,
      });
    }
  },

  fetchConfigs: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.getIntegrationConfigs();
      if (response.success && response.data) {
        set({ configs: response.data, isLoading: false });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch integration configs',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch integration configs',
        isLoading: false,
      });
    }
  },

  fetchActiveIntegrations: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.getActiveIntegrations();
      if (response.success && response.data) {
        set({ activeIntegrations: response.data, isLoading: false });
      } else {
        set({
          error: response.error?.message || 'Failed to fetch active integrations',
          isLoading: false,
        });
      }
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch active integrations',
        isLoading: false,
      });
    }
  },

  fetchAll: async () => {
    set({ isLoading: true, error: null });
    try {
      const [skillsRes, configsRes, activeRes] = await Promise.all([
        api.listIntegrationSkills(),
        api.getIntegrationConfigs().catch(() => ({ success: true as const, data: [] as IntegrationCompanyConfig[] })),
        api.getActiveIntegrations(),
      ]);

      const newState: Partial<IntegrationsState> = { isLoading: false };

      if (skillsRes.success && skillsRes.data) {
        newState.skills = Array.isArray(skillsRes.data) ? skillsRes.data : [];
      }
      if (configsRes.success && configsRes.data) {
        newState.configs = Array.isArray(configsRes.data) ? configsRes.data : [];
      }
      if (activeRes.success && activeRes.data) {
        newState.activeIntegrations = Array.isArray(activeRes.data) ? activeRes.data : [];
      }

      set(newState);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch integrations',
        isLoading: false,
      });
    }
  },

  configureIntegration: async (integrationKey, configValues) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.configureIntegration(integrationKey, configValues);
      if (response.success) {
        // Refresh both configs and active integrations
        await Promise.all([
          get().fetchConfigs(),
          get().fetchActiveIntegrations(),
        ]);
        set({ isLoading: false });
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to configure integration';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to configure integration';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  setEnabled: async (integrationKey, enabled) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.setIntegrationEnabled(integrationKey, enabled);
      if (response.success) {
        set((state) => ({
          configs: state.configs.map((c) =>
            c.integrationKey === integrationKey ? { ...c, enabled } : c
          ),
          isLoading: false,
        }));
        get().fetchActiveIntegrations();
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to update integration status';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to update integration status';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  deleteSkill: async (integrationKey) => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.deleteIntegrationSkill(integrationKey);
      if (response.success) {
        set((state) => ({
          skills: state.skills.filter((s) => s.integrationKey !== integrationKey),
          isLoading: false,
        }));
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to delete integration skill';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to delete integration skill';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  refreshRegistry: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await api.refreshIntegrationRegistry();
      if (response.success) {
        await get().fetchSkills();
        set({ isLoading: false });
        return { success: true };
      } else {
        const errorMsg = response.error?.message || 'Failed to refresh registry';
        set({ error: errorMsg, isLoading: false });
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to refresh registry';
      set({ error: errorMsg, isLoading: false });
      return { success: false, error: errorMsg };
    }
  },

  loadIntegrationPackage: async (integrationKey) => {
    try {
      const response = await api.loadIntegrationFull(integrationKey);
      if (response.success && response.data?.generatedPackage) {
        return { success: true, data: response.data.generatedPackage, sessionId: response.data.sessionId };
      }
      return { success: false, error: response.error?.message || 'Failed to load integration package' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to load integration package' };
    }
  },

  saveIntegrationPackage: async (pkg) => {
    try {
      const response = await api.saveIntegrationDirect(pkg);
      if (response.success) {
        // Refresh the skills list after saving
        await get().fetchSkills();
        return { success: true };
      }
      return { success: false, error: response.error?.message || 'Failed to save integration' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save integration' };
    }
  },

  clearError: () => set({ error: null }),

  // Platform integration actions
  connectPlatform: async (provider) => {
    const conn = getConnection();
    const result = await conn.sendAction<{ authUrl: string; state: string }>(
      'ekoa.platform-integrations',
      'connect',
      { provider },
    );
    return result;
  },

  disconnectPlatform: async (provider) => {
    const conn = getConnection();
    await conn.sendAction('ekoa.platform-integrations', 'disconnect', { provider });
    set((state) => ({
      platformStatuses: {
        ...state.platformStatuses,
        [provider]: { connected: false },
      },
    }));
  },

  fetchPlatformStatus: async (provider) => {
    try {
      const conn = getConnection();
      const result = await conn.sendAction<PlatformIntegrationStatus>(
        'ekoa.platform-integrations',
        'status',
        { provider },
      );
      set((state) => ({
        platformStatuses: {
          ...state.platformStatuses,
          [provider]: result,
        },
      }));
    } catch {
      // Silently fail -- platform integrations may not be available
    }
  },

  fetchAllPlatformStatuses: async () => {
    try {
      const conn = getConnection();
      const result = await conn.sendAction<{
        integrations: Array<{ provider: string; connected: boolean; email?: string }>;
      }>('ekoa.platform-integrations', 'list', {});
      if (result?.integrations) {
        const statuses: Record<string, PlatformIntegrationStatus> = {};
        for (const item of result.integrations) {
          statuses[item.provider] = {
            connected: item.connected,
            email: item.email,
          };
        }
        set({ platformStatuses: statuses });
      }
    } catch {
      // Silently fail -- platform integrations may not be available
    }
  },

  // Browser-session actions

  refreshSessionStatus: async (integrationKey) => {
    // Skip overlapping fetches (the 2s poll can outrun a slow response)
    if (sessionStatusInFlight.has(integrationKey)) return;
    sessionStatusInFlight.add(integrationKey);
    try {
      const response = await api.integrationSessionStatus(integrationKey);
      if (response.success && response.data) {
        const status = response.data;
        set((state) => ({
          sessionStatuses: { ...state.sessionStatuses, [integrationKey]: status },
        }));
        if (status.session.status === 'captured' || status.session.status === 'failed') {
          stopSessionPolling(integrationKey);
        }
      }
    } catch {
      // Keep the last known snapshot; the next poll retries.
    } finally {
      sessionStatusInFlight.delete(integrationKey);
    }
  },

  connectSession: async (integrationKey) => {
    set((state) => ({ sessionBusy: { ...state.sessionBusy, [integrationKey]: true } }));
    try {
      const response = await api.integrationConnectSession(integrationKey);
      if (response.success && response.data) {
        const { started, session } = response.data;
        // Optimistic update: reflect waiting_login/failed immediately, before
        // the first poll lands. Falls back to a minimal entry if the card
        // connected before the initial session-status fetch resolved.
        set((state) => {
          const prev: IntegrationSessionStatus = state.sessionStatuses[integrationKey] ?? {
            integrationKey,
            sessionConnect: { supported: true, available: started, message: session.message },
            session: { status: 'none', capturedAt: null },
            actions: [],
          };
          return {
            sessionStatuses: {
              ...state.sessionStatuses,
              [integrationKey]: {
                ...prev,
                session: { ...prev.session, status: session.status, message: session.message },
              },
            },
          };
        });
        if (started) startSessionPolling(integrationKey);
        return started ? { success: true } : { success: false, error: session.message };
      }
      const errorMsg = response.error?.message || 'Não foi possível iniciar a captura da sessão.';
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Não foi possível iniciar a captura da sessão.';
      return { success: false, error: errorMsg };
    } finally {
      set((state) => ({ sessionBusy: { ...state.sessionBusy, [integrationKey]: false } }));
    }
  },

  provisionAutomations: async (integrationKey) => {
    set((state) => ({ sessionBusy: { ...state.sessionBusy, [integrationKey]: true } }));
    try {
      const response = await api.integrationProvisionAutomations(integrationKey);
      if (response.success && response.data) {
        const { actions } = response.data;
        const prev = get().sessionStatuses[integrationKey];
        if (prev) {
          set((state) => ({
            sessionStatuses: {
              ...state.sessionStatuses,
              [integrationKey]: { ...prev, actions },
            },
          }));
        } else {
          void get().refreshSessionStatus(integrationKey);
        }
        return { success: true };
      }
      const errorMsg = response.error?.message || 'Não foi possível criar as automatizações.';
      return { success: false, error: errorMsg };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Não foi possível criar as automatizações.';
      return { success: false, error: errorMsg };
    } finally {
      set((state) => ({ sessionBusy: { ...state.sessionBusy, [integrationKey]: false } }));
    }
  },

  cancelSessionWait: (integrationKey) => {
    stopSessionPolling(integrationKey);
    set((state) => {
      const prev = state.sessionStatuses[integrationKey];
      if (!prev || prev.session.status !== 'waiting_login') return {};
      return {
        sessionStatuses: {
          ...state.sessionStatuses,
          [integrationKey]: { ...prev, session: { ...prev.session, status: 'none', message: undefined } },
        },
      };
    });
  },

  // Helpers
  isConfigured: (integrationKey) => {
    const configs = get().configs;
    return Array.isArray(configs) && configs.some((c) => c.integrationKey === integrationKey);
  },

  isEnabled: (integrationKey) => {
    const configs = get().configs;
    if (!Array.isArray(configs)) return false;
    const config = configs.find((c) => c.integrationKey === integrationKey);
    return config?.enabled ?? false;
  },

  getSkillByKey: (integrationKey) => {
    const skills = get().skills;
    return Array.isArray(skills) ? skills.find((s) => s.integrationKey === integrationKey) : undefined;
  },

  getConfigByKey: (integrationKey) => {
    const configs = get().configs;
    return Array.isArray(configs) ? configs.find((c) => c.integrationKey === integrationKey) : undefined;
  },
}));

// ---- Browser-session polling helpers ----
// Module-level so timers survive component unmounts (the capture keeps
// running while the user signs in on the provider portal in another window).

function stopSessionPolling(integrationKey: string): void {
  const timer = sessionPollTimers.get(integrationKey);
  if (timer) clearInterval(timer);
  sessionPollTimers.delete(integrationKey);
  sessionPollStartedAt.delete(integrationKey);
  useIntegrationsStore.setState((state) => ({
    sessionPolling: { ...state.sessionPolling, [integrationKey]: false },
  }));
}

function startSessionPolling(integrationKey: string): void {
  stopSessionPolling(integrationKey);
  sessionPollStartedAt.set(integrationKey, Date.now());
  const timer = setInterval(() => {
    const startedAt = sessionPollStartedAt.get(integrationKey) ?? 0;
    if (Date.now() - startedAt > SESSION_POLL_MAX_MS) {
      // Give up after 7 minutes without a captured session.
      stopSessionPolling(integrationKey);
      useIntegrationsStore.setState((state) => {
        const prev = state.sessionStatuses[integrationKey];
        if (!prev || prev.session.status !== 'waiting_login') return {};
        return {
          sessionStatuses: {
            ...state.sessionStatuses,
            [integrationKey]: {
              ...prev,
              session: {
                ...prev.session,
                status: 'failed',
                message: 'Tempo esgotado à espera do início de sessão. Tente novamente.',
              },
            },
          },
        };
      });
      return;
    }
    void useIntegrationsStore.getState().refreshSessionStatus(integrationKey);
  }, SESSION_POLL_INTERVAL_MS);
  sessionPollTimers.set(integrationKey, timer);
  useIntegrationsStore.setState((state) => ({
    sessionPolling: { ...state.sessionPolling, [integrationKey]: true },
  }));
}
