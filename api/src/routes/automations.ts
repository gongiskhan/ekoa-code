/**
 * Automations router (ch03 §3.8.18 + §3.6.3). One function call per route into the
 * automation/ service surface — routes never touch data/ (ch02 §2.7). The run SSE stream
 * authenticates via ?token= (CONV-1) and attaches to events/. Org scoping (Amendment 2)
 * lives in the service; creation authority reads the org's flippable builder-authoring
 * setting through the platform-crud org read.
 *
 * SLICE E4 — this is a CAPABILITY surface (Capability Contract rule 4): the router mounts
 * `requireUserOrApiKey`, so a platform JWT (byte-identical requireAuth path) or an `ekoa_gk_`
 * gateway key admits every route below. The SSE stream deliberately stays `?token=`-only: its
 * token is a real jti-bearing platform JWT, and a key must never end up riding a session token
 * that outlives the key's revocation (E1 review).
 */
import { Router, type Request, type Response } from 'express';
import {
  AutomationCreateRequest,
  AutomationPatch,
  PlanRequest,
  RunCreateRequest,
  IdempotencyKey,
  ConsentRequest,
  StepFeedbackRequest,
  RevokeApprovedCommandRequest,
  type Actor,
} from '@ekoa/shared';
import { verifySseToken, type AuthedRequest } from '../auth/middleware.js';
import { requireUserOrApiKey, type ApiKeyPrincipal } from '../auth/api-key-middleware.js';
import { sseManager } from '../events/sse-manager.js';
import {
  AutomationServiceError,
  listAutomations,
  getAutomation,
  createAutomation,
  patchAutomation,
  deleteAutomation,
  planFromGoal,
  startRun,
  listRuns,
  getRunRecord,
  getRunLogs,
  cancelRun,
  resumeRun,
  resolveConsent,
  submitStepFeedback,
  buildCatalog,
  listApprovedCommands,
  revokeApprovedCommand,
  type RunCreateCallContext,
} from '../automation/index.js';
import { getOrg } from '../services/platform-crud.js';
import { actorOf, sendError, parseBody } from './helpers.js';

/** Map a service error onto the shared error envelope (uniform 404 parity, ch04). */
function sendServiceError(res: Response, err: unknown): void {
  if (err instanceof AutomationServiceError) {
    if (err.code === 'NOT_FOUND') return sendError(res, 'NOT_FOUND', 'Automação não encontrada.');
    if (err.code === 'FORBIDDEN') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    return sendError(res, 'VALIDATION_FAILED', err.message);
  }
  throw err;
}

/** The key principal a gateway-key admission left on res.locals — trace only (rule 3). */
function callContextOf(req: AuthedRequest, res: Response): RunCreateCallContext {
  const p = res.locals.apiKeyPrincipal as ApiKeyPrincipal | undefined;
  return {
    ...(p ? { principal: { keyId: p.keyId, ...(p.xClient ? { xClient: p.xClient } : {}) } } : {}),
    ...(req.user?.username ? { username: req.user.username } : {}),
  };
}

/**
 * The run-create idempotency key, from the body field or the conventional `Idempotency-Key`
 * header. Returns `{ ok: false }` AFTER answering the envelope when the two disagree or the header
 * value is not a legal key.
 *
 * A body/header CONFLICT is refused rather than resolved. Picking a winner would mean a client
 * whose HTTP layer sets the header while its payload carries a different key silently gets the
 * at-most-once guarantee bound to a key it did not think it was using — the one failure mode this
 * whole feature exists to prevent.
 */
function idempotencyKeyOf(
  req: AuthedRequest,
  res: Response,
  body: { idempotencyKey?: string },
): { ok: true; key?: string } | { ok: false } {
  // An EMPTY header is treated as absent (a client that always sets the header but has no key must
  // behave exactly like one that never sets it). The value itself is opaque and never normalised.
  const raw = req.header('idempotency-key');
  const header = raw !== undefined && raw.trim().length > 0 ? raw : undefined;
  if (header !== undefined && body.idempotencyKey !== undefined && header !== body.idempotencyKey) {
    sendError(res, 'VALIDATION_FAILED', 'O cabeçalho Idempotency-Key não corresponde ao idempotencyKey do corpo.');
    return { ok: false };
  }
  const key = body.idempotencyKey ?? header;
  if (key === undefined) return { ok: true };
  const parsed = IdempotencyKey.safeParse(key);
  if (!parsed.success) {
    sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
    return { ok: false };
  }
  return { ok: true, key: parsed.data };
}

/** Route wrapper: awaits the handler and maps service errors; anything else -> 500 envelope. */
function handle(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof AutomationServiceError) return sendServiceError(res, err);
      // F29: log the FULL error (stack + cause), not just err.message — a swallowed cause was
      // exactly why the plan-from-goal 500s were undiagnosable from the server logs.
      console.error('[automations] route failed:', err);
      if (err instanceof Error && err.cause) console.error('[automations] cause:', err.cause);
      sendError(res, 'INTERNAL', 'Erro interno.');
    }
  };
}

export function automationsRouter(): Router {
  const r = Router();

  // SSE stream (?token= auth) — mounted before requireAuth (EventSource cannot set headers).
  // Visibility = the run's owner or an org admin (the service's canSeeRun via getRunRecord).
  r.get('/runs/:id/events', async (req: Request, res: Response) => {
    const auth = verifySseToken(req.query.token as string | undefined);
    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
    const actor: Actor = { userId: auth.claims.sub, orgId: auth.claims.orgId, role: auth.claims.role };
    try {
      await getRunRecord(actor, req.params.id as string);
    } catch {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Execução não encontrada.' } });
    }
    const lastEventId = req.header('last-event-id');
    sseManager.attach(res, auth.claims.sub, 'automation', req.params.id as string, lastEventId ? Number(lastEventId) : undefined);
  });

  r.use(requireUserOrApiKey);

  // --- Fixed paths BEFORE '/:id' so 'runs'/'plan'/'catalog'/'approved-commands' never bind as ids.

  r.post('/plan', handle(async (req, res) => {
    const body = parseBody(res, PlanRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    // /plan persists a new automation (landmine 9) → same creation gate as POST /automations.
    const org = await getOrg(actor.orgId);
    const settings = (org?.settings ?? {}) as { allowBuilderAutomations?: boolean };
    res.json(await planFromGoal(actor, body, settings));
  }));

  r.get('/runs', handle(async (req, res) => {
    const automationId = typeof req.query.automationId === 'string' ? req.query.automationId : undefined;
    const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
    const items = await listRuns(actorOf(req), {
      ...(automationId ? { automationId } : {}),
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    });
    res.json({ items });
  }));

  r.get('/runs/:id', handle(async (req, res) => {
    res.json(await getRunRecord(actorOf(req), req.params.id as string));
  }));

  // Per-step logs (slice E4). Same owner scoping as GET /runs/:id — a run the caller may not see
  // answers the identical uniform NOT_FOUND.
  r.get('/runs/:id/logs', handle(async (req, res) => {
    res.json(await getRunLogs(actorOf(req), req.params.id as string));
  }));

  r.post('/runs/:id/cancel', handle(async (req, res) => {
    res.json(await cancelRun(actorOf(req), req.params.id as string));
  }));

  r.post('/runs/:id/resume', handle(async (req, res) => {
    res.json(await resumeRun(actorOf(req), req.params.id as string));
  }));

  r.post('/runs/:id/consent', handle(async (req, res) => {
    const body = parseBody(res, ConsentRequest, req.body);
    if (!body) return;
    res.json(await resolveConsent(actorOf(req), req.params.id as string, body));
  }));

  r.post('/runs/:id/steps/:stepId/feedback', handle(async (req, res) => {
    const body = parseBody(res, StepFeedbackRequest, req.body);
    if (!body) return;
    res.json(await submitStepFeedback(actorOf(req), req.params.id as string, req.params.stepId as string, body));
  }));

  r.get('/catalog', handle(async (req, res) => {
    res.json(await buildCatalog(actorOf(req)));
  }));

  r.get('/approved-commands', handle(async (req, res) => {
    res.json({ items: await listApprovedCommands(actorOf(req)) });
  }));

  r.post('/approved-commands/revoke', handle(async (req, res) => {
    const body = parseBody(res, RevokeApprovedCommandRequest, req.body);
    if (!body) return;
    res.json(await revokeApprovedCommand(actorOf(req), body));
  }));

  // --- CRUD (§3.8.18 rows 1-5) ---------------------------------------------------------------

  r.get('/', handle(async (req, res) => {
    res.json({ items: await listAutomations(actorOf(req)) });
  }));

  r.post('/', handle(async (req, res) => {
    const body = parseBody(res, AutomationCreateRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    // Creation is org-admin-only by default; the flippable org setting enables builder authoring.
    const org = await getOrg(actor.orgId);
    const settings = (org?.settings ?? {}) as { allowBuilderAutomations?: boolean };
    res.status(201).json(await createAutomation(actor, body, settings));
  }));

  r.get('/:id', handle(async (req, res) => {
    res.json(await getAutomation(actorOf(req), req.params.id as string));
  }));

  r.patch('/:id', handle(async (req, res) => {
    const body = parseBody(res, AutomationPatch, req.body);
    if (!body) return;
    res.json(await patchAutomation(actorOf(req), req.params.id as string, body));
  }));

  r.delete('/:id', handle(async (req, res) => {
    res.json(await deleteAutomation(actorOf(req), req.params.id as string));
  }));

  // Runs are created under the automation id (CONV-3 async job pattern, 202). With an idempotency
  // key (body field or `Idempotency-Key` header) a replay answers 200 with the SAME runId and
  // starts nothing — the status code is the only signal, the body stays exactly RunCreateResponse.
  r.post('/:id/runs', handle(async (req, res) => {
    const body = parseBody(res, RunCreateRequest, req.body ?? {});
    if (!body) return;
    const key = idempotencyKeyOf(req, res, body);
    if (!key.ok) return;
    const out = await startRun(
      actorOf(req),
      req.params.id as string,
      { ...(body.inputs ? { inputs: body.inputs } : {}), ...(key.key ? { idempotencyKey: key.key } : {}) },
      callContextOf(req, res),
    );
    res.status(out.created ? 202 : 200).json({ runId: out.runId });
  }));

  return r;
}
