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
 *  is revocable (P-03) — a token without a jti is a revocation bypass and is forbidden.
 *
 *  `iat` may be pinned by the caller (jsonwebtoken honours an explicit `iat` and derives `exp`
 *  from it). A fresh session minted right after a token-epoch bump MUST carry `iat >= epoch`,
 *  or the middleware's `iat < tokenEpoch` check rejects it: JWT `iat` has one-second
 *  granularity, so a re-login in the same second as a password change would otherwise 401
 *  (ch09 §9.6). Only the mint-after-credential-check sites pin it. */
export function signToken(
  claims: Omit<JwtClaims, 'exp' | 'jti'> & { jti?: string; iat?: number },
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
  // Legacy-window shim (H1 role rename `builder` → `user`). A JWT minted before the rename carries
  // role 'builder', which is no longer a valid Role. Normalise it HERE — the single verify
  // chokepoint every admission path (requireAuth, verifySseToken, and every ?token= consumer)
  // funnels through — so no downstream role/capability check ever sees the dead value. The boot
  // migration bumps each migrated user's token epoch, so such tokens are rejected at the admission
  // plane once the epoch lands and the user re-logs in; this shim only covers the window between
  // boot and that next login. Remove once the fleet has rotated its tokens.
  if ((decoded.role as string) === 'builder') decoded.role = 'user';
  return decoded as JwtClaims;
}
