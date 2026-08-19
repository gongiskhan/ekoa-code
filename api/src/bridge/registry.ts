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
import { bridgePairings, bridgeCapabilityGrants } from '../data/stores.js';
import { encrypt, decrypt } from '../data/crypto.js';
import { logActivity } from '../data/activity.js';
import { normaliseEgressEndpoint } from './egress-endpoint.js';
import type { Doc } from '../data/store.js';

/** The one capability whose grant authorises a DESTINATION and not merely an ability. */
const EGRESS_RESIDENTIAL = 'egress.residential';

/** The durable pairing row (§18.3.4). */
export interface PairingRow extends Doc {
  pairingId: string;
  org: string;
  ownerUserId: string;
  createdAt: string;
  revokedAt: string | null;
  /**
   * Capabilities this machine advertises (Cofre WS-I / I-2). Closed vocabulary from
   * `shared/src/cofre.ts` `BridgeCapability`. Absent on a pairing registered before capability
   * advertisement, which reads as "advertises nothing" — the fail-closed direction.
   */
  capabilities?: string[];
  /**
   * The machine's tailnet address, advertised in its `hello` frame, used as the proxy target when
   * a run declares residential egress. NEVER a request-body value: it is recorded from the
   * authenticated registration, like org and owner.
   *
   * STORED ONLY IN CANONICAL, VALIDATED FORM (`egress-endpoint.ts`). The wire type is a free
   * `z.string().max(255)`, so before this the field was the one part of a machine's advertisement
   * that was believed outright: it travelled verbatim to `browser.newContext({ proxy })`. An
   * address this row cannot carry is an address no run can be routed through.
   */
  egressEndpoint?: string;
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
  /**
   * The `iat` of the bridge token this socket was admitted under (J-2). Retained so admission can
   * be RE-checked while the socket is open: a WebSocket is admitted once and then lives for hours,
   * so a connect-time-only epoch check would let "terminar todas as sessões" leave the offending
   * socket running until it happened to redial. Undefined only for a token with no `iat`, which
   * the epoch rule then cannot judge (matching `auth/middleware.ts`, which also skips the
   * comparison when `iat` is absent).
   */
  admittedIat?: number;
}

/** Monotonic sequence so redials register strictly after their predecessor even within one ms. */
let registrationSeq = 0;
const live = new Map<string, LiveConnection>();

// --- Persistent rows ---------------------------------------------------------------------

/** Register (or re-register) a pairing durably. On redial the row is preserved but un-revoked and
 *  its createdAt kept; a first pairing creates the row. Returns the stored row. */
export async function registerPairing(
  input: {
    pairingId: string;
    org: string;
    ownerUserId: string;
    /** Advertised at registration (I-1). Replaces the prior list wholesale — a machine that stops
     *  offering a capability must stop being selected for it. */
    capabilities?: string[];
    /**
     * TRI-STATE, and the third state is a fix. `undefined` means "this registration is not an
     * advertisement" - the CONNECT path registers a pairing before the machine has said anything
     * about itself, and must not erase what it said last time. `null` (or an address that does not
     * validate) means "this advertisement offers no egress", which CLEARS the stored one.
     *
     * It used to be `string | undefined` with a keep-the-previous fallback, so a `hello` carrying
     * no endpoint kept the old one alive: a machine could never un-offer a route it once offered,
     * which is precisely the merge-instead-of-replace defect the capability list already avoids.
     */
    egressEndpoint?: string | null;
  },
  deps?: { now?: () => number },
): Promise<PairingRow> {
  const nowIso = new Date(deps?.now?.() ?? Date.now()).toISOString();
  const existing = (await bridgePairings.get(input.pairingId)) as PairingRow | null;
  // R-8: mint once per pairing and carry it forward. Rotating on redial would silently break a
  // daemon that already holds the old secret (it would deny every task, fail-closed but opaque).
  const signingSecretCiphertext =
    existing?.signingSecretCiphertext ?? encrypt(randomBytes(32).toString('hex'));
  // The advertisement REPLACES; a non-advertisement keeps. Validation happens here rather than only
  // at the frame handler because this is the write: whatever else calls it, an unusable address
  // never reaches the row, and therefore never reaches a launch option.
  const egressEndpoint =
    input.egressEndpoint === undefined
      ? existing?.egressEndpoint
      : (normaliseEgressEndpoint(input.egressEndpoint) ?? undefined);
  const row: PairingRow = {
    _id: input.pairingId,
    pairingId: input.pairingId,
    org: input.org,
    ownerUserId: input.ownerUserId,
    // Advertisement REPLACES rather than merges: a machine that stops offering a capability must
    // stop being selected for it, and a merge would make revocation impossible.
    ...(input.capabilities ? { capabilities: input.capabilities } : existing?.capabilities ? { capabilities: existing.capabilities } : {}),
    ...(egressEndpoint ? { egressEndpoint } : {}),
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
export function attachLiveConnection(input: { pairingId: string; org: string; ownerUserId: string; ws: WebSocket; admittedIat?: number }): LiveConnection {
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
    ...(input.admittedIat !== undefined ? { admittedIat: input.admittedIat } : {}),
  };
  live.set(input.pairingId, conn);
  return conn;
}

/** Every live connection, for sweeps that must judge all of them (the heartbeat's admission
 *  re-check). Returned as an array so a caller may close sockets while iterating. */
export function allLiveConnections(): LiveConnection[] {
  return [...live.values()];
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

/**
 * Select a live connection for a step's DECLARATION rather than "newest socket for this owner"
 * (Cofre E-4).
 *
 * Three placements, and the difference between them is the point:
 *   - `cloud`   — not a machine at all; the caller handles it, so this returns undefined.
 *   - `pinned`  — exactly that pairing or nothing. A pinned step that falls back to a different
 *                 machine is not a pinned step; the run declared a specific computer for a reason
 *                 (its card reader, its VPN, its residential line).
 *   - `any`     — the router picks, but only from machines the ORG GRANTED for the capability.
 *
 * `usable` is the intersection of advertised and granted (I-3), passed in rather than read here so
 * the async grant lookup stays at the caller and this stays a pure, synchronous choice over the
 * live map. Org is checked on every branch: a machine in another tenant is never a candidate, not
 * a candidate filtered afterwards.
 *
 * Returns undefined when nothing matches — the caller then applies the step's OFFLINE POLICY, which
 * is a property of the run, not of the fleet. Never a silent fallback to some other machine.
 */
export function selectConnectionForStep(input: {
  ownerUserId: string;
  org: string;
  target: { kind: 'cloud' } | { kind: 'pinned'; pairingId: string } | { kind: 'any'; capability: string };
  /** pairingId -> capabilities that machine may actually be used for (advertised ∩ granted). */
  usable: Map<string, readonly string[]>;
  requiredCapabilities?: readonly string[];
}): LiveConnection | undefined {
  const { ownerUserId, org, target, usable, requiredCapabilities = [] } = input;
  if (target.kind === 'cloud') return undefined;

  const hasAll = (pairingId: string, caps: readonly string[]): boolean => {
    const granted = usable.get(pairingId) ?? [];
    return caps.every((c) => granted.includes(c));
  };

  if (target.kind === 'pinned') {
    const conn = live.get(target.pairingId);
    if (!conn || conn.org !== org || conn.ownerUserId !== ownerUserId) return undefined;
    return hasAll(conn.pairingId, requiredCapabilities) ? conn : undefined;
  }

  // `any:<capability>`: the declared capability is required IN ADDITION to requiredCapabilities —
  // naming it in the target is a request, not a substitute for declaring what the step needs.
  const needed = [...new Set([...requiredCapabilities, target.capability])];
  let best: LiveConnection | undefined;
  for (const conn of live.values()) {
    if (conn.ownerUserId !== ownerUserId || conn.org !== org) continue;
    if (!hasAll(conn.pairingId, needed)) continue;
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

/**
 * Egress candidates for an org (Cofre WS-I / I-2). Org-scoped by construction — a run can never be
 * routed through another tenant's home connection, because a foreign machine is not a candidate at
 * all rather than a candidate that is later filtered.
 *
 * THE ENDPOINT IS AUTHORISED HERE TOO, not only the capability. I-3 said the right thing about what
 * a machine may be USED FOR and nothing at all about WHERE the traffic would go: the capability was
 * intersected with the org's grants and the ADDRESS was passed through untouched. That gap had a
 * concrete shape - a machine advertising `{capabilities:['egress.residential'],
 * egressEndpoint:'http://attacker.example:8080'}` needed only the ordinary capability grant (which
 * carries no address, and whose admin surface showed capability NAMES) for the org's hosted
 * Chromium to launch through the attacker's proxy, credential-gated steps included; and a
 * compromised daemon could move the destination on any reconnect with no new grant.
 *
 * So the grant NAMES the endpoint it authorises, and the two are compared in canonical form. A
 * machine whose advertised address is not the one the org authorised is not a residential-egress
 * candidate AND carries no endpoint at all - the address never leaves this function, so nothing
 * downstream has to be trusted to re-check it.
 */
export async function egressCandidatesForOrg(org: string): Promise<
  Array<{ pairingId: string; org: string; capabilities: string[]; egressEndpoint?: string; live: boolean }>
> {
  const rows = (await bridgePairings.find({ org, revokedAt: null })) as PairingRow[];
  // I-3: what a machine ADVERTISES is a self-assertion; what the org GRANTED is the authorisation.
  // The candidate carries the INTERSECTION, so a daemon cannot widen its own privileges by claiming
  // more, and a grant for a capability the machine no longer offers cannot make it selectable.
  // Default deny falls out of this: a machine with no grants contributes an empty list and is never
  // chosen for anything.
  //
  // One query for the org's grants rather than one per machine — the intersection is cheap in
  // memory and a fleet listing should not be N+1 against the store.
  const grants = (await bridgeCapabilityGrants.find({ orgId: org, revokedAt: null })) as unknown as Array<{
    pairingId: string;
    capability: string;
    egressEndpoint?: string;
  }>;
  /** pairingId -> capability -> the endpoint that grant authorises (only `egress.residential` has one). */
  const grantedBy = new Map<string, Map<string, string | undefined>>();
  for (const g of grants) {
    const caps = grantedBy.get(g.pairingId) ?? new Map<string, string | undefined>();
    caps.set(g.capability, g.egressEndpoint);
    grantedBy.set(g.pairingId, caps);
  }

  return rows.map((row) => {
    const granted = grantedBy.get(row.pairingId) ?? new Map<string, string | undefined>();
    // Re-validated at the point of USE, not only at the point of write: a row written before this
    // rule existed, or by any other path, must not become a proxy target on the strength of being
    // in the database already.
    const advertised = normaliseEgressEndpoint(row.egressEndpoint);
    const authorisedRoute =
      advertised !== null &&
      granted.has(EGRESS_RESIDENTIAL) &&
      normaliseEgressEndpoint(granted.get(EGRESS_RESIDENTIAL)) === advertised;
    return {
      pairingId: row.pairingId,
      org: row.org,
      capabilities: (row.capabilities ?? []).filter(
        (c) => granted.has(c) && (c !== EGRESS_RESIDENTIAL || authorisedRoute),
      ),
      ...(authorisedRoute ? { egressEndpoint: advertised } : {}),
      live: isLive(row.pairingId),
    };
  });
}

/** The raw ADVERTISED list, for an admin surface that must show what a machine offers versus what
 *  it has been granted. Never feed this to selection — that is what `egressCandidatesForOrg` is
 *  for, and the difference between the two is the whole of I-3.
 *
 *  IT CARRIES THE ADVERTISED ADDRESS. Granting `egress.residential` authorises a DESTINATION, and a
 *  surface that returned capability names alone could not show the person deciding what they were
 *  actually deciding - which is how a machine-supplied address gets authorised by someone who never
 *  saw it. */
export async function advertisedCapabilitiesForOrg(
  org: string,
): Promise<Array<{ pairingId: string; advertised: string[]; egressEndpoint?: string }>> {
  const rows = (await bridgePairings.find({ org, revokedAt: null })) as PairingRow[];
  return rows.map((row) => ({
    pairingId: row.pairingId,
    advertised: row.capabilities ?? [],
    ...(row.egressEndpoint ? { egressEndpoint: row.egressEndpoint } : {}),
  }));
}

/**
 * Does this machine ADVERTISE a capability — i.e. can the daemon actually perform it?
 *
 * This answers a different question from `isCapabilityGranted` ("may we route this tenant's work
 * through it"), and anything Cortex ROUTES needs both. It exists on its own for the one case that
 * is not routing: a user asking their OWN machine to hold an attended ceremony. There the tenant
 * decision is the request itself, but "is the daemon new enough to understand the frame" is still
 * a real question — and it went unasked, so a machine running a daemon that silently dropped
 * `attended.request` was reported to its owner as ready to run one.
 *
 * A machine that has never sent `hello` advertises nothing and answers false: correct, because a
 * daemon that never advertised is exactly the old build that cannot do this.
 */
export async function advertisesCapability(pairingId: string, capability: string): Promise<boolean> {
  const row = (await bridgePairings.get(pairingId)) as PairingRow | null;
  if (!row || row.revokedAt !== null) return false;
  return (row.capabilities ?? []).includes(capability);
}
