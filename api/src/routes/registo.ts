/**
 * Registo router (ch03 §3.8.24). Org-scoped activity READ, metadata-only. Persistence via
 * the platform-crud service (ch02 §2.7). org-admin reads own org; super-admin across orgs.
 */
import { Router, type Response } from 'express';
import type { MaskingSummaryResponse } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { readRegisto, maskingSummary } from '../services/platform-crud.js';
import { actorOf } from './helpers.js';

export function registoRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  // FC-408 (run s5): the caller's OWN masking-activity aggregate — a per-user surface (the
  // settings privacy page), so it registers BEFORE the org-admin gate below with its own
  // requireAuth. Metadata only: classes and counts, never bodies, never the vault (§17.6).
  r.get('/masking-summary', requireAuth, async (req: AuthedRequest, res: Response) => {
    const payload: MaskingSummaryResponse = await maskingSummary(actorOf(req));
    res.json(payload);
  });

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
