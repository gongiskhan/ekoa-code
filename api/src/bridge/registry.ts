/**
 * bridge/registry.ts — the org-scoped, user-owned pairing registry (ch18 §18.3.4) with its
 * revoke-pairing kill switch (§18.3.5). Two halves that together are "the registry":
 *
 *  1. Persistent rows over the `bridge_pairings` store: { pairingId, org, ownerUserId, createdAt,
 *     revokedAt }. The durable record of which pairings exist and whether they are revoked.
 *  2. An in-memory live-socket map keyed by pairingId. A daemon's WebSocket is not persistable, so
 *     the live/offline fact (and multi-device resolution) lives in process memory. Legal under
 *     FIXED-8 (single process): the in-memory map is authoritative for the running process
 *     (ch09 §9.7.1, the same single-instance-state class as the activation map).
 *
 * Org scoping is STRUCTURAL (§18.3.4, §18.5 S2): a pairing belongs to exactly one org (its row's
 * `org`, resolved at connect from the owner, never from a request body), and resolution returns a
 * pairing's own org — resolution can never hand back a pairing from another org.
 */
import type { WebSocket } from 'ws';
import type { BridgeFrame } from '@ekoa/shared';
import { bridgePairings } from '../data/stores.js';
import type { Doc } from '../data/store.js';

/** The durable pairing row (§18.3.4). */
export interface PairingRow extends Doc {
  pairingId: string;
  org: string;
  ownerUserId: string;
  createdAt: string;
  revokedAt: string | null;
}

/** A live daemon connection: the WS plus the identity it was admitted under. `registeredAt`
 *  orders multi-device resolution; `alive` is the heartbeat state (§18.3.3). */
export interface LiveConnection {
  pairingId: string;
  org: string;
  ownerUserId: string;
  ws: WebSocket;
  registeredAt: number;
  alive: boolean;
}

/** Monotonic sequence so redials register strictly after their predecessor even within one ms. */
let registrationSeq = 0;
const live = new Map<string, LiveConnection>();

// --- Persistent rows ---------------------------------------------------------------------

/** Register (or re-register) a pairing durably. On redial the row is preserved but un-revoked and
 *  its createdAt kept; a first pairing creates the row. Returns the stored row. */
export async function registerPairing(
  input: { pairingId: string; org: string; ownerUserId: string },
  deps?: { now?: () => number },
): Promise<PairingRow> {
  const nowIso = new Date(deps?.now?.() ?? Date.now()).toISOString();
  const existing = (await bridgePairings.get(input.pairingId)) as PairingRow | null;
  const row: PairingRow = {
    _id: input.pairingId,
    pairingId: input.pairingId,
    org: input.org,
    ownerUserId: input.ownerUserId,
    createdAt: existing?.createdAt ?? nowIso,
    revokedAt: null,
    ...(existing?._rev !== undefined ? { _rev: existing._rev } : {}),
  };
  return (await bridgePairings.put(row)) as PairingRow;
}

/** Read a pairing row by id (durable). Null when the pairing was never registered. */
export async function getPairingById(pairingId: string): Promise<PairingRow | null> {
  return (await bridgePairings.get(pairingId)) as PairingRow | null;
}

/** Is the pairing durably revoked? A missing row counts as "not a live pairing" for the caller. */
export async function isRevoked(pairingId: string): Promise<boolean> {
  const row = await getPairingById(pairingId);
  return !row || row.revokedAt !== null;
}

// --- Live-socket map ---------------------------------------------------------------------

/**
 * Attach a freshly-admitted live connection (§18.3.4). Redialing with the same pairingId retires
 * the stale socket with a normal close before the new one takes its slot (multi-device is by
 * DISTINCT pairingId, not a second socket on one id). Returns the stored LiveConnection.
 */
export function attachLiveConnection(input: { pairingId: string; org: string; ownerUserId: string; ws: WebSocket }): LiveConnection {
  const stale = live.get(input.pairingId);
  if (stale && stale.ws !== input.ws) {
    try {
      stale.ws.close(1000, 'replaced');
    } catch {
      /* a close on an already-dead socket is fine */
    }
  }
  const conn: LiveConnection = {
    pairingId: input.pairingId,
    org: input.org,
    ownerUserId: input.ownerUserId,
    ws: input.ws,
    registeredAt: ++registrationSeq,
    alive: true,
  };
  live.set(input.pairingId, conn);
  return conn;
}

/** Remove a live connection on socket close — but only if the map still points at THIS socket (a
 *  redial that already replaced it must not be clobbered by the old socket's late close event). */
export function removeLiveConnection(pairingId: string, ws: WebSocket): void {
  const cur = live.get(pairingId);
  if (cur && cur.ws === ws) live.delete(pairingId);
}

/** The live connection for a pairing id, or undefined when offline. */
export function getLiveConnection(pairingId: string): LiveConnection | undefined {
  return live.get(pairingId);
}

/** True when the pairing has a live socket in this process. */
export function isLive(pairingId: string): boolean {
  return live.has(pairingId);
}

/**
 * The most-recently-registered LIVE connection for an owner (§18.3.4). Multi-device aware: an
 * owner may hold several paired machines; resolution returns the newest live one. Structurally
 * org-safe: every returned connection is one this owner registered, carrying that owner's org —
 * a caller for an owner in org A can never receive an org-B pairing here.
 */
export function getConnectionByOwner(ownerUserId: string): LiveConnection | undefined {
  let best: LiveConnection | undefined;
  for (const conn of live.values()) {
    if (conn.ownerUserId !== ownerUserId) continue;
    if (!best || conn.registeredAt > best.registeredAt) best = conn;
  }
  return best;
}

/** Send a frame to a pairing's live socket (§18.3.8). Returns false when offline or the send fails. */
export function sendToPairing(pairingId: string, frame: BridgeFrame): boolean {
  const conn = live.get(pairingId);
  if (!conn) return false;
  try {
    conn.ws.send(JSON.stringify(frame));
    return true;
  } catch {
    return false;
  }
}

/** The `/health` `bridgeConnections` count — live daemon sockets, reported separately from SSE
 *  `connections` (§18.3.3; reference/invisible-behaviors.md §9.3). */
export function bridgeConnectionCount(): number {
  return live.size;
}

/** Heartbeat state accessors (§18.3.3): a pairing's live/offline state IS its heartbeat state. */
export function markAlive(pairingId: string): void {
  const conn = live.get(pairingId);
  if (conn) conn.alive = true;
}
export function markStale(pairingId: string): void {
  const conn = live.get(pairingId);
  if (conn) conn.alive = false;
}

// --- Revoke kill switch (§18.3.5) --------------------------------------------------------

/**
 * Server-side revoke: stamp `revokedAt` on the durable row AND disconnect the live socket
 * immediately, so every subsequent connect attempt and every in-flight/new delegation on this
 * pairing fails cleanly (§18.3.5, S4). Removing the live entry synchronously makes `isLive` /
 * the provider credential chain (§18.4.4) see the pairing as gone at once; the socket's own close
 * event then runs the standard cleanup (unregister + fail in-flight delegations, wired in
 * server.ts). Returns true when a row or a live socket was affected.
 */
export async function revokePairing(pairingId: string, deps?: { now?: () => number }): Promise<boolean> {
  const nowIso = new Date(deps?.now?.() ?? Date.now()).toISOString();
  const updated = await bridgePairings.update(pairingId, (cur) => ({ ...cur, revokedAt: nowIso }));
  const conn = live.get(pairingId);
  if (conn) {
    live.delete(pairingId);
    try {
      conn.ws.close(1000, 'revoked');
    } catch {
      /* already closing */
    }
  }
  return updated !== null || conn !== undefined;
}

/** Test helper: drop every live connection (does not touch durable rows). */
export function __resetLiveConnectionsForTests(): void {
  for (const conn of live.values()) {
    try {
      conn.ws.close(1000, 'test-reset');
    } catch {
      /* noop */
    }
  }
  live.clear();
  registrationSeq = 0;
}
