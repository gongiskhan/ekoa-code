/**
 * bridge/secret-delivery.ts — one-time credential delivery to a paired machine (Cofre J-3).
 *
 * THE ONE FRAME THAT CARRIES A VALUE. Everything else on this wire moves references, task
 * descriptions and results; `secret.deliver` is the single frame in the union carrying credential
 * material, and it exists because a `local_command` step runs on the USER'S machine, so the value
 * has to get there. J-4 resolved the environment; this delivers it.
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

/** How long an unredeemed delivery stays pending before it is swept (ms). A delivery that has not
 *  been sent within this window is a run that never got going; keeping it wastes nothing but it
 *  must not accumulate. */
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

function sweep(now: number): void {
  for (const [id, d] of pending) {
    if (now - d.createdAt > PENDING_TTL_MS) pending.delete(id);
  }
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
  const held = pending.get(input.invocationId);
  if (!held) {
    throw new SecretDeliveryError(
      `no delivery authorised for invocation ${input.invocationId} (already redeemed, expired, or never authorised)`,
    );
  }
  if (held.pairingId !== input.pairingId) {
    // The authorisation named a machine. Delivering to a different one would let a caller that can
    // influence the pairing id redirect a credential to another of the org's machines.
    throw new SecretDeliveryError(`delivery for invocation ${input.invocationId} is bound to another pairing`);
  }
  // Redeem FIRST — see the docblock. One shot, whatever happens next.
  pending.delete(input.invocationId);

  const { env, secrets, itemIds } = await resolveEnvInjection(actor, input.mapping, {
    processLabel: input.processLabel ?? 'local_command',
  });

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
}

/** Test helper: pending (authorised, unredeemed) delivery count. */
export function __pendingDeliveryCount(): number {
  return pending.size;
}
