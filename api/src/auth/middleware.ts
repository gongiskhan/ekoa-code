/**
 * The auth middleware (ch03 §3.2, CONV-1) — the first of the three admission planes
 * (ch09 §9.7.1). Order: verify JWT → revocation check → activation check. A deactivated
 * account fails 403 ACCOUNT_DISABLED; a billing-locked account fails 402 BILLING_LOCKED;
 * these run on EVERY authenticated /api/v1 request (no route opts out).
 */
import type { Request, Response, NextFunction } from 'express';
import { ERROR_STATUS, type ErrorCode } from '@ekoa/shared';
import { verifyToken, type JwtClaims } from './jwt.js';
import { isRevoked } from './revocation.js';
import { getActivation } from '../data/activation.js';

export interface AuthedRequest extends Request {
  user?: JwtClaims;
}

function fail(res: Response, code: ErrorCode, message: string): void {
  res.status(ERROR_STATUS[code]).json({ error: { code, message } });
}

/** Bearer-JWT middleware for /api/v1 (except the closed exemption list). */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.header('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  let claims: JwtClaims;
  try {
    claims = verifyToken(m[1] as string);
  } catch (e) {
    const expired = e instanceof Error && e.name === 'TokenExpiredError';
    return fail(res, expired ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  }
  // A minted token ALWAYS carries a jti (jwt.ts). A token without one cannot be revoked,
  // so it is treated as invalid (a revocation bypass otherwise — ch09 §9.6, P-03).
  if (!claims.jti) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  if (isRevoked(claims.jti)) {
    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  }
  // Activation admission (write-through map; immediate, no TTL wait). Fail CLOSED on a
  // cache miss: an unknown subject is a stale/forged token, never treated as active.
  const act = getActivation(claims.sub);
  if (!act || !act.active) return fail(res, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.');
  // Token-epoch check: a token issued before the user's current epoch is invalid (its role/
  // active state is stale — e.g. an admin demoted after this token was minted). ch09 §9.6.
  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  }
  if (act.billingLocked) return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
  req.user = claims;
  next();
}

/** Role gate — use after requireAuth for org-admin / super-admin endpoints. */
export function requireRole(...roles: JwtClaims['role'][]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return fail(res, 'FORBIDDEN', 'Sem permissão.');
    }
    next();
  };
}
