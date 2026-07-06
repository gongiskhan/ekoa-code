/**
 * Sessions router (ch03 §3.8.6). Persistence via the platform-crud service (ch02 §2.7).
 * User-scoped: ownership mismatch → uniform not-found.
 */
import { Router, type Response } from 'express';
import { SessionCreateRequest, SessionPatch, MessageCreateRequest } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { listSessions, createSession, ownedSession, updateSession, deleteSession, listMessages, addMessage, sessionView } from '../services/platform-crud.js';
import { actorOf, notFound, parseBody } from './helpers.js';

export function sessionsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listSessions(actorOf(req).userId)).map(sessionView) });
  });

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SessionCreateRequest, req.body) as { name?: string } | undefined;
    if (!body) return;
    res.status(201).json(sessionView(await createSession(actorOf(req).userId, body.name, deps)));
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    res.json(sessionView(s));
  });

  r.patch('/:id', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SessionPatch, req.body);
    if (!body) return;
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    const updated = await updateSession(s._id, body as Record<string, unknown>);
    res.json(sessionView(updated!));
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    await deleteSession(s._id);
    res.json({ ok: true });
  });

  r.get('/:id/messages', async (req: AuthedRequest, res: Response) => {
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    res.json({ items: await listMessages(s._id) });
  });

  r.post('/:id/messages', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, MessageCreateRequest, req.body) as { role: unknown; content: unknown; metadata?: unknown } | undefined;
    if (!body) return;
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    res.status(201).json(await addMessage(s, body, deps));
  });

  return r;
}
