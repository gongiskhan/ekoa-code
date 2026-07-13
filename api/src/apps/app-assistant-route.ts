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
  type AppAssistantWhoamiResponse,
} from '@ekoa/shared';
import { collectionName } from '../data/collections-engine.js';
import { getActivation } from '../data/activation.js';
import { users, artifacts } from '../data/stores.js';
import { allowanceMiddleware } from '../billing/index.js';
import { runOneShot, decideForTask } from '../llm/index.js';
import { buildGroundingBlock } from '../knowledge/index.js';
import { verifySseToken } from '../auth/middleware.js';
import { can } from '../auth/capabilities.js';
import type { JwtClaims } from '../auth/jwt.js';
import { resolveApp, type ResolvedApp } from './registry.js';
import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';

const SHARED_SCOPE_PREFIX = 'usr.';

/** CONV-2 error envelope off the shared status table (routes/ is off-limits to apps/, ch02 §2.7). */
function sendError(res: Response, code: ErrorCode, message: string, details?: unknown): void {
  res.status(ERROR_STATUS[code]).json({ error: { code, message, ...(details ? { details } : {}) } });
}

/**
 * Resolve the `X-Ekoa-App-Id` header to an artifact-backed owner — the SHARED front half of every
 * app-assistant plane entry (POST admission AND the H2 whoami detection), so both apply the exact
 * same charset/collision checks and expose the exact same existence surface (no plane is a
 * different oracle than the other). A discriminated result the callers turn into the CONV-2
 * envelope: `invalid-id` → 400 VALIDATION_FAILED, `not-found` → 404 NOT_FOUND, `ok` → the app.
 */
type AssistantAppResolution =
  | { status: 'invalid-id' }
  | { status: 'not-found' }
  | { status: 'ok'; app: ResolvedApp };

async function resolveAssistantApp(header: unknown): Promise<AssistantAppResolution> {
  // Same header contract admit() has always applied: a string, a valid collection-name charset,
  // and NOT the reserved `usr.` shared-namespace prefix.
  if (
    typeof header !== 'string' ||
    !collectionName.safeParse(header).success ||
    header.startsWith(SHARED_SCOPE_PREFIX)
  ) {
    return { status: 'invalid-id' };
  }
  const app = await resolveApp(header);
  // The assistant plane needs a real artifact-backed owner (org to scope by, user to attribute).
  // A dev-serve / registry-only or unresolved id has none — the same 404 admit() gives.
  if (!app || !app.artifactBacked || !app.ownerUserId) return { status: 'not-found' };
  return { status: 'ok', app };
}

/**
 * Is this verified caller an admin of the app OWNER's org WITH the app-edit capability? PURE role
 * decision (the token is already verified by the caller). Gated by H1's `can()` so the role→
 * capability grid is the single source of truth — a `user` fails the capability gate, so only
 * `org-admin`/`super-admin` reach the org check. A super-admin spans every org; an org-admin must
 * belong to the owner's exact org. Fail-closed for any other shape. Exported for the unit matrix.
 */
export function isOwnerOrgAdmin(claims: Pick<JwtClaims, 'role' | 'orgId'>, ownerOrgId: string): boolean {
  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
  if (claims.role === 'super-admin') return true; // super-admin edits apps in any org
  if (claims.role === 'org-admin') return claims.orgId === ownerOrgId; // org-admin scoped to owner org
  return false; // unreachable given the capability gate, but fail-closed by construction
}

/**
 * Detect whether the OPTIONAL platform Bearer on this request belongs to an admin of `ownerOrgId`.
 * FAIL-CLOSED and oracle-free: any deviation — no token, a non-Bearer header, or a token that does
 * not clear the standard verification chain — returns false, never throws, never distinguishes a
 * bad token from a wrong-org one. The verification is the EXACT chain requireAuth/verifySseToken
 * run (verifyToken + jti + isRevoked + activation-active + tokenEpoch); this endpoint does NOT
 * hand-roll a weaker check and adds NO second identity path.
 */
function detectOwnerOrgAdmin(authHeader: string | undefined, ownerOrgId: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
  return isOwnerOrgAdmin(verified.claims, ownerOrgId);
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
    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
    if (resolution.status === 'invalid-id') {
      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
      return;
    }
    if (resolution.status === 'not-found') {
      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      return;
    }
    const app = resolution.app;

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

  /**
   * GET /app-assistant/whoami — admin DETECTION for the panel (operator-run H2; detect-then-ask).
   *
   * A DECLARED, DOCUMENTED exception to this plane's visitor-blindness: it is the ONE place the
   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "is the
   * current viewer an admin of this app's owner org?". It NEVER grounds, NEVER bills, NEVER widens
   * admission, and issues NO model call (the zero-token GET) — the POST grounding/billing path
   * above stays byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged
   * action remains gated server-side by the H1 admission plane with this same JWT; `admin: true`
   * here is only a HINT the panel may surface (edit mode is H3).
   *
   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
   * app existence).
   */
  const whoami = async (req: Request, res: Response): Promise<void> => {
    const resolution = await resolveAssistantApp(req.header('x-ekoa-app-id'));
    if (resolution.status === 'invalid-id') {
      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
      return;
    }
    if (resolution.status === 'not-found') {
      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      return;
    }

    // Owner org — resolved server-side from the owner user record (same source admit() uses),
    // NEVER from anything the caller supplied.
    const owner = (await users.get(resolution.app.ownerUserId)) as { orgId?: string } | null;
    const ownerOrgId = owner?.orgId ?? '';

    const response: AppAssistantWhoamiResponse = {
      admin: detectOwnerOrgAdmin(req.header('authorization'), ownerOrgId),
    };
    res.json(response); // always 200 — the boolean IS the answer
  };

  /** A whoami failure (e.g. a store read blowing up) is a 500, never a 4xx: a 4xx here would be an
   *  oracle. Fail-closed to an internal error, distinct from the detection's own false. */
  r.get('/app-assistant/whoami', (req, res) => {
    void whoami(req, res).catch((err) => {
      console.error('[app-assistant] whoami failed:', err instanceof Error ? err.message : err);
      sendError(res, 'INTERNAL', 'Erro interno.');
    });
  });

  return r;
}
