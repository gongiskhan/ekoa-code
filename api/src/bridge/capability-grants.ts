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
import type { BridgeCapability } from '@ekoa/shared';
import { bridgeCapabilityGrants } from '../data/stores.js';
import type { Doc } from '../data/store.js';

/** A tenant's decision that one machine may be used for one capability. */
export interface CapabilityGrantDoc extends Doc {
  orgId: string;
  pairingId: string;
  capability: string;
  grantedByUserId: string;
  createdAt: string;
  revokedAt: string | null;
}

function idFor(orgId: string, pairingId: string, capability: string): string {
  return `${orgId}::${pairingId}::${capability}`;
}

/**
 * Grant a capability on a machine, for an org. Idempotent; re-granting a revoked row revives it,
 * because revocation here is a state rather than a tombstone — unlike a PAIRING revoke, which is
 * terminal by design (a revoked pairingId must never reconnect). Re-authorising `local.bash` on a
 * machine the admin previously turned it off for is an ordinary administrative act, not a bypass.
 */
export async function grantCapability(input: {
  orgId: string;
  pairingId: string;
  capability: BridgeCapability | string;
  grantedByUserId: string;
  now?: () => number;
}): Promise<CapabilityGrantDoc> {
  const at = new Date(input.now?.() ?? Date.now()).toISOString();
  const existing = (await bridgeCapabilityGrants.get(
    idFor(input.orgId, input.pairingId, input.capability),
  )) as CapabilityGrantDoc | null;
  const row: CapabilityGrantDoc = {
    _id: idFor(input.orgId, input.pairingId, input.capability),
    orgId: input.orgId,
    pairingId: input.pairingId,
    capability: input.capability,
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
