/**
 * The activation cache (ch09 §9.7.1, Amendment 2). An in-memory map with write-through
 * invalidation: a `PATCH /users/:id { active }` write updates this map synchronously in
 * the same operation, so deactivation is effective immediately with NO TTL wait. Sound
 * under FIXED-8 (single process): the in-memory map is authoritative for the running process.
 * The three admission planes (auth middleware, served-app plane, bridge plane) all consult
 * this one map. Two gated facts: `active` and an account-level billing lock.
 */
export interface ActivationState {
  active: boolean;
  billingLocked: boolean;
  /** Tokens issued before this epoch (unix seconds) are invalid. Bumped on deactivation and
   *  on role change, so those changes revoke ALL of the user's outstanding tokens at once —
   *  a demoted admin cannot keep a stale privileged JWT (ch09 §9.6, no per-user jti index). */
  tokenEpoch: number;
}

const map = new Map<string, ActivationState>();

/** Boot-load the map from the users store (called at boot; TTL refresh is a safety net only). */
export function loadActivation(entries: Array<{ userId: string; active: boolean; billingLocked?: boolean; tokenEpoch?: number }>): void {
  map.clear();
  for (const e of entries) map.set(e.userId, { active: e.active, billingLocked: e.billingLocked ?? false, tokenEpoch: e.tokenEpoch ?? 0 });
}

/** Bump the user's token epoch to `epochSec`, invalidating every token issued earlier. */
export function bumpTokenEpoch(userId: string, epochSec: number): void {
  const cur = map.get(userId) ?? { active: true, billingLocked: false, tokenEpoch: 0 };
  map.set(userId, { ...cur, tokenEpoch: epochSec });
}

/** Write-through: called in the SAME operation as the store write for `active`/billing lock.
 *  `tokenEpoch` is preserved from the existing entry unless explicitly provided. */
export function setActivation(userId: string, state: { active: boolean; billingLocked: boolean; tokenEpoch?: number }): void {
  const prev = map.get(userId);
  map.set(userId, { active: state.active, billingLocked: state.billingLocked, tokenEpoch: state.tokenEpoch ?? prev?.tokenEpoch ?? 0 });
}

/**
 * Consult the cache. Returns `undefined` for an unknown user — the map is boot-loaded with
 * EVERY user and every creation is write-through, so a miss means the subject is not a
 * current user (a stale or forged token). Callers fail CLOSED on a miss (never fail-open:
 * an unknown subject must not be treated as active, or a deactivation lost from the cache
 * would reopen access — ch09 §9.7.1, the map is authoritative for the running process).
 */
export function getActivation(userId: string): ActivationState | undefined {
  return map.get(userId);
}

export function __resetActivationForTests(): void {
  map.clear();
}
