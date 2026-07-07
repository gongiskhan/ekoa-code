/**
 * Automations router (ch03 §3.8.18 + §3.6.3). One function call per route into the
 * automation/ service surface — routes never touch data/ (ch02 §2.7). The run SSE stream
 * authenticates via ?token= (CONV-1) and attaches to events/. Org scoping (Amendment 2)
 * lives in the service; creation authority reads the org's flippable builder-authoring
 * setting through the platform-crud org read.
 */
import { Router, type Request, type Response } from 'express';
import {
  AutomationCreateRequest,
  AutomationPatch,
  PlanRequest,
  RunCreateRequest,
  ConsentRequest,
  StepFeedbackRequest,
  RevokeApprovedCommandRequest,
  type Actor,
} from '@ekoa/shared';
import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
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
  cancelRun,
  resumeRun,
  resolveConsent,
  submitStepFeedback,
  buildCatalog,
  listApprovedCommands,
  revokeApprovedCommand,
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

/** Route wrapper: awaits the handler and maps service errors; anything else -> 500 envelope. */
function handle(fn: (req: AuthedRequest, res: Response) => Promise<void>) {
  return async (req: AuthedRequest, res: Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof AutomationServiceError) return sendServiceError(res, err);
      console.error('[automations] route failed:', err instanceof Error ? err.message : err);
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

  r.use(requireAuth);

  // --- Fixed paths BEFORE '/:id' so 'runs'/'plan'/'catalog'/'approved-commands' never bind as ids.

  r.post('/plan', handle(async (req, res) => {
    const body = parseBody(res, PlanRequest, req.body);
    if (!body) return;
    res.json(await planFromGoal(actorOf(req), body));
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

  // Runs are created under the automation id (CONV-3 async job pattern, 202).
  r.post('/:id/runs', handle(async (req, res) => {
    const body = parseBody(res, RunCreateRequest, req.body ?? {});
    if (!body) return;
    res.status(202).json(await startRun(actorOf(req), req.params.id as string, body));
  }));

  return r;
}
