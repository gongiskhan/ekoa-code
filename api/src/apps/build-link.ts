/**
 * Build-link router - GET /build/:slug (ch07 §7.7, ch03 §3.8.9). Visiting a build
 * link while authenticated FORKS the source artifact and redirects to
 * `/chat?continue={newId}`; each click yields a fresh artifact owned by the
 * visitor (fork-per-click, no dedup). Ported from the old server.ts /build/:slug
 * handler.
 *
 * Semantics carried:
 *   - not-found slug        -> 404 text
 *   - revoked share         -> 410 with the authored PT "link revoked" page
 *   - unauthenticated       -> 302 to `${frontendOrigin}/login?next=<build url>`
 *   - authenticated         -> fork + 302 to `${frontendOrigin}/chat?continue=<id>`
 *
 * apps/ never imports auth/ (ch02 §2.7): the JWT verifier is INJECTED (same seam
 * the serving router uses). The token is read from the cookie, the Authorization
 * header, or `?token=` (in that precedence).
 */
import { Router, type Request, type Response } from 'express';
import { lookupShareable } from './share-lookup.js';
import { forkArtifact } from './artifact-fork.js';
import type { Actor } from '../data/scoped.js';

export interface BuildLinkDeps {
  now: () => number;
  genId: () => string;
  verifyToken: (token: string) => { sub: string; orgId: string; role: Actor['role'] };
}

const REVOKED_HTML =
  '<!DOCTYPE html><html><body style="font-family:system-ui;text-align:center;padding:3rem;">' +
  '<h2>Link já não disponível</h2>' +
  '<p>O autor revogou este link de construção. Peça-lhe um novo, ou comece o seu artefacto de raiz.</p>' +
  '</body></html>';

function tokenFrom(req: Request): string | undefined {
  const cookieHeader = (req.headers.cookie || '') as string;
  const cookieToken = /(?:^|;\s*)ekoa_token=([^;]+)/.exec(cookieHeader)?.[1];
  const headerToken = (req.headers.authorization || '').replace(/^Bearer\s+/, '') || undefined;
  const queryToken = (req.query.token as string | undefined) || undefined;
  return headerToken || cookieToken || queryToken;
}

export function buildLinkRouter(deps: BuildLinkDeps): Router {
  const r = Router();

  r.get('/:slug', async (req: Request, res: Response) => {
    const slug = req.params.slug as string;
    const lookup = await lookupShareable(slug);
    if (lookup.kind === 'not-found') {
      res.status(404).send('Build link not found.');
      return;
    }
    if (lookup.kind === 'revoked') {
      res.status(410).setHeader('Content-Type', 'text/html').send(REVOKED_HTML);
      return;
    }

    const reqOrigin = `${req.protocol}://${req.get('host') || ''}`;
    // /build/:slug is a backend URL; /login and /chat live on the frontend, which
    // is a different origin in dev - resolve it from the allowed-origins allowlist.
    const frontendOrigin =
      (process.env.EKOA_STREAMING_ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .find((s) => s && s !== reqOrigin) || '';

    const token = tokenFrom(req);
    let claims: { sub: string; orgId: string; role: Actor['role'] } | null = null;
    if (token) {
      try { claims = deps.verifyToken(token); } catch { claims = null; }
    }
    if (!claims) {
      const next = encodeURIComponent(`${reqOrigin}/build/${slug}`);
      res.redirect(302, `${frontendOrigin}/login?next=${next}`);
      return;
    }

    try {
      const actor: Actor = { userId: claims.sub, orgId: claims.orgId, role: claims.role };
      const { artifact } = await forkArtifact(lookup.appId, actor, { now: deps.now, genId: deps.genId });
      res.redirect(302, `${frontendOrigin}/chat?continue=${encodeURIComponent(artifact._id)}`);
    } catch (err) {
      res.status(500).send(`Fork failed: ${err instanceof Error ? err.message : 'fork failed'}`);
    }
  });

  return r;
}
