/**
 * Artifacts router (ch03 §3.8.9). CRUD via the apps artifacts-service. Single list shape
 * `{ items, featured }` (landmine 7). SLUG_TAKEN on slug collision; visibility promote/demote.
 */
import { Router, type Response } from 'express';
import { ArtifactPatch } from '@ekoa/shared';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { listArtifacts, createArtifact, getVisibleArtifact, patchArtifact, deleteArtifact, artifactView } from '../apps/artifacts-service.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';

const CreateArtifact = z.object({ name: z.string(), visibility: z.enum(['private', 'org']).optional() });

export function artifactsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const { items, featured } = await listArtifacts(actorOf(req));
    res.json({ items: items.map(artifactView), featured: featured.map(artifactView) });
  });

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateArtifact, req.body) as { name: string; visibility?: 'private' | 'org' } | undefined;
    if (!body) return;
    res.status(201).json(artifactView(await createArtifact(actorOf(req), body, deps)));
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
    const a = await getVisibleArtifact(actorOf(req), req.params.id as string);
    if (!a) return notFound(res);
    res.json(artifactView(a));
  });

  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ArtifactPatch, req.body) as Record<string, unknown> | undefined;
    if (!body) return;
    const result = await patchArtifact(actorOf(req), req.params.id as string, body);
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') {
      // distinguish a slug collision from a permission denial
      if (typeof body.slug === 'string') return sendError(res, 'SLUG_TAKEN', 'Slug já em uso.');
      return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    }
    res.json(artifactView(result.artifact!));
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const verdict = await deleteArtifact(actorOf(req), req.params.id as string);
    if (verdict === 'notfound') return notFound(res);
    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json({ ok: true });
  });

  return r;
}
