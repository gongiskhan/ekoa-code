/**
 * Memories router (ch03 §3.8.19). Persistence via the `memory/` module (ch02 §2.7).
 * Reads inject own + org-shared; another user's private memory → 404; writing it → 403.
 */
import { Router, type Response } from 'express';
import { MemoryCreateRequest, MemoryPatch } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  listVisibleMemories, getVisibleMemory, memoryWriteGuard, memoryView,
  createMemory, updateMemory, deleteMemory,
} from '../memory/resolver.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';

export function memoriesRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const rows = await listVisibleMemories(actorOf(req));
    res.json({ items: rows.map(memoryView), total: rows.length });
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
    const m = await getVisibleMemory(actorOf(req), req.params.id as string);
    if (!m) return notFound(res); // includes another user's private memory (invisible to org admin)
    res.json(memoryView(m));
  });

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, MemoryCreateRequest, req.body) as Record<string, unknown> | undefined;
    if (!body) return;
    const doc = await createMemory(actorOf(req), body, deps);
    res.status(201).json(memoryView(doc));
  });

  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, MemoryPatch, req.body) as Record<string, unknown> | undefined;
    if (!body) return;
    const guard = await memoryWriteGuard(actorOf(req), req.params.id as string);
    if (guard.verdict === 'notfound') return notFound(res);
    if (guard.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    const updated = await updateMemory(req.params.id as string, body, deps);
    res.json(memoryView(updated!));
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const guard = await memoryWriteGuard(actorOf(req), req.params.id as string);
    if (guard.verdict === 'notfound') return notFound(res);
    if (guard.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    await deleteMemory(req.params.id as string);
    res.json({ ok: true });
  });

  return r;
}
