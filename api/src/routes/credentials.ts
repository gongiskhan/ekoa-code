/**
 * Credentials router (F2; ch06 §6.2). ONE write-only, super-admin, audit-logged surface
 * that provisions the central model credential. No read route exists by design — the
 * secret is never echoed; `GET /health` `claudeAuth` is the only observable state.
 * Thin route: validate → one llm/ domain call → shape (ch02 §2.6).
 */
import { Router, type Response } from 'express';
import { CredentialSetRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { provisionCredential, claudeAuthStatus } from '../llm/index.js';
import { actorOf, parseBody } from './helpers.js';

export function credentialsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.post('/', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CredentialSetRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    await provisionCredential(
      { mode: body.mode, secret: body.secret, refreshToken: body.refreshToken, expiresAt: body.expiresAt },
      { userId: actor.userId, username: req.user!.username, orgId: actor.orgId },
      deps,
    );
    res.json({ ok: true, claudeAuth: claudeAuthStatus() });
  });

  return r;
}
