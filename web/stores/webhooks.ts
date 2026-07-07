'use client';

/**
 * Webhooks Store
 *
 * Drives the "Webhooks" section on the integrations page: the list of
 * `ekoa.triggers` rows the workspace owns, plus create/delete. A webhook binds
 * an integration event (WhatsApp / Stripe / Ifthenpay, …) to an artifact
 * backend handler; the third party is pointed at the trigger's callback URL
 * `<cortex-origin>/hooks/<triggerId>`.
 *
 * The `list` intent redacts the secret and does not return the public URL, so
 * we rebuild it client-side from the API origin (which equals the cortex
 * `publicHooksBaseUrl` in dev). A freshly created trigger also returns the
 * authoritative `publicUrl`, which we prefer when present.
 */

import { create } from 'zustand';
import { wsAction, getApiBaseUrl } from '@/lib/api/client';

/** Redacted trigger row as returned by `ekoa.triggers` list/get/create. */
export interface WebhookTrigger {
  id: string;
  integrationKey: string;
  eventName: string;
  kind: 'webhook' | 'listener';
  target?: { kind?: string; artifactId?: string; entrypoint?: string };
  artifactId?: string;
  automationId?: string;
  registrationState?: 'auto' | 'manual' | 'pending' | 'failed';
  disabled?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateWebhookInput {
  integrationKey: string;
  eventName: string;
  artifactId: string;
  entrypoint: string;
}

interface WebhooksState {
  triggers: WebhookTrigger[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;

  fetchTriggers: () => Promise<void>;
  createTrigger: (
    input: CreateWebhookInput,
  ) => Promise<{ success: boolean; error?: string; trigger?: WebhookTrigger; publicUrl?: string }>;
  deleteTrigger: (id: string) => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

/** Build the public callback URL a provider posts to for a given trigger. */
export function webhookCallbackUrl(triggerId: string): string {
  let origin = '';
  try {
    origin = getApiBaseUrl();
  } catch {
    origin = typeof window !== 'undefined' ? window.location.origin : '';
  }
  return `${origin.replace(/\/$/, '')}/hooks/${triggerId}`;
}

export const useWebhooksStore = create<WebhooksState>()((set, get) => ({
  triggers: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchTriggers: async () => {
    set({ isLoading: true, error: null });
    const res = await wsAction<WebhookTrigger[]>('ekoa.triggers', 'list');
    if (res.success && Array.isArray(res.data)) {
      // Only webhook-kind triggers belong on this surface; listeners (mailbox
      // polling) are wired from the artifact detail view. `self-test-hooks` is an
      // internal boot probe, never a user-facing webhook.
      set({
        triggers: res.data.filter((t) => t.kind === 'webhook' && t.integrationKey !== 'self-test-hooks'),
        isLoading: false,
      });
    } else {
      set({ isLoading: false, error: res.error?.message || 'Falha ao carregar os webhooks' });
    }
  },

  createTrigger: async (input) => {
    set({ isSaving: true, error: null });
    const res = await wsAction<{ trigger: WebhookTrigger; publicUrl?: string }>(
      'ekoa.triggers',
      'create',
      {
        integrationKey: input.integrationKey,
        eventName: input.eventName,
        target: { kind: 'artifact-backend', artifactId: input.artifactId, entrypoint: input.entrypoint },
      },
    );
    if (res.success && res.data?.trigger) {
      await get().fetchTriggers();
      set({ isSaving: false });
      return { success: true, trigger: res.data.trigger, publicUrl: res.data.publicUrl };
    }
    const error = res.error?.message || 'Falha ao criar o webhook';
    set({ isSaving: false, error });
    return { success: false, error };
  },

  deleteTrigger: async (id) => {
    set({ error: null });
    const res = await wsAction<{ deleted: boolean }>('ekoa.triggers', 'delete', { id });
    if (res.success) {
      set((state) => ({ triggers: state.triggers.filter((t) => t.id !== id) }));
      return { success: true };
    }
    const error = res.error?.message || 'Falha ao remover o webhook';
    set({ error });
    return { success: false, error };
  },

  clearError: () => set({ error: null }),
}));
