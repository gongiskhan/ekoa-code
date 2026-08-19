/**
 * bridge/secret-delivery.ts — one-time credential delivery to a paired machine (Cofre J-3).
 *
 * THE ONE FRAME THAT CARRIES A VALUE. Everything else on this wire moves references, task
 * descriptions and results; `secret.deliver` is the single frame in the union carrying credential
 * material, and it exists because a `local_command` step runs on the USER'S machine, so the value
 * has to get there. J-4 resolved the environment; this delivers it.
 *
 * THE AUTHORISATION QUESTION IS ASKED BEFORE THIS MODULE IS CALLED, NOT INSIDE IT. Whether the org
 * granted this capability on this machine (I-3) is `daemon-step-seam.ts`'s first statement, because
 * everything here is irreversible: the nonce is redeemed, the item is unwrapped, the plaintext goes
 * on the wire and a Registo "use" row is written. This module's own controls are single-use and
 * pairing-binding; it has never been, and must not become, the place tenancy is decided.
 *
 * SINGLE-USE IS ENFORCED ON BOTH SIDES, DELIBERATELY. The daemon is contractually required to hold
 * the payload in RAM, inject at execution time and zeroize — but "the other end promises to" is not
 * a control this side can verify, and a compromised or simply older daemon makes that promise
 * worthless. So Cortex enforces what Cortex can: a delivery nonce is minted here, bound to one
 * invocation, and REDEEMED here exactly once. A second delivery attempt for the same invocation
 * does not re-unwrap the credential and does not put a second copy of the value on the wire. The
 * daemon-side half (absent from `config.json`, absent from the ledger, zeroized after the child
 * exits) is a counterpart obligation, flagged in `docs/bridge-counterpart-changes.md`, and its test
 * lives in that repo — this module never claims to have proven it.
 *
 * WHAT IS NOT DELIVERED. The value is unwrapped only at the moment of delivery and is never
 * written to a step record, a Registo row, a log line or a delegation result. The `SecretRegistry`
 * that comes back from the resolution is returned to the caller so the child's stdout/stderr can be
 * filtered through it (H-1); a secret-bearing process whose output is unfiltered fails the second
 * half of I9, so the registry travels WITH the delivery rather than being left to the caller to
 * remember.
 */
import { randomUUID, randomBytes } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import { resolveEnvInjection, recordEnvInjectionUse, type EnvInjectionMap } from '../cofre/process-injection.js';
import type { SecretRegistry } from '../security/redaction.js';
import { sendToPairing } from './registry.js';
import { registerDeliveredSecrets } from './ingress-redaction.js';

/**
 * How long an authorisation stays redeemable before it is swept (ms).
 *
 * WHAT IS ACTUALLY HELD HERE, because it is easy to assume worse and easy to assume better. NOT a
 * credential: `deliverSecrets` redeems the entry BEFORE it unwraps anything, so no value ever
 * enters this map. What is held is a live, single-use PERMISSION to unwrap a Cofre item and put its
 * value on one machine's socket - and an unbounded permission is what this constant exists to
 * prevent.
 */
const PENDING_TTL_MS = 5 * 60_000;

interface PendingDelivery {
  invocationId: string;
  nonce: string;
  pairingId: string;
  createdAt: number;
}

/** invocationId -> the one delivery it is allowed. Process-local, like the live-socket map it
 *  rides on (FIXED-8): a delivery targets a socket in THIS process. */
const pending = new Map<string, PendingDelivery>();

/**
 * The one scheduled sweep, armed for the OLDEST entry's expiry.
 *
 * THE TTL HAD NO TRIGGER. `sweep()` was reachable only from `authoriseDelivery`, so an orphaned
 * authorisation expired if and only if another delivery happened to be authorised afterwards - on a
 * quiet fleet, never - and `deliverSecrets` never compared `createdAt` to anything, so a days-old
 * authorisation redeemed exactly like a fresh one. Orphans are not contrived: the pairing-mismatch
 * refusal below throws BEFORE the redeem, and any failure between authorising and delivering leaves
 * one behind.
 *
 * A TIMER RATHER THAN ONLY A SOCKET EVENT, and both rather than either. The socket hook
 * (`dropPendingDeliveriesForPairing`) is exact and immediate, but it fires only when a machine
 * actually disconnects - one that stays connected for days would keep its orphans for days. The
 * timer bounds the lifetime with no dependence on traffic or on anything else happening at all. It
 * is UNREF'd, because a five-minute handle that kept Node alive would turn one idle authorisation
 * into a hung shutdown, and it is armed only while the map is non-empty, so an idle process
 * schedules nothing.
 *
 * The redemption path sweeps as well, so expiry is enforced by COMPARISON and not by a timer having
 * fired punctually. A control that depends on a timer's punctuality is not a control.
 */
let sweepTimer: ReturnType<typeof setTimeout> | null = null;

function cancelSweep(): void {
  if (sweepTimer === null) return;
  clearTimeout(sweepTimer);
  sweepTimer = null;
}

/** Arm the sweep for the oldest entry's expiry, or cancel it when nothing is pending. */
function rescheduleSweep(now: number): void {
  cancelSweep();
  let oldest = Number.POSITIVE_INFINITY;
  for (const d of pending.values()) if (d.createdAt < oldest) oldest = d.createdAt;
  if (!Number.isFinite(oldest)) return;
  const timer = setTimeout(() => {
    sweepTimer = null;
    sweep(Date.now());
  }, Math.max(0, oldest + PENDING_TTL_MS - now));
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
  sweepTimer = timer;
}

function sweep(now: number): void {
  for (const [id, d] of pending) {
    if (now - d.createdAt > PENDING_TTL_MS) pending.delete(id);
  }
  rescheduleSweep(now);
}

/**
 * Drop every pending authorisation for a machine - its socket is gone. The bridge server calls this
 * from the same `close` handler that releases the ingress registry and fails in-flight invocations.
 *
 * A delivery targets a LIVE SOCKET in this process, so once the socket is gone the authorisation
 * can only ever be redeemed into a refusal. Dropping it immediately is the honest bookkeeping, and
 * it stops a disconnected machine's orphans from waiting out the whole TTL.
 */
export function dropPendingDeliveriesForPairing(pairingId: string, now = Date.now()): void {
  for (const [id, d] of pending) {
    if (d.pairingId === pairingId) pending.delete(id);
  }
  rescheduleSweep(now);
}

export class SecretDeliveryError extends Error {
  readonly code = 'SECRET_DELIVERY_REFUSED';
  constructor(message: string) {
    super(message);
    this.name = 'SecretDeliveryError';
  }
}

/**
 * Authorise ONE delivery for an invocation. Returns the nonce the eventual frame will carry.
 * Calling twice for the same invocationId is refused: two nonces for one invocation would mean two
 * legitimate copies of the value on the wire, which is the property this whole module exists to
 * prevent.
 */
export function authoriseDelivery(invocationId: string, pairingId: string, now = Date.now()): string {
  sweep(now);
  if (pending.has(invocationId)) {
    throw new SecretDeliveryError(`invocation ${invocationId} already has a delivery authorised`);
  }
  const nonce = randomBytes(24).toString('base64url');
  pending.set(invocationId, { invocationId, nonce, pairingId, createdAt: now });
  rescheduleSweep(now);
  return nonce;
}

export interface DeliveryOutcome {
  /** The nonce the frame carried — the daemon echoes it so a result can be joined to a delivery. */
  nonce: string;
  /** Filter for the child's output. See the module docblock: it travels with the delivery. */
  secrets: SecretRegistry;
  /** Cofre item ids delivered, for the Registo row. Ids only — never values. */
  itemIds: string[];
}

/**
 * Resolve the declared credentials and deliver them to the pairing's live socket, exactly once.
 *
 * ORDER MATTERS. The nonce is redeemed BEFORE the credential is unwrapped: if redemption fails
 * (a replay) the unwrap never happens, so a replayed delivery cannot even cause a decrypt, let
 * alone a send. And the send failing is a REFUSAL, not a silent partial success — a caller that
 * believes the child has its credentials when the frame never left would produce an
 * authentication failure on the user's machine with no explanation anywhere.
 */
export async function deliverSecrets(
  actor: Actor,
  input: { invocationId: string; pairingId: string; mapping: EnvInjectionMap; processLabel?: string },
  now = Date.now(),
): Promise<DeliveryOutcome> {
  // Expire by COMPARISON, before the lookup. The scheduled sweep is a cleanup, not the control:
  // a stale authorisation must be unredeemable whether or not a timer got to it first.
  sweep(now);

  const held = pending.get(input.invocationId);
  if (!held) {
    throw new SecretDeliveryError(
      `no delivery authorised for invocation ${input.invocationId} (already redeemed, expired, or never authorised)`,
    );
  }
  // Redeem FIRST - see the docblock. One shot, whatever happens next, INCLUDING the pairing
  // mismatch below: a refusal that left the authorisation live handed a caller who can influence
  // the pairing id an unlimited number of attempts, and left an orphan behind on every one.
  pending.delete(input.invocationId);
  rescheduleSweep(now);
  if (held.pairingId !== input.pairingId) {
    // The authorisation named a machine. Delivering to a different one would let a caller that can
    // influence the pairing id redirect a credential to another of the org's machines.
    throw new SecretDeliveryError(`delivery for invocation ${input.invocationId} is bound to another pairing`);
  }

  const { env, secrets, itemIds } = await resolveEnvInjection(actor, input.mapping, {
    processLabel: input.processLabel ?? 'local_command',
  });

  // H-4: arm the ingress filter BEFORE the value is on the wire. Registering after the send would
  // leave a window in which a fast machine could echo the secret back into an unfiltered frame.
  registerDeliveredSecrets(input.pairingId, Object.values(env));

  const sent = sendToPairing(input.pairingId, {
    type: 'secret.deliver',
    invocationId: input.invocationId,
    nonce: held.nonce,
    env,
  });
  if (!sent) {
    throw new SecretDeliveryError(`pairing ${input.pairingId} is not reachable; secrets were not delivered`);
  }

  await recordEnvInjectionUse(actor, itemIds, `bridge:${input.pairingId}`, now);
  return { nonce: held.nonce, secrets, itemIds };
}

/** A fresh invocation id for a delivery-bearing step. */
export function newInvocationId(): string {
  return randomUUID();
}

/** Test/boot helper. */
export function __resetDeliveriesForTests(): void {
  pending.clear();
  cancelSweep();
}

/** Test helper: pending (authorised, unredeemed) delivery count. */
export function __pendingDeliveryCount(): number {
  return pending.size;
}

/** Test helper: the armed sweep handle, so a suite can assert it is unref'd rather than trust it. */
export function __pendingSweepTimerForTests(): ReturnType<typeof setTimeout> | null {
  return sweepTimer;
}
