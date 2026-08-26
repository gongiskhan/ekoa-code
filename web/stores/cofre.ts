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
  /**
   * Ask the user's own machine to open a login window for `origin` and capture the session.
   *
   * Returns the server's own words rather than a boolean, because BOTH outcomes are things the
   * person has to read: `started: false` here is a refusal they can act on ("no machine connected",
   * "that Ponte is too old"), not an error to swallow into a red banner.
   *
   * It does NOT resume anything. The capture wakes the halted run server-side through the ordinary
   * credential-waiter path the moment the session lands, and the ceremony happens minutes later in
   * another window - so a resume fired from here would fire before there was anything to resume.
   */
  establishSession: (origin: string) => Promise<{
    started: boolean;
    message: string;
    /** Present when the machine can live-stream its ceremony window (D-CEREMONY-STREAM): the login
     *  can then happen right in the dashboard rather than only at the bridge machine. */
    streaming?: { token: string; wsUrl: string; viewport: { width: number; height: number } };
  }>;
  /**
   * "I have finished logging in - capture it now" (D-CEREMONY-DONE).
   *
   * THE SIGNAL THAT REPLACES CLOSING THE WINDOW. The ceremony used to capture only when the human
   * closed the headed browser it opened, and that window is raised by the OS on every navigation -
   * so an OTP login, the flow this whole rail exists for, was a focus fight the person loses. This
   * says "done" from the dashboard they are already in.
   *
   * It resolves ONLY when there is an answer: `requested` is what the server did (a frame reached
   * the machine), `captured` is what actually happened (a new session item for this origin appeared
   * in the Cofre). The card shows the second one, because "we asked" is not what the person wants
   * to know.
   */
  captureSession: (origin: string) => Promise<{ requested: boolean; captured: boolean; message: string }>;
  clearError: () => void;
}

/** A session item usable for `origin`. Exact host match, because the ceremony binds a capture to
 *  the ONE host Cortex named (`boundOriginsForEstablishedHost`) rather than to the pushed jar. */
function coversOrigin(item: CofreItem, origin: string): boolean {
  const host = origin.trim().toLowerCase();
  return item.type === 'session' && item.boundOrigins.some((o) => o.trim().toLowerCase() === host);
}

/**
 * Watch the Cofre until the ceremony's capture lands, and answer whether it did.
 *
 * WHY WATCHING RATHER THAN BEING TOLD. The capture travels machine -> Cortex -> Cofre on its own
 * rail, seconds after the button is pressed; the endpoint that delivers the request cannot honestly
 * report an outcome it has not seen yet. So the client reads the one thing that IS the outcome - the
 * item existing - and the person gets a fact instead of a promise.
 *
 * A NEW ITEM, not a matching one: `before` is the set of ids that already covered this origin, so a
 * session captured last week cannot be mistaken for the one being waited on. Running out of attempts
 * is reported as "not yet", never as failure, because the window is still open and closing it still
 * captures.
 *
 * The list is read WITHOUT `fetchItems` so a poll cannot flash the page's loading state every tick;
 * store items are committed only when the awaited capture is actually there.
 */
export async function awaitCapturedSession(
  origin: string,
  before: ReadonlySet<string>,
  deps: {
    list: () => Promise<CofreItem[] | null>;
    commit: (items: CofreItem[]) => void;
    wait?: (ms: number) => Promise<void>;
    attempts?: number;
    delayMs?: number;
  },
): Promise<boolean> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const attempts = deps.attempts ?? 8;
  const delayMs = deps.delayMs ?? 1_500;
  for (let i = 0; i < attempts; i += 1) {
    await wait(delayMs);
    const items = await deps.list();
    if (!items) continue; // a transient read failure is not an answer about the capture
    if (items.some((item) => coversOrigin(item, origin) && !before.has(item.id))) {
      deps.commit(items);
      return true;
    }
  }
  return false;
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

  establishSession: async (origin) => {
    set({ error: null });
    const response = await tryCall(() => api.cofre.cofreSessionEstablish({ origin }));
    if (!response.ok) {
      const message = response.error.message || 'Não foi possível iniciar a autenticação.';
      set({ error: message });
      return { started: false, message };
    }
    return {
      started: response.data.started,
      message: response.data.message,
      ...(response.data.streaming ? { streaming: response.data.streaming } : {}),
    };
  },

  captureSession: async (origin) => {
    set({ error: null });
    // Snapshotted BEFORE the request: anything already here is not what this ceremony produced.
    const before = new Set(get().items.filter((i) => coversOrigin(i, origin)).map((i) => i.id));
    const response = await tryCall(() => api.cofre.cofreSessionCapture({ origin }));
    if (!response.ok) {
      const message = response.error.message || 'Não foi possível concluir a autenticação.';
      set({ error: message });
      return { requested: false, captured: false, message };
    }
    // A refusal is the server's own words - no machine connected, no window open for this origin -
    // and there is nothing to wait for, so it is returned as it came.
    if (!response.data.requested) return { requested: false, captured: false, message: response.data.message };

    const captured = await awaitCapturedSession(origin, before, {
      list: async () => {
        const listed = await tryCall(() => api.cofre.cofreItemsList());
        return listed.ok ? listed.data.items : null;
      },
      commit: (items) => set({ items }),
    });
    // The run that was blocked is woken server-side by the credential-waiter the moment the capture
    // lands; this is the same client-side second leg the unlock path has, for the case where the
    // server's process-local registry did not survive.
    if (captured) await resumeAnyRunWaitingForCredentials();
    return { requested: true, captured, message: response.data.message };
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
