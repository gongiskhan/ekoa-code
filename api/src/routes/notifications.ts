/**
 * Notifications SSE endpoint (ch03 §3.6.4). The per-user push channel — one of the four
 * sanctioned SSE streams. Authenticates via ?token= (EventSource cannot set headers, CONV-1).
 * Persistence/state access goes through auth/ + events/ modules, never data/ (ch02 §2.7).
 */
import { Router, type Request, type Response } from 'express';
import { verifySseToken } from '../auth/middleware.js';
import { sseManager } from '../events/sse-manager.js';

export function notificationsRouter(): Router {
  const r = Router();

  r.get('/events', (req: Request, res: Response) => {
    const auth = verifySseToken(req.query.token as string | undefined);
    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
    const lastEventId = req.header('last-event-id');
    sseManager.attach(res, auth.claims.sub, 'notifications', auth.claims.sub, lastEventId ? Number(lastEventId) : undefined);
  });

  return r;
}
