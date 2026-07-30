/**
 * `user-or-key` admission (slice E1): capability routes accept EITHER a platform JWT or a
 * per-user gateway key (`ekoa_gk_…`). Anything that is not a gateway-key Bearer delegates to
 * requireAuth untouched, so the JWT path is byte-identical. The key path fails CLOSED:
 * verifyGatewayKey verdicts map unknown/revoked/inactive → 401 (one uniform message — never a
 * key-state oracle) and billing_locked → 402. A key carries NO role, so the CURRENT role is
 * read from the users store on every call (missing/inactive owner → 401 — a key never outlives
 * or outranks its user) and req.user is synthesized actorOf()-compatible. Key principals ONLY
 * then pass the separate per-key capability window (429); JWT sessions are never counted there.
 */
import type { Response, NextFunction } from 'express';
import { ERROR_STATUS, type ErrorCode } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from './middleware.js';
import { verifyGatewayKey, GATEWAY_KEY_PREFIX } from './gateway-keys-service.js';
import { admitCapabilityCall } from './api-key-rate.js';
import { users } from '../data/stores.js';

/** Audit marker (res.locals.apiKeyPrincipal): present ONLY on key-admitted requests. */
export interface ApiKeyPrincipal {
  keyId: string;
  xClient?: string;
}

function fail(res: Response, code: ErrorCode, message: string): void {
  res.status(ERROR_STATUS[code]).json({ error: { code, message } });
}

/** Bearer-JWT or gateway-key middleware for `user-or-key` capability routes. */
export function requireUserOrApiKey(req: AuthedRequest, res: Response, next: NextFunction): void {
  const m = /^Bearer\s+(.+)$/i.exec(req.header('authorization') ?? '');
  const secret = m?.[1];
  if (!secret || !secret.startsWith(GATEWAY_KEY_PREFIX)) return requireAuth(req, res, next);
  void admitApiKey(secret, req, res, next).catch(() => {
    // An unexpected store/verify failure must never fall through open.
    if (!res.headersSent) fail(res, 'INTERNAL', 'Erro interno.');
  });
}

async function admitApiKey(secret: string, req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const verdict = await verifyGatewayKey(secret);
  if (!verdict.ok) {
    if (verdict.reason === 'billing_locked') {
      return fail(res, 'BILLING_LOCKED', 'A sua conta tem um problema de faturação. Contacte o suporte.');
    }
    return fail(res, 'UNAUTHENTICATED', 'Chave de API inválida.');
  }
  // ONE store read: the key stores no role, and a snapshot would let a demoted admin keep
  // admin reach through an old key. The live doc is authoritative for role AND org.
  const owner = await users.get(verdict.userId);
  if (!owner || !owner.active) return fail(res, 'UNAUTHENTICATED', 'Chave de API inválida.');
  req.user = {
    sub: verdict.userId,
    role: owner.role,
    scope: 'user',
    orgId: owner.orgId,
    username: verdict.username,
    // Synthetic — there is no token to revoke on this path; revocation is the key doc itself.
    jti: `gk:${verdict.keyId}`,
  };
  const xClient = req.header('x-client');
  const principal: ApiKeyPrincipal = { keyId: verdict.keyId, ...(xClient ? { xClient } : {}) };
  res.locals.apiKeyPrincipal = principal;
  const rate = admitCapabilityCall({ keyId: verdict.keyId, billeeUserId: verdict.userId, orgId: owner.orgId });
  if (!rate.ok) return fail(res, 'RATE_LIMITED', 'Limite de chamadas da chave excedido. Tente novamente em breve.');
  next();
}
