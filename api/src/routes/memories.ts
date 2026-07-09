/**
 * Memories router (ch03 §3.8.19). Persistence via the `memory/` module (ch02 §2.7).
 * Reads inject own + org-shared; another user's private memory → 404; writing it → 403.
 */
import { Router, type Response } from 'express';
import { MemoryCreateRequest, MemoryPatch, MemoryBulkDeleteRequest, MemorySignalRequest } from '@ekoa/shared';
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

  // F5 subset. These MUST be registered before `GET /:id` or that route swallows them ('stats'
  // and 'tags' would be read as memory ids).
  r.get('/stats', async (req: AuthedRequest, res: Response) => {
    const rows = await listVisibleMemories(actorOf(req));
    const tally = (pick: (m: (typeof rows)[number]) => string) =>
      rows.reduce<Record<string, number>>((acc, m) => { const k = pick(m); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
    res.json({
      total: rows.length,
      byType: tally((m) => m.type ?? 'unknown'),
      byTier: tally((m) => m.tier ?? 'active'), // the same honest default memoryView reports
      byVisibility: tally((m) => m.visibility),
      // `verified` IS persisted (MemoryPatch declares it and updateMemory spreads the patch), so
      // count it. It was hardcoded to 0 behind a comment that claimed it was not stored — false.
      verified: rows.filter((m) => m.verified === true).length,
    });
  });

  r.get('/tags', async (req: AuthedRequest, res: Response) => {
    const rows = await listVisibleMemories(actorOf(req));
    const counts = new Map<string, number>();
    for (const m of rows) for (const tag of m.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const items = [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    res.json({ items });
  });

  r.post('/bulk-delete', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, MemoryBulkDeleteRequest, req.body);
    if (body === undefined) return;
    const actor = actorOf(req);
    // Check EVERY id before deleting any: a partial delete on a forbidden id is worse than a refusal.
    for (const id of body.ids) {
      const guard = await memoryWriteGuard(actor, id);
      if (guard.verdict === 'notfound') return notFound(res);
      if (guard.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    }
    for (const id of body.ids) await deleteMemory(id);
    res.json({ ok: true });
  });

  r.post('/signals', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, MemorySignalRequest, req.body);
    if (body === undefined) return;
    // HONEST minimal (F5 brief): there is no per-run memory-scoring store yet, so no memory can be
    // adjusted. Answer the contract shape with real zeros rather than fabricating a success count.
    // Do NOT report `accepted: true` — the signal is discarded, and saying otherwise is the exact
    // fabrication the F5 brief forbids. The zeros carry the whole truth.
    res.json({ affectedMemories: 0, adjustedScores: 0, signal: body.signal, runId: body.runId });
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
