/**
 * Server-side token revocation set (P-03, ch03 §3.2, ch09 §9.6). An in-memory map (jti →
 * expiry) backed by the persisted `revoked_tokens` collection: loaded at boot, checked by
 * the auth middleware on every request (O(1)), self-pruning on token expiry (both in the
 * in-memory map on access/sweep AND the persisted rows via the retention sweep). Correct
 * under FIXED-8 (single process). A deactivation pushes the user's tokens here in the same
 * operation.
 */
import { revokedTokens } from '../data/stores.js';

/** jti → epoch-seconds expiry. Pruning on expiry bounds memory (no unbounded growth). */
const set = new Map<string, number>();

/** Boot-load unexpired revoked tokens into the in-memory map. */
export async function loadRevocations(nowSec: number): Promise<void> {
  set.clear();
  const rows = await revokedTokens.find({});
  for (const r of rows) {
    const exp = r.expiresAt as number;
    if (exp > nowSec) set.set(r._id, exp);
  }
}

/** Is this jti revoked (and not yet expired)? Expired entries are pruned lazily on access. */
export function isRevoked(jti: string, nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  const exp = set.get(jti);
  if (exp === undefined) return false;
  if (exp <= nowSec) {
    set.delete(jti); // lazy prune — an expired token is already rejected by JWT exp anyway
    return false;
  }
  return true;
}

/** Revoke a token: add to the map AND persist (survives restart via the collection). */
export async function revoke(jti: string, userId: string, expiresAtSec: number, nowMs: number): Promise<void> {
  set.set(jti, expiresAtSec);
  await revokedTokens.insert({ _id: jti, userId, revokedAt: new Date(nowMs).toISOString(), expiresAt: expiresAtSec });
}

/** Sweep expired entries from the in-memory map and delete expired persisted rows (P-09). */
export async function pruneExpired(nowSec: number): Promise<number> {
  let n = 0;
  for (const [jti, exp] of set) {
    if (exp <= nowSec) {
      set.delete(jti);
      n++;
    }
  }
  await revokedTokens.deleteMany({ expiresAt: { $lte: nowSec } });
  return n;
}

export function __revocationSize(): number {
  return set.size;
}

export function __resetRevocationsForTests(): void {
  set.clear();
}
