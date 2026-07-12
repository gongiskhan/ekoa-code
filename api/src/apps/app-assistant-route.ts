/**
 * Served-app assistant plane (operator-run D1) — `POST /api/app-assistant`.
 *
 * The header-scoped (no platform JWT) endpoint the served app's assistant panel calls. It reuses
 * the served-data admission plane: the `X-Ekoa-App-Id` header (charset-checked; the reserved `usr.`
 * shared-namespace prefix rejected) resolves to the artifact, whose OWNER's activation gates the
 * plane (fail-closed). Unlike the byte-compatible key-value app-data plane, the assistant REQUIRES
 * a resolved artifact-backed owner — it has to run under that owner's org and bill that owner — so
 * an unresolved / registry-only (dev-serve) id is a 404 here rather than an anonymous scope.
 *
 * Errors speak the CONV-2 envelope (a new endpoint, not the old app-data string envelope). This
 * module may not import routes/ (ch02 §2.7 lint zone), so it emits the envelope directly off the
 * shared ERROR_STATUS table — the same shape routes/helpers.sendError produces.
 *
 * The org the assistant grounds under and the user it bills come ONLY from the server-resolved
 * owner — never from the anonymous visitor's body. The billing allowance gate is billed to that
 * same owner (the served-app assistant is a named synchronous entry in billing/allowance.ts).
 */
import { Router, type Request, type Response, type RequestHandler, type NextFunction } from 'express';
import {
  AssistantChatRequest,
  AppActionManifest,
  ERROR_STATUS,
  type ErrorCode,
  type AssistantChatResponse,
} from '@ekoa/shared';
import { collectionName } from '../data/collections-engine.js';
import { getActivation } from '../data/activation.js';
import { users, artifacts } from '../data/stores.js';
import { allowanceMiddleware } from '../billing/index.js';
import { runOneShot, decideForTask } from '../llm/index.js';
import { buildGroundingBlock } from '../knowledge/index.js';
import { resolveApp } from './registry.js';
import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';

const SHARED_SCOPE_PREFIX = 'usr.';

/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
}

/** What the admission middleware resolves and stashes for the handler + allowance gate. */
interface AssistantAdmission {
  owner: { userId: string; orgId: string };
  artifactId: string;
  actionManifest: AppActionManifest | null;
}
interface AssistantRequest extends Request {
  ekoaAssistant?: AssistantAdmission;
}

/** The production deps: the assistant's only model egress is the llm/ chokepoint one-shot; grounding
 *  rides the knowledge/ builder; the tier is floored at WORKHORSE like chat (D1 owner-org grounding
 *  is passed in by the admission middleware, not here). */
const prodDeps: AppAssistantDeps = {
  oneShot: runOneShot,
  ground: buildGroundingBlock,
  decide: (message) => decideForTask(message, undefined, 'WORKHORSE'),
};

export function appAssistantRouter(deps: AppAssistantDeps = prodDeps): Router {
  const r = Router();

  /**
   * Served-app admission (mirrors served-data's headerFor + admitOwner, then resolves the owner org
   * and the app's action manifest). On any refusal it writes the CONV-2 envelope and does NOT call
   * next. On success it stashes the resolved subject on the request for the allowance gate + handler.
   */
  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header('x-ekoa-app-id');
    if (
      typeof header !== 'string' ||
      !collectionName.safeParse(header).success ||
      header.startsWith(SHARED_SCOPE_PREFIX)
    ) {
      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
      return;
    }

    const app = await resolveApp(header);
    // The assistant needs a real owner subject (org to ground under, user to bill). A dev-serve /
    // registry-only or unresolved id has none — 404 rather than an anonymous scope.
    if (!app || !app.artifactBacked || !app.ownerUserId) {
      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      return;
    }

    // Owner-activation gate (Amendment 2 second admission plane; fail-closed CONV-2).
    const activation = getActivation(app.ownerUserId);
    if (!activation || activation.active === false) {
      sendError(res, 'ACCOUNT_DISABLED', 'A conta associada a esta aplicação está bloqueada. Contacte o suporte.');
      return;
    }
    if (activation.billingLocked) {
      sendError(res, 'BILLING_LOCKED', 'A conta associada a esta aplicação tem um problema de faturação.');
      return;
    }

    // Owner org — resolved server-side from the owner user record, NEVER from the visitor's body.
    const owner = (await users.get(app.ownerUserId)) as { orgId?: string } | null;
    const orgId = owner?.orgId ?? '';

    // The app's declared action manifest (persisted at activation on the artifact data bag).
    // Validate it against the shared contract; absent/invalid → no operate surface (null).
    const art = await artifacts.get(app.appId);
    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;

    req.ekoaAssistant = { owner: { userId: app.ownerUserId, orgId }, artifactId: app.appId, actionManifest };
    next();
  };

  /** Async admission errors surface as a CONV-2 500 rather than Express's default HTML. */
  const admitGuarded: RequestHandler = (req, res, next) => {
    void admit(req, res, next).catch((err) => {
      console.error('[app-assistant] admission failed:', err instanceof Error ? err.message : err);
      sendError(res, 'INTERNAL', 'Erro interno.');
    });
  };

  // Allowance gate billed to the resolved OWNER (mounted AFTER admission populates the subject).
  const allowance = allowanceMiddleware((req) => (req as AssistantRequest).ekoaAssistant?.owner.userId);

  r.post('/app-assistant', admitGuarded, allowance, async (req: AssistantRequest, res) => {
    const admission = req.ekoaAssistant;
    if (!admission) {
      sendError(res, 'INTERNAL', 'Erro interno.'); // unreachable: admit ran first
      return;
    }

    const parsed = AssistantChatRequest.safeParse(req.body ?? {});
    if (!parsed.success) {
      sendError(res, 'VALIDATION_FAILED', 'Dados inválidos.', { issues: parsed.error.issues });
      return;
    }
    const body = parsed.data;

    try {
      const result = await runAppAssistant(
        {
          message: body.message,
          history: body.history,
          mode: body.mode,
          context: body.context,
          owner: admission.owner,
          artifactId: admission.artifactId,
          actionManifest: admission.actionManifest,
        },
        deps,
      );
      const response: AssistantChatResponse = {
        reply: result.reply,
        mode: result.mode,
        ...(result.citations.length > 0 ? { citations: result.citations } : {}),
        ...(result.actions.length > 0 ? { actions: result.actions } : {}),
      };
      res.json(response);
    } catch (err) {
      console.error('[app-assistant] run failed:', err instanceof Error ? err.message : err);
      sendError(res, 'INTERNAL', 'O assistente está indisponível de momento.');
    }
  });

  return r;
}
