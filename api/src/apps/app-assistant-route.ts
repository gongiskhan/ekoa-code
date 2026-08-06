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
  type AssistantChatResponse,
  type AppAssistantWhoamiResponse,
} from '@ekoa/shared';
import { artifacts } from '../data/stores.js';
import { allowanceMiddleware } from '../billing/index.js';
import { runOneShot, decideForTask } from '../llm/index.js';
import { buildGroundingBlock } from '../knowledge/index.js';
import { verifySseToken } from '../auth/middleware.js';
import { getActivation } from '../data/activation.js';
import { can } from '../auth/capabilities.js';
import type { JwtClaims } from '../auth/jwt.js';
import { loadWritable } from './app-paths.js';
import { runAppAssistant, type AppAssistantDeps } from './app-assistant.js';
import { admitServedApp, resolveServedApp, sendAppError as sendError } from './served-app-admission.js';

/**
 * Can this verified caller EDIT this specific app? Detection MIRRORS the H1 follow-up-build gate
 * EXACTLY (routes/jobs.ts): `can(canEditApps)` AND the artifact is writable by this actor
 * (loadWritable: own always; org-shared within the org ok; another user's private → not-ok;
 * missing/cross-org → not-ok). Making detection identical to the actual edit authority is what
 * closes BOTH codex-h2 findings and a false-offer bug at once:
 *   - Medium (fail-closed on a missing owner org): an orphaned/cross-org/unresolvable artifact is
 *     never writable, so admin is false even for a super-admin — no false positive.
 *   - Low (org-admin membership oracle): admin:true only for apps loadWritable already grants, i.e.
 *     the caller's OWN + org-shared apps — exactly what they already enumerate via GET /artifacts
 *     (listVisible). It reveals nothing new; a same-org OTHER user's PRIVATE app reads not-writable
 *     → admin:false, so it is not an existence oracle for private in-org apps.
 *   - No false offer: admin:true ⟺ H3's edit mode / the follow-up build will actually succeed for
 *     this caller on this app. The panel never promises an edit the gate would then refuse.
 * NOTE: like the H1 gate, loadWritable is org-scoped, so a super-admin is NOT granted cross-org app
 * edit here (a super-admin only edits apps in their own org). If platform-wide cross-org app editing
 * is ever wanted, that is a deliberate policy change to loadWritable/the H1 gate AND this detection
 * together — not a silent divergence. Exported for the unit matrix.
 */
export function isAppEditor(claims: Pick<JwtClaims, 'role' | 'orgId'>, writableVerdict: 'ok' | 'forbidden' | 'notfound'): boolean {
  if (!can(claims, 'canEditApps')) return false; // capability gate (H1): a plain user stops here
  return writableVerdict === 'ok'; // ...and the actor must actually be able to write THIS artifact
}

/**
 * Detect whether the OPTIONAL platform Bearer on this request can EDIT app `appId`. FAIL-CLOSED and
 * oracle-free: any deviation — no token, a non-Bearer header, or a token that does not clear the
 * standard verification chain — returns false, never throws, never distinguishes a bad token from a
 * not-writable one. The verification is the EXACT chain requireAuth/verifySseToken run (verifyToken
 * + jti + isRevoked + activation-active + tokenEpoch); the edit decision is the EXACT H1 gate
 * (can(canEditApps) + loadWritable). This endpoint does NOT hand-roll a weaker check and adds NO
 * second identity path.
 */
async function detectAppEditor(authHeader: string | undefined, appId: string): Promise<boolean> {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? '');
  if (!m) return false; // no/malformed Authorization header (incl. the cross-origin dev case) → false
  const verified = verifySseToken(m[1]); // the one verification chain; returns claims-or-error, never throws
  if (!verified.ok) return false; // invalid / expired / revoked / epoch-stale / deactivated → false
  // Mirror the FULL H1 admission gate, not just its verify+capability+writability legs (codex-h6
  // Medium): the real edit path is requireAuth (active + NOT billing-locked + epoch) THEN can() +
  // loadWritable. verifySseToken checks active/epoch but NOT billingLocked, so without this a
  // billing-locked admin would read admin:true and be OFFERED edit mode (H3) only to be refused
  // BILLING_LOCKED at POST /jobs - a false offer. A locked/absent activation ⇒ not an editor.
  const act = getActivation(verified.claims.sub);
  if (!act || !act.active || act.billingLocked) return false;
  const actor = { userId: verified.claims.sub, orgId: verified.claims.orgId, role: verified.claims.role };
  const { verdict } = await loadWritable(actor, appId); // the SAME writability rule the H1 edit gate uses
  return isAppEditor(verified.claims, verdict);
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
   * Served-app admission (the shared plane: header charset/collision checks, artifact-backed
   * resolution, owner-activation gate, owner org read server-side), then this plane's own extra —
   * the app's action manifest. On any refusal the shared admission has already written the CONV-2
   * envelope and we do NOT call next. On success we stash the resolved subject on the request for
   * the allowance gate + handler.
   */
  const admit = async (req: AssistantRequest, res: Response, next: NextFunction): Promise<void> => {
    const admission = await admitServedApp(req, res);
    if (!admission) return;

    // The app's declared action manifest (persisted at activation on the artifact data bag).
    // Validate it against the shared contract; absent/invalid → no operate surface (null).
    const art = await artifacts.get(admission.appId);
    const rawManifest = (art?.data as { actionManifest?: unknown } | undefined)?.actionManifest;
    const parsedManifest = rawManifest ? AppActionManifest.safeParse(rawManifest) : null;
    const actionManifest = parsedManifest?.success ? parsedManifest.data : null;

    req.ekoaAssistant = { owner: admission.owner, artifactId: admission.appId, actionManifest };
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
   * served-app assistant reads the caller's platform JWT, and it does so ONLY to answer "can the
   * current viewer EDIT this app?" — the SAME decision the H1 follow-up-build gate makes
   * (can(canEditApps) + loadWritable). It NEVER grounds, NEVER bills, NEVER widens admission, and
   * issues NO model call (the zero-token GET) — the POST grounding/billing path above stays
   * byte-for-byte visitor-blind (it still never reads the caller JWT). Every privileged action
   * remains gated server-side by the H1 admission plane with this same JWT; `admin: true` here is
   * only a HINT the panel may surface (edit mode is H3), and it exactly matches what that edit will
   * actually be allowed to do — never a false offer.
   *
   * FAIL-CLOSED + oracle-free: the ONLY non-200 responses are the SAME ones POST already gives for
   * the app-id header itself (400 malformed / 404 unknown app — so whoami is not a new existence
   * oracle). A missing/invalid/expired/revoked/epoch-stale/wrong-org/user token is ALWAYS a 200
   * `{ admin: false }` — never a 401 (which would leak token validity) or a 403 (which would leak
   * app existence).
   */
  const whoami = async (req: Request, res: Response): Promise<void> => {
    const resolution = await resolveServedApp(req.header('x-ekoa-app-id'));
    if (resolution.status === 'invalid-id') {
      sendError(res, 'VALIDATION_FAILED', 'Cabeçalho X-Ekoa-App-Id em falta ou inválido.');
      return;
    }
    if (resolution.status === 'not-found') {
      sendError(res, 'NOT_FOUND', 'Aplicação não encontrada.');
      return;
    }

    // "admin" == can this caller edit THIS app, decided by the SAME rule the H1 edit gate uses
    // (can(canEditApps) + loadWritable on the resolved artifact id). Ownership/org is resolved
    // server-side inside loadWritable from the artifact record, NEVER from anything the caller
    // supplied. Fail-closed + no oracle: see detectAppEditor / isAppEditor above.
    const response: AppAssistantWhoamiResponse = {
      admin: await detectAppEditor(req.header('authorization'), resolution.app.appId),
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
