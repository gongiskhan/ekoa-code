/**
 * Chat runs router (ch03 §3.8.7, §3.6.1). Thin: validate, call `agents/`, shape the response.
 * Creation registers the run synchronously and returns 202 with the server-minted id (§5.2 steps
 * 1-2); results arrive on the SSE stream. The events endpoint authenticates via ?token= (CONV-1)
 * and attaches to `events/`. Routes never touch `data/` (ch02 §2.7) — persistence is `agents/`.
 */
import { Router, type Request, type Response } from 'express';
import { ChatRunCreateRequest } from '@ekoa/shared';
import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
import { can } from '../auth/capabilities.js';
import { sseManager } from '../events/sse-manager.js';
import { createChatRun, executeChatRun, getRun, cancelRun } from '../agents/index.js';
import { chatRunView } from '../agents/registry.js';
import { actorOf, notFound, parseBody, sendError } from './helpers.js';

export function chatRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  // SSE stream (?token= auth) — mounted before requireAuth (EventSource cannot set headers).
  r.get('/runs/:id/events', (req: Request, res: Response) => {
    const auth = verifySseToken(req.query.token as string | undefined);
    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
    const id = req.params.id as string;
    const entry = getRun(id);
    if (entry && entry.ownerUserId !== auth.claims.sub) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
    }
    const lastEventId = req.header('last-event-id');
    sseManager.attach(res, auth.claims.sub, 'chat', id, lastEventId ? Number(lastEventId) : undefined);
  });

  r.use(requireAuth);

  r.post('/runs', (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ChatRunCreateRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    // H1 capability gate: chat requires canUseChat. Every role holds it today, so this never
    // refuses now — wired so the matrix is enforced, not merely implied (a future role without
    // canUseChat is denied here, with the machine-readable FORBIDDEN + details.capability shape).
    if (!can(actor, 'canUseChat')) {
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para usar o assistente; pode pedir ao administrador da organização.', { capability: 'canUseChat' });
    }
    const input = {
      actor,
      username: req.user!.username,
      sessionId: body.sessionId,
      message: body.message,
      language: body.language,
      ...(body.attachments ? { attachments: body.attachments } : {}),
      ...(body.references ? { references: body.references } : {}),
      deps,
    };
    const { runId } = createChatRun(input);
    res.status(202).json({ runId });
    void executeChatRun(runId, input);
  });

  r.get('/runs/:id', (req: AuthedRequest, res: Response) => {
    const entry = getRun(req.params.id as string);
    const actor = actorOf(req);
    // Ephemeral: a pre-crash / unknown run is a clean 404 (§5.2.1, acceptance criterion 2).
    if (!entry || (entry.ownerUserId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
    res.json(chatRunView(entry));
  });

  r.post('/runs/:id/cancel', (req: AuthedRequest, res: Response) => {
    res.json(cancelRun(req.params.id as string, actorOf(req)));
  });

  return r;
}
