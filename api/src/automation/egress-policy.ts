/**
 * automation/egress-policy.ts — per-run egress + offline policy (Cofre E-3 / WS-I).
 *
 * WHAT WAS WRONG. Whether a browser step could run in-process was decided by ONE global flag,
 * `localBrowserEnabled`, defaulting to `!isProd`. The discovery gate first read that as a "silent
 * datacenter fallback" and its verifier corrected it: in production with no daemon the run HALTS in
 * `awaiting_daemon`, which is honest. The real defect is narrower and still real — the choice is
 * GLOBAL and UNDECLARABLE. A run that must leave from a residential IP and a run that does not care
 * are governed by the same environment variable, and neither can say which it is.
 *
 * WHAT THIS ADDS. A run declares its egress requirement and what to do when it cannot be met. The
 * default is `fail`, so the safe option is the one you get by not choosing — a run that silently
 * proceeds from a datacenter IP when it was written to leave from a residential one is both a
 * correctness problem and a detection problem for the site being automated.
 *
 * The Tailscale data plane itself is infrastructure and is not code in either repo. What IS code —
 * and is here — is the DECLARATION, the resolution against the registry, and the refusal. When the
 * tailnet lands, `resolveEgress` gains a real address to return and nothing else moves.
 */
import type { OfflinePolicy } from '@ekoa/shared';

/** What a run needs of its egress. */
export type EgressRequirement =
  /** Any route out is fine — the default for automations that do not care. */
  | { kind: 'any' }
  /** Must leave from a residential IP, via a bridge advertising `egress.residential`. */
  | { kind: 'residential'; pairingId?: string }
  /** Must leave from the datacenter (an explicit choice, never a fallback). */
  | { kind: 'datacenter' };

export interface EgressDeclaration {
  requirement: EgressRequirement;
  /** DEFAULTS TO `fail`. See the module docblock. */
  offlinePolicy: OfflinePolicy;
}

export const DEFAULT_EGRESS: EgressDeclaration = {
  requirement: { kind: 'any' },
  offlinePolicy: 'fail',
};

/** A machine the registry knows about, reduced to what egress selection needs. */
export interface EgressCandidate {
  pairingId: string;
  org: string;
  /**
   * The capabilities this machine may actually be used for — the INTERSECTION of what it advertises
   * and what the org GRANTED (Cofre I-3, `bridge/capability-grants.ts`).
   *
   * This used to be the advertised list alone, which made a self-assertion by the machine into an
   * authorisation: a daemon that was compromised, misconfigured, or simply running a newer build
   * than its owner expected could widen its own privileges by claiming more, and a tenant's traffic
   * would be routed through it. Advertisement answers "what can this machine do"; it was never an
   * answer to "what may this tenant's work be routed through it for". Callers MUST pass the
   * intersection — `usableCapabilities()` computes it — never the raw `PairingRow.capabilities`.
   */
  capabilities: readonly string[];
  /** The machine's tailnet address, advertised in its `hello` frame. Absent until it advertises. */
  egressEndpoint?: string;
  live: boolean;
}

export type EgressResolution =
  | { outcome: 'datacenter'; reason: 'declared' | 'no-requirement' }
  | { outcome: 'machine'; pairingId: string; proxyUrl: string }
  /** The requirement cannot be met and the policy says stop. */
  | { outcome: 'refused'; reason: string }
  /** The requirement cannot be met and the policy says wait. */
  | { outcome: 'queue'; reason: string }
  /** The requirement cannot be met and the run explicitly accepts the datacenter. */
  | { outcome: 'datacenter-fallback'; reason: string };

/**
 * WHICH MACHINES CAN CARRY RESIDENTIAL EGRESS FOR THIS ORG RIGHT NOW - the one predicate, stated
 * once.
 *
 * It has TWO consumers that must never disagree: `resolveEgress` below, which picks a machine to
 * proxy a step THROUGH, and `checkoutSession` (`cofre/session-checkout.ts`), which decides whether
 * a session BOUND to a machine's residential line may be handed out at all. A session bound to a
 * machine that egress selection would refuse is a session the run cannot use, and a session that
 * checkout releases for a machine selection would not choose is a route that does not exist. Two
 * copies of this filter would let those two answers drift apart silently, so there is one.
 *
 * Org-scoped by construction (Rule 5): a machine in another tenant is not a candidate at all rather
 * than a candidate that is later filtered.
 */
export function residentialEgressPairings(
  candidates: readonly EgressCandidate[],
  actorOrg: string,
): string[] {
  return candidates
    .filter(
      (c) =>
        c.live &&
        c.org === actorOrg &&
        c.capabilities.includes('egress.residential') &&
        typeof c.egressEndpoint === 'string' &&
        c.egressEndpoint.length > 0,
    )
    .map((c) => c.pairingId);
}

/**
 * IS THIS MACHINE GONE, OR MERELY SWITCHED OFF? - the difference between a halt a person must
 * clear and one a laptop clears, stated once because two call sites ask it.
 *
 * `knownPairingIds` is the org's WHOLE listing, live or not (`egressCandidatesForOrg` returns every
 * non-revoked pairing), so "registered but asleep" and "revoked" are genuinely distinguishable. A
 * NON-EMPTY listing that does not contain the pairing is the registry stating the machine is gone.
 * An EMPTY listing is "this process does not know what this org has" - an unbound seam, a store
 * that answered nothing - which is not a statement that anything was retired, so the answer is NO.
 * That is the closed direction: not-knowing may never escalate a neutral wait into a terminal halt.
 */
export function machineRetired(pairingId: string, knownPairingIds: readonly string[]): boolean {
  if (!pairingId) return false;
  if (knownPairingIds.length === 0) return false;
  return !knownPairingIds.includes(pairingId);
}

/**
 * Choose the route out for a run.
 *
 * The `residential` branch is the only one that can fail, and when it does the OFFLINE POLICY —
 * not this function — decides what happens. That separation matters: the resolution is a fact
 * about the fleet, and the response to it is a property of the run.
 */
export function resolveEgress(
  declaration: EgressDeclaration,
  candidates: readonly EgressCandidate[],
  actorOrg: string,
): EgressResolution {
  const req = declaration.requirement;
  if (req.kind === 'datacenter') return { outcome: 'datacenter', reason: 'declared' };
  if (req.kind === 'any') return { outcome: 'datacenter', reason: 'no-requirement' };

  // Residential. The org filter lives in `residentialEgressPairings`; all that is added here is the
  // caller's optional pin, which narrows the same set rather than re-deriving it.
  const available = new Set(residentialEgressPairings(candidates, actorOrg));
  const usable = candidates.filter(
    (c) => available.has(c.pairingId) && (req.pairingId === undefined || c.pairingId === req.pairingId),
  );

  const chosen = usable[0];
  if (chosen?.egressEndpoint) {
    return { outcome: 'machine', pairingId: chosen.pairingId, proxyUrl: chosen.egressEndpoint };
  }

  const reason = req.pairingId
    ? `the pinned machine ${req.pairingId} is not available with residential egress`
    : 'no machine in this org is advertising residential egress';

  switch (declaration.offlinePolicy) {
    case 'queue':
      return { outcome: 'queue', reason };
    case 'datacenter':
      // Only ever reached because the RUN said so. Never a default.
      return { outcome: 'datacenter-fallback', reason };
    case 'fail':
    default:
      return { outcome: 'refused', reason };
  }
}

/**
 * The Playwright launch option for a resolution, or undefined for the datacenter route.
 * `chromium.launch` is the single place a proxy can be applied, which is why this returns the
 * option rather than reaching for the browser itself.
 */
export function proxyOptionFor(resolution: EgressResolution): { server: string } | undefined {
  return resolution.outcome === 'machine' ? { server: resolution.proxyUrl } : undefined;
}
