/**
 * bridge/capability-grants.ts — per-tenant-per-machine capability grants (Cofre WS-I / I-3).
 *
 * THE GAP. A machine ADVERTISES what it can do in its `hello` frame, and the registry records that
 * list (I-1/I-2). Selection then read the advertised list as if it were an authorisation: a pairing
 * claiming `egress.residential` became a candidate to route a tenant's traffic through, and a
 * pairing claiming `local.bash` became a candidate to run commands. But advertisement is a
 * SELF-ASSERTION by the machine — the same category of control as J-7's model-set `confirmed` flag,
 * and wrong for the same reason. A daemon that is compromised, misconfigured, or simply running a
 * newer build than its owner expected could widen its own privileges by claiming more.
 *
 * Advertisement answers "what can this machine do". It was never an answer to "what may this
 * tenant's work be routed through it for", and only the tenant can answer that.
 *
 * THE MODEL. A capability is usable on a machine only when BOTH hold:
 *   1. the machine advertises it (it is physically able), AND
 *   2. the ORG has granted it for that machine (someone decided it should).
 *
 * DEFAULT DENY. A machine with no grants can do nothing, including a machine that just paired.
 * That is the direction that fails safe: the alternative — inheriting whatever the machine claims
 * until an admin says otherwise — means a new or re-paired machine is maximally privileged for the
 * window nobody is watching.
 *
 * SHAPE lifted from `ekoa-bridge/src/auth/grants-store.ts`, which is already a working instance of
 * a per-resource pre-authorisation ({grantRef, root, session, createdAt, label}) — this is the same
 * idea with the tenant and the machine as the scope instead of the session and the path.
 */
import type { BridgeCapability, BridgeMachineSummary } from '@ekoa/shared';
import { bridgeCapabilityGrants } from '../data/stores.js';
import { logActivity } from '../data/activity.js';
import { normaliseEgressEndpoint } from './egress-endpoint.js';
import { advertisedCapabilitiesForOrg, getPairingById, isLive } from './registry.js';
import type { Doc } from '../data/store.js';

/** The one capability whose grant authorises a DESTINATION and not merely an ability. */
const EGRESS_RESIDENTIAL = 'egress.residential';

/** A tenant's decision that one machine may be used for one capability. */
export interface CapabilityGrantDoc extends Doc {
  orgId: string;
  pairingId: string;
  capability: string;
  /**
   * THE ADDRESS THIS GRANT AUTHORISES - `egress.residential` only, in canonical form.
   *
   * A residential-egress grant is not "this machine may carry traffic"; it is "this tenant's
   * traffic may leave by THIS DOOR". Without the address, the grant authorised the MACHINE and the
   * machine then chose the destination - a self-assertion sitting exactly where an authorisation
   * was supposed to be. A daemon could advertise an attacker's proxy and have the org's hosted
   * Chromium launch through it on the strength of an ordinary capability grant, and could move the
   * destination again on any reconnect with no new grant and nobody asked.
   *
   * `egressCandidatesForOrg` compares this against what the machine CURRENTLY advertises and
   * withholds the route (and the address) when they differ. Optional on the type only because rows
   * for every other capability have none.
   */
  egressEndpoint?: string;
  grantedByUserId: string;
  createdAt: string;
  revokedAt: string | null;
}

/** A grant that cannot be recorded because the destination it would authorise is missing or
 *  unusable. Thrown rather than stored-and-ignored: the person deciding is the one who can fix it,
 *  and a grant that silently authorises no route is the failure this whole field exists to stop. */
export class CapabilityGrantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityGrantError';
  }
}

function idFor(orgId: string, pairingId: string, capability: string): string {
  return `${orgId}::${pairingId}::${capability}`;
}

/**
 * Grant a capability on a machine, for an org. Idempotent; re-granting a revoked row revives it,
 * because revocation here is a state rather than a tombstone — unlike a PAIRING revoke, which is
 * terminal by design (a revoked pairingId must never reconnect). Re-authorising `local.bash` on a
 * machine the admin previously turned it off for is an ordinary administrative act, not a bypass.
 *
 * `egress.residential` REQUIRES `egressEndpoint`, and it must be an address a run may actually be
 * routed through (`egress-endpoint.ts`). See `CapabilityGrantDoc.egressEndpoint` for why the
 * capability alone was never the authorisation this grant was taken to be.
 */
export async function grantCapability(input: {
  orgId: string;
  pairingId: string;
  capability: BridgeCapability | string;
  /** REQUIRED for `egress.residential`, meaningless (and dropped) for every other capability. */
  egressEndpoint?: string;
  grantedByUserId: string;
  now?: () => number;
}): Promise<CapabilityGrantDoc> {
  const at = new Date(input.now?.() ?? Date.now()).toISOString();
  let endpoint: string | undefined;
  if (input.capability === EGRESS_RESIDENTIAL) {
    endpoint = normaliseEgressEndpoint(input.egressEndpoint) ?? undefined;
    if (!endpoint) {
      throw new CapabilityGrantError(
        `a ${EGRESS_RESIDENTIAL} grant must name the egress endpoint it authorises, and it must be a usable proxy address`,
      );
    }
  }
  const existing = (await bridgeCapabilityGrants.get(
    idFor(input.orgId, input.pairingId, input.capability),
  )) as CapabilityGrantDoc | null;
  const row: CapabilityGrantDoc = {
    _id: idFor(input.orgId, input.pairingId, input.capability),
    orgId: input.orgId,
    pairingId: input.pairingId,
    capability: input.capability,
    ...(endpoint ? { egressEndpoint: endpoint } : {}),
    grantedByUserId: input.grantedByUserId,
    createdAt: existing?.createdAt ?? at,
    revokedAt: null,
    ...(existing?._rev !== undefined ? { _rev: existing._rev } : {}),
  };
  return (await bridgeCapabilityGrants.put(row)) as CapabilityGrantDoc;
}

/** Revoke a capability on a machine. Returns true when a live grant was actually turned off. */
export async function revokeCapability(
  orgId: string,
  pairingId: string,
  capability: string,
  now: () => number = Date.now,
): Promise<boolean> {
  const id = idFor(orgId, pairingId, capability);
  const row = (await bridgeCapabilityGrants.get(id)) as CapabilityGrantDoc | null;
  if (!row || row.revokedAt !== null) return false;
  await bridgeCapabilityGrants.update(id, (cur) => ({ ...cur, revokedAt: new Date(now()).toISOString() }));
  return true;
}

/**
 * Is this capability granted for this machine, in this org?
 *
 * Org is part of the KEY, not a filter applied afterwards, so a grant made in one tenant cannot be
 * read in another even if the pairingId were somehow guessed.
 */
export async function isCapabilityGranted(orgId: string, pairingId: string, capability: string): Promise<boolean> {
  const row = (await bridgeCapabilityGrants.get(idFor(orgId, pairingId, capability))) as CapabilityGrantDoc | null;
  return row !== null && row.revokedAt === null;
}

/** Every live capability grant for a machine, in an org. */
export async function grantedCapabilities(orgId: string, pairingId: string): Promise<string[]> {
  const rows = (await bridgeCapabilityGrants.find({ orgId, pairingId, revokedAt: null })) as CapabilityGrantDoc[];
  return rows.map((r) => r.capability).sort();
}

/**
 * The address a live `egress.residential` grant AUTHORISES, or undefined when there is none.
 *
 * Read separately from `grantedCapabilities` because it answers a different question and only one
 * capability has an answer at all. It exists for the ADMIN SURFACE: `egressCandidatesForOrg`
 * withholds the route when the authorised address and the advertised one differ, and without this
 * a surface could not tell an administrator why a machine they believe they granted carries
 * nothing - it would show a granted capability beside a live machine and no reason for the silence.
 */
export async function grantedEgressEndpoint(orgId: string, pairingId: string): Promise<string | undefined> {
  const row = (await bridgeCapabilityGrants.get(
    idFor(orgId, pairingId, EGRESS_RESIDENTIAL),
  )) as CapabilityGrantDoc | null;
  return row && row.revokedAt === null ? row.egressEndpoint : undefined;
}

/**
 * The capabilities a machine may actually be used for: the INTERSECTION of what it advertises and
 * what the org granted.
 *
 * Intersection rather than either side alone, and both directions matter. A grant for a capability
 * the machine no longer advertises must not make it selectable (the machine may have lost the
 * hardware, or the operator removed the feature). An advertisement with no grant must not either —
 * that is the whole point of I-3.
 */
export async function usableCapabilities(
  orgId: string,
  pairingId: string,
  advertised: readonly string[],
): Promise<string[]> {
  const granted = new Set(await grantedCapabilities(orgId, pairingId));
  return advertised.filter((c) => granted.has(c)).sort();
}

// --- The admin surface (the tenant-facing half I-3 was missing) ---------------------------
//
// `grantCapability`/`revokeCapability` above were built, security-tested, and had no caller
// outside those tests: nothing in the product could WRITE a grant, so `desktop.automation` and
// `local.bash` could never be turned on and the default-deny in `daemon-step-seam.ts` refused
// every browser and bash step forever. The functions below are what a route calls - the READ that
// shows an administrator both halves of the I-3 question, and the two WRITES with their audit
// rows attached, because `routes/` may not import `data/` (ch02 §2.7) and a grant is a security
// event that must land in the Registo whoever performs it.

/**
 * Every machine in an org, with what it ADVERTISES and what the org has GRANTED, side by side.
 *
 * Org-scoped by construction: `advertisedCapabilitiesForOrg` filters on the org and drops revoked
 * pairings, so a foreign machine is not a row that is filtered later - it is not a row.
 *
 * One grants query PER MACHINE rather than one for the org. That is an N+1 and it is the right
 * trade here: `grantedCapabilities` is the single definition of "a live grant" (its `revokedAt:
 * null` filter is the whole semantics), and the alternative - a second grant-shaped join written
 * beside this one - is how the read and the enforcement drift apart. A pairing is a physical
 * computer, so N is a fleet, not a table.
 */
export async function orgMachines(orgId: string): Promise<BridgeMachineSummary[]> {
  const advertised = await advertisedCapabilitiesForOrg(orgId);
  return Promise.all(
    advertised.map(async (row) => {
      const authorised = await grantedEgressEndpoint(orgId, row.pairingId);
      return {
        pairingId: row.pairingId,
        live: isLive(row.pairingId),
        advertisedCapabilities: [...row.advertised].sort(),
        grantedCapabilities: await grantedCapabilities(orgId, row.pairingId),
        ...(row.egressEndpoint ? { egressEndpoint: row.egressEndpoint } : {}),
        ...(authorised ? { grantedEgressEndpoint: authorised } : {}),
      };
    }),
  );
}

/**
 * One machine, in one org, or null when this org has no such machine.
 *
 * NULL COVERS BOTH "unknown" AND "belongs to somebody else", indistinguishably, because
 * `getPairingById` takes the expected org and answers null for a row from another one. A caller
 * that turns this into a 404 is therefore not an existence oracle without having to remember to
 * be careful.
 */
export async function machineForOrg(orgId: string, pairingId: string): Promise<BridgeMachineSummary | null> {
  const row = await getPairingById(pairingId, orgId);
  if (!row || row.revokedAt !== null) return null;
  const authorised = await grantedEgressEndpoint(orgId, pairingId);
  return {
    pairingId: row.pairingId,
    live: isLive(row.pairingId),
    advertisedCapabilities: [...(row.capabilities ?? [])].sort(),
    grantedCapabilities: await grantedCapabilities(orgId, pairingId),
    ...(row.egressEndpoint ? { egressEndpoint: row.egressEndpoint } : {}),
    ...(authorised ? { grantedEgressEndpoint: authorised } : {}),
  };
}

/** Who performed a grant change, for the Registo row. */
export interface GrantActor {
  userId: string;
  orgId: string;
  username?: string;
}

/**
 * Grant + audit as ONE domain operation, the shape `revokePairingAudited` established.
 *
 * The Registo row carries ids and the capability only. `egressEndpoint` rides too, and must: a
 * residential-egress grant authorises a DESTINATION, so an audit trail that recorded the
 * capability alone could not answer the question the trail exists for - which door was opened.
 * It is an address the org's own admin typed, not credential material.
 *
 * The org is the ACTOR'S org for both the grant and the audit row: a caller cannot grant into
 * another tenant by naming one, because no argument here comes from a request body.
 */
export async function grantCapabilityAudited(
  input: {
    pairingId: string;
    capability: BridgeCapability | string;
    egressEndpoint?: string;
  },
  actor: GrantActor,
  deps?: { now?: () => number },
): Promise<CapabilityGrantDoc> {
  const row = await grantCapability({
    orgId: actor.orgId,
    pairingId: input.pairingId,
    capability: input.capability,
    ...(input.egressEndpoint !== undefined ? { egressEndpoint: input.egressEndpoint } : {}),
    grantedByUserId: actor.userId,
    ...(deps?.now ? { now: deps.now } : {}),
  });
  await logActivity(
    { userId: actor.userId, orgId: actor.orgId, username: actor.username ?? actor.userId },
    'security',
    'bridge_capability_granted',
    { now: deps?.now ?? (() => Date.now()) },
    {
      pairingId: input.pairingId,
      capability: input.capability,
      ...(row.egressEndpoint ? { egressEndpoint: row.egressEndpoint } : {}),
    },
  );
  return row;
}

/** Revoke + audit, the mirror of the above. Audited even when nothing was live to turn off: the
 *  ATTEMPT is the administrative act, and a trail that recorded only effective revocations would
 *  omit exactly the case someone later asks about ("I turned that off - did I?"). */
export async function revokeCapabilityAudited(
  input: { pairingId: string; capability: string },
  actor: GrantActor,
  deps?: { now?: () => number },
): Promise<boolean> {
  const revoked = await revokeCapability(
    actor.orgId,
    input.pairingId,
    input.capability,
    deps?.now ?? Date.now,
  );
  await logActivity(
    { userId: actor.userId, orgId: actor.orgId, username: actor.username ?? actor.userId },
    'security',
    'bridge_capability_revoked',
    { now: deps?.now ?? (() => Date.now()) },
    { pairingId: input.pairingId, capability: input.capability, revoked },
  );
  return revoked;
}
