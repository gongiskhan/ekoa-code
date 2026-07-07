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
import { loadConfig } from '../config.js';

/** Deterministic JSON: object keys sorted recursively, arrays order-preserved. Two structurally
 *  equal bindings therefore serialise to byte-identical strings regardless of key insertion order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** The exact bytes signed: the whole task minus `sig`. Exported so the daemon computes the same. */
export function canonicalTaskBinding(task: Omit<DelegatedTask, 'sig'> & { sig?: string }): string {
  const binding = { ...task } as Record<string, unknown>;
  delete binding.sig;
  return stableStringify(binding);
}

/** HMAC-SHA256 of the canonical binding, hex. */
export function signDelegatedTask(task: Omit<DelegatedTask, 'sig'> & { sig?: string }): string {
  return createHmac('sha256', loadConfig().jwtSecret).update(canonicalTaskBinding(task)).digest('hex');
}

/** Constant-time verification of a task's `sig`. Returns false on any length/format/value drift. */
export function verifyDelegatedTaskSig(task: DelegatedTask): boolean {
  const expected = signDelegatedTask(task);
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
