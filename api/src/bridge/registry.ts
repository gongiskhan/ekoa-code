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
import { randomBytes } from 'node:crypto';
import { bridgePairings } from '../data/stores.js';
import { encrypt, decrypt } from '../data/crypto.js';
import { logActivity } from '../data/activity.js';
import type { Doc } from '../data/store.js';

/** The durable pairing row (§18.3.4). */
export interface PairingRow extends Doc {
  pairingId: string;
  org: string;
  ownerUserId: string;
  createdAt: string;
  revokedAt: string | null;
  /**
   * PER-PAIRING task-signing secret, encrypted at rest (Cofre R-8).
   *
   * Delegated tasks used to be HMAC'd with `loadConfig().jwtSecret` — the platform-wide secret that
   * signs every user's session token. Making delegation WORK therefore required copying that secret
   * onto every paired laptop, where the daemon stores it in a plaintext `config.json`. One secret
   * signing platform sessions, minting bridge tokens AND keying task HMACs means one compromised
   * laptop compromises every session in the deployment. Minted here, per pairing, so the blast
   * radius of a stolen daemon config is that one machine.
   *
   * Optional on the type because rows written before R-8 have none; `getPairingSigningSecret`
   * returns null for those and the signer refuses rather than falling back to the JWT secret.
   */
  signingSecretCiphertext?: string;
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
  /** ISO stamp of the last heartbeat proof (attach or pong) — the FC-405 "last seen". */
  lastSeenAt: string;
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
  // R-8: mint once per pairing and carry it forward. Rotating on redial would silently break a
  // daemon that already holds the old secret (it would deny every task, fail-closed but opaque).
  const signingSecretCiphertext =
    existing?.signingSecretCiphertext ?? encrypt(randomBytes(32).toString('hex'));
  const row: PairingRow = {
    _id: input.pairingId,
    pairingId: input.pairingId,
    org: input.org,
    ownerUserId: input.ownerUserId,
    signingSecretCiphertext,
    createdAt: existing?.createdAt ?? nowIso,
    // Preserve a revocation tombstone (§18.3.5, S4): a revoked pairingId stays revoked forever - a
    // reconnect must NEVER resurrect it (that would defeat the kill switch). Re-pairing is an
    // explicit NEW pairing with a fresh pairingId (ch10 §10.2 row 12), not a reset of this row.
    revokedAt: existing?.revokedAt ?? null,
    ...(existing?._rev !== undefined ? { _rev: existing._rev } : {}),
  };
  return (await bridgePairings.put(row)) as PairingRow;
}

/** Read a pairing row by id (durable). Null when the pairing was never registered. When
 *  `expectedOrg` is given, a row from a DIFFERENT org reads as null - org-scoped resolution can
 *  never return another org's pairing (§18.3.4, S2 cross-org isolation). */
export async function getPairingById(pairingId: string, expectedOrg?: string): Promise<PairingRow | null> {
  const row = (await bridgePairings.get(pairingId)) as PairingRow | null;
  if (!row) return null;
  if (expectedOrg !== undefined && row.org !== expectedOrg) return null;
  return row;
}

/**
 * The pairing's decrypted task-signing secret, or null when the pairing is unknown, REVOKED, or
 * predates R-8. Null makes the signer refuse — never a fallback to the platform JWT secret, which
 * is the monoculture this replaces.
 */
export async function getPairingSigningSecret(pairingId: string, expectedOrg?: string): Promise<string | null> {
  const row = await getPairingById(pairingId, expectedOrg);
  if (!row || row.revokedAt !== null || !row.signingSecretCiphertext) return null;
  try {
    return decrypt(row.signingSecretCiphertext);
  } catch {
    return null;
  }
}

/** Is the pairing durably revoked? A missing row counts as "not a live pairing" for the caller. */
export async function isRevoked(pairingId: string): Promise<boolean> {
  const row = await getPairingById(pairingId);
  return !row || row.revokedAt !== null;
}

/**
 * All non-revoked pairing rows an owner holds, newest first (§18.3.4; FC-405). Owner-scoped by
 * construction: the filter is the requester's own user id, so no cross-user (a fortiori no
 * cross-org) row can be returned. Registry-only — presence reads never round-trip to a daemon.
 */
export async function getPairingsByOwner(ownerUserId: string): Promise<PairingRow[]> {
  const rows = (await bridgePairings.find({ ownerUserId, revokedAt: null })) as PairingRow[];
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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
    lastSeenAt: new Date().toISOString(),
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
export function getConnectionByOwner(ownerUserId: string, expectedOrg?: string): LiveConnection | undefined {
  let best: LiveConnection | undefined;
  for (const conn of live.values()) {
    if (conn.ownerUserId !== ownerUserId) continue;
    // Enforce (not just document) org-safety: when the caller names its org, never return a
    // connection from a different org (§18.3.4, S2).
    if (expectedOrg !== undefined && conn.org !== expectedOrg) continue;
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
  if (conn) {
    conn.alive = true;
    conn.lastSeenAt = new Date().toISOString();
  }
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

/**
 * Revoke + audit as one domain operation (Cofre R-9). The Registo write lives HERE, not in the
 * route, because `routes/` may not import `data/` directly (ch02 §2.7 module direction) — the route
 * calls a domain module and the domain module owns the side effects.
 *
 * The metadata is ids and an outcome flag ONLY: a Registo row never carries credential material,
 * and this pairing's signing secret is exactly the sort of thing that must not leak into an audit
 * trail that is rendered in the dashboard.
 */
export async function revokePairingAudited(
  pairingId: string,
  actor: { userId: string; orgId: string; username?: string },
  ownerUserId: string,
  deps?: { now?: () => number },
): Promise<boolean> {
  const revoked = await revokePairing(pairingId, deps);
  await logActivity(
    // `username` is required by ActivityActor; a token without one is still auditable by id.
    { userId: actor.userId, orgId: actor.orgId, username: actor.username ?? actor.userId },
    'security',
    'bridge_pairing_revoked',
    { now: deps?.now ?? (() => Date.now()) },
    { pairingId, ownerUserId, byOwner: actor.userId === ownerUserId },
  );
  return revoked;
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
