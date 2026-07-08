/**
 * Build/brand-research jobs router (ch03 §3.8.8, §3.6.2). `POST /jobs` creates BUILD jobs; the
 * response is `created` (with the job) or `answered` (in-build classifier resolved it, no job) or
 * 409 DUPLICATE_BUILD (a concurrent follow-up on the same artifact). `GET /jobs/:id` serves the
 * persisted record (P-10); events stream over `events/` via ?token=. Routes never touch `data/`.
 */
import { Router, type Request, type Response } from 'express';
import { JobCreateRequest } from '@ekoa/shared';
import { requireAuth, verifySseToken, type AuthedRequest } from '../auth/middleware.js';
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
