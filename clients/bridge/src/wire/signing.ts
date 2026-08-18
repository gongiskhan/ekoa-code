/**
 * wire/signing.ts — the Cortex signature over a DelegatedTask binding (ch18 §18.2.6, §18.5.1
 * step 1). Cortex signs every delegated task; the daemon re-verifies the signature as the FIRST
 * step of its ordered check and rejects a forged task (S2). The signature is an HMAC-SHA256 over
 * the canonical serialisation of every task field EXCEPT `sig` (see canonicalTaskBinding) — so a
 * compromised or lying transport cannot tamper with the binding (org, user, session, pairingId,
 * grantRefs, budget, expiry, nonce) without invalidating the signature.
 *
 * Provenance: adapted 2026-07-10 from api/src/bridge/signing.ts (copy-with-review), back when this
 * daemon lived in its own repository. The one intentional deviation from that signer: the HMAC
 * secret is a PARAMETER here, not read from a config import (`loadConfig().jwtSecret`) — this
 * module stays free of the daemon's config wiring so it can be exercised in isolation and re-used
 * by both ends of a test. The canonical BYTES are no longer a copy at all: `canonicalTaskBinding`
 * is imported from `@ekoa/shared`, the same function the Cortex signer uses, so the two sides
 * cannot drift.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DelegatedTask } from '@ekoa/shared';
import { canonicalTaskBinding } from '@ekoa/shared';

/**
 * HMAC-SHA256 of the canonical binding, hex. `secret` is the platform JWT secret (parameter).
 *
 * Refuses an EMPTY secret loudly (throws). Upstream keys the HMAC with `loadConfig().jwtSecret`,
 * where `required('JWT_SECRET')` throws on an unset/empty value; parameterising the secret dropped
 * that guard, and `createHmac('sha256', '')` succeeds — so an empty secret would silently produce a
 * publicly-computable signature that verifies any forged task. Failing loud at the SIGN site keeps a
 * misconfiguration (`process.env.X ?? ''`) from becoming an auth bypass. (Flagged contract
 * correction vs upstream's config-level guard — see docs/decisions.md.)
 */
export function signDelegatedTask(
  task: Omit<DelegatedTask, 'sig'> & { sig?: string },
  secret: string,
): string {
  if (secret.length === 0) {
    throw new Error('signDelegatedTask: refusing an empty signing secret (misconfiguration)');
  }
  return createHmac('sha256', secret).update(canonicalTaskBinding(task)).digest('hex');
}

/**
 * Constant-time verification of a task's `sig` against `secret`. Returns false on any length or
 * format drift (forged / truncated / odd-length / non-hex) AND on any error computing the expected
 * signature — it NEVER throws. This is load-bearing: the daemon calls it as the first ordered S2
 * check on an untrusted, only-shape-validated task, and `BridgeFrame.safeParse` admits arbitrary
 * `passthrough` keys — including a non-finite number (`1e999` → Infinity) that `canonicalTaskBinding`
 * refuses. Computing the expected signature therefore happens INSIDE the try/catch: a crafted frame
 * yields a clean `false` (rejected + ledgered upstream), never a thrown exception that would crash
 * the daemon (remote DoS). An empty secret (signDelegatedTask throws) likewise fails closed here.
 */
export function verifyDelegatedTaskSig(task: DelegatedTask, secret: string): boolean {
  let a: Buffer;
  let b: Buffer;
  try {
    const expected = signDelegatedTask(task, secret);
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(task.sig, 'hex');
  } catch {
    return false;
  }
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
