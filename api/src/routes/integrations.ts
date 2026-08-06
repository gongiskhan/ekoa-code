/**
 * Integrations router (ch03 §3.8.13). Since D1 it carries TWO ADMISSION TIERS, and the split is
 * the point:
 *
 *   1. The PUBLIC CAPABILITY surface — `user-or-key` (Capability Contract rule 4): discover the
 *      caller's integrations (`GET /`), read one as a capability (`GET /:key`), and execute an
 *      action under the caller's own credentials (`POST /:key/actions/:actionName/execute`). A
 *      per-user gateway key reaches these; `requireUserOrApiKey` delegates to `requireAuth`
 *      untouched for a platform JWT, so the dashboard's calls are byte-identical to before.
 *   2. Everything else — the dashboard surface: configs CRUD, the active catalog, the org-admin
 *      refresh, the SHARING routes (E1) and the three WRITE-GATE consent routes (C2). These carry
 *      `requireAuth` and a gateway key can never reach them. The consent routes in particular are
 *      `auth: 'user'` on purpose: an agent refused at the write gate must not be able to POST the
 *      shape it was just handed and retry (see shared/src/integrations.ts `approveAction`).
 *
 * HOW THE TWO TIERS ARE KEPT APART, and why the ordering below is load-bearing: express matches in
 * registration order, so `GET /:key` (tier 1) is registered AFTER the dashboard's literal-segment
 * routes (`/active`, `/configs`, `/refresh`, `/definitions/…`) — otherwise it would swallow them —
 * and the router-wide `requireAuth` blanket sits BELOW it, covering every remaining `:key` route.
 * That blanket is the SAFE DEFAULT for anything appended later. The routes above it each carry
 * their admission EXPLICITLY, and `api/tests/contract/integrations-capability.test.ts` walks this
 * router's own stack and probes every route it finds: unauthenticated must be 401, and every route
 * outside the declared capability set must refuse a real gateway key. A new route added anywhere in
 * this file is therefore covered by that gate without anyone remembering to extend it.
 *
 * Persistence via the integrations service; definitions via the tenant-scoped registry (ch02 §2.7);
 * credentials NEVER returned (summary only).
 */
import { Router, type Response } from 'express';
import {
  type Actor,
  SetDefinitionVisibilityRequest,
  SetDefinitionGlobalRequest,
  ApproveIntegrationActionRequest,
  ExecuteIntegrationActionRequest,
  AchieveIntegrationGoalRequest,
  TrustAuthoredActionRequest,
  IntegrationActionParams,
  IntegrationKeyParams,
  SetIntegrationLessonsRequest,
} from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { requireUserOrApiKey, type ApiKeyPrincipal } from '../auth/api-key-middleware.js';
import { listConfigs, upsertConfig, updateConfig, deleteConfig, configSummary, findConfigForOwner } from '../integrations/service.js';
import { refreshDefinitions, integrationAutomationTemplate } from '../integrations/definitions.js';
import { resolveDefinition, listDefinitionsFor, activeCatalogFor } from '../integrations/definition-registry.js';
import {
  actionRequiresConsent,
  approveAction,
  describeAction,
  liveApprovalFor,
  targetResolutionOf,
  revokeActionApprovals,
} from '../integrations/action-consent.js';
import {
  capabilityWireOutcome,
  executeIntegrationCapabilityAction,
  getIntegrationCapability,
  type CapabilityContext,
  type CapabilityRefusal,
} from '../integrations/integration-capability.js';
import {
  achieveIntegrationGoal,
  trustAuthoredAction,
  type ActionDrafter,
} from '../integrations/integration-achieve.js';
import {
  integrationDefinitionStore,
  type DefinitionVisibility,
  type SetVisibilityResult,
} from '../integrations/definition-store.js';
import { readLessons, writeLessons } from '../integrations/definition-lessons.js';
import { provisionIntegrationAutomations, sessionActionRows, type ProvisionBinding } from '../automation/index.js';
import type { AutomationBackedHandler } from '../integrations/action-executor.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';
import { z } from 'zod';

/**
 * Join a definition's automation-bound actions with their template payloads (the provisioner
 * and the session rows both consume this; automation/ never imports integrations/).
 *
 * A2/A3: the DEFINITION is resolved tenant-scoped; the TEMPLATE body still comes off disk
 * (`integrationAutomationTemplate`) because automation templates are package FILES only shipped
 * with BASELINE packages — and since A3 that lookup is baseline-only (the retired runtime tier is
 * never probed on this tenant response path).
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

/**
 * The audit/exec context for a capability call: the actor from the VERIFIED principal (never a
 * body field), the username the activity row needs, and — for a key-admitted call — the trace-only
 * key principal. `x-client` arrives already capped by the admission middleware and is carried into
 * the audit row verbatim; nothing below reads it, let alone branches on it (Rule 3).
 */
function capabilityCtxOf(
  req: AuthedRequest,
  res: Response,
  deps: {
    now: () => number;
    genId: () => string;
    runAutomationBackedAction?: AutomationBackedHandler;
    draftAction?: ActionDrafter;
    callPlatform?: CapabilityContext['callPlatform'];
  },
): CapabilityContext & { draftAction?: ActionDrafter } {
  const p = res.locals.apiKeyPrincipal as ApiKeyPrincipal | undefined;
  return {
    actor: actorOf(req),
    deps,
    ...(p ? { principal: { keyId: p.keyId, ...(p.xClient ? { xClient: p.xClient } : {}) } } : {}),
    ...(req.user?.username ? { username: req.user.username } : {}),
    ...(deps.runAutomationBackedAction ? { runAutomationBackedAction: deps.runAutomationBackedAction } : {}),
    // D3: the AUTHORING seam, bound once by the composition root exactly like the automation one.
    // Absent, `achieve` still executes and refuses to author (`authoring_unavailable`).
    ...(deps.draftAction ? { draftAction: deps.draftAction } : {}),
    // Bound once by the composition root, same as the two seams above. Its ABSENCE is meaningful:
    // a platform action then falls through to the user-credential rail and is refused there, which
    // is the correct closed answer rather than a silent cross-custody read.
    ...(deps.callPlatform ? { callPlatform: deps.callPlatform } : {}),
  };
}

/**
 * The two capability refusals on the wire.
 *
 * `not_found` is the house 404, byte-identical for "no such integration" and "not visible to you" —
 * the same no-existence-oracle posture the sharing and consent routes already take.
 * `no_tenant` is a 403: the caller authenticated, but their principal names no organisation, and
 * since A2 the org SELECTS which definition resolves — so resolving anything for them would mean
 * resolving an arbitrary tenant's package. Fail closed, and say so rather than answering an
 * ambiguous 404 that reads like a missing integration.
 */
function refuseCapability(res: Response, refusal: CapabilityRefusal): void {
  if (refusal === 'not_found') return notFound(res);
  sendError(res, 'FORBIDDEN', 'A sua conta não pertence a nenhuma organização.');
}

export function integrationsRouter(deps: {
  now: () => number;
  genId: () => string;
  /** The automation seam the composition root binds ONCE and hands to every executor rail. */
  runAutomationBackedAction?: AutomationBackedHandler;
  /** The AUTHORING seam (D3): one drafting turn on D2's shared authoring core. */
  draftAction?: ActionDrafter;
  /** The PLATFORM seam: google-workspace / microsoft-365 run on org-scoped OAuth custody. */
  callPlatform?: CapabilityContext['callPlatform'];
}): Router {
  const r = Router();

  // ===========================================================================================
  // TIER 1 (part 1) — the PUBLIC CAPABILITY surface: the exact-path route.
  // Registered before any `requireAuth`, so a gateway key reaches it.
  // ===========================================================================================

  // GET /api/v1/integrations -> { items: IntegrationDefinition[] } (auth: USER-OR-KEY since D1).
  // A2: TENANT-SCOPED. The actor's visible stored definitions merged over the shipped baseline —
  // this is the filter that stops one org's authored package being listed to every other org.
  // Wire shape is unchanged (Rule 7): the same `{ items: IntegrationDefinition[] }` the dashboard
  // has always read, from the same call under the same actor. What D1 changed is WHO may ask:
  // this is the capability DISCOVERY endpoint, so an outside client can find its user's
  // integrations before calling `GET /:key` and `POST /:key/actions/:actionName/execute`.
  r.get('/', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listDefinitionsFor(actorOf(req)) });
  });

  // ===========================================================================================
  // TIER 2 (part 1) — dashboard routes whose FIRST SEGMENT IS A LITERAL. They must be registered
  // before the tier-1 `/:key` routes below, or `:key` would swallow `active` / `configs` /
  // `refresh` / `definitions`. Each carries `requireAuth` explicitly (the router-wide blanket
  // starts further down).
  // ===========================================================================================

  // GET /api/v1/integrations/active -> { items: ActiveIntegration[] } (auth: user, 'list-active').
  // The active set = definitions the actor's org has an ENABLED config for; each entry carries
  // the action + webhook/listener event catalogs the trigger picker offers. A2: the catalog is
  // built over the actor's VISIBLE definitions before the enabled-config join.
  r.get('/active', requireAuth, async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const configs = await listConfigs(actor);
    const enabled = new Set(configs.filter((c) => c.enabled).map((c) => c.integrationKey));
    res.json({ items: (await activeCatalogFor(actor)).filter((e) => enabled.has(e.key)) });
  });

  // POST /api/v1/integrations/refresh -> { count, keys } (auth: org-admin, 'refresh-registry').
  // SCOPE (A3): this reloads the SHIPPED BASELINE packages (api/assets/integrations) and nothing
  // else — the disk runtime tier is retired, so the reported {count, keys} is the same shipped set
  // for every caller and can no longer enumerate other tenants' authored keys (A2-residual 1).
  // It does not read, write or invalidate any tenant definition document — those are read per
  // request straight off Mongo and need no refresh.
  r.post('/refresh', requireAuth, requireRole('org-admin', 'super-admin'), (_req: AuthedRequest, res: Response) => {
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
  r.patch('/definitions/:id/visibility', requireAuth, async (req: AuthedRequest, res: Response) => {
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
  r.post('/definitions/:id/global', requireAuth, requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
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

  // --- Configs CRUD (literal first segment — must precede the `/:key` routes) -----------------

  r.get('/configs', requireAuth, async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listConfigs(actorOf(req))).map(configSummary) });
  });

  r.post('/configs', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateConfig, req.body);
    if (!body) return;
    // `secretKeys` comes from the definition's own schema and decides which values may be stored
    // in the non-secret projection the consent path reads (service.ts `publicValuesOf`). Resolved
    // HERE because `service.ts` cannot import the registry - `definitions.ts` imports `service.ts`,
    // so that edge would close an import cycle (docs/findings.md).
    const actorForCreate = actorOf(req);
    const createDef = await resolveDefinition(actorForCreate, body.integrationKey);
    // UPSERT, not insert: the dashboard's save button posts here every time, so an unconditional
    // insert made every re-save a duplicate row for the same integration, and duplicates resolve
    // nondeterministically (`findConfigForOwner`). A re-save updates the row it would have
    // created, merging into the stored bundle. 201 on a genuine connect, 200 on a re-save.
    const result = await upsertConfig(
      actorForCreate,
      {
        ...(body as { integrationKey: string; configValues: Record<string, unknown>; name?: string }),
        secretKeys: (createDef?.configSchema ?? []).filter((f) => f?.secret).map((f) => f.key),
      },
      deps,
    );
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'undecryptable') {
      return sendError(res, 'SECRET_GUARD_BLOCKED', 'As credenciais guardadas não puderam ser lidas, por isso a gravação foi recusada para não as destruir. Volte a introduzir todas as credenciais desta integração.');
    }
    res.status(result.created ? 201 : 200).json(configSummary(result.config!));
  });

  r.patch('/configs/:integrationKey', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, UpdateConfig, req.body);
    if (!body) return;
    const a = actorOf(req);
    const target = (await listConfigs(a)).find((c) => c.integrationKey === req.params.integrationKey);
    if (!target) return notFound(res);
    const patchDef = await resolveDefinition(a, req.params.integrationKey as string);
    const result = await updateConfig(a, target._id, {
      ...(body as { enabled?: boolean; configValues?: Record<string, unknown> }),
      secretKeys: (patchDef?.configSchema ?? []).filter((f) => f?.secret).map((f) => f.key),
    });
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    // The stored bundle could not be decrypted, so it could not be merged into. Refusing is the
    // point: writing the patch alone would silently wipe every credential it omits. Recovery is
    // to re-enter them all (the client then sends a complete bundle, which merges to itself).
    // `SECRET_GUARD_BLOCKED` (422) rather than a new code: a guard protecting stored secrets
    // refused the write, which is exactly what this code already names on the artifact-download
    // path, and the shared ErrorCode enum is a client contract - adding a member makes every
    // older client read the body as "not the shared error envelope" (clients/cortex-cli).
    if (result.verdict === 'undecryptable') {
      return sendError(res, 'SECRET_GUARD_BLOCKED', 'As credenciais guardadas não puderam ser lidas, por isso a gravação foi recusada para não as destruir. Volte a introduzir todas as credenciais desta integração.');
    }
    res.json(configSummary(result.config!));
  });

  // ===========================================================================================
  // TIER 1 (part 2) — the PUBLIC CAPABILITY surface's `:key` routes (slice D1).
  //
  // Registered HERE: after every dashboard route whose first segment is a literal (so `:key`
  // cannot swallow `active`/`configs`/`refresh`/`definitions`), and before the router-wide
  // `requireAuth` blanket below (so a gateway key reaches them). Both carry
  // `requireUserOrApiKey` explicitly rather than relying on position.
  //
  // Behaviour lives in `integrations/integration-capability.ts`; these two handlers validate,
  // call it once, and shape the answer.
  // ===========================================================================================

  /**
   * GET /api/v1/integrations/:key -> IntegrationCapability (auth: user-or-key).
   *
   * The definition as the list already projects it (one projection, never a second one that could
   * drift), plus per-action execution metadata: how it runs, where it writes, whether it needs a
   * human approval and whether one already stands for this caller. Resolved through A2's
   * tenant-scoped registry under the verified actor, so an integration the caller may not see is a
   * 404 byte-identical with one that does not exist.
   */
  r.get('/:key', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const out = await getIntegrationCapability(capabilityCtxOf(req, res, deps), params.data.key);
    if (!out.ok) return refuseCapability(res, out.refusal);
    res.json(out.value);
  });

  /**
   * POST /api/v1/integrations/:key/actions/:actionName/execute -> ExecuteIntegrationActionResponse.
   *
   * THE WRITE GATE IS INHERITED, NOT RE-IMPLEMENTED HERE. The call goes to
   * `executeUserIntegrationAction` (through the capability module) and meets C2's
   * `checkActionConsent` inside it, before any credential is loaded. An unapproved `mutates` action
   * therefore answers 403 with `details.code = 'awaiting_consent'` and the descriptor a human must
   * be shown — and the endpoint that BANKS that answer, `POST …/approval`, is `auth: 'user'` and
   * sits below the blanket, so the gateway key that was just refused cannot approve itself.
   *
   * The request body carries `args` and nothing else: no field names an org, a user or an owner,
   * and zod strips unknown keys, so a body inventing one is inert (Rule 5).
   */
  r.post('/:key/actions/:actionName/execute', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, ExecuteIntegrationActionRequest, req.body ?? {});
    if (!body) return;
    const out = await executeIntegrationCapabilityAction(
      capabilityCtxOf(req, res, deps),
      params.data.key,
      params.data.actionName,
      body.args ?? {},
    );
    if (!out.ok) return refuseCapability(res, out.refusal);
    const wire = capabilityWireOutcome(out.value);
    if (wire.kind === 'not_found') return notFound(res);
    if (wire.kind === 'awaiting_consent') {
      return sendError(
        res,
        'FORBIDDEN',
        'Esta ação altera dados e precisa da autorização do titular antes de correr.',
        { code: 'awaiting_consent', consentRequest: wire.consentRequest },
      );
    }
    res.json(wire.body);
  });

  /**
   * POST /api/v1/integrations/:key/achieve -> AchieveIntegrationGoalResponse (slice D3).
   *
   * EXECUTE-OR-AUTHOR. The handler is a shell: validate, call `achieveIntegrationGoal` once, map
   * the outcome. Every guardrail lives in the module, so none of them can be re-decided per route.
   *
   * THE WRITE GATE IS THE SAME ONE, ON THE SAME WIRE. The execute arm returns an executor result,
   * and an unapproved `mutates` action comes back with `code: 'awaiting_consent'` — which this
   * handler answers with the IDENTICAL 403 envelope `/execute` above answers, through the same
   * `capabilityWireOutcome` mapping. A client therefore handles the gate in ONE place rather than
   * learning a second dialect for this endpoint, and there is no path here that could answer 200
   * for a write nobody approved.
   *
   * A REFUSAL IS A 200 CARRYING `outcome: 'refused'`, not an error envelope, and that is deliberate:
   * "no action fits and I could not write one because the host is not bound" is an ANSWER about the
   * caller's integration, exactly like a remote 4xx is an answer about the remote system (the same
   * argument `/execute` makes for returning failed results at 200). The two cases that are NOT
   * answers stay envelopes: unaddressable is a 404, and no-tenant is a 403.
   */
  r.post('/:key/achieve', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, AchieveIntegrationGoalRequest, req.body ?? {});
    if (!body) return;
    const out = await achieveIntegrationGoal(
      capabilityCtxOf(req, res, deps),
      params.data.key,
      body.goal,
      body.args ?? {},
    );
    if (!out.ok) return refuseCapability(res, out.refusal);
    const result = out.value;
    if (result.outcome === 'executed') {
      const wire = capabilityWireOutcome(result.result);
      if (wire.kind === 'not_found') return notFound(res);
      if (wire.kind === 'awaiting_consent') {
        return sendError(
          res,
          'FORBIDDEN',
          'Esta ação altera dados e precisa da autorização do titular antes de correr.',
          { code: 'awaiting_consent', consentRequest: wire.consentRequest },
        );
      }
      return res.json({ outcome: 'executed', actionName: result.actionName, result: wire.body });
    }
    res.json(result);
  });

  // ===========================================================================================
  // TIER 2 (part 2) — everything below is PLATFORM-SESSION ONLY. The blanket is the SAFE DEFAULT
  // for any route appended later: a new handler added past this line inherits `requireAuth`
  // whether or not its author thought about admission. Nothing below may become `user-or-key`
  // without moving above it AND declaring the class in `shared/src/integrations.ts`.
  // ===========================================================================================
  r.use(requireAuth);

  // --- The WRITE GATE (slice C2) --------------------------------------------------------------
  //
  // Three routes over `integrations/action-consent.ts`. None of them is the gate: the gate is in
  // `executeUserIntegrationAction`, so it catches every rail (capability route, automation step,
  // listener tick, agent tool) rather than only the ones that happen to pass through a router.
  // These are the surface a human answers it on.
  //
  // ALL THREE ARE `auth: 'user'` AND STAY THAT WAY (C2, reaffirmed by D1). D1 put an execute
  // endpoint on the key-reachable surface; if approving were key-reachable too, an agent refused at
  // the gate could POST the very shape it was just handed and retry. A gate that grants its own
  // exemption is not a gate.
  //
  // TENANCY: the acting (org, user) is `actorOf(req)` — off the verified JWT — and the integration
  // is resolved UNDER THAT ACTOR, so an action the caller cannot see is a 404, byte-identical with
  // a key that does not exist. No body field names an org, a user or another tenant's action.

  /**
   * GET /api/v1/integrations/:key/action-approvals -> { items: IntegrationActionApproval[] }.
   * Every action of the integration with its rendered target, its shape and the live approval.
   * Non-mutating actions are listed too, flagged `requiresConsent: false`: the dashboard has to be
   * able to show that a read needs no permission, and an empty row would read as "not yet asked".
   */
  r.get('/:key/action-approvals', async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const key = req.params.key as string;
    const def = await resolveDefinition(actor, key);
    if (!def) return notFound(res);
    // The SAME resolution the gate uses, so the target shown here is the target an approval is
    // keyed on. Non-secret values only, off the un-decrypted row.
    const cfg = await findConfigForOwner(actor.orgId, actor.userId, key);
    const resolution = targetResolutionOf(def.configSchema, cfg?.publicConfigValues);
    const items = [];
    for (const action of def.actions ?? []) {
      const descriptor = describeAction(key, action, resolution);
      const requiresConsent = actionRequiresConsent(action);
      // A read is never looked up: it has no approval to have, and querying for one would invent a
      // row shape for actions that are not gated.
      const live = requiresConsent
        ? await liveApprovalFor({ orgId: actor.orgId, userId: actor.userId }, key, action.actionName, descriptor.shape, descriptor.target)
        : null;
      items.push({
        actionName: descriptor.actionName,
        description: descriptor.description,
        target: descriptor.target,
        shape: descriptor.shape,
        requiresConsent,
        decision: live?.decision ?? null,
        expiresAt: live?.expiresAt ?? null,
      });
    }
    res.json({ items });
  });

  /**
   * POST /api/v1/integrations/:key/actions/:actionName/approval -> { ok, decision, expiresAt }.
   *
   * The two refusals that matter:
   *  - a NON-MUTATING action cannot be approved. Banking permission for something that needs none
   *    would leave a row that outlives a later flip of `mutates` to true — an approval for a write
   *    the human never saw. Rule 7's "a `mutates:false` action must not gain a prompt" runs in this
   *    direction too.
   *  - a SHAPE MISMATCH is refused. The body echoes the shape the user was shown; if the action was
   *    re-authored between render and click, the answer is about a different action.
   *
   * Both answer `VALIDATION_FAILED` (400) rather than a conflict status: the shared error
   * vocabulary (`shared/src/errors.ts`) has no generic `CONFLICT`, and widening it is a
   * contract-wide change that does not belong to this slice. Both refusals genuinely are about the
   * request body — it named a decision for an ungated action, or a shape that is not this action's
   * — so the code is not a lie, and the messages say precisely which.
   */
  r.post('/:key/actions/:actionName/approval', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ApproveIntegrationActionRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    const key = req.params.key as string;
    const def = await resolveDefinition(actor, key);
    const action = def?.actions?.find((a) => a.actionName === req.params.actionName);
    if (!action) return notFound(res);
    if (!actionRequiresConsent(action)) {
      return sendError(res, 'VALIDATION_FAILED', 'Esta ação não altera dados e não precisa de autorização.');
    }
    const cfg = await findConfigForOwner(actor.orgId, actor.userId, key);
    const descriptor = describeAction(key, action, targetResolutionOf(def?.configSchema, cfg?.publicConfigValues));
    if (descriptor.shape !== body.shape) {
      return sendError(res, 'VALIDATION_FAILED', 'A ação mudou desde que foi apresentada. Reveja e confirme de novo.');
    }
    const { expiresAt } = await approveAction({ orgId: actor.orgId, userId: actor.userId }, descriptor, body.decision);
    res.json({ ok: true, decision: body.decision, expiresAt });
  });

  /**
   * DELETE /api/v1/integrations/:key/actions/:actionName/approval -> { ok, revoked }.
   * Revoking does NOT require the action to still exist in a resolvable definition — a user must be
   * able to withdraw permission from an action that was just deleted or re-authored, which is
   * exactly when they most want to. The delete is scoped to their own (org, user) rows regardless.
   */
  r.delete('/:key/actions/:actionName/approval', async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const revoked = await revokeActionApprovals(
      { orgId: actor.orgId, userId: actor.userId },
      req.params.key as string,
      req.params.actionName as string,
    );
    res.json({ ok: true, revoked });
  });

  /**
   * POST /api/v1/integrations/:key/actions/:actionName/trust -> { ok, actionName, state, mutates }.
   *
   * PROMOTE an action `achieve` authored, from provisional to trusted (slice D3). It sits BELOW the
   * `requireAuth` blanket on purpose, and that position is the point: `achieve` is `user-or-key`,
   * so if a gateway key could reach this route an agent would author an action and bless its own
   * work in the next request. Same rule, same place in this file, as the three consent routes above.
   *
   * The gates are `trustAuthoredAction`'s, not this handler's. The four verdicts that are not `ok`
   * map to the house envelope the way the rest of this domain does — a row the caller cannot see
   * and a row that does not exist answer the same 404, and the three body-shaped refusals answer
   * `VALIDATION_FAILED` with a message that says which, exactly as `approveAction` does for its own
   * shape mismatch (`shared/src/errors.ts` has no generic CONFLICT, and widening it is a
   * contract-wide change that does not belong to this slice).
   */
  r.post('/:key/actions/:actionName/trust', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, TrustAuthoredActionRequest, req.body);
    if (!body) return;
    const out = await trustAuthoredAction(actorOf(req), params.data.key, params.data.actionName, body.shape);
    switch (out.verdict) {
      case 'notfound': return notFound(res);
      case 'forbidden': return sendError(res, 'FORBIDDEN', 'Sem permissão.');
      case 'shape_mismatch':
        return sendError(res, 'VALIDATION_FAILED', 'A ação mudou desde que foi apresentada. Reveja e confirme de novo.');
      case 'not_authored':
        return sendError(res, 'VALIDATION_FAILED', 'Esta ação foi escrita por uma pessoa e não precisa de ser confirmada.');
      case 'unverified':
        return sendError(res, 'VALIDATION_FAILED', 'Esta ação mudou desde que foi verificada — peça de novo o objetivo para a reescrever.');
      default:
        return res.json({ ok: true, actionName: out.actionName, state: out.state, mutates: out.mutates });
    }
  });

  // --- Per-integration LESSONS (slice C3) -----------------------------------------------------
  //
  // Two thin routes over `integrations/definition-lessons.ts`. NOTHING about the raw-vs-scrubbed
  // split, the admission set, the ceiling or the CAS is decided here — this layer validates, calls
  // once, and maps the verdict onto the envelope. Both sit BELOW the `requireAuth` blanket: they
  // are `auth: 'user'` and a gateway key never reaches them (the descriptors say why).

  r.get('/:key/lessons', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const result = await readLessons(actorOf(req), params.data.key);
    if (result.verdict === 'notfound') return notFound(res);
    res.json(result.view);
  });

  r.patch('/:key/lessons', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, SetIntegrationLessonsRequest, req.body);
    if (!body) return;
    const result = await writeLessons(actorOf(req), params.data.key, body.lessons, {
      ...(body.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: body.expectedUpdatedAt } : {}),
    });
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') {
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para editar as lições desta integração.');
    }
    if (result.verdict === 'too_long') {
      // Belt-and-braces: the shared schema already refuses this length, so reaching here means the
      // two disagreed. Same 400 either way — the body genuinely is invalid.
      return sendError(res, 'VALIDATION_FAILED', 'As lições excedem o limite de caracteres.', {
        code: 'lessons_too_long', limit: result.limit, length: result.length,
      });
    }
    if (result.verdict === 'stale') {
      // 400 and not a conflict status, for the reason `approveAction` states one screen up: the
      // shared error vocabulary has no generic CONFLICT and widening it does not belong to this
      // slice. The refusal genuinely IS about the body — it named a revision that is no longer
      // current — and `details.current` carries what IS stored, so the editor can show both
      // versions instead of guessing.
      return sendError(res, 'VALIDATION_FAILED', 'Estas lições foram alteradas entretanto. Reveja a versão guardada.', {
        code: 'stale_revision', current: result.view,
      });
    }
    res.json(result.view);
  });

  // --- Config removal + session/provision (the remaining `:key` dashboard routes) -------------

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
