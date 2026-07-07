/**
 * JWT sign/verify (ch03 §3.2, CONV-1). Single mint point. Claim set is
 * `{ sub, role, scope, orgId, username }` (Amendment 2 — orgId replaces companyId).
 */
import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { loadConfig } from '../config.js';
import type { Role } from '@ekoa/shared';

export interface JwtClaims {
  sub: string;
  role: Role;
  scope: string;
  orgId: string;
  username: string;
  /** ALWAYS present on a minted token — the revocation key (P-03). A token lacking a jti
   *  cannot be revoked and is treated as invalid by the middleware. */
  jti: string;
  exp?: number;
  iat?: number;
}

/** Mint a token. A `jti` is ALWAYS set (generated if the caller omits it) so every token
 *  is revocable (P-03) — a token without a jti is a revocation bypass and is forbidden. */
export function signToken(
  claims: Omit<JwtClaims, 'exp' | 'iat' | 'jti'> & { jti?: string },
  rememberMe = false,
): { token: string; expiresIn: number; jti: string } {
  const expiresIn = rememberMe ? 30 * 24 * 3600 : 24 * 3600; // 30d / 24h (ch03 §3.2)
  const jti = claims.jti ?? randomUUID();
  const token = jwt.sign({ ...claims, jti }, loadConfig().jwtSecret, { expiresIn });
  return { token, expiresIn, jti };
}

/** Verify a token. jsonwebtoken rejects alg:none and tampered signatures by default;
 *  we additionally require HS256 explicitly so an attacker cannot downgrade the alg.
 *
 *  Token-class separation (ch18 §18.3.6, ch09 §9.2): the platform verifier positively REJECTS
 *  bridge tokens. Platform JWTs and bridge tokens are two classes over ONE secret, never
 *  interchangeable — a bridge token carries `aud: ekoa-bridge` and a `pairingId`/`connectionId`
 *  claim, none of which a minted platform token ever has, so any token bearing them is a bridge
 *  token presented on the wrong plane and is refused. This is an anti-replay/anti-misconfiguration
 *  defence: a stolen bridge token cannot call the platform API. (The bridge verifier rejects
 *  platform tokens symmetrically — bridge/token.ts readBridgeToken.) */
export function verifyToken(token: string): JwtClaims {
  const decoded = jwt.verify(token, loadConfig().jwtSecret, { algorithms: ['HS256'] }) as JwtClaims & {
    aud?: unknown;
    pairingId?: unknown;
    connectionId?: unknown;
  };
  if (decoded.aud === 'ekoa-bridge' || decoded.pairingId !== undefined || decoded.connectionId !== undefined) {
    throw new Error('bridge token presented on the platform verifier (token-class separation, ch18 §18.3.6)');
  }
  return decoded as JwtClaims;
}
