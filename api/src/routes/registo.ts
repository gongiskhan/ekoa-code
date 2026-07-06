/**
 * Registo router (ch03 §3.8.24). Org-scoped activity READ, metadata-only. Persistence via
 * the platform-crud service (ch02 §2.7). org-admin reads own org; super-admin across orgs.
 */
import { Router, type Response } from 'express';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { readRegisto } from '../services/platform-crud.js';
import { actorOf } from './helpers.js';

export function registoRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth, requireRole('org-admin', 'super-admin'));

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const a = actorOf(req);
    const q = req.query as { userId?: string; type?: string; orgId?: string; limit?: string; offset?: string };
    const result = await readRegisto(a, req.user!.username, {
      userId: q.userId,
      type: q.type,
      orgId: q.orgId,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    }, deps);
    res.json(result);
  });

  return r;
}
