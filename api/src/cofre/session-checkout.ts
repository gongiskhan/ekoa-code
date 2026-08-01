/**
 * cofre/session-checkout.ts — session health and egress-matched checkout (Cofre G-4 / G-5).
 *
 * A CAPTURED SESSION IS NOT A TOKEN YOU CAN USE ANYWHERE. It was established from a particular
 * vantage point — a specific machine, behind a specific egress — and portals notice when that
 * changes. Replaying a session captured on a lawyer's home connection from a datacenter IP is the
 * exact pattern fraud systems are built to flag: same cookie, different continent. The result is
 * not a clean failure either; it is an account lock, a forced re-verification, or a silent
 * shadow-ban that looks like the automation being flaky.
 *
 * So checkout asks two questions, in this order:
 *   1. HEALTH (G-4) — is this session still usable at all, or has it expired / been marked
 *      unhealthy? An expired session must be RE-ESTABLISHED, and the route for that depends on
 *      what established it: a typist can redo a password login unattended, but a session created by
 *      a human at a card reader needs that human again.
 *   2. EGRESS (G-5) — can we leave from a vantage point compatible with where it was made?
 *
 * WHAT THIS MODULE DOES NOT DO. It does not re-establish, and it does not pick a machine. It
 * returns a DECISION, and the caller acts on it. Keeping the judgement separate from the action is
 * what lets the engine apply the run's offline policy to the result rather than having a checkout
 * helper silently decide that a datacenter fallback was fine.
 */
import type { SessionMetadata } from '@ekoa/shared';
import type { CofreItemDoc } from './types.js';
import { sessionIsExpired } from './sessions.js';

/** How a session must be re-established, decided by what created it in the first place. */
export type ReestablishRoute =
  /** A password login the typist can redo without a human present. */
  | 'typist'
  /** A ceremony that needed a person (card in a reader). Only a human can repeat it. */
  | 'attended'
  /** A code the user completes wherever they are. */
  | 'relay';

export type CheckoutDecision =
  | { ok: true; session: CofreItemDoc; egress: { kind: 'datacenter' } | { kind: 'residential'; pairingId: string } }
  /** Unusable as-is; `route` says how to get a fresh one. */
  | { ok: false; reason: 'expired' | 'unhealthy'; route: ReestablishRoute }
  /** Healthy, but no compatible way out. The CALLER applies the run's offline policy. */
  | { ok: false; reason: 'egress-unavailable'; required: { kind: 'residential'; pairingId: string } };

/** The metadata a session item carries, when it carries any. */
function metaOf(item: CofreItemDoc): SessionMetadata | undefined {
  return (item as unknown as { sessionMetadata?: SessionMetadata }).sessionMetadata;
}

/**
 * How to re-establish this session.
 *
 * The rule is "whatever made it must make it again", and the conservative direction is ATTENDED: a
 * session whose provenance we cannot read might have come from a card ceremony, and quietly
 * re-running a typist against a portal that actually wanted a smartcard would fail in a way that
 * looks like a bad password — which is how accounts get locked.
 */
export function reestablishRouteFor(item: CofreItemDoc): ReestablishRoute {
  const meta = metaOf(item);
  // A row whose metadata is absent OR INCOMPLETE reads as unknown provenance. The incomplete case
  // is real, not theoretical: `markSessionUnhealthy` stamps `healthy:false` onto whatever metadata a
  // row has, including none, and a pre-metadata row edited that way arrives here with no
  // `establishedBy`. Reading `.kind` off it used to throw — the one failure mode this function must
  // not have, since its whole job is to answer conservatively when it cannot tell.
  if (!meta?.establishedBy || !meta.boundEgress) return 'attended';
  if (meta.establishedBy.kind === 'machine') {
    // Established ON a machine. If it was also bound to that machine's residential egress it is
    // the card/attended shape; a plain machine-established session is a typist login.
    return meta.boundEgress.kind === 'residential' ? 'attended' : 'typist';
  }
  return 'typist';
}

/**
 * Decide whether a session can be checked out now, and over what egress.
 *
 * `availableEgress` is what the fleet can currently offer for this run — passed in rather than
 * resolved here, so this stays a pure decision the tests can drive exhaustively and the caller
 * keeps ownership of fleet state.
 */
export function checkoutSession(input: {
  item: CofreItemDoc;
  /** Pairing ids currently able to provide residential egress for this org. */
  residentialAvailable: readonly string[];
  /** Whether a datacenter route exists at all (it normally does). */
  datacenterAvailable?: boolean;
  now?: number;
}): CheckoutDecision {
  const { item, residentialAvailable, datacenterAvailable = true, now = Date.now() } = input;
  const meta = metaOf(item);

  // 1. HEALTH FIRST. Checking egress for a dead session would answer the wrong question and, worse,
  //    would report "no route" for something that actually needs re-authentication — sending the
  //    operator to look at the network when the problem is the credential.
  if (meta?.healthy === false) return { ok: false, reason: 'unhealthy', route: reestablishRouteFor(item) };
  if (sessionIsExpired(item, now)) return { ok: false, reason: 'expired', route: reestablishRouteFor(item) };

  // 2. EGRESS. A session with no recorded binding predates the metadata and cannot be matched, so
  //    it takes the datacenter route — the honest default, and the one that fails visibly at the
  //    portal rather than silently succeeding from somewhere unexpected.
  const bound = meta?.boundEgress;
  if (!bound || bound.kind === 'datacenter') {
    if (!datacenterAvailable) return { ok: false, reason: 'egress-unavailable', required: { kind: 'residential', pairingId: '' } };
    return { ok: true, session: item, egress: { kind: 'datacenter' } };
  }

  // Residential: it must be THAT machine. Another machine's residential line is a different
  // household on a different ASN — as foreign to the portal as a datacenter, and more confusing
  // when it fails, so a substitute is never offered.
  if (!residentialAvailable.includes(bound.pairingId)) {
    return { ok: false, reason: 'egress-unavailable', required: { kind: 'residential', pairingId: bound.pairingId } };
  }
  return { ok: true, session: item, egress: { kind: 'residential', pairingId: bound.pairingId } };
}

/** Mark a session unhealthy (G-4). Called when a run finds the session rejected by the portal. */
export function markUnhealthy(item: CofreItemDoc): CofreItemDoc {
  const meta = metaOf(item);
  return {
    ...item,
    ...(meta ? { sessionMetadata: { ...meta, healthy: false } } : {}),
  } as CofreItemDoc;
}
