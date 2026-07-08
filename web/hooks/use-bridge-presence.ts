'use client';

/**
 * Bridge presence for the privacy surfaces (FC-401, FC-405).
 *
 * The bridge presence heartbeat is served by the ekoa-local daemon over the bridge
 * WebSocket (ch18 §18.3), which is OUT OF SCOPE for this hosted-only build (§12.6:
 * "the ekoa-local daemon that serves the picker, the grants, and the ledger is out
 * of scope, built later by its own brief"). There is therefore NO hosted endpoint
 * and NO stream to read here: this hook does not open an EventSource (confined to
 * `web/lib/api/stream.ts`, criterion 6) or a WebSocket (confined to the canvas
 * module, criterion 15). It reports the honest hosted default - the bridge is not
 * installed / not paired - and the surfaces render their offline/not-paired states
 * accordingly, rather than a fabricated "connected" state (§12.6: never invent an
 * endpoint; render the state).
 *
 * SEAM: when the daemon lands, its presence heartbeat is wired in HERE (through the
 * sanctioned bridge transport), and every consumer - the Reference action's three
 * states, the settings bridge/grants/ledger sections - updates with no change to
 * their own code.
 */

export type BridgePresenceStatus = 'not-installed' | 'offline' | 'connected';

export interface BridgePresence {
  status: BridgePresenceStatus;
  /** True only when the daemon heartbeat is live (never, in the hosted build). */
  connected: boolean;
}

const HOSTED_DEFAULT: BridgePresence = {
  status: 'not-installed',
  connected: false,
};

/**
 * Current bridge presence. Hosted build: always the not-installed default. The
 * shape is stable so the daemon-era wiring is a drop-in replacement.
 */
export function useBridgePresence(): BridgePresence {
  return HOSTED_DEFAULT;
}
