/**
 * streaming/auth.ts — short-TTL canvas token mint + verify (ch03 §3.7 carve-out, B17 port).
 *
 * The token rides the automation run's `streaming_available` SSE event ({ token, wsUrl,
 * viewport }, ch03 §3.6.3) and authenticates the WebSocket upgrade — it is the ONLY auth on
 * the media channel (no JSON API payload ever crosses it). It is a distinct, short-lived JWT
 * bound to { userId, traceId }, signed with the same secret as session tokens but NEVER a
 * session token itself. Per module-map §2.6, streaming/ imports config.ts only.
 */
import { randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { loadConfig } from '../config.js';

const TOKEN_TTL_SECONDS = parseInt(process.env.EKOA_STREAMING_TOKEN_TTL_SECONDS || '600', 10);

/**
 * TOKEN-CLASS SEPARATION (Cofre F-1). The canvas token is signed with the SAME secret as platform
 * session tokens, and before this marker existed it carried nothing to distinguish it: `sub` and
 * `jti` were present, `aud` was absent, so `auth/jwt.ts` `verifyToken` — whose class guard only
 * knew about `ekoa-bridge` — ACCEPTED it. A leaked 600-second canvas token was therefore a platform
 * bearer token for every route that authorizes on `req.user.sub` alone (gateway-key mint, the
 * bridge token endpoint, the Cofre item routes), because `role`/`orgId` come back undefined and
 * those routes never consult them. Verified empirically before this was written, not inferred.
 *
 * The audience makes the class explicit in both directions: minted here, required here, and
 * REFUSED by the platform verifier.
 */
export const CANVAS_AUDIENCE = 'ekoa-canvas';

export interface StreamTokenClaims {
  sub: string;
  traceId: string;
  jti: string;
  iat: number;
  exp: number;
}

export function signStreamToken(payload: { userId: string; traceId: string }): string {
  const opts: SignOptions = { expiresIn: TOKEN_TTL_SECONDS, jwtid: randomUUID(), audience: CANVAS_AUDIENCE };
  return jwt.sign(
    { sub: payload.userId, traceId: payload.traceId },
    loadConfig().jwtSecret,
    opts,
  );
}

/**
 * Single-use enforcement (close-code 4000 = never reconnect, landmine 8): a token is CONSUMED on
 * its first successful upgrade. Any later upgrade with the same token — a displaced client
 * reconnecting after a 4000 takeover, or a replay of a leaked short-TTL token — is rejected. A
 * legitimate new viewer takes over with a FRESH token minted by the next `streaming_available`
 * event. The map self-prunes on read (entries expire with the token TTL).
 */
const consumedJtis = new Map<string, number>();

export function consumeStreamToken(jti: string, expUnixSeconds: number): boolean {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [k, exp] of consumedJtis) if (exp <= nowSec) consumedJtis.delete(k);
  if (consumedJtis.has(jti)) return false; // already used → replay/reconnect rejected
  consumedJtis.set(jti, expUnixSeconds || nowSec + TOKEN_TTL_SECONDS);
  return true;
}

/** Test-only: clear the consumed-token registry. */
export function __resetConsumedStreamTokensForTests(): void {
  consumedJtis.clear();
}

export type StreamAuthFailure =
  | { ok: false; reason: 'jwt-invalid' }
  | { ok: false; reason: 'jwt-missing' }
  | { ok: false; reason: 'trace-mismatch' };
const MISSING_JTI = '';

export type StreamAuthSuccess = { ok: true; claims: StreamTokenClaims };

export function verifyStreamToken(token: string | undefined, expectedTraceId: string): StreamAuthSuccess | StreamAuthFailure {
  if (!token) return { ok: false, reason: 'jwt-missing' };
  let decoded: jwt.JwtPayload;
  try {
    // `audience` makes jwt.verify reject any token that is not canvas-class — so a platform
    // session token presented on the media channel fails here, the mirror of the platform
    // verifier's refusal of this one.
    const result = jwt.verify(token, loadConfig().jwtSecret, { audience: CANVAS_AUDIENCE });
    if (typeof result === 'string') return { ok: false, reason: 'jwt-invalid' };
    decoded = result;
  } catch {
    return { ok: false, reason: 'jwt-invalid' };
  }
  const sub = decoded.sub;
  const traceId = decoded.traceId;
  if (typeof sub !== 'string' || typeof traceId !== 'string') {
    return { ok: false, reason: 'jwt-invalid' };
  }
  if (traceId !== expectedTraceId) {
    return { ok: false, reason: 'trace-mismatch' };
  }
  return {
    ok: true,
    claims: {
      sub,
      traceId,
      jti: typeof decoded.jti === 'string' ? decoded.jti : MISSING_JTI,
      iat: typeof decoded.iat === 'number' ? decoded.iat : 0,
      exp: typeof decoded.exp === 'number' ? decoded.exp : 0,
    },
  };
}

export function tokenTtlSeconds(): number {
  return TOKEN_TTL_SECONDS;
}
