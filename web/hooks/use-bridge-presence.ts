'use client';

/**
 * Bridge presence for the privacy surfaces (FC-401, FC-405).
 *
 * Hosted-registry truth, polled over REST (run decision D1): the daemon heartbeats to the
 * hosted bridge server (ch18 §18.3.3) and this hook polls the derived state from
 * `GET /api/v1/bridge/status` through the typed client — no EventSource here (confined to
 * `web/lib/api/stream.ts`, criterion 6) and no WebSocket (FIXED-2; confined to the canvas
 * module, criterion 15). Mapping: not paired -> 'not-installed'; paired but no live
 * socket -> 'offline'; live -> 'connected'.
 *
 * One module-level poller is shared by every consumer (the Reference action's three states,
 * the settings bridge/grants/ledger sections): the first subscriber starts it, the last one
 * stops it. A fetch failure keeps the last known state (first load stays the honest
 * 'not-installed' default — never a fabricated 'connected'; §12.6: render the state).
 */

import { useSyncExternalStore } from 'react';
import type { BridgeStatusResponse } from '@ekoa/shared';
import { api } from '@/lib/api';

export type BridgePresenceStatus = 'not-installed' | 'offline' | 'connected';

export interface BridgePresence {
  status: BridgePresenceStatus;
  /** True only when the daemon heartbeat is live. */
  connected: boolean;
}

const HOSTED_DEFAULT: BridgePresence = {
  status: 'not-installed',
  connected: false,
};

/** Poll cadence (D1: 10-15 s). */
const POLL_MS = 12_000;

function toPresence(s: BridgeStatusResponse): BridgePresence {
  if (s.live) return { status: 'connected', connected: true };
  if (s.paired) return { status: 'offline', connected: false };
  return HOSTED_DEFAULT;
}

// -- module-level shared poller ----------------------------------------------------------

let current: BridgePresence = HOSTED_DEFAULT;
const subscribers = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

async function pollOnce(gen: number): Promise<void> {
  try {
    const status = (await api.ekoaLocal.bridgeStatus()) as BridgeStatusResponse;
    if (gen !== generation) return; // stopped (or restarted) while in flight
    const next = toPresence(status);
    if (next.status !== current.status || next.connected !== current.connected) {
      current = next;
      for (const notify of subscribers) notify();
    }
  } catch {
    // Keep the last known state; the endpoint answering again corrects it on the next tick.
  }
  if (gen === generation && subscribers.size > 0) {
    timer = setTimeout(() => void pollOnce(gen), POLL_MS);
  }
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  if (subscribers.size === 1) {
    generation += 1;
    void pollOnce(generation);
  }
  return () => {
    subscribers.delete(notify);
    if (subscribers.size === 0) {
      generation += 1; // invalidate in-flight polls
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }
  };
}

const getSnapshot = (): BridgePresence => current;
const getServerSnapshot = (): BridgePresence => HOSTED_DEFAULT;

/** Test-only: reset the shared poller between tests. */
export function __resetBridgePresenceForTests(): void {
  generation += 1;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  subscribers.clear();
  current = HOSTED_DEFAULT;
}

/**
 * Current bridge presence, shared across all consumers. The shape is unchanged from the
 * hosted-only stub, so consumers needed no edits (the SEAM promise of FC-401/FC-405).
 */
export function useBridgePresence(): BridgePresence {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
