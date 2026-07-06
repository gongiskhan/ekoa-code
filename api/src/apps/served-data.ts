/**
 * Served-app data plane (ch03 §3.9, ch04 §4.2.7) - byte-compatible with the old
 * /api/app-data + /api/app-shared wire surface (FIXED-9). The injected window.__ekoa
 * client (ch07 §7.6) unwraps EXACTLY these shapes, so they are a compatibility
 * contract, not a design:
 *   - success bodies: `{ success: true, data: <item|items> }` (create 201, everything
 *     else 200); DELETE success is `{ success: true }` with no data member.
 *   - PUT is an upsert: update-merge when present, create-with-the-given-id when
 *     absent - 200 on BOTH legs (only POST answers 201).
 *   - errors: `{ error: '<string>' }` with the old strings ('Invalid collection
 *     name', 'Missing or invalid X-Ekoa-App-Id header', 'Not found', the shared-
 *     namespace guard strings) - never the CONV-2 object envelope.
 *   - OPTIONS on either prefix answers 204.
 * Scoping: X-Ekoa-App-Id (charset-checked; `usr.` reserved prefix rejected so the
 * shared namespace is unreachable by spoofing; slug resolved server-side to the
 * canonical artifact id). No platform JWT anywhere on this plane.
 *
 * The shared namespace adds (carried verbatim): a same-origin guard (a foreign
 * Origin header is refused so the global CORS `*` cannot exfiltrate an owner's
 * shared dataset), the manifest `sharedData: true` opt-in (default-off => 403),
 * and server-side owner resolution (never a client-supplied account id).
 *
 * One layered admission check that changes no route shape (Amendment 2; ch03 §3.2
 * second admission plane): the artifact OWNER's activation state gates the plane.
 * A deactivated owner's apps refuse with the CONV-2 envelope - 403 ACCOUNT_DISABLED
 * or 402 BILLING_LOCKED - and an owner with no activation record fails CLOSED
 * (ch09; a cache miss is never an allow).
 */
import { Router, type Request, type Response, type RequestHandler } from 'express';
import {
  CollectionsEngine,
  appScope,
  sharedScope,
  collectionName,
  EngineError,
} from '../data/collections-engine.js';
import { getActivation } from '../data/activation.js';
import { resolveApp, type ResolvedApp } from './registry.js';

const SHARED_SCOPE_PREFIX = 'usr.';

/** True when a request's Origin is cross-origin to its Host (carried check: served
 *  apps call the shared routes same-origin; a foreign Origin is an exfil attempt;
 *  no Origin means a same-origin GET or a non-browser caller and is allowed). */
export function originIsForeign(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // malformed Origin -> treat as foreign
  }
}

export function servedDataRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  const engine = new CollectionsEngine(deps);

  // Old-plane middleware order carried: an invalid collection name 400s before
  // the header is even looked at.
  const validateCollection: RequestHandler = (req, res, next) => {
    if (!collectionName.safeParse(req.params.collection).success) {
      res.status(400).json({ error: 'Invalid collection name' });
      return;
    }
    next();
  };

  /** Validate the X-Ekoa-App-Id header (charset + not the reserved prefix). Writes
   *  the 400 and returns null on refusal. Byte-compat: the OLD per-app plane did NOT
   *  require the app to exist - it keyed data on the (charset-checked, non-reserved)
   *  header value directly, so featured apps, dev-serve apps, and any app id all work. */
  function headerFor(req: Request, res: Response): string | null {
    const header = req.header('x-ekoa-app-id');
    if (
      typeof header !== 'string' ||
      !collectionName.safeParse(header).success ||
      header.startsWith(SHARED_SCOPE_PREFIX)
    ) {
      res.status(400).json({ error: 'Missing or invalid X-Ekoa-App-Id header' });
      return null;
    }
    return header;
  }

  /** Amendment 2 second admission plane: when an ARTIFACT backs the app, its owner's
   *  activation gates service (fail-closed CONV-2). Apps with no artifact owner (dev-
   *  serve, or a raw/unregistered id on the key-value per-app plane) have no subject,
   *  so the gate is skipped - carried old-plane behavior. Returns true to proceed. */
  function admitOwner(app: ResolvedApp | null, res: Response): boolean {
    if (!app || !app.artifactBacked) return true;
    const activation = getActivation(app.ownerUserId);
    if (!activation || activation.active === false) {
      res.status(403).json({ error: { code: 'ACCOUNT_DISABLED', message: 'A sua conta está bloqueada. Contacte o suporte.' } });
      return false;
    }
    if (activation.billingLocked) {
      res.status(402).json({ error: { code: 'BILLING_LOCKED', message: 'A sua conta tem um problema de faturação. Contacte o suporte.' } });
      return false;
    }
    return true;
  }

  async function scopeFor(req: Request, res: Response, shared: boolean) {
    const header = headerFor(req, res);
    if (!header) return null;
    // Best-effort resolve: the per-app plane does NOT require existence (key-value,
    // carried), but a resolved artifact still gates on its owner's activation.
    const app = await resolveApp(header);
    if (!admitOwner(app, res)) return null;

    if (!shared) {
      // Per-app scope: a resolved app gives its canonical id (so slug and id hit the
      // same data - edits never orphan it); an unresolved (dev/raw) id keys on itself.
      // Existence is NOT required (key-value plane, carried).
      return appScope(app ? app.appId : header);
    }

    // Shared namespace REQUIRES a resolved owner - guards carried verbatim.
    if (!app) {
      res.status(404).json({ error: 'Not found' });
      return null;
    }
    if (originIsForeign(req.headers.origin as string | undefined, req.headers.host)) {
      res.status(403).json({ error: 'cross-origin shared-data access denied' });
      return null;
    }
    if (!app.sharedData) {
      res.status(403).json({ error: 'app does not participate in shared data' });
      return null;
    }
    if (!app.ownerUserId || !collectionName.safeParse(app.ownerUserId).success) {
      res.status(403).json({ error: 'shared data unavailable: owner unresolved' });
      return null;
    }
    return sharedScope(app.appId, app.ownerUserId);
  }

  function handleEngineError(res: Response, e: unknown): void {
    // Old-plane errors are strings; engine failures surface their message.
    if (e instanceof EngineError) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }

  function mount(prefix: string, shared: boolean) {
    r.options(new RegExp(`^${prefix}/`), (_req, res) => {
      res.status(204).end();
    });

    r.get(`${prefix}/:collection`, validateCollection, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        res.json({ success: true, data: await engine.list(scope, req.params.collection as string) });
      } catch (e) {
        handleEngineError(res, e);
      }
    });

    r.get(`${prefix}/:collection/:id`, validateCollection, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        const item = await engine.get(scope, req.params.collection as string, req.params.id as string);
        if (!item) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, data: item });
      } catch (e) {
        handleEngineError(res, e);
      }
    });

    r.post(`${prefix}/:collection`, validateCollection, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        const item = await engine.create(scope, req.params.collection as string, req.body ?? {});
        res.status(201).json({ success: true, data: item });
      } catch (e) {
        handleEngineError(res, e);
      }
    });

    r.put(`${prefix}/:collection/:id`, validateCollection, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        const item = await engine.upsert(scope, req.params.collection as string, req.params.id as string, req.body ?? {});
        res.json({ success: true, data: item });
      } catch (e) {
        handleEngineError(res, e);
      }
    });

    r.delete(`${prefix}/:collection/:id`, validateCollection, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        const deleted = await engine.delete(scope, req.params.collection as string, req.params.id as string);
        if (!deleted) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true });
      } catch (e) {
        handleEngineError(res, e);
      }
    });
  }

  mount('/app-data', false);
  mount('/app-shared', true);
  return r;
}
