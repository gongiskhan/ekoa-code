/**
 * Triggers router (ch03 §3.8.17). CRUD via the events service. GET /triggers returns
 * publicUrl (landmine 3); create returns the secret exactly once (landmine 2).
 */
import { Router, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import { listTriggers, createTrigger, deleteTrigger, triggerView } from '../events/service.js';
import { getAutomation, AutomationServiceError } from '../automation/index.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';

// The wire shape is a union on target.kind (automation flat vs artifact-backend nested).
const CreateTrigger = z.union([
  z.object({ automationId: z.string(), integrationKey: z.string(), eventName: z.string(), artifactId: z.string().optional() }),
  z.object({ integrationKey: z.string(), eventName: z.string(), target: z.object({ kind: z.literal('artifact-backend'), artifactId: z.string(), entrypoint: z.string() }) }),
]);

export function triggersRouter(deps: { now: () => number; genId: () => string }): Router {
  const r = Router();
  r.use(requireAuth);
  const base = process.env.API_PUBLIC_URL ?? '';

  r.get('/', async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listTriggers(actorOf(req))).map((t) => triggerView(t, base)) });
  });

  r.post('/', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateTrigger, req.body) as Record<string, unknown> | undefined;
    if (!body) return;
    const hasBackend = 'target' in body;
    const actor = actorOf(req);
    // Cross-org binding guard (Codex G8): a trigger targeting an automation must reference one the
    // creator can access — otherwise org A could bind a webhook to org B's automation and drive its
    // execution on delivery (the engine trusts the trigger owner). getAutomation enforces the org
    // scope (same-org read or super-admin) and throws NOT_FOUND for a foreign/unknown automation.
    if (!hasBackend) {
      try {
        await getAutomation(actor, body.automationId as string);
      } catch (err) {
        if (err instanceof AutomationServiceError) return sendError(res, 'NOT_FOUND', 'Automação não encontrada.');
        throw err;
      }
    }
    const input = hasBackend
      ? { targetKind: 'artifact-backend' as const, integrationKey: body.integrationKey as string, eventName: body.eventName as string, artifactId: (body.target as { artifactId: string }).artifactId, entrypoint: (body.target as { entrypoint: string }).entrypoint }
      : { targetKind: 'automation' as const, integrationKey: body.integrationKey as string, eventName: body.eventName as string, automationId: body.automationId as string, artifactId: body.artifactId as string | undefined };
    const { trigger, secret } = await createTrigger(actor, input, deps);
    res.status(201).json({ trigger: triggerView(trigger, base), publicUrl: `${base}/hooks/${trigger._id}`, secret });
  });

  r.delete('/:id', async (req: AuthedRequest, res: Response) => {
    const ok = await deleteTrigger(actorOf(req), req.params.id as string);
    if (!ok) return notFound(res);
    res.json({ ok: true });
  });

  return r;
}
