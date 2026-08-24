/**
 * bridge/attended.ts — the attended ceremony rail (Cofre J-5).
 *
 * THE PROBLEM THIS SOLVES WITHOUT SOLVING THE HARD VERSION OF IT. Portuguese legal portals
 * (Citius, the Ordem dos Advogados) authenticate with a smartcard — Cartão de Cidadão or an
 * advogado card — read by a physical reader attached to a physical machine. A cloud browser cannot
 * touch one. The general solution is a card stack in Cortex: PKCS#11, driver matrices, `.pfx`
 * custody, certificate lifecycles. That is a large surface holding the most sensitive credential a
 * lawyer owns, and it would put private key material on a server that has no business seeing it.
 *
 * THE RAIL INSTEAD. `attended.request` asks the machine that ALREADY HAS the reader to open a
 * browser at a declared origin and hold it while the human completes the ceremony in front of it.
 * The card, its PIN and every certificate stay on that machine. What comes back is
 * `session.push` — the resulting `storageState`, stored as a Cofre session item through WS-G's
 * existing path.
 *
 * So Cortex needs ZERO PKCS#11 code and ZERO `.pfx` handling, and no certificate material ever
 * transits the wire. That is not a simplification of the card problem; it is a decision not to own
 * it. The cost is honest and worth stating: the ceremony requires a human at a specific machine, so
 * it cannot be scheduled, retried unattended, or run while the lawyer is asleep.
 *
 * WHAT THIS MODULE REFUSES. A pushed session is credential-equivalent: it walks past the card as
 * well as the password, so it goes through the Cofre's own capture and nothing else. Same
 * envelope, same `unwrap()` seam, same locks. And a push is only accepted against a ceremony THIS
 * process asked for, on the machine it asked, so a compromised or confused daemon cannot inject a
 * session for an origin nobody requested.
 *
 * THE RAIL NOW CARRIES A SECOND ERRAND (docs/decisions.md 2026-08-24, D-ADHOC-1). A run that walks
 * into a sign-in wall on an UNDECLARED, adversarial origin halts `needs_credentials(ceremony)` and
 * is completed here, through this same rail - a `login` ceremony at the origin the run resolved.
 * Reusing the rail rather than reading `storageState` out of the live run browser is the custody
 * decision: it adds no new secret-bearing wire surface, it makes the ad-hoc path structurally
 * identical to the declared one, and the profile-lock arbitration falls out for free because the
 * ceremony opens its OWN browser instead of contending for the run's.
 *
 * WHAT DIFFERS BETWEEN THE TWO ERRANDS IS ONE FIELD: the GRANT the capture is armed with. A declared
 * portal someone connected on purpose gets the standing `until_locked`; an origin reached ad-hoc
 * gets a bounded TTL (`ADHOC_SESSION_GRANT`, D-ADHOC-2). It is recorded on the ceremony AT REQUEST
 * TIME, by the code that asked for it, and never taken from the push - a daemon that could name its
 * own grant would be choosing how long its capture lives.
 */
import { randomUUID } from 'node:crypto';
import type { Actor, GrantDuration, SessionMetadata } from '@ekoa/shared';
import { boundOriginsForEstablishedHost, captureSessionToCofre, captureSessionWithGrant } from '../cofre/sessions.js';
import type { CofreItemDoc } from '../cofre/types.js';
import { sendToPairing } from './registry.js';
import { recordBridgeEvent } from './audit.js';

/** How long a ceremony stays open. A human is walking to a card reader, not making a round trip. */
const CEREMONY_TTL_MS = 10 * 60_000;

export type AttendedKind = 'card_login' | 'relay_code' | 'login';

interface PendingCeremony {
  requestId: string;
  pairingId: string;
  kind: AttendedKind;
  origin: string;
  actor: Actor;
  label: string;
  createdAt: number;
  /**
   * The grant this ceremony's capture will be armed with, or ABSENT for none.
   *
   * Absent is the declared rail's behaviour and is unchanged by the ad-hoc slice: `card_login` mints
   * a locked item exactly as it always has. Present is the ad-hoc ceremony, which must come back
   * USABLE - the run that halted is re-dispatched the moment the capture lands, and a locked item
   * would wake it into the same halt it just came from.
   *
   * Decided by the REQUESTER and held here, so the value cannot arrive on the push: this is the one
   * field of the capture the machine is not allowed a say in.
   */
  grant?: GrantDuration;
}

const ceremonies = new Map<string, PendingCeremony>();

function sweep(now: number): void {
  for (const [id, c] of ceremonies) {
    if (now - c.createdAt > CEREMONY_TTL_MS) ceremonies.delete(id);
  }
}

export class AttendedError extends Error {
  readonly code = 'ATTENDED_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'AttendedError';
  }
}

/**
 * Ask a named machine to open a ceremony and hold it.
 *
 * The origin is declared by CORTEX, not chosen by the daemon in its reply: the whole security value
 * of the rail is that the session which comes back is the session for the portal we asked about.
 */
export async function requestAttendedCeremony(
  actor: Actor,
  input: {
    pairingId: string;
    kind: AttendedKind;
    origin: string;
    reason: string;
    label: string;
    /** See `PendingCeremony.grant`. Omitted by the declared rail; `ADHOC_SESSION_GRANT` for the
     *  ad-hoc one. */
    grant?: GrantDuration;
  },
  now = Date.now(),
): Promise<string> {
  sweep(now);
  const requestId = randomUUID();
  const sent = sendToPairing(input.pairingId, {
    type: 'attended.request',
    requestId,
    kind: input.kind,
    origin: input.origin,
    reason: input.reason,
  });
  if (!sent) {
    // Offline is a refusal, never a queued promise: a ceremony needs a human AT the machine, so
    // "we will ask when it comes back" would mean asking at a moment nobody is standing there.
    throw new AttendedError(`machine ${input.pairingId} is not reachable; the ceremony was not started`);
  }
  ceremonies.set(requestId, {
    requestId,
    pairingId: input.pairingId,
    kind: input.kind,
    origin: input.origin,
    actor,
    label: input.label,
    createdAt: now,
    ...(input.grant ? { grant: input.grant } : {}),
  });
  await recordBridgeEvent(
    { userId: actor.userId, orgId: actor.orgId, username: '' },
    'bridge_attended_requested',
    { pairingId: input.pairingId, attendedKind: input.kind, targetOrigin: input.origin },
    { now: () => now },
  ).catch(() => undefined);
  return requestId;
}

/**
 * Accept a `session.push` and store the result as a Cofre session item.
 *
 * Four refusals, each closing a different way this could go wrong:
 *  - an UNKNOWN requestId: a push for a ceremony this process never asked for;
 *  - a push arriving from a DIFFERENT pairing than the one asked: a machine answering for another;
 *  - an ORIGIN that does not match the ceremony's: the session for a portal nobody requested;
 *  - a JAR THAT COVERS NO COOKIE FOR THE CEREMONY ORIGIN: a login that left nothing for the portal
 *    this ceremony was about.
 *
 * THE LAST TWO ARE ONE CONTROL, AND SPLITTING THEM WAS THE DEFECT. The `sameOrigin` check compares
 * the ceremony's origin to `input.origin`, a field the DAEMON declares - so on its own it is a
 * machine agreeing with itself. What the item is actually usable for is decided by `boundOrigins`,
 * and that used to be `originsFromStorageState`: EVERY cookie domain in the pushed jar. A confused
 * or compromised daemon could therefore pass the field comparison (`input.origin` = the ceremony's)
 * and push a jar whose cookies are for somewhere else entirely, minting a valid, correctly-encrypted
 * item bound to the WRONG SITE - the exact outcome the paragraph above claimed was closed. An HONEST
 * daemon produced a softer version of the same thing: a real login leaves analytics, CDN, SSO and
 * parent-domain cookies beside the portal's own, and binding to all of them makes the session
 * unwrappable under every one.
 *
 * THE BINDING IS NOW DERIVED FROM THE CEREMONY'S ORIGIN, which is the one statement in this
 * transaction that Cortex made rather than received. `boundOriginsForEstablishedHost` narrows to
 * that single host and uses the jar only as EVIDENCE - at least one cookie must cover it, or there
 * is no session for this portal and the empty list makes `captureSessionToCofre` refuse the push.
 * That is the origin cross-check the field comparison only ever pretended to be. It is the same
 * function, with the same matcher, that the typist's capture path uses (`session-establishment.ts`),
 * so the two ways a session can enter the Cofre bind identically.
 *
 * IT TIGHTENS `card_login` TOO, deliberately. The declared rail had the same wide binding and was
 * merely less exposed by it (its item is minted LOCKED); a narrower binding is strictly better
 * there, and it leaves the GRANT as the only difference between the two errands.
 */
export async function acceptSessionPush(
  input: { requestId: string; pairingId: string; origin: string; storageState: unknown },
  now = Date.now(),
): Promise<CofreItemDoc> {
  sweep(now);
  const ceremony = ceremonies.get(input.requestId);
  if (!ceremony) throw new AttendedError('no ceremony is open for this request');
  if (ceremony.pairingId !== input.pairingId) {
    throw new AttendedError('the session was pushed by a different machine than the one asked');
  }
  if (!sameOrigin(ceremony.origin, input.origin)) {
    throw new AttendedError('the pushed session is for a different origin than the ceremony declared');
  }
  // One ceremony, one session. Consumed before the store write so a duplicate push cannot mint a
  // second item even if the first write is still in flight.
  ceremonies.delete(input.requestId);

  // NARROWED TO THE CEREMONY'S OWN ORIGIN, never to the jar. See the docblock: the jar is evidence
  // that a session for this portal exists, not a statement of what the session may be replayed
  // against. An empty answer means the login left nothing scoped to the portal we asked about, and
  // `captureSessionToCofre` refuses it below rather than minting an unusable or over-broad item.
  const origins = boundOriginsForEstablishedHost(input.storageState, ceremony.origin);
  const metadata: SessionMetadata = {
    // Established ON the machine, by a human at its card reader — that is the fact the router needs
    // at checkout (WS-I): a card-established session is not replayable from a datacenter egress.
    establishedBy: { kind: 'machine', pairingId: input.pairingId },
    boundEgress: { kind: 'residential', pairingId: input.pairingId },
    establishedAt: new Date(now).toISOString(),
    healthy: true,
  };
  // ONE CAPTURE INPUT, TWO ARMING STATES. The encryption, the origin binding and the owner scope are
  // the same call either way (`captureSessionWithGrant` IS `captureSessionToCofre` plus a grant), so
  // there is no second custody path here to get wrong - only the question of whether the item comes
  // back usable, which the requester answered when it opened the ceremony.
  const capture = { label: ceremony.label, boundOrigins: origins, storageState: input.storageState, metadata };
  const item = ceremony.grant
    ? (await captureSessionWithGrant(ceremony.actor, capture, { now: () => now }, { grant: ceremony.grant })).item
    : await captureSessionToCofre(ceremony.actor, capture, { now: () => now });
  await recordBridgeEvent(
    { userId: ceremony.actor.userId, orgId: ceremony.actor.orgId, username: '' },
    'bridge_session_pushed',
    { pairingId: input.pairingId, targetOrigin: ceremony.origin, itemCount: 1 },
    { now: () => now },
  ).catch(() => undefined);
  return item;
}

/** Host comparison, case-insensitive and scheme/port tolerant — the daemon reports what the browser
 *  landed on, which may carry a scheme where the request carried a bare host. */
function sameOrigin(a: string, b: string): boolean {
  return hostOf(a) === hostOf(b);
}

function hostOf(value: string): string {
  const trimmed = value.trim().toLowerCase();
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return trimmed;
  }
}

/** Test/boot helper. */
export function __resetCeremoniesForTests(): void {
  ceremonies.clear();
}

/** Test helper: open ceremony count. */
export function __openCeremonyCount(): number {
  return ceremonies.size;
}
