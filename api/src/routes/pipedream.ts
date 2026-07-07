/**
 * Pipedream router (ch03 §3.8.16). Thin dispatcher over the Pipedream Connect layer; all logic
 * lives in integrations/pipedream.ts.
 *
 *   GET    /pipedream                 status          (user)      -> { configured, enabled, accountCount }
 *   GET    /pipedream/accounts        list-accounts   (user)      -> { items: PipedreamAccount[] }
 *   PUT    /pipedream/config          configure       (org-admin) -> { id, configured }
 *   DELETE /pipedream/config          remove-config   (org-admin) -> { ok }
 *   POST   /pipedream/connect-token   connect-token   (user)      -> { token, connectLinkUrl, expiresAt }
 *   DELETE /pipedream/accounts/:id    disconnect      (user)      -> { ok }
 *
 * The enable/disable toggle rides `PATCH /settings` (integration.pipedreamEnabled) — a separate
 * resource; this router only reads it via the status endpoint. The external transport is an
 * injectable seam (`deps.pipedream`) so tests point it at a mock; production uses the SSRF-guarded
 * default. Mount at `/api/v1/pipedream`.
 */
import { Router, type Response } from 'express';
import { PipedreamConfigRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { actorOf, parseBody, sendError } from './helpers.js';
import {
  getPipedreamStatus,
  listConnectedAccounts,
  savePipedreamConfig,
  removePipedreamConfig,
  getConnectToken,
  disconnectAccount,
  type PipedreamDeps,
} from '../integrations/pipedream.js';

interface RouterDeps {
  now: () => number;
  genId: () => string;
  /** Injectable Pipedream transport seam (tests point it at a mock; production omits it). */
  pipedream?: PipedreamDeps;
}

export function pipedreamRouter(deps: RouterDeps): Router {
  const r = Router();
  r.use(requireAuth);
  const pd: PipedreamDeps = deps.pipedream ?? {};

  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json(await getPipedreamStatus(actorOf(req), pd));
  });

  r.get('/accounts', async (req: AuthedRequest, res: Response) => {
    try {
      res.json({ items: await listConnectedAccounts(actorOf(req), pd) });
    } catch {
      sendError(res, 'UPSTREAM_FAILED', 'Não foi possível listar as ligações Pipedream.');
    }
  });

  r.put('/config', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, PipedreamConfigRequest, req.body);
    if (!body) return;
    res.json(await savePipedreamConfig(actorOf(req), body));
  });

  r.delete('/config', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    res.json(await removePipedreamConfig(actorOf(req)));
  });

  r.post('/connect-token', async (req: AuthedRequest, res: Response) => {
    try {
      res.json(await getConnectToken(actorOf(req), pd));
    } catch {
      sendError(res, 'UPSTREAM_UNAVAILABLE', 'Não foi possível criar a ligação Pipedream.');
    }
  });

  r.delete('/accounts/:accountId', async (req: AuthedRequest, res: Response) => {
    res.json(await disconnectAccount(actorOf(req), req.params.accountId as string, pd));
  });

  return r;
}
