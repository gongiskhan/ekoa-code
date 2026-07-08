'use client';

/**
 * Webhooks Store
 *
 * Drives the "Webhooks" section on the integrations page: the list of
 * `triggers` rows the workspace owns, plus create/delete. A webhook binds
 * an integration event (WhatsApp / Stripe / Ifthenpay, …) to an artifact
 * backend handler; the third party is pointed at the trigger's callback URL
 * `<cortex-origin>/hooks/<triggerId>`.
 *
 * The `list` response redacts the secret, so we rebuild the public URL
 * client-side from the API origin (which equals the cortex `publicHooksBaseUrl`
 * in dev). A freshly created trigger also returns the authoritative `publicUrl`,
 * which we prefer when present.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';

/** Redacted trigger row as returned by the `triggers` list/create endpoints. */
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
  try {
    return api.resolveUrl(`/hooks/${triggerId}`);
  } catch {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin.replace(/\/$/, '')}/hooks/${triggerId}`;
  }
}

export const useWebhooksStore = create<WebhooksState>()((set, get) => ({
  triggers: [],
  isLoading: false,
  isSaving: false,
  error: null,

  fetchTriggers: async () => {
    set({ isLoading: true, error: null });
    const res = await tryCall(() => api.triggers.list());
    if (res.ok) {
      // Only webhook-kind triggers belong on this surface; listeners (mailbox
      // polling) are wired from the artifact detail view. `self-test-hooks` is an
      // internal boot probe, never a user-facing webhook.
      const rows = res.data.items as unknown as WebhookTrigger[];
      set({
        triggers: rows.filter((t) => t.kind === 'webhook' && t.integrationKey !== 'self-test-hooks'),
        isLoading: false,
      });
    } else {
      set({ isLoading: false, error: res.error.message || 'Falha ao carregar os webhooks' });
    }
  },

  createTrigger: async (input) => {
    set({ isSaving: true, error: null });
    const res = await tryCall(() =>
      api.triggers.create({
        integrationKey: input.integrationKey,
        eventName: input.eventName,
        target: { kind: 'artifact-backend', artifactId: input.artifactId, entrypoint: input.entrypoint },
      }),
    );
    if (res.ok && res.data.trigger) {
      await get().fetchTriggers();
      set({ isSaving: false });
      return {
        success: true,
        trigger: res.data.trigger as unknown as WebhookTrigger,
        publicUrl: res.data.publicUrl,
      };
    }
    const error = res.ok ? 'Falha ao criar o webhook' : res.error.message;
    set({ isSaving: false, error });
    return { success: false, error };
  },

  deleteTrigger: async (id) => {
    set({ error: null });
    const res = await tryCall(() => api.triggers.delete({ id }));
    if (res.ok) {
      set((state) => ({ triggers: state.triggers.filter((t) => t.id !== id) }));
      return { success: true };
    }
    const error = res.error.message || 'Falha ao remover o webhook';
    set({ error });
    return { success: false, error };
  },

  clearError: () => set({ error: null }),
}));
