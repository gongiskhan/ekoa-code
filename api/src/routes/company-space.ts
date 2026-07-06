/**
 * Company space router (ch03 §3.8.12). Manage the serving state of shared artifact
 * instances: list/get enrich the artifact record with in-memory appRegistry state
 * (serving status, URL, registeredAt); start/stop register/unregister the app so
 * it is (or stops being) served at `/apps/:id/`. Ported from the old
 * handlers/company-space-handler.ts, org-scoped to the actor (Amendment 2) and
 * shaped to the shared CompanySpaceEntry contract. One normalized param
 * (`artifactId`), fixing FC-057.
 */
import { Router, type Response } from 'express';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { listArtifacts, type ArtifactDoc } from '../apps/artifacts-service.js';
import { loadReadable, loadWritable, projectDirFor } from '../apps/app-paths.js';
import { appRegistry } from '../apps/app-registry.js';
import { actorOf, notFound, sendError } from './helpers.js';
import type { CompanySpaceEntry } from '@ekoa/shared';

function entryOf(art: ArtifactDoc): CompanySpaceEntry {
  const reg = appRegistry.getApp(art._id);
  const updatedAt = (art as { updatedAt?: unknown }).updatedAt;
  return {
    artifactId: art._id,
    name: art.name,
    status: reg ? 'running' : 'stopped',
    ...(reg ? { url: `/apps/${art._id}/`, startedAt: reg.registeredAt.toISOString() } : {}),
    ...(typeof updatedAt === 'string' ? { updatedAt } : {}),
  };
}

export function companySpaceRouter(_deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const { items } = await listArtifacts(actorOf(req));
    res.json({ items: items.map(entryOf) });
  });

  r.get('/:artifactId', async (req: AuthedRequest, res: Response) => {
    const art = await loadReadable(actorOf(req), req.params.artifactId as string);
    if (!art) return notFound(res);
    res.json(entryOf(art));
  });

  r.post('/:artifactId/start', async (req: AuthedRequest, res: Response) => {
    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
    if (verdict === 'notfound') return notFound(res);
    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    try {
      await appRegistry.register(art!._id, projectDirFor(art!), art!.userId, art!.name);
    } catch (err) {
      return sendError(res, 'INTERNAL', `Não foi possível iniciar a app: ${err instanceof Error ? err.message : String(err)}`);
    }
    res.json({ status: 'running', url: `/apps/${art!._id}/` });
  });

  r.post('/:artifactId/stop', async (req: AuthedRequest, res: Response) => {
    const { verdict, art } = await loadWritable(actorOf(req), req.params.artifactId as string);
    if (verdict === 'notfound') return notFound(res);
    if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    await appRegistry.unregister(art!._id);
    res.json({ ok: true });
  });

  return r;
}
