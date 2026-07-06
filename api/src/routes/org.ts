/**
 * Org + orgs router (ch03 §3.8.4). Persistence via the platform-crud service (ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { OrgUpdateRequest, OrgCreateRequest, OrgPatch, BrandingSaveRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { getOrg, updateOrg, createOrg, listOrgs, orgView } from '../services/platform-crud.js';
import { actorOf, notFound, parseBody } from './helpers.js';

export function orgRouter(_deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const o = await getOrg(actorOf(req).orgId);
    if (!o) return notFound(res);
    res.json(orgView(o));
  });

  r.patch('/', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, OrgUpdateRequest, req.body);
    if (!body) return;
    const updated = await updateOrg(actorOf(req).orgId, body as Record<string, unknown>);
    if (!updated) return notFound(res);
    res.json(orgView(updated));
  });

  r.put('/branding', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, BrandingSaveRequest, req.body) as { branding: unknown; displayName?: string } | undefined;
    if (!body) return;
    const updated = await updateOrg(actorOf(req).orgId, { branding: body.branding as Record<string, unknown>, ...(body.displayName ? { displayName: body.displayName } : {}) });
    if (!updated) return notFound(res);
    res.json(orgView(updated));
  });

  return r;
}

export function orgsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth, requireRole('super-admin'));

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, OrgCreateRequest, req.body) as { name: string; displayName?: string } | undefined;
    if (!body) return;
    res.status(201).json(orgView(await createOrg(body, deps)));
  });

  r.get('/', async (_req: AuthedRequest, res: Response) => {
    res.json({ items: (await listOrgs()).map(orgView) });
  });

  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, OrgPatch, req.body);
    if (!body) return;
    const updated = await updateOrg(req.params.id as string, body as Record<string, unknown>);
    if (!updated) return notFound(res);
    res.json(orgView(updated));
  });

  return r;
}
