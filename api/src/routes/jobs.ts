/**
 * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
 * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
 * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
 * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
 */
import { Router, type Request, type Response } from 'express';
import { JobCreateRequest } from '@ekoa/shared';
import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
import { can } from '../auth/capabilities.js';
import { loadWritable } from '../apps/app-paths.js';
import { sseManager } from '../events/sse-manager.js';
import { handleBuildCreate, cancelRun } from '../agents/index.js';
import { getJob, jobView } from '../agents/jobs.js';
import { actorOf, notFound, parseBody, sendError } from './helpers.js';

export function jobsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  r.get('/:id/events', async (req: Request, res: Response) => {
    const auth = verifySseToken(req.query.token as string | undefined);
    if (!auth.ok) return res.status(auth.status).json({ error: { code: auth.code, message: 'Não autorizado.' } });
    const id = req.params.id as string;
    // Ownership check BEFORE attach (Codex checkpoint): a valid SSE token must NOT subscribe to
    // another user's job stream (cross-user event/output leak). Mirrors the guarded GET /:id + the
    // chat SSE route. A missing job attaches (nothing streams); only a foreign OWNED job is refused.
    const job = await getJob(id);
    if (job && job.userId !== auth.claims.sub) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Sem permissão.' } });
    }
    const lastEventId = req.header('last-event-id');
    sseManager.attach(res, auth.claims.sub, 'job', id, lastEventId ? Number(lastEventId) : undefined);
  });

  r.use(requireAuth);

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, JobCreateRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    // Capability + ownership gates BEFORE any job is created or agent spawned (H1). Refusals carry
    // the FORBIDDEN envelope with `details.capability` (the machine-readable hook the H4
    // request-to-admin flow consumes); object-ownership denials carry no capability field.
    if (body.artifactId) {
      // A follow-up build EDITS an existing app: it requires canEditApps AND writability on the
      // target artifact. The writability check (own always; org-shared within org ok; another
      // user's private → 403; missing/cross-org → 404) closes the follow-up-build IDOR (map §5.1),
      // where any authenticated user could drive a code-writing agent against ANY artifact by id.
      // The capability check runs FIRST so a user without canEditApps gets a uniform refusal that
      // never leaks whether the target exists.
      if (!can(actor, 'canEditApps')) {
        return sendError(res, 'FORBIDDEN', 'Não tem permissão para alterar aplicações; pode pedir ao administrador da organização.', { capability: 'canEditApps' });
      }
      const { verdict } = await loadWritable(actor, body.artifactId);
      if (verdict === 'notfound') return notFound(res);
      if (verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    } else if (!can(actor, 'canBuildApps')) {
      // A first build CREATES an app.
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para criar aplicações; pode pedir ao administrador da organização.', { capability: 'canBuildApps' });
    }
    const result = await handleBuildCreate({
      actor,
      username: req.user!.username,
      sessionId: body.sessionId,
      description: body.description,
      language: body.language,
      ...(body.templateId ? { templateId: body.templateId } : {}),
      ...(body.integrationKeys ? { integrationKeys: body.integrationKeys } : {}),
      ...(body.artifactId ? { artifactId: body.artifactId } : {}),
      ...(body.attachments ? { attachments: body.attachments } : {}),
      ...(body.fieldValues ? { fieldValues: body.fieldValues } : {}),
      ...(body.configValues ? { configValues: body.configValues } : {}),
      ...(body.knowledgeDocs ? { knowledgeDocs: body.knowledgeDocs } : {}),
      deps,
    });
    if (result.status === 'conflict') return sendError(res, 'DUPLICATE_BUILD', 'Já existe uma construção em curso para esta aplicação.');
    if (result.status === 'answered') return res.status(200).json({ status: 'answered', reason: result.reason });
    res.status(202).json({ status: 'created', job: result.job });
    result.fire();
  });

  r.get('/:id', async (req: AuthedRequest, res: Response) => {
    const job = await getJob(req.params.id as string);
    const actor = actorOf(req);
    if (!job || (job.userId !== actor.userId && actor.role !== 'super-admin')) return notFound(res);
    res.json(jobView(job));
  });

  r.post('/:id/cancel', (req: AuthedRequest, res: Response) => {
    res.json(cancelRun(req.params.id as string, actorOf(req)));
  });

  return r;
}
