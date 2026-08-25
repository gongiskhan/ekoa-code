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
 * The outcome of asking a machine to finish its open ceremony NOW. A discriminated result rather
 * than a thrown error, because both refusals are ordinary states a person can act on, and the words
 * they are told belong to the route rather than here.
 */
export type CeremonyCaptureOutcome =
  | { requested: true; origin: string }
  | { requested: false; reason: 'no_open_ceremony' | 'unreachable' };

/**
 * "THE HUMAN PRESSED DONE" - relay a capture request to the machine holding an open ceremony
 * (docs/decisions.md 2026-08-25, D-CEREMONY-DONE).
 *
 * WHY THIS EXISTS. The ceremony's only completion signal was the human CLOSING the headed window,
 * and that window is raised by the OS on every top-level navigation - so during an OTP login the
 * person cannot hold focus on the app showing the code, and nothing on screen says that closing is
 * what captures. Measured live: the operator logged in, and the ceremony expired holding nothing
 * (findings, `attended-ceremony-browser-steals-focus-and-hides-its-capture-signal`).
 *
 * IT ADDS NO CUSTODY SURFACE, and that is the whole of the design. The capture that follows is the
 * unchanged one: the daemon snapshots the same `storageState` and pushes it on the same
 * `session.push` rail, and `acceptSessionPush` below binds it to the ceremony's own origin, mints it
 * under the ceremony's own actor and arms it with the grant the REQUESTER named when the ceremony
 * was opened. This function decides none of that - it delivers a frame naming a requestId.
 *
 * THE CEREMONY IS RESOLVED FROM THE CALLER AND NEVER NAMED BY THEM, and the second half follows from
 * the first: a client-supplied requestId would have to be checked against the ceremony's actor
 * anyway - or one user could finish another user's ceremony and bank the capture - so keying the
 * lookup on the actor REMOVES that check rather than passing it. It also means the Done button
 * survives a page reload, which a handle held in the browser would not.
 *
 * EVERY CANDIDATE IS SIGNALLED, AND THERE IS NO TIEBREAK - because both tiebreaks are wrong, each in
 * a different reachable flow (review round 2026-08-25, F3/F5).
 *
 * Cortex keeps one pending ceremony per REQUEST; the daemon holds at most one at a TIME and refuses
 * every later `attended.request` while a window is up. So this map can hold two ceremonies for one
 * actor + machine + origin, and which one the daemon is actually holding depends on how they came to
 * exist:
 *
 *   A DOUBLE OPEN over a LIVE window (the person alt-tabs back from the focus-stealing window and
 *   clicks "Abrir janela" again): the daemon refuses the second and keeps holding the FIRST, so
 *   newest-wins sends a requestId the daemon can never match.
 *
 *   A RETRY after a DEAD window (the first login was abandoned, closed, or refused - Google blocks
 *   this browser outright, see findings `google-sso-refuses-the-automated-ceremony-browser`): the
 *   daemon finished with the first and accepts the second, so it holds the NEWEST - while the first
 *   sits in this map, unswept, for the remainder of its 10-minute TTL. Oldest-wins sends that dead
 *   requestId, and does so for up to ten minutes on the "it did not work, try again" path.
 *
 * So a tiebreak trades one silent no-op for another. Instead the capture is relayed for EVERY open
 * ceremony of this caller, on this machine, for this origin, oldest first. The daemon finishes the
 * one it is actually holding and no-ops the rest - a property that is already enforced and
 * mutation-proven there (`handleCeremonyCapture` matches on requestId), so this fans out a signal
 * without widening what any single frame can do. It is not a broadcast: every requestId named is one
 * of this caller's own, for the origin they asked about, on the machine resolved from their actor.
 *
 * IT IS BOUNDED BY WHAT THE CALLER THEMSELVES OPENED inside one ceremony TTL, and it lands on their
 * own socket - each candidate already cost an `attended.request` to that same daemon when it was
 * created, so there is no amplification here the caller had not already produced. Hence no cap: a cap
 * would have to choose which candidates to drop, which is the tiebreak this stopped making.
 */
export async function requestCeremonyCapture(
  actor: Actor,
  input: { pairingId: string; origin: string },
  now = Date.now(),
): Promise<CeremonyCaptureOutcome> {
  sweep(now);
  const host = hostOf(input.origin);
  const candidates: PendingCeremony[] = [];
  for (const c of ceremonies.values()) {
    if (c.pairingId !== input.pairingId) continue;
    // OWNER SCOPE, both halves. `userId` is the authorization; `orgId` travels with it because every
    // other read on this rail is scoped to the pair (D-ADHOC-3), and a ceremony opened under a
    // different org membership is not this caller's to finish.
    if (c.actor.userId !== actor.userId || c.actor.orgId !== actor.orgId) continue;
    if (hostOf(c.origin) !== host) continue;
    candidates.push(c);
  }
  if (candidates.length === 0) return { requested: false, reason: 'no_open_ceremony' };
  // Oldest first, so the frame the daemon is most likely to be holding arrives before the ones it
  // will ignore. Ordering changes no outcome - the daemon matches on requestId, not on arrival - it
  // only keeps the machine's own log reading in the order the human's attempts happened.
  candidates.sort((a, b) => a.createdAt - b.createdAt);

  let sent = 0;
  for (const c of candidates) {
    if (sendToPairing(input.pairingId, { type: 'ceremony.capture', requestId: c.requestId })) sent += 1;
  }
  // A dead socket is a REFUSAL, exactly as it is when the ceremony is opened: the window is on a
  // machine this process can no longer speak to, and saying otherwise would leave the person waiting
  // for a capture nobody was asked to make.
  if (sent === 0) return { requested: false, reason: 'unreachable' };

  // THE CEREMONIES STAY OPEN. One is consumed by `acceptSessionPush` when the capture actually
  // arrives, so a Done that reaches a daemon which cannot complete it (an empty jar, a login the
  // human had not finished) leaves everything as it was: closing the window still captures, and
  // pressing Done again still works.
  const [oldest] = candidates as [PendingCeremony, ...PendingCeremony[]];
  await recordBridgeEvent(
    { userId: actor.userId, orgId: actor.orgId, username: '' },
    'bridge_ceremony_capture_requested',
    { pairingId: input.pairingId, attendedKind: oldest.kind, targetOrigin: oldest.origin },
    { now: () => now },
  ).catch(() => undefined);
  return { requested: true, origin: oldest.origin };
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
