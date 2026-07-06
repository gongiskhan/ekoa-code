/**
 * Users router (ch03 §3.8.2). Thin: validate → call the users-management service → shape.
 * super-admin platform-wide; org-admin scoped to its own org. Persistence goes through the
 * auth users-service, never data/ (ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { CreateUserRequest, UserPatch, type Role } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { listUsers, createUser, getUser, patchUser, deleteUser } from '../auth/users-service.js';
import { actorOf, sendError, notFound, parseBody } from './helpers.js';

export function usersRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', requireRole('super-admin', 'org-admin'), async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listUsers(actorOf(req)) });
  });

  r.post('/', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateUserRequest, req.body) as { username: string; password: string; role: Role; orgId?: string } | undefined;
    if (!body) return;
    const result = await createUser(body, deps);
    if (!result.ok) return sendError(res, 'SLUG_TAKEN', 'Utilizador já existe.');
    res.status(201).json(result.user);
  });

  r.patch('/:id', requireRole('super-admin', 'org-admin'), async (req: AuthedRequest, res: Response) => {
    const a = actorOf(req);
    const body = parseBody(res, UserPatch, req.body) as { role?: Role; active?: boolean } | undefined;
    if (!body) return;
    const target = await getUser(req.params.id as string);
    if (!target) return notFound(res);
    if (a.role === 'org-admin' && target.orgId !== a.orgId) return notFound(res); // cross-org → uniform 404
    if (a.role === 'org-admin' && body.role === 'super-admin') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json(await patchUser(a, target, body, deps));
  });

  r.delete('/:id', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const ok = await deleteUser(req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  return r;
}
