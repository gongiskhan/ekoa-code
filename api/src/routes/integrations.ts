/**
 * Integrations router (ch03 §3.8.13). Two surfaces:
 *  - the DEFINITIONS registry (read-only): list definitions, the active catalog, and an
 *    org-admin refresh that reloads the versioned packages from disk (ch03 §3.8.13 rows).
 *  - configs CRUD; credentials NEVER returned (summary only).
 * Persistence via the integrations service; definitions via the registry (ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { type Actor, SetDefinitionVisibilityRequest, SetDefinitionGlobalRequest } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { listConfigs, createConfig, updateConfig, deleteConfig, configSummary } from '../integrations/service.js';
import { refreshDefinitions, integrationAutomationTemplate } from '../integrations/definitions.js';
import { resolveDefinition, listDefinitionsFor, activeCatalogFor } from '../integrations/definition-registry.js';
import {
  integrationDefinitionStore,
  type DefinitionVisibility,
  type SetVisibilityResult,
} from '../integrations/definition-store.js';
import { provisionIntegrationAutomations, sessionActionRows, type ProvisionBinding } from '../automation/index.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';
import { z } from 'zod';

/**
 * Join a definition's automation-bound actions with their template payloads (the provisioner
 * and the session rows both consume this; automation/ never imports integrations/).
 *
 * A2: the DEFINITION is resolved tenant-scoped; the TEMPLATE body still comes off disk
 * (`integrationAutomationTemplate`) because automation templates are package FILES that have not
 * moved to the database — A3 owns that move.
 */
async function automationBindings(actor: Actor, key: string): Promise<ProvisionBinding[]> {
  const def = await resolveDefinition(actor, key);
  return (def?.actions ?? [])
    .filter((a) => a.automationBinding?.automationTemplate)
    .map((a) => ({
      actionName: a.actionName,
      description: a.description,
      mutates: a.mutates,
      templateKey: a.automationBinding!.automationTemplate!,
      template: integrationAutomationTemplate(key, a.automationBinding!.automationTemplate!),
    }));
}

const CreateConfig = z.object({ integrationKey: z.string(), configValues: z.record(z.unknown()), name: z.string().optional() });
const UpdateConfig = z.object({ enabled: z.boolean().optional(), configValues: z.record(z.unknown()).optional() });

/**
 * Map the definition store's write verdict onto the house error envelope — the ONE place both
 * sharing routes below answer from, so the two can never drift apart:
 *   `notfound`  -> 404 NOT_FOUND, byte-for-byte with a genuinely missing id. A row the caller
 *                  cannot READ answers this too: a write must not become an existence oracle for
 *                  a private definition the caller was never allowed to see.
 *   `forbidden` -> 403 FORBIDDEN. The caller can see the row but may not rewrite it (a same-org
 *                  peer of an `org` row), or the write touches the super-admin-only `global` tier.
 *   `ok`        -> the visibility now stored, echoed straight off the persisted document rather
 *                  than off the request, so the response can only ever report the real state.
 */
function sendVisibility(res: Response, result: SetVisibilityResult): void {
  if (result.verdict === 'notfound') return notFound(res);
  if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
  res.json({ ok: true, visibility: result.doc.visibility });
}

export function integrationsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);

  // --- Definitions registry (read surface; execution stack is G8) ---------------------------

  // GET /api/v1/integrations -> { items: IntegrationDefinition[] } (auth: user, 'list-skills').
  // A2: TENANT-SCOPED. The actor's visible stored definitions merged over the shipped baseline —
  // this is the filter that stops one org's authored package being listed to every other org.
  // Wire shape is unchanged (Rule 7): the same `{ items: IntegrationDefinition[] }`.
  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listDefinitionsFor(actorOf(req)) });
  });

  // GET /api/v1/integrations/active -> { items: ActiveIntegration[] } (auth: user, 'list-active').
  // The active set = definitions the actor's org has an ENABLED config for; each entry carries
  // the action + webhook/listener event catalogs the trigger picker offers. A2: the catalog is
  // built over the actor's VISIBLE definitions before the enabled-config join.
  r.get('/active', async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const configs = await listConfigs(actor);
    const enabled = new Set(configs.filter((c) => c.enabled).map((c) => c.integrationKey));
    res.json({ items: (await activeCatalogFor(actor)).filter((e) => enabled.has(e.key)) });
  });

  // POST /api/v1/integrations/refresh -> { count, keys } (auth: org-admin, 'refresh-registry').
  // SCOPE (A2): this reloads the PROCESS-WIDE DISK registry (api/assets/integrations + the runtime
  // tier) and nothing else. It does not read, write or invalidate any tenant definition document —
  // those are read per request straight off Mongo and need no refresh. The reported {count, keys}
  // is therefore the disk baseline's, deliberately NOT the caller's visible set.
  r.post('/refresh', requireRole('org-admin', 'super-admin'), (_req: AuthedRequest, res: Response) => {
    res.json(refreshDefinitions());
  });

  // --- Definition SHARING (slice E1) ---------------------------------------------------------
  //
  // Both routes are a thin, validated shell over the ONE gate: `integrationDefinitionStore`'s
  // `setVisibility` (definition-store.ts), which already enforces the owner-or-admin write gate,
  // the no-existence-oracle `notfound`, and "the `global` tier is super-admin only, on promotion
  // AND on demotion". The gate is NOT re-implemented here; nothing below re-derives visibility.
  //
  // A2 CARRY-FORWARD: the acting tenant is `actorOf(req)` — off the verified JWT — and NOTHING
  // else. Neither route reads `orgId` or `userId` from the request body; there is no body field
  // that could name another tenant, and the `:id` is resolved by the store under that actor.

  /**
   * PATCH /api/v1/integrations/definitions/:id/visibility -> { ok, visibility } (auth: user).
   * The TENANT surface: an owner (or their org-admin) shares their own definition with the org, or
   * pulls it back to private. `SetDefinitionVisibilityRequest` is a two-value enum, so a body
   * asking for `global` is a 400 at the schema — the tenant route cannot publish cross-org, and
   * that fact is in the wire contract rather than only in a handler branch. A caller who already
   * owns a `global` row still cannot demote it here: the store answers `forbidden` unless they are
   * a super-admin, which is why the demotion direction is gated too.
   */
  r.patch('/definitions/:id/visibility', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SetDefinitionVisibilityRequest, req.body);
    if (!body) return;
    const result = await integrationDefinitionStore.setVisibility(req.params.id as string, actorOf(req), body.visibility);
    sendVisibility(res, result);
  });

  /**
   * POST /api/v1/integrations/definitions/:id/global -> { ok, visibility } (auth: super-admin).
   * The cross-org publish toggle — the brief's human REVIEW GATE. `requireRole('super-admin')` is
   * defense in depth, mirroring `artifacts.ts`'s featured-flag route: the store enforces the same
   * bar on both directions, so a regression in either layer alone cannot publish a tenant's
   * definition to every org.
   */
  r.post('/definitions/:id/global', requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SetDefinitionGlobalRequest, req.body);
    if (!body) return;
    // DEMOTION TARGET: un-publishing returns the row to `org`, NOT to `private`. `global` is a tier
    // the authoring org's members were already reading, so dropping straight to `private` would
    // additionally revoke the author's own org — a second, unasked-for change. `org` is the
    // narrowest tier that only undoes the cross-org publication; the owner can then go `private`
    // themselves through the tenant route above.
    const target: DefinitionVisibility = body.global ? 'global' : 'org';
    const result = await integrationDefinitionStore.setVisibility(req.params.id as string, actorOf(req), target);
    sendVisibility(res, result);
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
    const key = req.params.key as string;
    const actor = actorOf(req);
    res.json({
      integrationKey: key,
      status: 'none',
      // Truthful values: capture is a supported product surface but unavailable in this
      // environment (no capture orchestration). The ACTIONS rows are real: the definition's
      // automation bindings joined with the org's materialized managed automations.
      sessionConnect: {
        supported: true,
        available: false,
        message: 'Captura de sessão não disponível nesta versão.',
      },
      session: { status: 'none', capturedAt: null },
      actions: await sessionActionRows(actor, key, await automationBindings(actor, key)),
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
    const key = req.params.key as string;
    const actor = actorOf(req);
    // A2: a key the actor cannot see is a 404, byte-for-byte with a key that does not exist.
    if (!(await resolveDefinition(actor, key))) return notFound(res);
    // Materialize the definition's bound automation templates as org automations (idempotent:
    // deterministic ids; re-provision refreshes from the template).
    const { created, updated, rows } = await provisionIntegrationAutomations(actor, key, await automationBindings(actor, key));
    res.json({ provisioned: rows.some((row) => row.provisioned), created, updated, actions: rows });
  });

  return r;
}
