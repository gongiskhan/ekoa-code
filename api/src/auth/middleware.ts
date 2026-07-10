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
  // cache miss, but as UNAUTHENTICATED: an unknown subject is a stale/forged token
  // (deleted user, reset store), not a deactivated account. §3.3 reserves ACCOUNT_DISABLED
  // for active=false; a 401 lets clients end the dead session instead of showing the
  // blocked-account state for a user that no longer exists.
  const act = getActivation(claims.sub);
  if (!act) return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  if (!act.active) return fail(res, 'ACCOUNT_DISABLED', 'A sua conta está bloqueada. Contacte o suporte.');
  // Token-epoch check: a token issued before the user's current epoch is invalid (its role/
  // active state is stale — e.g. an admin demoted after this token was minted). ch09 §9.6.
  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) {
    return fail(res, 'UNAUTHENTICATED', 'Sessão expirada. Inicie sessão novamente.');
  }
  if (act.billingLocked) return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
  req.user = claims;
  next();
}

/** Token-query auth for the four SSE endpoints (CONV-1: EventSource cannot set headers).
 *  Verifies the ?token=, revocation, and activation. Returns the claims or an error code. */
export function verifySseToken(token: string | undefined): { ok: true; claims: JwtClaims } | { ok: false; status: number; code: ErrorCode } {
  if (!token) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  let claims: JwtClaims;
  try {
    claims = verifyToken(token);
  } catch {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  }
  if (!claims.jti || isRevoked(claims.jti)) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  const act = getActivation(claims.sub);
  if (!act) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  if (!act.active) return { ok: false, status: 403, code: 'ACCOUNT_DISABLED' };
  if (claims.iat !== undefined && claims.iat < act.tokenEpoch) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  return { ok: true, claims };
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
