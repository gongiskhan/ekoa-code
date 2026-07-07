/**
 * Platform-integrations routers (ch03 §3.8.15). Two mounts, exported from one file:
 *
 *   platformIntegrationsRouter → mount at `/api/v1/platform-integrations` (authed)
 *     GET    /                       list       (user)      -> { items: [{provider, connected, email?}] }
 *     GET    /:provider              status      (user)     -> { connected, email?, expiresAt? }
 *     POST   /:provider/connect      connect     (org-admin)-> { authUrl, state }
 *     DELETE /:provider              disconnect  (org-admin)-> { ok }
 *
 *   oauthCallbackRouter → mount at `/api/v1/oauth` (PUBLIC — no auth; state-validated)
 *     GET    /:provider/callback     server-rendered page that postMessages the result
 *
 * The callback path `GET /api/v1/oauth/:provider/callback` is a registered redirect URI in the
 * provider consoles and is kept verbatim. Each route does exactly three things: validate, call
 * one module function, shape the response (error envelope via helpers).
 */
import { Router, type Response } from 'express';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { actorOf, sendError } from './helpers.js';
import {
  connectPlatform,
  disconnectPlatform,
  platformStatus,
  listPlatform,
  completeCallback,
  renderCallbackPage,
  PLATFORM_PROVIDERS,
  type OAuthDeps,
  type PlatformHttp,
  type PlatformOAuthEnv,
} from '../integrations/platform-oauth.js';

interface RouterDeps {
  now: () => number;
  genId: () => string;
  /** Injectable OAuth seam (tests/e2e fake the provider HTTP + client creds; production omits). */
  oauth?: { http?: PlatformHttp; env?: PlatformOAuthEnv };
}

function isKnownProvider(p: string): boolean {
  return (PLATFORM_PROVIDERS as readonly string[]).includes(p);
}

function firstStr(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/** Authed platform-integrations router — mount at `/api/v1/platform-integrations`. */
export function platformIntegrationsRouter(deps: RouterDeps): Router {
  const r = Router();
  r.use(requireAuth);
  const oauthDeps: OAuthDeps = { now: deps.now, genId: deps.genId, http: deps.oauth?.http, env: deps.oauth?.env };

  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listPlatform(actorOf(req)) });
  });

  r.get('/:provider', async (req: AuthedRequest, res: Response) => {
    const provider = req.params.provider as string;
    if (!isKnownProvider(provider)) return sendError(res, 'VALIDATION_FAILED', 'Fornecedor inválido.');
    res.json(await platformStatus(actorOf(req), provider));
  });

  r.post('/:provider/connect', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const u = req.user!;
    const result = await connectPlatform({ userId: u.sub, orgId: u.orgId, username: u.username }, req.params.provider as string, oauthDeps);
    if (!result.ok) {
      if (result.code === 'invalid_provider') return sendError(res, 'VALIDATION_FAILED', 'Fornecedor inválido.');
      return sendError(res, 'UPSTREAM_UNAVAILABLE', 'A ligação a este serviço não está configurada.');
    }
    res.json({ authUrl: result.authUrl, state: result.state });
  });

  r.delete('/:provider', requireRole('org-admin', 'super-admin'), async (req: AuthedRequest, res: Response) => {
    const provider = req.params.provider as string;
    if (!isKnownProvider(provider)) return sendError(res, 'VALIDATION_FAILED', 'Fornecedor inválido.');
    const u = req.user!;
    await disconnectPlatform({ userId: u.sub, orgId: u.orgId, username: u.username }, provider, oauthDeps);
    res.json({ ok: true });
  });

  return r;
}

/** Public OAuth callback router — mount at `/api/v1/oauth`. No auth: the CSRF state is the
 *  security token. Always returns a 200 HTML page (success/failure signalled via postMessage). */
export function oauthCallbackRouter(deps: RouterDeps): Router {
  const r = Router();
  const oauthDeps: OAuthDeps = { now: deps.now, genId: deps.genId, http: deps.oauth?.http, env: deps.oauth?.env };

  r.get('/:provider/callback', async (req, res: Response) => {
    const provider = req.params.provider as string;
    const outcome = await completeCallback(
      provider,
      { code: firstStr(req.query.code), state: firstStr(req.query.state), error: firstStr(req.query.error) },
      oauthDeps,
    );
    res.status(200).type('html').send(renderCallbackPage(provider, outcome.ok));
  });

  return r;
}
