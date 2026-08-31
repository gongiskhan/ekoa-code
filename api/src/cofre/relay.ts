/**
 * cofre/relay.ts - the LOGIN relay's server half, and nothing else.
 *
 * `RelayPrompt` / `RelayCompleteRequest` (`shared/src/cofre.ts`) shipped as schemas with no
 * producer and no consumer. This module gives the `login` variant a producer - a run that halts in
 * `needs_credentials` with `mode: 'ceremony'` issues one, and the portal renders "log in to <site>
 * in your headed window" from it - and DELIBERATELY gives the completion half nothing.
 *
 * ================= WHY THERE IS NO `completeLoginRelay` HERE =================
 * `RelayCompleteRequest.code` is an OTP field. Wiring it to anything that types would be building
 * typed-OTP automation: a human reads a code off their phone, hands it to the platform, and the
 * platform enters it on their behalf. That was proposed and it is REFUSED (docs/decisions.md,
 * 2026-08-18). An origin whose login demands OTP / MFA / CAPTCHA is classified
 * `requiresAttendedAuth` (`automation/origin-posture.ts`) and its only establishment route is the
 * human logging in THEMSELVES in a headed window, after which `captureSessionWithGrant` stores the
 * resulting `storageState`. The login ceremony is completed by that capture, never by a code.
 *
 * `RelayCompleteRequest` therefore stays reserved for the `signature` ceremony, which is out of
 * scope here. `api/tests/automation/no-typed-otp.test.ts` asserts this module exposes no
 * completion entry point and that nothing hands a code to the typist.
 *
 * NOTHING HERE HOLDS A SECRET. A login prompt carries an origin, a run's automation name, a reason
 * and an expiry. There is no field a credential could occupy, which is why the prompt is safe to
 * persist on a run record and stream over SSE.
 */
import { randomUUID } from 'node:crypto';
import { RelayLoginPrompt } from '@ekoa/shared';

/**
 * How long a ceremony request stays meaningful.
 *
 * It bounds the PROMPT, not the halt: a run stays `needs_credentials` until a credential appears or
 * a human cancels it, and an expired prompt only means the portal should stop presenting this
 * particular invitation as live. Ten minutes matches the shortest grant duration the Cofre offers,
 * which is the same order of magnitude as "walk to the other window and log in".
 */
export const LOGIN_RELAY_TTL_MS = 10 * 60_000;

export interface IssueLoginRelayInput {
  /** The automation the human is being asked to unblock. Shown, never parsed. */
  automationName: string;
  /** The portal origin the ceremony is against. */
  siteOrigin: string;
  /** The address the window opens at, when it is not `https://<siteOrigin>` (an http-only portal or
   *  a non-default port). Shown to the human so the prompt names the address they will land on. */
  siteUrl?: string;
  /** Why a human is needed, composed from the host and the route - never a failure body. */
  reason: string;
}

/**
 * Build a login relay prompt. Validated through the shared schema on the way out rather than merely
 * shaped like it: this object crosses to the client, and a producer that only LOOKS conformant is
 * how a contract drifts. Typed as the login variant alone, so this function cannot emit a signature
 * prompt however it is called (I8).
 */
export function issueLoginRelayPrompt(
  input: IssueLoginRelayInput,
  deps: { now?: () => number; genId?: () => string } = {},
): RelayLoginPrompt {
  const nowMs = deps.now?.() ?? Date.now();
  return RelayLoginPrompt.parse({
    operation: 'login',
    relayId: deps.genId?.() ?? `rly_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    automationName: input.automationName,
    siteOrigin: input.siteOrigin,
    ...(input.siteUrl ? { siteUrl: input.siteUrl } : {}),
    reason: input.reason,
    expiresAt: new Date(nowMs + LOGIN_RELAY_TTL_MS).toISOString(),
  });
}
