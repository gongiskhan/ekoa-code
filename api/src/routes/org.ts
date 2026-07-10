/**
 * Org + orgs router (ch03 §3.8.4). Persistence via the platform-crud service (ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { OrgUpdateRequest, OrgCreateRequest, OrgPatch, BrandingSaveRequest, DenyListCreateRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { getOrg, updateOrg, createOrg, listOrgs, orgView } from '../services/platform-crud.js';
import { listDenyList, addDenyListEntry, removeDenyListEntry } from '../services/deny-list.js';
import { actorOf, notFound, parseBody } from './helpers.js';

/** The activity-log actor (data/activity.ts needs the real username, not just the id). */
const activityActorOf = (req: AuthedRequest) => {
  const a = actorOf(req);
  return { userId: a.userId, username: req.user!.username, orgId: a.orgId };
};

export function orgRouter(deps: { now: () => number; genId: () => string }): Router {
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

  // Mounted at BOTH /api/v1/org/branding (legacy, carried) and /api/v1/branding (the contract
  // path, via routes/branding.ts) — ONE handler, aliased, never duplicated (F4).
  r.put('/branding', requireRole('org-admin', 'super-admin'), saveBrandingHandler);

  // Org anonymisation deny-list (ch17 §17.4 (b), ch04 §4.3; F10): metadata-only reads,
  // write-only values — the cleartext literal never appears in any response.
  r.get('/deny-list', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listDenyList(actorOf(req).orgId) });
  });

  r.post('/deny-list', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, DenyListCreateRequest, req.body);
    if (!body) return;
    const entry = await addDenyListEntry(actorOf(req).orgId, body.value, body.entityClass ?? 'PARTY', activityActorOf(req), deps);
    res.status(201).json(entry);
  });

  r.delete('/deny-list/:id', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const removed = await removeDenyListEntry(actorOf(req).orgId, req.params.id as string, activityActorOf(req), deps);
    if (!removed) return notFound(res);
    res.json({ ok: true });
  });

  return r;
}

/** The branding save (F4). Exported so the contract-path router aliases this exact handler. */
export async function saveBrandingHandler(req: AuthedRequest, res: Response): Promise<void> {
  const body = parseBody(res, BrandingSaveRequest, req.body) as { branding: unknown; displayName?: string } | undefined;
  if (!body) return;
  const updated = await updateOrg(actorOf(req).orgId, { branding: body.branding as Record<string, unknown>, ...(body.displayName ? { displayName: body.displayName } : {}) });
  if (!updated) return notFound(res);
  res.json(orgView(updated));
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
