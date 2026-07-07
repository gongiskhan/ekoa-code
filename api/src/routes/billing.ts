/**
 * Billing router (ch03 §3.8.21, ch06 §6.6). Thin routes: validate → one billing/ service call →
 * shape. Persistence via the `billing/` service (routes/ never touches data/ — ch02 §2.7). The
 * metering WRITE path is the chokepoint's (llm/ → billing tracker), not a route. Admin routes are
 * super-admin gated (§6.6.2).
 */
import { Router, type Response } from 'express';
import {
  PurchaseCreditsRequest,
  ToggleOverageRequest,
  AdminGlobalOverageRequest,
  AdminSetLimitRequest,
} from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import {
  usageFor,
  historyFor,
  breakdownFor,
  addCredits,
  setOverage,
  setGlobalOverage,
  adminListUsage,
  adminResetUsage,
  adminSetLimit,
} from '../billing/service.js';
import { actorOf, parseBody, sendError } from './helpers.js';

export function billingRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);
  const superAdmin = requireRole('super-admin');

  // ---- User surfaces ----
  r.get('/usage', async (req: AuthedRequest, res: Response) => {
    res.json(await usageFor(actorOf(req).userId, deps.now()));
  });

  r.get('/history', async (req: AuthedRequest, res: Response) => {
    const limit = intQuery(req.query.limit);
    const offset = intQuery(req.query.offset);
    res.json(await historyFor(actorOf(req).userId, { limit, offset }));
  });

  r.post('/credits', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, PurchaseCreditsRequest, req.body);
    if (!body) return;
    if (!(body.amountUsd > 0) || !Number.isFinite(body.amountUsd)) {
      return sendError(res, 'VALIDATION_FAILED', 'Montante inválido.');
    }
    res.json(await addCredits(actorOf(req).userId, body.amountUsd, deps.now()));
  });

  r.put('/overage', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ToggleOverageRequest, req.body);
    if (!body) return;
    res.json(await setOverage(actorOf(req).userId, body.enabled, deps.now()));
  });

  // ---- Super-admin surfaces (§6.6.2) ----
  r.get('/breakdown', superAdmin, async (_req: AuthedRequest, res: Response) => {
    res.json(await breakdownFor());
  });

  r.put('/admin/overage', superAdmin, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, AdminGlobalOverageRequest, req.body);
    if (!body) return;
    res.json(await setGlobalOverage(body.enabled));
  });

  r.get('/admin/usage', superAdmin, async (_req: AuthedRequest, res: Response) => {
    res.json(await adminListUsage(deps.now()));
  });

  r.post('/admin/usage/:userId/reset', superAdmin, async (req: AuthedRequest, res: Response) => {
    res.json(await adminResetUsage(req.params.userId as string, deps.now()));
  });

  r.put('/admin/limits/:userId', superAdmin, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, AdminSetLimitRequest, req.body);
    if (!body) return;
    res.json(await adminSetLimit(req.params.userId as string, body.tokenLimit, deps.now()));
  });

  return r;
}

function intQuery(v: unknown): number | undefined {
  if (typeof v !== 'string' || v === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
