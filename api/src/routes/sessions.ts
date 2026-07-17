/**
 * Sessions router (ch03 §3.8.6). Persistence via the platform-crud service (ch02 §2.7).
 * User-scoped: ownership mismatch → uniform not-found.
 */
import { Router, type Response } from 'express';
import { SessionCreateRequest, SessionPatch, MessageCreateRequest, SheetRenameRequest, SheetRevisionCreateRequest } from '@ekoa/shared';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { listSessions, createSession, ownedSession, updateSession, deleteSession, listMessages, addMessage, sessionView, messageView, listSessionSheetViews, addSessionSheetRevision, renameSessionSheet } from '../services/platform-crud.js';
import { actorOf, notFound, parseBody } from './helpers.js';

export function sessionsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  /** The activity-log actor (Registo needs the real username, F3). */
  const audActor = (req: AuthedRequest) => ({ userId: actorOf(req).userId, username: req.user!.username, orgId: actorOf(req).orgId });

  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listSessions(actorOf(req).userId)).map(sessionView) });
  });

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SessionCreateRequest, req.body) as { name?: string; type?: string; artifactId?: string } | undefined;
    if (!body) return;
    res.status(201).json(sessionView(await createSession(actorOf(req).userId, body, deps, audActor(req))));
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
    const updated = await updateSession(s._id, body as { name?: string }, deps, audActor(req));
    res.json(sessionView(updated!));
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    await deleteSession(s._id, deps, audActor(req));
    res.json({ ok: true });
  });

  r.get('/:id/messages', async (req: AuthedRequest, res: Response) => {
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    res.json({ items: (await listMessages(s._id)).map(messageView) });
  });

  r.post('/:id/messages', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, MessageCreateRequest, req.body) as { role: unknown; content: unknown; metadata?: unknown } | undefined;
    if (!body) return;
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    res.status(201).json(messageView(await addMessage(s, body, deps)));
  });

  // ---- Sheets (Part B decision B.B): subdocuments on the session record; legacy sessions
  // read as derived one-sheet-per-assistant-message views. Unknown sheet -> uniform 404. ----

  r.get('/:id/sheets', async (req: AuthedRequest, res: Response) => {
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    res.json({ items: await listSessionSheetViews(s) });
  });

  r.patch('/:id/sheets/:sheetId', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SheetRenameRequest, req.body) as { title: string } | undefined;
    if (!body) return;
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    const sheet = await renameSessionSheet(s, req.params.sheetId as string, body.title, deps, audActor(req));
    if (!sheet) return notFound(res);
    res.json(sheet);
  });

  r.post('/:id/sheets/:sheetId/revisions', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SheetRevisionCreateRequest, req.body) as { content: string; instruction?: string } | undefined;
    if (!body) return;
    const s = await ownedSession(actorOf(req).userId, req.params.id as string);
    if (!s) return notFound(res);
    const sheet = await addSessionSheetRevision(s, req.params.sheetId as string, body, req.user!.username, deps, audActor(req));
    if (!sheet) return notFound(res);
    res.status(201).json(sheet);
  });

  return r;
}
