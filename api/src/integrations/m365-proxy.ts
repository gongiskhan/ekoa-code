/**
 * Workspace Microsoft Graph proxy (`ALL /api/m365/*`, ch03 §3.9). Acts as the WORKSPACE's
 * connected Microsoft 365 account (delegated OAuth) for a served artifact - forwards the
 * Graph path verbatim, injecting a freshly-refreshed workspace Bearer token; the served
 * app never sees the token. Ported from the /api/m365 route in cortex/src/server.ts.
 *
 * Deliberate deviation from byte-compatibility (RESOLVED Q-10, ch03 §3.9; gate owned by
 * ch09 §9.4): the proxy now REQUIRES an `X-Ekoa-App-Id` header that resolves (slug-checked,
 * charset-checked) to an app that EXISTS and is SERVED, PLUS a per-app manifest opt-in flag
 * (`m365Proxy: true`), before injecting the workspace token. An optional platform JWT is
 * still validated if present (invalid → 401). Amendment 2: the artifact owner's activation
 * gates the plane. Upstream failures surface as 502.
 *
 * Boundaries: integrations/ may not import apps/ or auth/, so both the app resolution
 * (`resolveAppScope`) and the JWT verifier (`verifyToken`) are injected by server.ts.
 */
import { Router, raw as expressRaw, type Request } from 'express';
import { checkOwnerActivation, type ResolveAppScope } from './app-scope.js';
import { proxyToGraph } from './app-sso.js';

/** Provides a valid workspace Graph access token (refresh handled behind the seam). Throws
 *  when the workspace Microsoft integration is not connected / needs reauth. */
export type WorkspaceGraphTokenProvider = () => Promise<string>;

export interface M365ProxyDeps {
  resolveAppScope: ResolveAppScope;
  /** Injected workspace token seam (server.ts wires the integration credential store). */
  getWorkspaceGraphToken: WorkspaceGraphTokenProvider;
  /** Optional JWT verifier (injected; integrations/ never imports auth/). Validated only
   *  when a bearer/`?token=` is present. */
  verifyToken?: (token: string) => { sub: string };
}

function extractBearer(req: Request): string | undefined {
  const auth = (req.headers.authorization || '') as string;
  const fromHeader = /^Bearer\s+(.+)$/i.exec(auth)?.[1];
  return fromHeader || (typeof req.query.token === 'string' ? req.query.token : undefined);
}

export function m365ProxyRouter(deps: M365ProxyDeps): Router {
  const r = Router();

  r.all(/^\/(.+)$/, expressRaw({ type: '*/*', limit: '30mb' }), async (req, res) => {
    // Optional JWT: validated if supplied, ignored if absent (same-origin served apps).
    const bearer = extractBearer(req);
    if (bearer && deps.verifyToken) {
      try { deps.verifyToken(bearer); } catch { res.status(401).json({ error: 'Unauthorized: invalid token' }); return; }
    }

    // Q-10 gate: require + verify X-Ekoa-App-Id → app exists, is served, and opted in.
    const headerId = (req.headers['x-ekoa-app-id'] as string | undefined) || '';
    if (!headerId) { res.status(400).json({ error: 'Missing X-Ekoa-App-Id header' }); return; }
    const app = await deps.resolveAppScope(headerId);
    if (!app) { res.status(404).json({ error: 'Unknown app' }); return; }
    if (!app.isServed) { res.status(403).json({ error: 'App is not served' }); return; }
    if (!app.m365Proxy) { res.status(403).json({ error: 'App has not enabled the Microsoft 365 workspace proxy' }); return; }

    // Amendment 2: the artifact owner's activation gates the plane.
    const gate = checkOwnerActivation(app.ownerUserId);
    if (!gate.ok) { res.status(gate.status).json(gate.body); return; }

    const graphPath = (req.params as Record<string, string>)[0] ?? '';
    let accessToken: string;
    try {
      accessToken = await deps.getWorkspaceGraphToken();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(502).json({ error: `Microsoft Graph proxy error: ${msg}` });
      return;
    }
    try {
      await proxyToGraph(req, res, graphPath, accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[m365-proxy] ${req.method} ${graphPath} failed:`, msg);
      res.status(502).json({ error: `Microsoft Graph proxy error: ${msg}` });
    }
  });

  return r;
}
