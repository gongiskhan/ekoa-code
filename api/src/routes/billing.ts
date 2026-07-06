/**
 * Billing router — read surfaces (ch03 §3.8.21). Persistence via the `billing/` service
 * (ch02 §2.7). The metering write path + admin sub-routes land with the chokepoint (G7).
 */
import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { usageFor, historyFor } from '../billing/service.js';
import { actorOf } from './helpers.js';

export function billingRouter(_deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/usage', async (req: AuthedRequest, res: Response) => {
    res.json(await usageFor(actorOf(req).userId));
  });

  r.get('/history', async (req: AuthedRequest, res: Response) => {
    res.json(await historyFor(actorOf(req).userId));
  });

  return r;
}
