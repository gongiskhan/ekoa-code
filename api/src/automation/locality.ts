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
 * schedule rail carries it as `blocked` rather than `failed`. Whether a given block is NEUTRAL
 * against the failure ceiling is the schedule rail's own judgement and depends on the cause - a
 * machine that is not connected is fixed by opening a laptop, a rejected credential is not fixed by
 * repeating it (`schedules/supervisor.ts` `NEUTRAL_BLOCKED_CODES`).
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
 * A preference is not a life sentence. A pairing the org's fleet listing no longer contains has
 * been RETIRED, and `preferenceMachineRetired` turns that into a refusal that names the act which
 * fixes it - establish the session again from a machine you still have - rather than an eternal
 * wait for hardware nobody owns. It does NOT silently fall through to another machine: a retired
 * ceremony machine makes the session homeless, not portable.
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
   * (`sessionMetadata.establishedBy.pairingId`). A preference for adversarial origins only, and one
   * this module refuses DIFFERENTLY when the fleet listing says that machine is gone - see
   * `preferenceMachineRetired`.
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
 * Has the ceremony machine been RETIRED - i.e. is this preference about a machine that no longer
 * exists, rather than one that is merely switched off?
 *
 * WHY THE QUESTION IS WORTH ASKING. `preferredPairingId` is read off a stored session and is never
 * revised. Retire the laptop that established it (`revokePairing`, an ordinary admin action) and
 * the preference outlives the machine: every later fire resolves to `blocked` "waiting" for a
 * machine that is gone, forever, and NOTHING the owner does clears it - not connecting the new
 * machine, not re-pairing, not disabling and re-enabling. A halt with no way out is its own defect,
 * and it is worse than the substitution the preference exists to prevent, because a substitution is
 * at least visible.
 *
 * THE TEST. A NON-EMPTY fleet listing that does not contain the pairing is the registry stating the
 * machine is gone: `egressCandidatesForOrg` lists every non-revoked pairing in the org, live or
 * not, so "registered but asleep" and "revoked" are genuinely distinguishable here. An EMPTY
 * listing is "this process does not know what this org has" - an unbound seam, a store that
 * answered nothing - which is not a statement that anything was retired, so the preference stands.
 * That is the closed direction: not-knowing may never change where a session is allowed to run.
 *
 * WHAT THE ANSWER IS *NOT* USED FOR. Dropping the preference and letting selection pick some other
 * machine, which was the first shape of this fix and is wrong: substituting a colleague's household
 * for the retired one is precisely the swap P4.2 forbids, and the machine being retired does not
 * make it less of a swap. A retired ceremony machine means the SESSION has no home any more, and
 * the honest answer is to say so and name the act that fixes it - establish this session again from
 * a machine you still have, which mints an item carrying a pairing that exists.
 */
function preferenceMachineRetired(input: LocalityInput): boolean {
  if (!input.preferredPairingId) return false;
  if (input.candidates.length === 0) return false;
  return !input.candidates.some((c) => c.pairingId === input.preferredPairingId);
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
  // WHO NAMED THE MACHINE decides how the refusal is worded. An `authorPin` is a literal the author
  // typed into the automation, so echoing it back is the most useful thing a message can do. The
  // ceremony PREFERENCE is an inference this module made from a stored session, and its pairing id
  // is an opaque UUID nothing in the product ever shows a user - printing it names nothing and
  // reads as a fault code, so those messages describe the machine and the way out instead.
  const authorPin = input.declaredTarget.kind === 'pinned' ? input.declaredTarget.pairingId : undefined;

  // ---- 0. A ceremony machine that no longer exists ------------------------------------------
  // Checked FIRST, and before the bridge, because every answer below it would be a lie: "that
  // machine is not connected" is wrong about a machine that was removed, and "run it here instead"
  // is the substitution P4.2 exists to refuse. Only when the preference is what the requirement
  // actually became - an author's explicit pin is the author's business, and a permissive origin
  // resolves to `any` and never asks about a machine at all.
  if (
    !authorPin &&
    requirement.kind === 'residential' &&
    requirement.pairingId === input.preferredPairingId &&
    preferenceMachineRetired(input)
  ) {
    return {
      kind: 'blocked',
      reason:
        'the machine where this session was established has been removed from your account - ' +
        'establish this session again, from a machine you still have',
    };
  }

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
      reason: authorPin
        ? `this step is pinned to machine ${authorPin}; the machine currently connected is a different one`
        : 'this step must run on the machine where its session was established, and a different ' +
          'machine of yours is connected - start that machine, or establish this session again ' +
          'from the one you want to use',
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
      reason: authorPin
        ? `this origin is ${input.classification.posture}: the step is pinned to machine ${authorPin}, ` +
          'and that machine is not connected'
        : pinned
          ? `this origin is ${input.classification.posture}: the step runs only on the machine where its ` +
            'session was established, and that machine is not connected'
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
