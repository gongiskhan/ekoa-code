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
 * WHAT THIS MODULE REFUSES. A pushed session is credential-equivalent — it walks past the card as
 * well as the password — so it goes through `captureSessionToCofre` and nothing else: same
 * envelope, same `unwrap()` seam, same locks. And a push is only accepted against a ceremony THIS
 * process asked for, on the machine it asked, so a compromised or confused daemon cannot inject a
 * session for an origin nobody requested.
 */
import { randomUUID } from 'node:crypto';
import type { Actor, SessionMetadata } from '@ekoa/shared';
import { captureSessionToCofre, originsFromStorageState } from '../cofre/sessions.js';
import type { CofreItemDoc } from '../cofre/types.js';
import { sendToPairing } from './registry.js';
import { recordBridgeEvent } from './audit.js';

/** How long a ceremony stays open. A human is walking to a card reader, not making a round trip. */
const CEREMONY_TTL_MS = 10 * 60_000;

export type AttendedKind = 'card_login' | 'relay_code';

interface PendingCeremony {
  requestId: string;
  pairingId: string;
  kind: AttendedKind;
  origin: string;
  actor: Actor;
  label: string;
  createdAt: number;
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
  input: { pairingId: string; kind: AttendedKind; origin: string; reason: string; label: string },
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
 * Three refusals, each closing a different way this could go wrong:
 *  - an UNKNOWN requestId: a push for a ceremony this process never asked for;
 *  - a push arriving from a DIFFERENT pairing than the one asked: a machine answering for another;
 *  - an ORIGIN that does not match the ceremony's: the session for a portal nobody requested.
 *
 * The last one is the one worth dwelling on. Bound origins are derived from the cookies (WS-G), so
 * a mismatched push would produce a perfectly valid, correctly-encrypted, correctly-bound Cofre item
 * for the WRONG SITE — quietly usable later by anything that looks up a session by label.
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

  const origins = originsFromStorageState(input.storageState);
  const metadata: SessionMetadata = {
    // Established ON the machine, by a human at its card reader — that is the fact the router needs
    // at checkout (WS-I): a card-established session is not replayable from a datacenter egress.
    establishedBy: { kind: 'machine', pairingId: input.pairingId },
    boundEgress: { kind: 'residential', pairingId: input.pairingId },
    establishedAt: new Date(now).toISOString(),
    healthy: true,
  };
  const item = await captureSessionToCofre(
    ceremony.actor,
    { label: ceremony.label, boundOrigins: origins, storageState: input.storageState, metadata },
    { now: () => now },
  );
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
