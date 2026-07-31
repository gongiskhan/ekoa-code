/**
 * bridge/connect-nonce.ts — single-use enforcement for bridge connect tokens (Cofre J-2).
 *
 * THE HOLE THIS CLOSES. A bridge token is a 600-second bearer credential for one pairing, and
 * `attachLiveConnection` RETIRES the incumbent socket when a new one arrives for the same pairing
 * (that is the correct redial behaviour — a daemon that reconnects after a network blip must be
 * able to take its slot back). Together those two facts meant a captured token was not merely
 * replayable: replaying it EVICTED the real daemon and put the attacker's socket in its place, so
 * every subsequent `delegate` frame for that pairing — including the credential-bearing ones —
 * was delivered to the attacker. Ten minutes of exposure on a token that rides an Authorization
 * header through whatever proxies sit in front of the deployment.
 *
 * THE FIX. Every minted bridge token carries a `jti`, and a `jti` may be spent EXACTLY ONCE. The
 * first connect wins; the replay is refused with `token-replayed` and the live daemon keeps its
 * socket. This is safe against the shipped daemon by construction rather than by hope: the
 * counterpart's `BridgeSocket.connect()` calls `getToken()` immediately before EVERY dial and its
 * `auth/bridge-token.ts` performs a fresh HTTP mint with no caching, so a legitimate reconnect
 * always arrives with a `jti` that has never been seen. (Verified by reading
 * `../ekoa-bridge/src/transport/bridge-socket.ts` and `src/auth/bridge-token.ts`, not assumed.)
 *
 * RETENTION. An entry is kept until the token's own `exp` and no longer. That is exactly the
 * window in which a replay could succeed — past `exp`, `jwt.verify` rejects the token anyway, so a
 * retained nonce would be dead weight. It also bounds the store: at most the number of tokens
 * minted in one TTL window.
 *
 * IN-MEMORY IS DELIBERATE. Same single-process class as the live-socket map above it (FIXED-8,
 * ch09 §9.7.1): the thing being protected — the live WebSocket — is itself process-local, so a
 * nonce store on another instance would be guarding a socket it cannot see. If the API ever runs
 * multi-instance, the live map and this store move together, and neither works alone.
 */

/** jti -> the epoch-seconds `exp` of the token that carried it. */
const spent = new Map<string, number>();

/** Drop entries whose token has expired; they can no longer be replayed. */
function prune(nowSec: number): void {
  for (const [jti, exp] of spent) {
    if (exp <= nowSec) spent.delete(jti);
  }
}

/**
 * Spend a connect token's `jti`. Returns true when this is its FIRST use (the caller may proceed)
 * and false when it has already been spent (a replay — refuse the upgrade).
 *
 * A token with no `exp` is retained for `fallbackTtlSec`, so a malformed-but-verified token cannot
 * buy unlimited replays by omitting the claim.
 */
export function spendConnectNonce(jti: string, expSec: number | undefined, nowSec: number, fallbackTtlSec = 600): boolean {
  prune(nowSec);
  if (spent.has(jti)) return false;
  spent.set(jti, expSec ?? nowSec + fallbackTtlSec);
  return true;
}

/** Test/boot helper: forget every spent nonce. */
export function __resetConnectNoncesForTests(): void {
  spent.clear();
}

/** Test helper: how many nonces are currently retained (used to assert the store stays bounded). */
export function __spentNonceCount(): number {
  return spent.size;
}
