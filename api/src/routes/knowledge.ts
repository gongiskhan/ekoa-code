/**
 * Knowledge router (ch03 §3.8.20). Org-partitioned sources/uploads. No human search endpoint
 * (agents consume search/read via in-process tools). Persistence via the knowledge service.
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { listSources, addSource, deleteSource, listUploads, sourceView, KnowledgeError } from '../knowledge/service.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';

const SourceInput = z.object({ url: z.string(), kind: z.string().optional(), seedId: z.string().optional() });

export function knowledgeRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/sources', async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listSources(actorOf(req))).map(sourceView) });
  });

  r.post('/sources', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SourceInput, req.body);
    if (!body) return;
    try {
      const s = await addSource(actorOf(req), body as { url: string; kind?: string; seedId?: string }, deps);
      res.status(201).json(sourceView(s));
    } catch (e) {
      if (e instanceof KnowledgeError) return sendError(res, e.code as 'VALIDATION_FAILED', e.message);
      throw e;
    }
  });

  r.delete('/sources/:id', async (req: AuthedRequest, res: Response) => {
    const ok = await deleteSource(actorOf(req), req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  r.get('/uploads', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listUploads(actorOf(req)) });
  });

  return r;
}
