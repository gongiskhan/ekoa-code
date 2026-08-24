/**
 * bridge/session-delivery.ts - the hosted half of the S-inject session channel.
 *
 * ONE FUNCTION, and it exists as a module rather than a lambda in `server.ts` for the reason
 * `secret-delivery.ts` does: putting a credential on a machine's socket has an ORDERING obligation
 * attached to it, and an obligation written inline at the composition root is one the next edit can
 * silently drop. `deliverSecrets` arms Cortex's ingress filter before the value is on the wire
 * (H-4); a delivered `storageState` is credential-equivalent and inherits exactly that rule.
 *
 * ── WHY THE INGRESS LEG MATTERS MORE HERE THAN THE OUTBOUND ONE ─────────────────────────────────
 *
 * The daemon arms its OWN outbound filter on the same delivery (`runtime/session-hold.ts`), and the
 * two are the usual pair: the daemon's leg means the value never crosses the network, this one
 * means it never reaches Cortex's PERSISTENCE. For a session that second leg is the load-bearing
 * one. A portal that reflects its session cookie into page text - a debug banner, an error page, a
 * token in a query string - produces an observation that Cortex writes into the run record and
 * streams over SSE, and a run record is durable in a way a dropped frame is not. Relying on the
 * daemon's leg alone would also mean trusting the daemon's version: a machine running an older
 * build, or one that has been tampered with, arms nothing.
 *
 * ── WHY ONLY COOKIE VALUES ──────────────────────────────────────────────────────────────────────
 *
 * A `storageState` also carries per-origin localStorage, which is a site's entire client-side
 * scratch space - `"dark"`, `"pt-PT"`, `"true"`. Registering those would have the redactor
 * substitute ordinary words out of every observation the run produces: a filter that mangles the
 * page is not a safer filter, it is a broken run plus a false sense of coverage. Cookies are where
 * portal sessions live, which is also why `profile.ts` injects cookies at context creation and
 * seeds localStorage only per origin. `runtime/session-hold.ts` makes the same call for the same
 * reason, and the two floors are deliberately identical.
 *
 * RELEASE IS ALREADY HANDLED and needs nothing here: `releasePairingSecrets` drops the whole
 * registry when the pairing's socket closes, which is the same lifetime a delivered secret's
 * registration has and the correct one - the filter should live exactly as long as the machine's
 * ability to echo what it was given.
 */
import type { BridgeFrame } from '@ekoa/shared';
import { sendToPairing } from './registry.js';
import { registerDeliveredSecrets } from './ingress-redaction.js';

/**
 * Below this, a cookie value is a preference flag and not a session token - `1`, `en`, `true`, `PT`.
 * Registering one would substitute it wherever it occurred in ordinary page text. Deliberately far
 * above `SecretRegistry`'s own minimum, which exists to stop a two-character secret destroying a
 * stream; this one exists to stop a short NON-secret being treated as one. A real portal session
 * cookie is dozens of characters. Kept in step with `MIN_SESSION_VALUE_LENGTH` in the daemon's
 * `runtime/session-hold.ts` - the two legs should arm on the same set.
 */
const MIN_SESSION_VALUE_LENGTH = 12;

/**
 * Deliver a run's stored session to a machine, arming the ingress filter first.
 *
 * Returns whether the frame reached the socket. A `false` is NOT fatal to the step - see
 * `daemon-step-seam.ts` on why a session that does not arrive degrades the run to signed-out rather
 * than failing it.
 *
 * THE CALLER HAS ALREADY CHECKED THE CAPABILITY GRANT. This function does not re-check it, and that
 * is deliberate rather than an omission: `createDaemonStepConnection` asks first and refuses before
 * reaching here, which is the same shape `deliverSecrets` sits in. Adding a second read here would
 * suggest this is a safe entry point for callers that have not asked, and it is not one.
 */
export function deliverSession(input: { pairingId: string; runId: string; storageState: unknown }): boolean {
  // BEFORE the send, never after. Registering afterwards leaves a window in which a fast first step
  // reports an observation carrying the cookie and Cortex persists it unfiltered - the exact defect
  // H-4 fixed for delivered secrets, and the reason that ordering is written down rather than left
  // to the reader.
  registerDeliveredSecrets(input.pairingId, sessionCookieValues(input.storageState));
  const frame: BridgeFrame = { type: 'session.deliver', runId: input.runId, storageState: input.storageState };
  return sendToPairing(input.pairingId, frame);
}

/**
 * The cookie values inside a stored session.
 *
 * Accepts BOTH shapes the Cofre can hold - a raw Playwright `storageState` and the
 * `{ storageState, capturedAt }` wrapper - because arming must not depend on which of the two a
 * given item happened to be written as. Anything unrecognised yields nothing: an unarmed filter is
 * a smaller failure than a throw on the delivery path, which would cost the run its session too.
 */
export function sessionCookieValues(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const state =
    obj['storageState'] && typeof obj['storageState'] === 'object'
      ? (obj['storageState'] as Record<string, unknown>)
      : obj;
  const cookies = state['cookies'];
  if (!Array.isArray(cookies)) return [];
  const out: string[] = [];
  for (const cookie of cookies) {
    if (!cookie || typeof cookie !== 'object') continue;
    const value = (cookie as Record<string, unknown>)['value'];
    if (typeof value === 'string' && value.length >= MIN_SESSION_VALUE_LENGTH) out.push(value);
  }
  return out;
}
