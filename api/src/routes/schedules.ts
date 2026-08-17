/**
 * Schedules router — thin (the memvault split): admit user-or-key, validate against the
 * shared/ schemas, call the service, shape the envelope. Uniform NOT_FOUND for missing,
 * cross-tenant and refused alike (no existence oracle).
 *
 * Route ORDER is load-bearing: the literal `/runs...` and `/preview` paths mount BEFORE `/:id`
 * so the id parameter cannot shadow them (stated on the shared descriptor too).
 *
 * `fireNow` is an injected dep (the supervisor instance lives in schedules/supervisor.ts and
 * is bound here by the composition root) — the route never imports execution machinery.
 */
import { Router, type Response } from 'express';
import {
  ScheduleCreateRequest,
  SchedulePatch,
  SchedulePreviewRequest,
  ScheduleRunCompleteRequest,
  ScheduleRunListQuery,
} from '@ekoa/shared';
import { requireUserOrApiKey } from '../auth/api-key-middleware.js';
import type { AuthedRequest } from '../auth/middleware.js';
import * as service from '../schedules/service.js';
import { ScheduleServiceError } from '../schedules/service.js';
import type { ScheduleDoc, ScheduleRunDoc } from '../schedules/store.js';
import { getSchedule } from '../schedules/store.js';
import { actorOf, notFound, sendError } from './helpers.js';

const DEFAULT_RUNS_LIMIT = 50;

function refuse(res: Response, err: unknown): void {
  if (err instanceof ScheduleServiceError) {
    if (err.code === 'NOT_FOUND') return notFound(res);
    if (err.code === 'FORBIDDEN') return sendError(res, 'FORBIDDEN', err.message);
    return sendError(res, 'VALIDATION_FAILED', err.message, err.cause_code ? { code: err.cause_code } : undefined);
  }
  console.error(`[schedules] unexpected: ${err instanceof Error ? err.message : String(err)}`);
  sendError(res, 'INTERNAL', 'Erro interno.');
}

export interface SchedulesRouterDeps {
  now: () => number;
  genId: () => string;
  /** Fire a schedule out of band (bound to the supervisor at the composition root). */
  fireNow: (schedule: ScheduleDoc) => Promise<ScheduleRunDoc>;
}

export function schedulesRouter(deps: SchedulesRouterDeps): Router {
  const r = Router();
  r.use(requireUserOrApiKey);
  const svcDeps = { now: deps.now, genId: deps.genId };

  r.get('/', (req, res) => {
    void (async () => {
      try {
        res.json({ items: await service.listForActor(actorOf(req as AuthedRequest)) });
      } catch (err) { refuse(res, err); }
    })();
  });

  r.post('/', (req, res) => {
    void (async () => {
      const body = ScheduleCreateRequest.safeParse(req.body);
      if (!body.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: body.error.issues });
      try {
        res.status(201).json(await service.createSchedule(actorOf(req as AuthedRequest), body.data, svcDeps));
      } catch (err) { refuse(res, err); }
    })();
  });

  // Literal paths BEFORE `/:id`.
  r.get('/runs', (req, res) => {
    void (async () => {
      const q = ScheduleRunListQuery.safeParse(req.query);
      if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
      try {
        const items = await service.listAllRuns(actorOf(req as AuthedRequest), {
          ...(q.data.status ? { status: q.data.status } : {}),
          limit: q.data.limit ?? DEFAULT_RUNS_LIMIT,
        });
        res.json({ items });
      } catch (err) { refuse(res, err); }
    })();
  });

  r.post('/runs/:runId/complete', (req, res) => {
    void (async () => {
      const body = ScheduleRunCompleteRequest.safeParse(req.body);
      if (!body.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: body.error.issues });
      try {
        const run = await service.completeRun(actorOf(req as AuthedRequest), req.params.runId!, body.data, svcDeps);
        res.json({ run });
      } catch (err) { refuse(res, err); }
    })();
  });

  r.post('/preview', (req, res) => {
    void (async () => {
      const body = SchedulePreviewRequest.safeParse(req.body);
      if (!body.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: body.error.issues });
      try {
        res.json({ occurrences: service.previewSpec(body.data.spec, body.data.count ?? 5, svcDeps) });
      } catch (err) { refuse(res, err); }
    })();
  });

  r.get('/:id', (req, res) => {
    void (async () => {
      try {
        res.json(await service.getForActor(actorOf(req as AuthedRequest), req.params.id!));
      } catch (err) { refuse(res, err); }
    })();
  });

  r.patch('/:id', (req, res) => {
    void (async () => {
      const body = SchedulePatch.safeParse(req.body);
      if (!body.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: body.error.issues });
      try {
        res.json(await service.patchSchedule(actorOf(req as AuthedRequest), req.params.id!, body.data, svcDeps));
      } catch (err) { refuse(res, err); }
    })();
  });

  r.delete('/:id', (req, res) => {
    void (async () => {
      try {
        await service.removeSchedule(actorOf(req as AuthedRequest), req.params.id!);
        res.json({ ok: true });
      } catch (err) { refuse(res, err); }
    })();
  });

  r.post('/:id/run-now', (req, res) => {
    void (async () => {
      try {
        const actor = actorOf(req as AuthedRequest);
        // Owner-only (run-now aims the owner's authority; seeing is not firing).
        const doc = await getSchedule(req.params.id!, actor);
        if (!doc || !(doc.ownerUserId === actor.userId || actor.role === 'super-admin')) return notFound(res);
        const run = await deps.fireNow(doc);
        res.status(202).json({ run: service.toWireRun(run) });
      } catch (err) { refuse(res, err); }
    })();
  });

  r.get('/:id/runs', (req, res) => {
    void (async () => {
      const q = ScheduleRunListQuery.safeParse(req.query);
      if (!q.success) return sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: q.error.issues });
      try {
        const items = await service.listRuns(actorOf(req as AuthedRequest), req.params.id!, q.data.limit ?? DEFAULT_RUNS_LIMIT);
        res.json({ items });
      } catch (err) { refuse(res, err); }
    })();
  });

  return r;
}
