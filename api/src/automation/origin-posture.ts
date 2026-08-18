/**
 * ORIGIN POSTURE - permissive vs adversarial, resolved at use, closed by default.
 *
 * One classification, three consumers. It exists as its own module because those three decisions
 * are made in three different places and MUST agree:
 *
 *   - egress locality: cloud egress is an opt-in a permissive origin may take, and an adversarial
 *     one may not take at all (a datacenter IP against a site that scores IPs is a detection event,
 *     not a fallback);
 *   - browser routing: an adversarial origin is bridge-only, and prefers the pairing where its
 *     session ceremony happened;
 *   - re-authentication: an origin whose login is attended (OTP / MFA / CAPTCHA) is never re-auth'd
 *     by the unattended typist, whatever grant is live.
 *
 * Three copies of "is this site adversarial?" would drift, and the drift would be silent and in the
 * open direction. So the question is answered here, once.
 *
 * WHERE THE TRUTH LIVES. Nowhere new. The declaration is an optional per-action field on
 * `IntegrationAction` (`integrations/definitions.ts`), and it is resolved HERE at the moment a
 * decision needs it - never stored resolved anywhere. That is the discipline the repo already
 * settled on when it deleted the per-integration `declaredOrigins` allow-list ("the one egress
 * truth is the action's httpConfig.baseUrl derived at use"; `definition-store.ts`, docs/decisions.md
 * 2026-08-02): a stored classification is a lie waiting to be trusted after the action changed.
 *
 * DEFAULT CLOSED. An origin nobody classified is `adversarial`, with no cloud egress. Every
 * automation authored before this module existed declares nothing, and the safe reading of "nothing"
 * is "assume the site fights back" - the expensive-but-correct route - not "assume it does not".
 */

import type { StepTarget } from '@ekoa/shared';

/**
 * How the origin treats being automated.
 *
 * Structurally identical to `IntegrationActionOriginPosture` (`integrations/definitions.ts`), which
 * is the DECLARATION site. The union is restated on both sides rather than imported across, because
 * integrations/ sits below automation/ in the tier table and the dependency runs one way - the same
 * pattern `schedules/supervisor.ts` uses for the automation outcome shapes it maps. The two unions
 * are pinned identical by `tests/automation/origin-posture.test.ts`.
 */
export type OriginPosture = 'permissive' | 'adversarial';

export interface OriginClassification {
  /** DEFAULT `adversarial`: an origin with no declaration gets the closed answer. */
  posture: OriginPosture;
  /**
   * The login is OTP / MFA / CAPTCHA gated ⇒ only a human at a headed browser can establish or
   * re-establish the session. Never a typist replay, and never "try the typist first".
   */
  requiresAttendedAuth: boolean;
  /**
   * Whether this run may leave from the managed cloud path for this origin. STRUCTURALLY tied to
   * `posture === 'permissive'` - see `classification()`; it is not possible to build a value of
   * this type that says `adversarial` and `true`.
   */
  cloudEgressAllowed: boolean;
}

/**
 * The declaration this module reads, as a STRUCTURAL type rather than an import of
 * `IntegrationAction`.
 *
 * automation/ reaches integrations/ only through seams wired at the composition root; a type-only
 * import would still add a module edge the architecture does not have, for three fields. So the
 * shape is the contract, exactly as `schedules/supervisor.ts` declares the automation-outcome
 * shapes it maps. An `IntegrationAction` satisfies this by construction (pinned by the suite).
 */
export interface PostureBearingAction {
  posture?: OriginPosture;
  authProfile?: { attended: boolean };
  /** Present on api-call actions. Its origin is what the declaration is ABOUT - see `classifyOrigin`. */
  httpConfig?: { baseUrl?: string };
}

/**
 * The ONLY constructor of an `OriginClassification`, and the reason `cloudEgressAllowed: true` on
 * an adversarial origin is impossible rather than merely discouraged.
 *
 * A convention ("remember to check the posture first") is enforced by whoever reviews the next
 * caller. A clamp is enforced by the type system's only entry point. `requestedCloudEgress` is what
 * the declaration ASKED for; what comes out is what the posture ALLOWS. The result is frozen so a
 * consumer cannot flip the field after the fact either.
 */
function classification(
  posture: OriginPosture,
  requiresAttendedAuth: boolean,
  requestedCloudEgress: boolean,
): OriginClassification {
  return Object.freeze({
    posture,
    requiresAttendedAuth,
    cloudEgressAllowed: posture === 'permissive' && requestedCloudEgress,
  });
}

/** The closed answer: what an origin nobody classified gets. */
const CLOSED: OriginClassification = classification('adversarial', false, false);

/**
 * Normalise to a bare origin (scheme + host + port), lower-cased, so `https://Example.com/path?x=1`
 * and `https://example.com` compare equal. An unparseable value answers null and therefore gets the
 * closed classification: we do not guess at what a caller meant by a string that is not a URL.
 */
function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Resolve the posture of `origin`, folding in the action's declaration when the action is the one
 * being run against it.
 *
 * WHEN THE DECLARATION APPLIES (a decision the plan left open, recorded here because it is the
 * whole security surface of this function): the author declares posture ON AN ACTION, so it applies
 * to the origin that action is about. For an action carrying an `httpConfig.baseUrl`, that origin
 * is known, and the declaration applies ONLY to it - classifying any other origin with the same
 * action falls back to closed. That is what stops a `permissive` label from following a redirect,
 * an OAuth hop, or a third-party embed off the site it was written for. For an action with no
 * `httpConfig` at all (a browser-steps action, whose origin is wherever its automation navigates)
 * there is nothing to compare against, so the declaration applies to the origin the caller passed:
 * the caller is executing THAT action, and the author's label is the only statement anyone has
 * made. Callers must therefore pass the action they are actually running, never one they looked up
 * by name for context.
 */
export function classifyOrigin(origin: string, action?: PostureBearingAction): OriginClassification {
  const target = toOrigin(origin);
  if (!target) return CLOSED;
  if (!action) return CLOSED;

  const declaredFor = toOrigin(action.httpConfig?.baseUrl);
  if (declaredFor && declaredFor !== target) return CLOSED;

  const posture: OriginPosture = action.posture ?? 'adversarial';
  const requiresAttendedAuth = action.authProfile?.attended === true;
  // A permissive declaration IS the cloud-egress opt-in: the author saying "this site tolerates
  // automation" is the only assent the egress decision has. The clamp in `classification` means an
  // adversarial declaration cannot produce it however this argument is computed.
  return classification(posture, requiresAttendedAuth, posture === 'permissive');
}

/** What a step's declared (or defaulted) target resolves to once posture has had its say. */
export interface TargetPostureVerdict {
  /** Whether the managed cloud path may carry this step for this origin. */
  cloudAllowed: boolean;
  /** True when posture DENIED a `cloud` target the declaration asked for, explicitly or by default. */
  overriddenByPosture: boolean;
  /** Why, when it was overridden. Free text for the run record; never parsed. */
  reason?: string;
}

/**
 * POSTURE WINS. The one place that reconciles two closed defaults which, taken literally, contradict
 * each other - and the reason this module exists before the code that consumes it.
 *
 * `resolveStepDeclaration` (`automation/types.ts`) fills an absent declaration with
 * `target: { kind: 'cloud' }`. That default was chosen when "cloud" meant "the managed path, as
 * opposed to a machine we have to find", and it is the right default for that question. But every
 * automation authored before origin posture existed declares nothing, so read together the two
 * defaults would hand a legacy automation cloud egress against a site classified adversarial -
 * precisely the outcome the adversarial default exists to prevent.
 *
 * The decision (plan trap T9, taken here rather than at the call site so P4 consumes it instead of
 * re-deciding it): for an adversarial origin, posture overrides the `cloud` target. "Declared
 * nothing" means adversarial and bridge-preferred, not cloud. An EXPLICIT non-cloud target is
 * untouched - it is already asking for a machine, which is what posture wants anyway.
 *
 * This function decides only whether cloud is allowed. WHICH bridge, and what happens when none is
 * available, belongs to the router (the offline policy already answers the second half).
 */
export function resolveTargetPosture(
  declaredTarget: StepTarget,
  classification: OriginClassification,
): TargetPostureVerdict {
  if (declaredTarget.kind !== 'cloud') return { cloudAllowed: false, overriddenByPosture: false };
  if (classification.cloudEgressAllowed) return { cloudAllowed: true, overriddenByPosture: false };
  return {
    cloudAllowed: false,
    overriddenByPosture: true,
    reason:
      `origin is ${classification.posture}: the step's cloud target is overridden ` +
      '(a declaration-free step defaults to cloud, which posture does not grant)',
  };
}
