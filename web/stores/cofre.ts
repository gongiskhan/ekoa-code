'use client';

/**
 * Cofre store (WS-D). The user's credentials: list, unlock for a chosen duration, lock one, lock
 * everything.
 *
 * There is no `value` anywhere in this file and there never may be one — the API returns the item
 * VIEW, which has no value field at the contract layer. Unlike gateway keys there is also no
 * show-once secret, because the user already HAS this credential; the Cofre is storing it.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { CofreItem, GrantDuration } from '@ekoa/shared';

interface CofreState {
  items: CofreItem[];
  isLoading: boolean;
  error: string | null;

  fetchItems: () => Promise<void>;
  unlock: (id: string, duration: GrantDuration) => Promise<{ success: boolean; error?: string }>;
  lock: (id: string) => Promise<{ success: boolean; error?: string }>;
  lockAll: () => Promise<{ success: boolean; error?: string }>;
  clearError: () => void;
}

/**
 * THE CLIENT HALF OF THE AUTO-RESUME (P3.1, plan trap T7).
 *
 * The server already wakes a waiting run when a credential becomes usable — a process-local waiter
 * registry hung off the Cofre's domain functions. That registry does not survive a server restart,
 * and this is the other leg: if THIS client knows a run of its own is parked in `needs_credentials`,
 * unlocking a credential also asks the run to resume. `resumeRun` re-reads the durable row, so the
 * two paths racing costs at most one no-op — and neither one alone is load-bearing.
 *
 * Deliberately not filtered by origin. The client does not know which item covers which host (the
 * item view carries `boundOrigins`, but the covering rule is the server's), and a resume for a run
 * whose credential still is not there simply halts again. Guessing here would be the failure mode
 * that leaves a run parked forever.
 *
 * The import is dynamic so the Cofre page does not pull the automations store into its bundle for a
 * path that only matters when a run is actually waiting.
 */
async function resumeAnyRunWaitingForCredentials(): Promise<void> {
  try {
    const { useAutomationsStore } = await import('./automations');
    const { activeRun, resume } = useAutomationsStore.getState();
    if (activeRun.status === 'needs_credentials' && activeRun.runId) await resume();
  } catch {
    // Best-effort by design: the server-side observer is the primary path, and a failure here must
    // never turn a successful unlock into a reported error.
  }
}

export const useCofreStore = create<CofreState>()((set, get) => ({
  items: [],
  isLoading: false,
  error: null,

  fetchItems: async () => {
    set({ isLoading: true, error: null });
    const response = await tryCall(() => api.cofre.cofreItemsList());
    if (response.ok) {
      set({ items: response.data.items, isLoading: false });
    } else {
      set({ error: response.error.message || 'Não foi possível carregar o cofre.', isLoading: false });
    }
  },

  unlock: async (id, duration) => {
    set({ error: null });
    const response = await tryCall(() => api.cofre.cofreItemGrant({ id, duration }));
    if (!response.ok) {
      const message = response.error.message || 'Não foi possível desbloquear.';
      set({ error: message });
      return { success: false, error: message };
    }
    await get().fetchItems();
    await resumeAnyRunWaitingForCredentials();
    return { success: true };
  },

  lock: async (id) => {
    set({ error: null });
    const response = await tryCall(() => api.cofre.cofreItemLock({ id }));
    if (!response.ok) {
      const message = response.error.message || 'Não foi possível bloquear.';
      set({ error: message });
      return { success: false, error: message };
    }
    await get().fetchItems();
    return { success: true };
  },

  lockAll: async () => {
    set({ error: null });
    const response = await tryCall(() => api.cofre.cofreLockAll());
    if (!response.ok) {
      const message = response.error.message || 'Não foi possível bloquear tudo.';
      set({ error: message });
      return { success: false, error: message };
    }
    await get().fetchItems();
    return { success: true };
  },

  clearError: () => set({ error: null }),
}));

/**
 * The durations the unlock control offers, in the order the consent page shows them.
 *
 * `this_run` is deliberately absent: it is issued BY A RUN asking for consent, not chosen from a
 * resting item list, and offering it here would let a user "unlock for a run" with no run in play.
 */
export const UNLOCK_DURATIONS: ReadonlyArray<{ value: GrantDuration; labelKey: string }> = [
  { value: '10_minutes', labelKey: '10 minutos' },
  { value: '40_minutes', labelKey: '40 minutos' },
  { value: '1_day', labelKey: '1 dia' },
  { value: '1_week', labelKey: '1 semana' },
  { value: '1_month', labelKey: '1 mês' },
  { value: 'until_locked', labelKey: 'Até eu bloquear' },
];

/**
 * A signature identity gets NO duration control at all — every signature is a fresh ceremony
 * (I7). The API refuses a TTL grant on one regardless, so this is the UI half of a rule that is
 * already enforced in the schema and the service; it cannot regress on its own.
 */
export function offersDurationControl(item: Pick<CofreItem, 'type'>): boolean {
  return item.type !== 'certificate_identity';
}
