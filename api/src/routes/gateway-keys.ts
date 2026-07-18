/**
 * Per-user gateway API keys router (S4a, run 20260717). Thin: validate -> call the
 * gateway-keys service -> shape. Self-service for any ACTIVE user (`auth: 'user'`): gateway
 * use bills the caller exactly like chat, so ownership scoping IS the authorization - the
 * owner is stamped server-side from the verified JWT, never from the body, and a foreign key
 * id answers uniform 404 (no cross-user existence oracle).
 */
import { Router, type Response } from 'express';
import { GatewayKeyMintRequest } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { mintGatewayKey, listGatewayKeys, revokeGatewayKey } from '../auth/gateway-keys-service.js';
import { notFound, parseBody } from './helpers.js';

/** The Registo actor from the verified JWT (logActivity needs a username, which the shared
 *  Actor type does not carry). */
function activityActorOf(req: AuthedRequest): { userId: string; username: string; orgId: string } {
  const u = req.user!;
  return { userId: u.sub, username: u.username ?? u.sub, orgId: u.orgId ?? '' };
}

export function gatewayKeysRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, GatewayKeyMintRequest, req.body) as { label: string } | undefined;
    if (!body) return;
    const minted = await mintGatewayKey(activityActorOf(req), body.label, deps);
    res.status(201).json(minted);
  });

  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listGatewayKeys(req.user!.sub) });
  });

  r.post('/:id/revoke', async (req: AuthedRequest, res: Response) => {
    const ok = await revokeGatewayKey(activityActorOf(req), req.params.id as string, deps);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  return r;
}
