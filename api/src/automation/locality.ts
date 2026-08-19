/**
 * automation/locality.ts - WHERE a browser step runs, and WHERE its traffic leaves from.
 *
 * ================================ WHAT WAS WRONG ================================
 * Two modules already answered half of this question each, and neither was called.
 *
 *   - `egress-policy.ts` implements the route-out decision exactly (`resolveEgress` /
 *     `proxyOptionFor`) and shipped with ZERO callers, so a run's declared `offlinePolicy` and
 *     `StepTarget` were inert: nothing ever read them.
 *   - the browser-vs-bridge choice was made by ONE GLOBAL FLAG, `localBrowserEnabled`, defaulting
 *     to `!isProd`. So the question "may this step run in the hosted browser" was answered by the
 *     deployment environment rather than by the site being automated: outside production EVERY
 *     target silently ran hosted, including the portals that score datacenter IPs, and the only
 *     reason production looked correct was that the flag happened to be off there.
 *
 * This module is where the two halves meet, and it is where the environment stops being the
 * decision. The gate is the ORIGIN POSTURE (`origin-posture.ts`), in every environment: a
 * permissive origin may be carried by the hosted browser, an adversarial one never is. Because
 * posture defaults CLOSED, every automation authored before posture existed is bridge-only - which
 * is the direction a default must fail in when the cost of being wrong is an account lock.
 *
 * ================================ THE THREE ANSWERS ================================
 *   - `bridge`     - run it on the owner's paired machine. The default for a browser step.
 *   - `in-process` - run it in the hosted Chromium, optionally proxied out through a machine's
 *                    residential line (`egress`, fed to `proxyOptionFor` at the launch seam).
 *   - `blocked`    - neither is permissible. The run HALTS. It does not fall back to a datacenter
 *                    route, and it does not borrow another machine.
 *
 * `blocked` is a halt, never a failure: nothing about it is retryable by a machine, and the
 * schedule rail carries it as `blocked` (neutral against the failure ceiling) rather than `failed`.
 *
 * ================================ PREFERENTIAL BRIDGE (P4.2) ================================
 * A captured session was established from a particular vantage point, and the pairing where its
 * ceremony happened is already recorded - `sessionMetadata.establishedBy.pairingId`, stamped by
 * `bridge/attended.ts`. For an ADVERSARIAL origin that pairing is a preference this module honours:
 * the run goes to that machine or it waits. A substitute machine is another household on another
 * ASN, which to the portal is as foreign as a datacenter and more confusing when it fails.
 *
 * Portable credentials - API keys, OAuth tokens, CLI logins, a permissive origin's storageState -
 * carry NO preference. Their posture is permissive, which resolves to `kind: 'any'`: any route out
 * is fine, because nothing about them is bound to where they were made.
 *
 * KNOWN LIMITATION, named rather than hidden (docs/findings.md
 * `daemon-seam-cannot-ask-for-a-specific-machine...`): the daemon seam answers "the newest live
 * socket for this owner" and cannot be asked for a particular machine, so a two-machine user whose
 * arbitrary pick is the wrong one HALTS here even though the preferred machine is dialled in.
 * `bridge/registry.ts` `selectConnectionForStep` is the (currently inert) primitive that closes it.
 * The failure direction is the safe one: refuse and name the machine, never execute on another.
 *
 * ================================ PURE ON PURPOSE ================================
 * Nothing here reads a store, a seam or an env var. Every input is an argument, so the whole
 * decision table is drivable from a test - including the cross-tenant cases, which are the ones
 * that must never be reasoned about by inspection (`resolveEgress` filters candidates by org, and
 * `tests/security/locality-isolation.test.ts` proves it through this function).
 */
import type { OfflinePolicy, StepTarget } from '@ekoa/shared';
import type { OriginClassification } from './origin-posture.js';
import { resolveTargetPosture } from './origin-posture.js';
import {
  resolveEgress,
  type EgressCandidate,
  type EgressRequirement,
  type EgressResolution,
} from './egress-policy.js';

/** Where a step runs and how it leaves. */
export type LocalityVerdict =
  /** The owner's paired machine. `egress` is the fleet fact that was resolved alongside. */
  | { kind: 'bridge'; egress: EgressResolution }
  /** The hosted Chromium. `egress` becomes the launch proxy option (`proxyOptionFor`). */
  | { kind: 'in-process'; egress: EgressResolution }
  /** Neither is permissible. HALT - never a datacenter fallback, never a substitute machine. */
  | { kind: 'blocked'; reason: string };

export interface LocalityInput {
  /** The posture of the origin this step is ABOUT (`classifyOrigin`, resolved at use). */
  classification: OriginClassification;
  /** The step's declared (or defaulted) target. `resolveStepDeclaration` defaults it to `cloud`. */
  declaredTarget: StepTarget;
  /** The step's declared (or defaulted) offline policy. Defaults to `fail`. */
  offlinePolicy: OfflinePolicy;
  /** The pairing id of the daemon connected for this owner, or undefined when none is. */
  daemonPairingId?: string;
  /** Whether a daemon is connected at all (a connection may predate `pairingId` on the seam). */
  daemonConnected: boolean;
  /**
   * The pairing where THIS SESSION's ceremony happened
   * (`sessionMetadata.establishedBy.pairingId`). A preference for adversarial origins only.
   */
  preferredPairingId?: string;
  /** The org's machines, as the registry sees them (advertised INTERSECT granted). */
  candidates: readonly EgressCandidate[];
  /** The RUN's org. `resolveEgress` filters candidates by it - the tenancy boundary (Rule 5). */
  actorOrg: string;
  /** The env kill switch (`EKOA_AUTOMATION_LOCAL_BROWSER`). Never the posture gate. */
  inProcessFallbackEnabled: boolean;
}

/**
 * The route out this step needs, folding the declaration and the posture.
 *
 * PRECEDENCE, and why:
 *   1. An EXPLICITLY PINNED target names a machine. The author was specific; nothing here
 *      second-guesses that, and it outranks the ceremony preference (which is an inference).
 *   2. `any: egress.residential` asks for a residential line without naming one - so the ceremony
 *      pairing, when there is one, is the machine it means.
 *   3. Otherwise posture decides, via `resolveTargetPosture` (which is where "posture wins over a
 *      defaulted `target: cloud`" is already settled - plan trap T9, decided when posture landed).
 *      Cloud allowed => `any`: no preference at all, because a permissive origin's credential is
 *      portable by definition. Cloud denied => residential, preferring the ceremony pairing.
 */
export function egressRequirementFor(input: {
  declaredTarget: StepTarget;
  classification: OriginClassification;
  preferredPairingId?: string;
}): EgressRequirement {
  const { declaredTarget, classification, preferredPairingId } = input;
  if (declaredTarget.kind === 'pinned') {
    return { kind: 'residential', pairingId: declaredTarget.pairingId };
  }
  const preferred = preferredPairingId ? { pairingId: preferredPairingId } : {};
  if (declaredTarget.kind === 'any' && declaredTarget.capability === 'egress.residential') {
    return { kind: 'residential', ...preferred };
  }
  if (resolveTargetPosture(declaredTarget, classification).cloudAllowed) {
    return { kind: 'any' };
  }
  return { kind: 'residential', ...preferred };
}

/**
 * Decide where this step runs.
 *
 * The order is the argument. The bridge is tried FIRST because a browser step's home is the owner's
 * machine - it has the real profile, the real IP and the real fingerprint, and every reason the
 * hosted browser exists is a fallback reason. Only when no usable bridge is available does posture
 * get asked whether the hosted browser may carry this origin at all, and the answer for anything
 * undeclared is no.
 */
export function resolveLocality(input: LocalityInput): LocalityVerdict {
  const requirement = egressRequirementFor({
    declaredTarget: input.declaredTarget,
    classification: input.classification,
    ...(input.preferredPairingId ? { preferredPairingId: input.preferredPairingId } : {}),
  });
  const resolution = resolveEgress(
    { requirement, offlinePolicy: input.offlinePolicy },
    input.candidates,
    input.actorOrg,
  );

  // ---- 1. The bridge ------------------------------------------------------------------------
  if (input.daemonConnected) {
    const pinned = requirement.kind === 'residential' ? requirement.pairingId : undefined;
    // A NAMED machine and a connected daemon that is not it: this is the P4.2 refusal. Running the
    // step here would be silently substituting a foreign machine for the one the session was made
    // on, which is precisely the swap the preference exists to prevent. A connection with no
    // `pairingId` cannot PROVE it is the right machine, and unprovable reads as no.
    if (!pinned || input.daemonPairingId === pinned) {
      return { kind: 'bridge', egress: resolution };
    }
    return {
      kind: 'blocked',
      reason: `this step must run on machine ${pinned} (where its session was established); the connected machine is a different one`,
    };
  }

  // ---- 2. The hosted browser, gated by POSTURE and not by the environment --------------------
  if (!input.classification.cloudEgressAllowed) {
    // No machine is connected, and this origin may not be carried by the hosted browser. The
    // OFFLINE POLICY has nothing to add here: `queue` and `fail` produce the same halt, because
    // there is no queue to join — the run stops and re-fires once a machine is back — and
    // `datacenter` cannot be honoured at all, since posture is what denied the datacenter in the
    // first place. Naming the machine when there is one is the difference between an instruction
    // and a shrug.
    const pinned = requirement.kind === 'residential' ? requirement.pairingId : undefined;
    return {
      kind: 'blocked',
      reason: pinned
        ? `this origin is ${input.classification.posture}: the step runs only on machine ${pinned}, ` +
          'where its session was established, and that machine is not connected'
        : `this origin is ${input.classification.posture}, so its browser steps run only on one of your ` +
          'machines, and none is connected',
    };
  }
  if (!input.inProcessFallbackEnabled) {
    return { kind: 'blocked', reason: 'no machine is connected and the in-process browser fallback is disabled' };
  }

  // ---- 3. ...and the route out it gets -------------------------------------------------------
  switch (resolution.outcome) {
    case 'datacenter':
    case 'machine':
      return { kind: 'in-process', egress: resolution };
    case 'datacenter-fallback':
      // The RUN explicitly accepted the datacenter (`offlinePolicy: 'datacenter'`), and the origin
      // is permissive, so this is a declared choice rather than a silent substitution.
      return { kind: 'in-process', egress: resolution };
    case 'queue':
      return { kind: 'blocked', reason: `waiting for a machine: ${resolution.reason}` };
    case 'refused':
    default:
      return { kind: 'blocked', reason: resolution.reason };
  }
}

/**
 * Do two resolutions put traffic on the SAME route out?
 *
 * A browser session is created once per run and then reused across steps, so a later step can
 * inherit a context that was launched for an earlier step's route. Two steps that resolve
 * differently must not share one: the proxy is a launch option, and a context launched for the
 * datacenter cannot be re-pointed at a machine afterwards. The engine refuses rather than reusing.
 */
export function sameRoute(a: EgressResolution, b: EgressResolution): boolean {
  if (a.outcome === 'machine' || b.outcome === 'machine') {
    return a.outcome === 'machine' && b.outcome === 'machine' && a.proxyUrl === b.proxyUrl;
  }
  // Every other outcome leaves by the datacenter (or does not leave at all), so they interchange.
  return true;
}
