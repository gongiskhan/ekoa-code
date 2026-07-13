/**
 * Change-requests router (operator-run H4; BRIEF Phase 9d). The request-changes queue.
 *
 * TWO planes on one resource:
 *  - FILE (POST /) — ANY logged-in platform user (auth 'user'), registered BEFORE the org-admin
 *    gate so a plain user can file (filing needs no capability; the queue READ is admin-gated).
 *    Scoped by the OPTIONAL `X-Ekoa-App-Id` header: present => a served-app filing (lands in the
 *    app OWNER's org queue); absent => a dashboard refused-build filing (lands in the requester's
 *    OWN org). requesterUserId + org come from the verified JWT / resolved owner, never the body.
 *  - QUEUE (GET /, POST /:id/convert, POST /:id/dismiss) — org-admin reads/acts on its OWN org,
 *    super-admin across orgs: the EXACT `requireRole('org-admin','super-admin')` gate registo.ts
 *    uses. Org SCOPE (the cross-org isolation crux) is enforced in the service.
 *
 * Routes stay thin (validate, call one domain module, shape) — like jobs.ts this one additionally
 * resolves the app (apps/registry) and fires the live SSE (agents/streaming); it never touches
 * data/ (the service owns store access, ch02 §2.7).
 */
import { Router, type Response } from 'express';
import { ChangeRequestFileRequest, ChangeRequestConvertRequest, type ChangeRequestStatus } from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { resolveApp } from '../apps/registry.js';
import { loadReadable } from '../apps/app-paths.js';
import { emitChangeRequest } from '../agents/streaming.js';
import {
  fileChangeRequest,
  readChangeRequests,
  convertChangeRequest,
  dismissChangeRequest,
} from '../services/change-requests.js';
import { actorOf, notFound, parseBody, sendError } from './helpers.js';

export function changeRequestsRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();

  // FILE a change request (any authenticated user). Registered BEFORE the org-admin gate below.
  r.post('/', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ChangeRequestFileRequest, req.body);
    if (!body) return;
    const requester = { userId: req.user!.sub, username: req.user!.username, orgId: req.user!.orgId };

    // The OPTIONAL served-app header decides the target org. Present => resolve the app + its OWNER
    // (fail-closed: unknown / registry-only / ownerless id is a 404, exactly like the app-assistant
    // plane). Absent => the dashboard refused-build filing to the requester's own org (target null).
    let target: { ownerUserId: string; appId: string } | null = null;
    const header = req.header('x-ekoa-app-id');
    if (header !== undefined && header !== '') {
      const app = await resolveApp(header);
      if (!app || !app.artifactBacked || !app.ownerUserId) {
        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      }
      // CROSS-ORG INJECTION GUARD (codex HIGH): filing about a served app requires the REQUESTER to
      // be able to READ it - own, or org-shared WITHIN THEIR OWN org. loadReadable returns null for a
      // cross-org row, another user's private row, or an unknown id -> a UNIFORM 404 (indistinguishable
      // from an unknown app, so it is NOT a cross-org existence oracle). Because a readable app is
      // always in the requester's own org, the owner-org stamp is reachable ONLY for apps the requester
      // can see - a request can NEVER be injected into another org's queue (nor its admins notified).
      if (!(await loadReadable(actorOf(req), app.appId))) {
        return sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      }
      target = { ownerUserId: app.ownerUserId, appId: app.appId };
    }

    const { request, notifyUserIds } = await fileChangeRequest(requester, target, body, deps);
    // Live push into each OWNER-org admin's notifications channel (org-scoped fan-in).
    for (const uid of notifyUserIds) emitChangeRequest(uid, { appId: request.appId });
    res.json(request);
  });

  // The org-admin queue (read + convert + dismiss). org-admin own org; super-admin across orgs.
  r.use(requireAuth, requireRole('org-admin', 'super-admin'));

  r.get('/', async (req: AuthedRequest, res: Response) => {
    const q = req.query as { status?: string; orgId?: string; limit?: string; offset?: string };
    const result = await readChangeRequests(actorOf(req), {
      status: q.status as ChangeRequestStatus | undefined,
      orgId: q.orgId,
      limit: q.limit ? parseInt(q.limit, 10) : undefined,
      offset: q.offset ? parseInt(q.offset, 10) : undefined,
    });
    res.json(result);
  });

  r.post('/:id/convert', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ChangeRequestConvertRequest, req.body);
    if (!body) return;
    const result = await convertChangeRequest(actorOf(req), req.params.id as string, body.jobId);
    if (result.status === 'not-found') return notFound(res);
    res.json(result.request);
  });

  r.post('/:id/dismiss', async (req: AuthedRequest, res: Response) => {
    const result = await dismissChangeRequest(actorOf(req), req.params.id as string);
    if (result.status === 'not-found') return notFound(res);
    res.json(result.request);
  });

  return r;
}
