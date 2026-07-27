/**
 * routes/cofre.ts — the Cofre's REST surface (Cofre WS-B B-3).
 *
 * Thin by design: validate -> call the domain module -> shape. Every authorization decision lives
 * in `api/src/cofre/`, not here, so there is exactly one place to audit and one place for WS-K and
 * the parked passkey-PRF lock to install behind.
 *
 * OWNERSHIP SCOPING IS THE AUTHORIZATION, exactly as it is for gateway keys: the owner is stamped
 * server-side from the verified JWT and never read from the body, and an item belonging to anyone
 * else answers a uniform 404 rather than a 403 — a 403 would confirm the item exists.
 *
 * The VALUE is write-only across this whole surface. It is accepted on create and returned by
 * nothing; the response to a create is the item VIEW, which has no value field at the contract
 * layer. Unlike a gateway key there is no show-once secret, because the user already HAS this
 * credential — the Cofre is storing it, not generating it.
 */
import { Router, type Response } from 'express';
import { CofreItemCreateRequest, GrantRequest } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  mintCofreItem,
  issueGrant,
  listCofreItems,
  lockItem,
  lockAll,
  deleteCofreItem,
  recordCofreEvent,
} from '../cofre/index.js';
import { notFound, parseBody, sendError } from './helpers.js';
import type { Actor } from '@ekoa/shared';

function actorOf(req: AuthedRequest): Actor {
  const u = req.user!;
  return { userId: u.sub, orgId: u.orgId ?? '', role: u.role } as Actor;
}

function auditActorOf(req: AuthedRequest): { userId: string; username: string; orgId: string } {
  const u = req.user!;
  return { userId: u.sub, username: u.username ?? u.sub, orgId: u.orgId ?? '' };
}

export function cofreRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/items', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listCofreItems(actorOf(req), deps.now()) });
  });

  r.post('/items', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CofreItemCreateRequest, req.body);
    if (!body) return;
    try {
      const item = await mintCofreItem(actorOf(req), body, deps);
      const [view] = await listCofreItems(actorOf(req), deps.now());
      res.status(201).json(view ?? { id: item._id });
    } catch (err) {
      // A missing origin binding is a 422, not a 500: it is a well-formed request the policy
      // refuses, and the message names the reason so the UI can render it.
      return sendError(res, 'VALIDATION_FAILED', err instanceof Error ? err.message : 'invalid item');
    }
  });

  r.delete('/items/:id', async (req: AuthedRequest, res: Response) => {
    const ok = await deleteCofreItem(actorOf(req), req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  r.post('/items/:id/grants', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, GrantRequest, req.body);
    if (!body) return;
    const itemId = req.params.id as string;
    try {
      const grant = await issueGrant(actorOf(req), itemId, body.duration, {}, deps);
      await recordCofreEvent(auditActorOf(req), 'cofre_grant_issued', { itemId, scope: grant.scope, duration: body.duration }, deps);
      res.json({ ok: true, scope: grant.scope, ...(grant.expiresAt ? { expiresAt: grant.expiresAt } : {}) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'grant refused';
      if (message.includes('not found')) return notFound(res);
      // I7 refusals land here: a TTL on a signature identity is a 422 the UI must surface, never a
      // silent downgrade to `this_run`.
      return sendError(res, 'VALIDATION_FAILED', message);
    }
  });

  r.post('/items/:id/lock', async (req: AuthedRequest, res: Response) => {
    const itemId = req.params.id as string;
    const revoked = await lockItem(actorOf(req), itemId, deps.now());
    await recordCofreEvent(auditActorOf(req), 'cofre_lock_now', { itemId }, deps);
    res.json({ ok: true, revoked });
  });

  r.post('/lock-all', async (req: AuthedRequest, res: Response) => {
    const revoked = await lockAll(actorOf(req), deps.now());
    await recordCofreEvent(auditActorOf(req), 'cofre_lock_all', { itemCount: revoked }, deps);
    res.json({ ok: true, revoked });
  });

  return r;
}
