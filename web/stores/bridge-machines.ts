'use client';

/**
 * Paired-machine capability grants (I-3), the tenant-facing half.
 *
 * A machine ADVERTISES what it can do in its `hello` frame; the ORG GRANTS what its work may be
 * routed through that machine for. Both facts arrive together from `GET /bridge/machines` and are
 * kept together here, because the product decision this store exists to support is exactly the
 * difference between them.
 *
 * Every mutation replaces the machine row from the SERVER'S answer rather than patching the local
 * copy optimistically. A grant can be stored in a form the client did not send (the residential
 * endpoint is canonicalised server-side) and can be recorded for a capability the machine does not
 * advertise - so a locally-guessed row would show an administrator a grant that reads as effective
 * when it authorises nothing.
 */

import { create } from 'zustand';
import { api, tryCall } from '@/lib/api';
import type { BridgeCapability, BridgeMachineSummary } from '@ekoa/shared';

/** A failed mutation, held against the machine+capability it was attempted on so the message
 *  appears at the control the person used rather than at the top of the page. */
export interface GrantFailure {
  pairingId: string;
  capability: string;
  message: string;
}

interface BridgeMachinesState {
  machines: BridgeMachineSummary[];
  isLoading: boolean;
  /** The list could not be loaded at all. Distinct from `failure`, which is one control's error. */
  error: string | null;
  /**
   * A fetch has SUCCEEDED at least once, so an empty list can be told apart from "not asked yet".
   *
   * SUCCESS, not completion, and the difference is a real defect. Set on failure too, a retry after
   * a failed first load would carry `isLoaded: true`, `error: null` (cleared as the retry starts)
   * and an empty list - which renders the "no paired machines" empty state while the request is
   * still in flight. The surface would state a fact about the fleet it has never once managed to
   * read, and an administrator would be told they have no machines when the truth is that the
   * server could not be reached.
   */
  isLoaded: boolean;
  /** The capability whose grant/revoke is in flight, as `pairingId::capability`. */
  pending: string | null;
  failure: GrantFailure | null;

  fetchMachines: () => Promise<void>;
  /**
   * GRANT takes the CLOSED vocabulary and REVOKE takes any string, and the asymmetry is the
   * contract's, not an oversight. A capability nobody can name must not be grantable; a grant made
   * before a capability left the vocabulary must stay revocable, or it would be a live grant with
   * no way to turn it off.
   */
  grant: (pairingId: string, capability: BridgeCapability, egressEndpoint?: string) => Promise<boolean>;
  revoke: (pairingId: string, capability: string) => Promise<boolean>;
  clearFailure: () => void;
}

const key = (pairingId: string, capability: string) => `${pairingId}::${capability}`;

/** Replace one machine in the list, matched by pairingId. */
function withMachine(machines: BridgeMachineSummary[], next: BridgeMachineSummary): BridgeMachineSummary[] {
  return machines.map((m) => (m.pairingId === next.pairingId ? next : m));
}

export const useBridgeMachinesStore = create<BridgeMachinesState>()((set, get) => ({
  machines: [],
  isLoading: false,
  error: null,
  isLoaded: false,
  pending: null,
  failure: null,

  fetchMachines: async () => {
    set({ isLoading: true, error: null });
    const res = await tryCall(() => api.ekoaLocal.bridgeListMachines());
    if (res.ok) {
      set({ machines: res.data.items, isLoading: false, isLoaded: true });
    } else {
      // The list stays as it was: a transient failure must not blank a surface an administrator
      // may be reading, and the banner says the refresh failed. `isLoaded` is deliberately NOT
      // touched - see its docblock: a failure is not a reading of the fleet.
      set({ error: res.error.message, isLoading: false });
    }
  },

  grant: async (pairingId, capability, egressEndpoint) => {
    if (get().pending) return false; // in-flight guard: one grant change at a time
    set({ pending: key(pairingId, capability), failure: null });
    const res = await tryCall(() =>
      api.ekoaLocal.bridgeGrantCapability({
        pairingId,
        capability,
        ...(egressEndpoint ? { egressEndpoint } : {}),
      }),
    );
    if (res.ok) {
      set((s) => ({ machines: withMachine(s.machines, res.data.machine), pending: null }));
      return true;
    }
    // The server's message is the useful one here - a residential grant refused for a missing or
    // unusable endpoint says exactly what is wrong, and a generic string would throw that away.
    set({ pending: null, failure: { pairingId, capability, message: res.error.message } });
    return false;
  },

  revoke: async (pairingId, capability) => {
    if (get().pending) return false;
    set({ pending: key(pairingId, capability), failure: null });
    const res = await tryCall(() => api.ekoaLocal.bridgeRevokeCapability({ pairingId, capability }));
    if (res.ok) {
      set((s) => ({ machines: withMachine(s.machines, res.data.machine), pending: null }));
      return true;
    }
    set({ pending: null, failure: { pairingId, capability, message: res.error.message } });
    return false;
  },

  clearFailure: () => set({ failure: null }),
}));
