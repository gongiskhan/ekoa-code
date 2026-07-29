/**
 * automation/human-action-routing.ts — where a paused run goes when a human is needed (Cofre F-4).
 *
 * TWO RULES, and both exist because the alternative is a model improvising around a credential.
 *
 * 1. AN UNKNOWN PATTERN NEVER REACHES THE FIXER. When the typist cannot find the form it expects,
 *    the tempting move is to hand the page to the rehearsal fixer and let it work out which field
 *    is the password. That is exactly the thing invariant I5 forbids: the fixer is an LLM, its
 *    output steers a live page, and the next action in the sequence types a decrypted credential
 *    into whatever it picked. An unfamiliar login form is a case for a HUMAN, not for a guess.
 *    `isCredentialAdjacentFailure` is what the engine consults to refuse the fix.
 *
 * 2. LOGIN AND SIGNATURE ARE DIFFERENT CEREMONIES. The classifier used to collapse
 *    captcha/mfa/payment/identity/login into one paused state. `signature` is now its own kind,
 *    because I8 requires that a login-typed relay cannot satisfy a signature completion: signing a
 *    document is an act of legal authorship by a named person, and "the user completed a ceremony"
 *    is not interchangeable evidence for it. The types are kept apart HERE, at classification, so
 *    everything downstream inherits the distinction rather than re-deriving it.
 */
import type { HumanActionKind } from './types.js';

/**
 * How a paused state is resolved.
 *  - `relay`    — the user completes it wherever they are, via a one-time code (a browser they can
 *                 reach, a phone). Suits captcha, MFA, payment step-up, identity checks.
 *  - `attended` — the user must be AT the machine: a smartcard in a physical reader, a signature
 *                 ceremony bound to that device. No code can stand in for presence.
 *
 * Deliberately NOT a member of this union: anything meaning "let the model try". The absence is the
 * control — a route that does not exist cannot be selected by a later refactor looking for a
 * fallback.
 */
export type HumanActionRoute = 'relay' | 'attended';

/**
 * Route a classified pause.
 *
 * `signature` is attended because a qualified signature is bound to the card in the reader in front
 * of the person signing. `login` is relay: a password or OTP can be supplied from anywhere the
 * legitimate user is, and forcing physical presence for it would push people toward sharing
 * credentials, which is worse than the risk it avoids.
 *
 * `other` routes to `relay` rather than `attended`: relay is the weaker claim ("a human did
 * something"), and asserting the stronger one (presence at a specific machine) for a state nobody
 * classified would be evidence we have not earned.
 */
export function routeForHumanAction(kind: HumanActionKind): HumanActionRoute {
  switch (kind) {
    case 'signature':
      return 'attended';
    case 'captcha':
    case 'mfa':
    case 'payment':
    case 'identity':
    case 'login':
    case 'other':
      return 'relay';
  }
}

/** Error names/messages that mean "a credential was about to be handled and the page was not what
 *  we expected". Matched on the error NAME where possible — a name is structural, a message is
 *  prose that changes. */
const CREDENTIAL_ADJACENT_ERRORS = new Set([
  'TypistUnknownPattern',
  'TypistNotSuppressed',
  'CredentialOriginError',
  'CofreLockedError',
]);

/**
 * Must this failure be kept away from the rehearsal fixer?
 *
 * True for every credential-adjacent failure. The engine consults this BEFORE deciding to attempt a
 * fix, so the answer is "pause for a human", never "ask the model to try something else". Matching
 * is by error name first; the message fallback exists because errors cross a serialisation boundary
 * (a step record persists `error.message`, not the class) and the property must survive that.
 */
export function isCredentialAdjacentFailure(err: { name?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.name && CREDENTIAL_ADJACENT_ERRORS.has(err.name)) return true;
  const msg = err.message ?? '';
  return (
    /login requires an opaque cofre: reference/i.test(msg) ||
    /refusing to fill/i.test(msg) ||
    /no password field|unknown login form/i.test(msg) ||
    CREDENTIAL_ADJACENT_ERRORS.has(msg.split(':')[0]?.trim() ?? '')
  );
}
