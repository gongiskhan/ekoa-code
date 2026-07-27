/**
 * bridge/signing.ts — the Cortex signature over a DelegatedTask binding (ch18 §18.2.6, §18.5.1
 * step 1). Cortex signs every delegated task; the daemon re-verifies the signature as the FIRST
 * step of its ordered check and rejects a forged task (S2). The signature is an HMAC-SHA256 over
 * a canonical serialisation of every task field EXCEPT `sig`, keyed by the platform JWT secret —
 * so a compromised or lying transport cannot tamper with the binding (org, user, session,
 * pairingId, grantRefs, budget, expiry, nonce) without invalidating the signature.
 *
 * This signer is part of the wire contract: the fake-daemon harness (and later the real daemon)
 * imports `verifyDelegatedTaskSig` / `canonicalTaskBinding` so both ends compute the SAME bytes
 * (§18.1 — kept in lockstep). A divergence in canonicalisation is a wire bug, not a policy choice.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DelegatedTask } from '@ekoa/shared';
// The canonical binding lives in the FROZEN shared contract so the Cortex signer and the daemon
// verifier compute byte-identical bytes without importing each other (§18.1 — single wire source).
import { canonicalTaskBinding } from '@ekoa/shared';

export { canonicalTaskBinding };

/**
 * HMAC-SHA256 of the canonical binding, hex.
 *
 * Refuses an EMPTY secret loudly. `createHmac('sha256','')` succeeds, so an empty secret would
 * silently produce a publicly-computable signature that verifies any forged task — failing loud at
 * the SIGN site keeps a misconfiguration from becoming an auth bypass. (Carried verbatim from the
 * daemon's vendored signer, which hardened this first.)
 */
export function signDelegatedTask(task: Omit<DelegatedTask, 'sig'> & { sig?: string }, secret: string): string {
  if (secret.length === 0) {
    throw new Error('signDelegatedTask: refusing an empty signing secret (misconfiguration)');
  }
  return createHmac('sha256', secret).update(canonicalTaskBinding(task)).digest('hex');
}

/** Constant-time verification of a task's `sig`. Returns false on any length/format/value drift. */
export function verifyDelegatedTaskSig(task: DelegatedTask, secret: string): boolean {
  if (secret.length === 0) return false;
  const expected = signDelegatedTask(task, secret);
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(task.sig, 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
