/**
 * Integrations router (ch03 §3.8.13). Two surfaces:
 *  - the DEFINITIONS registry (read-only): list definitions, the active catalog, and an
 *    org-admin refresh that reloads the versioned packages from disk (ch03 §3.8.13 rows).
 *  - configs CRUD; credentials NEVER returned (summary only).
 * Persistence via the integrations service; definitions via the registry (ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { listConfigs, createConfig, updateConfig, deleteConfig, configSummary } from '../integrations/service.js';
import { listDefinitions, activeCatalog, refreshDefinitions } from '../integrations/definitions.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';
import { z } from 'zod';

const CreateConfig = z.object({ integrationKey: z.string(), configValues: z.record(z.unknown()), name: z.string().optional() });
const UpdateConfig = z.object({ enabled: z.boolean().optional(), configValues: z.record(z.unknown()).optional() });

export function integrationsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  // --- Definitions registry (read surface; execution stack is G8) ---------------------------

  // GET /api/v1/integrations -> { items: IntegrationDefinition[] } (auth: user, 'list-skills').
  r.get('/', (_req: AuthedRequest, res: Response) => {
    res.json({ items: listDefinitions() });
  });

  // GET /api/v1/integrations/active -> { items: ActiveIntegration[] } (auth: user, 'list-active').
  // The active set = definitions the actor's org has an ENABLED config for; each entry carries
  // the action + webhook/listener event catalogs the trigger picker offers.
  r.get('/active', async (req: AuthedRequest, res: Response) => {
    const configs = await listConfigs(actorOf(req));
    const enabled = new Set(configs.filter((c) => c.enabled).map((c) => c.integrationKey));
    res.json({ items: activeCatalog().filter((e) => enabled.has(e.key)) });
  });

  // POST /api/v1/integrations/refresh -> { count, keys } (auth: org-admin, 'refresh-registry').
  r.post('/refresh', requireRole('org-admin', 'super-admin'), (_req: AuthedRequest, res: Response) => {
    res.json(refreshDefinitions());
  });

  // --- Configs CRUD -------------------------------------------------------------------------

  r.get('/configs', async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listConfigs(actorOf(req))).map(configSummary) });
  });

  r.post('/configs', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateConfig, req.body);
    if (!body) return;
    const c = await createConfig(actorOf(req), body as { integrationKey: string; configValues: Record<string, unknown>; name?: string }, deps);
    res.status(201).json(configSummary(c));
  });

  r.patch('/configs/:integrationKey', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, UpdateConfig, req.body);
    if (!body) return;
    const a = actorOf(req);
    const target = (await listConfigs(a)).find((c) => c.integrationKey === req.params.integrationKey);
    if (!target) return notFound(res);
    const result = await updateConfig(a, target._id, body as { enabled?: boolean; configValues?: Record<string, unknown> });
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json(configSummary(result.config!));
  });

  r.delete('/:key', async (req: AuthedRequest, res: Response) => {
    const result = await deleteConfig(actorOf(req), req.params.key as string);
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json({ ok: true });
  });

  /**
   * F5 session-capture endpoints. There is NO server-side session-capture orchestration in this
   * build (the browser capture lives on the ekoa-local bridge, de-scoped for rc-1). Per the F5
   * brief these answer their declared shape with truthful values and never claim a captured
   * session. SECRET HYGIENE (shared/src/integrations.ts SessionSnapshot): the captured Playwright
   * storageState/cookies are consumed in-memory by the automation engine and MUST NEVER be
   * serialized to a client — these responses carry STATUS METADATA ONLY.
   */
  r.get('/:key/session', async (req: AuthedRequest, res: Response) => {
    res.json({
      integrationKey: req.params.key as string,
      status: 'none',
      session: { status: 'none', capturedAt: null },
    });
  });

  r.post('/:key/session', async (req: AuthedRequest, res: Response) => {
    res.json({
      started: false,
      session: { status: 'failed', message: 'Captura de sessão não disponível nesta versão.' },
    });
    void req;
  });

  r.post('/:key/provision-automations', async (req: AuthedRequest, res: Response) => {
    // No automation-provisioning infrastructure: real zeros, never a fabricated created/updated count.
    res.json({ provisioned: false, created: 0, updated: 0, actions: [] });
    void req;
  });

  return r;
}
