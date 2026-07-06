/**
 * Served-app data plane (ch03 §3.9, ch04 §4.2.7) — byte-compatible. GET/POST/PUT/DELETE on
 * /api/app-data/:collection[/:id] and /api/app-shared/:collection[/:id], header-scoped by
 * X-Ekoa-App-Id (NO platform JWT). Bodies are the bare item (no wrapper), _rev never on the
 * wire. This is the surface the 37 legal e2e specs drive through window.__ekoa.
 */
import { Router, type Request, type Response } from 'express';
import { CollectionsEngine, appScope, sharedScope, EngineError } from '../data/collections-engine.js';
import { resolveApp } from './registry.js';

export function servedDataRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  const engine = new CollectionsEngine(deps);

  async function scopeFor(req: Request, res: Response, shared: boolean) {
    const header = req.header('x-ekoa-app-id');
    if (!header) {
      res.status(400).json({ error: { code: 'VALIDATION_FAILED', message: 'X-Ekoa-App-Id em falta.' } });
      return null;
    }
    if (header.startsWith('usr.')) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Scope reservado.' } });
      return null;
    }
    const app = await resolveApp(header);
    if (!app) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'App não encontrada.' } });
      return null;
    }
    if (shared) {
      if (!app.sharedData) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'App não partilha dados.' } });
        return null;
      }
      return sharedScope(app.appId, app.ownerUserId);
    }
    return appScope(app.appId);
  }

  function handleEngineError(res: Response, e: unknown): void {
    if (e instanceof EngineError) {
      res.status(e.status).json({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });
      return;
    }
    res.status(500).json({ error: { code: 'INTERNAL', message: 'Erro interno.' } });
  }

  function mount(prefix: string, shared: boolean) {
    r.get(`${prefix}/:collection`, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        res.json(await engine.list(scope, req.params.collection as string));
      } catch (e) {
        handleEngineError(res, e);
      }
    });
    r.get(`${prefix}/:collection/:id`, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        const item = await engine.get(scope, req.params.collection as string, req.params.id as string);
        if (!item) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Não encontrado.' } });
        res.json(item);
      } catch (e) {
        handleEngineError(res, e);
      }
    });
    r.post(`${prefix}/:collection`, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        res.status(201).json(await engine.create(scope, req.params.collection as string, req.body ?? {}));
      } catch (e) {
        handleEngineError(res, e);
      }
    });
    r.put(`${prefix}/:collection/:id`, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        res.json(await engine.upsert(scope, req.params.collection as string, req.params.id as string, req.body ?? {}));
      } catch (e) {
        handleEngineError(res, e);
      }
    });
    r.delete(`${prefix}/:collection/:id`, async (req, res) => {
      const scope = await scopeFor(req, res, shared);
      if (!scope) return;
      try {
        await engine.delete(scope, req.params.collection as string, req.params.id as string);
        res.json({ ok: true });
      } catch (e) {
        handleEngineError(res, e);
      }
    });
  }

  mount('/app-data', false);
  mount('/app-shared', true);
  return r;
}
