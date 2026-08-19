/**
 * Sync router (slice CS6) — the FLAGGED, DASHBOARD-AUTH surface for the Caixa Citius read-only
 * notifications sync.
 *
 * DELIBERATELY NOT A CAPABILITY. RUN_SPEC's non-goals name this in as many words: "Promoting the
 * Citius sync onto the user-or-key capability surface (lands via the core execute endpoint; the
 * proof ships behind dashboard-auth `routes/sync.ts` + a flag)". So:
 *
 *   - `requireAuth` only. NO `requireUserOrApiKey`, no `AuthClass 'user-or-key'`, and NO descriptor
 *     in `shared/`'s `ALL_ENDPOINTS` — this router is invisible to OpenAPI, to the generated client
 *     and to the schema-coverage/mount-coverage gates BY DESIGN, because it is not part of the
 *     public contract. Rule 7 (contracts evolve additively) is satisfied trivially: nothing public
 *     changed. When the sync graduates it graduates through the integration execute endpoint, which
 *     is where every consumer-facing capability lives (Rule 1: one implementation, here).
 *   - A FLAG, read LIVE (never memoized, so an operator toggle needs no restart and a test needs no
 *     module reset). DEFAULT OFF: the connector has never met a real account (CS1/CS4 SPIKE lists),
 *     so the surface that would drive it at a court's infrastructure stays closed until an operator
 *     opts in. Disabled answers 404 rather than 403 — an unshipped feature should not advertise
 *     that it exists.
 *
 * PER-USER, NOT PER-ORG. Every route acts as the CALLER: the session is the caller's own Cofre
 * item and the sync state is keyed by the caller's user id inside the action key (see the hazard-4
 * note in `legal/citius-sync.ts`). There is no `userId` parameter and no cross-user read — one
 * lawyer's notification inbox is not their colleague's, and a route that let an org-admin sync
 * "on behalf of" someone would be advancing a watermark over an inbox they cannot see.
 *
 * The router is thin by the house rule (ch02 §2.6): validate, call ONE domain module, shape the
 * response. All of the joinery, all four seam hazards and the whole metadata-only argument live in
 * `legal/citius-sync.ts`; nothing here decides anything about completeness.
 */
import { Router, type Response } from 'express';
import { SyncRunOutcome, SyncStateView } from '@ekoa/shared';
import { z } from 'zod';
import { requireAuth, type AuthedRequest } from '../auth/middleware.js';
import {
  ensureSession,
  markSessionUnhealthy,
} from '../automation/session-establishment.js';
import { classifyOrigin } from '../automation/origin-posture.js';
import { CITIUS_MANDATARIOS_BASE_URL } from '../legal/citius-mandatarios-http.js';
import { CofreLockedError, CredentialOriginError } from '../cofre/index.js';
import {
  CitiusSyncError,
  readCitiusSyncState,
  syncCitiusNotifications,
  type CitiusSyncDeps,
  type CitiusSyncInput,
} from '../legal/citius-sync.js';
import { actorOf, parseBody, sendError } from './helpers.js';

/**
 * The flag. Read LIVE on every request.
 *
 * ONLY the exact string `true` enables it: `'1'`, `'yes'` and `'TRUE'` are all left OFF on purpose.
 * This flag guards the one surface in the codebase that drives a court's portal with a real
 * lawyer's credential, and the cost of being wrong in the permissive direction is unbounded while
 * the cost of being wrong in the strict direction is one corrected env var.
 */
export const CITIUS_SYNC_FLAG = 'CITIUS_SYNC_ENABLED';
export function citiusSyncEnabled(): boolean {
  return process.env[CITIUS_SYNC_FLAG] === 'true';
}

/**
 * Body of a sync run. Every field is OPTIONAL and every one of them is a knob the FIRST REAL
 * ACCOUNT is expected to need (CS4's SPIKE list is a list of configuration, not of rewrites), so
 * they are settable without a deploy. What is NOT settable: the actor, the integration key, or
 * anything that scopes durable state — those come from the verified JWT.
 */
const SyncRunRequest = z.object({
  baseUrl: z.string().url().optional(),
  inboxPath: z.string().optional(),
  pageParam: z.string().optional(),
  pageSize: z.number().int().positive().optional(),
  maxPages: z.number().int().positive().optional(),
  throttleMs: z.number().int().nonnegative().optional(),
  requestTimeoutMs: z.number().int().positive().optional(),
  untilSkewMs: z.number().int().nonnegative().optional(),
  credentialRef: z.string().optional(),
  username: z.string().optional(),
});

export interface SyncRouterDeps {
  /** CS5's session establishment, injected so a test can drive the whole rail against a mock
   *  portal without a browser. Defaults to the real one. */
  establishSession: CitiusSyncDeps['establishSession'];
  markSessionUnhealthy: CitiusSyncDeps['markSessionUnhealthy'];
  /** CS4's transport/sleep seams, handed through to the connector. */
  enumerateDeps?: CitiusSyncDeps['enumerateDeps'];
  /** Run id for the sync (session establishment threads it into the credential window). */
  genRunId?: () => string;
}

export function syncRouter(deps: Partial<SyncRouterDeps> = {}): Router {
  const r = Router();
  const establishSession = deps.establishSession ?? ensureSession;
  const markUnhealthy = deps.markSessionUnhealthy ?? markSessionUnhealthy;
  const genRunId = deps.genRunId ?? ((): string => `citius-sync-${Date.now().toString(36)}`);

  // The flag gate runs BEFORE authentication on purpose: a disabled feature must look identical to
  // a caller with a good token and one without. Authenticating first would make the 401/404 split a
  // probe for whether the flag is on.
  r.use((_req, res, next) => {
    if (!citiusSyncEnabled()) {
      sendError(res, 'NOT_FOUND', 'Sincronização Citius não está disponível.');
      return;
    }
    next();
  });
  r.use(requireAuth);

  /** Run ONE completeness-verified sync for the CALLER's Citius inbox. */
  r.post('/citius/notificacoes', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SyncRunRequest, req.body ?? {});
    if (!body) return;
    const input: CitiusSyncInput = {
      actor: actorOf(req),
      runId: genRunId(),
      ...stripUndefined(body),
      ...hostedTypistPermitForPortal(body.baseUrl),
    };
    try {
      const outcome = await syncCitiusNotifications(input, {
        establishSession,
        markSessionUnhealthy: markUnhealthy,
        ...(deps.enumerateDeps === undefined ? {} : { enumerateDeps: deps.enumerateDeps }),
      });
      // The wire shape is the shared union MINUS the Cofre item id: the caller does not need an
      // internal credential handle to read its own sync outcome, and an id that never leaves is an
      // id that cannot be replayed at a surface that does not re-check ownership.
      const payload: SyncRunOutcome =
        outcome.status === 'ran'
          ? {
              status: 'ran',
              session: outcome.session,
              sessionMarkedUnhealthy: outcome.sessionMarkedUnhealthy,
              report: outcome.report,
            }
          : outcome;
      res.json(payload);
    } catch (err) {
      sendSyncError(res, err);
    }
  });

  /** The per-action sync state: watermark, streaks, and the last report. */
  r.get('/citius/notificacoes/state', async (req: AuthedRequest, res: Response) => {
    try {
      const view: SyncStateView = await readCitiusSyncState({ actor: actorOf(req) });
      res.json(view);
    } catch (err) {
      sendSyncError(res, err);
    }
  });

  return r;
}

/** Drop explicitly-undefined keys so `exactOptionalPropertyTypes` stays satisfiable downstream. */
function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * MAY THE HOSTED TYPIST LOG IN TO THIS PORTAL - asked here, at the rail's composition point, for the
 * same reason the run loop asks it: posture is a fact about an ORIGIN, and neither `legal/` nor
 * `automation/session-establishment.ts` knows one.
 *
 * The rail briefly answered YES for itself, unconditionally. That made it the single consumer able
 * to open the hosted Chromium and submit a lawyer's court password from a datacenter IP whatever
 * anyone had declared about the origin - which is both the substitution P4.1 exists to stop and a
 * per-consumer exemption from a rule everything else obeys (Capability Contract rule 3).
 *
 * NO ACTION DECLARATION IS PASSED, and there is none to pass: this rail runs a hard-coded portal
 * walk, not an `IntegrationAction`, so nobody has ever declared a posture for it.
 * `classifyOrigin(url)` with no action is CLOSED, so the answer today is a permit WITHHELD - the
 * typist route becomes `needs-human` and the session is established by a person, on a machine of
 * their own. That is the correct closed reading for a court portal, and it becomes an ordinary YES
 * the moment the sync is promoted onto a declared integration action (docs/findings.md
 * `citius-sync-establishes-its-session-outside-the-locality-decision`).
 */
function hostedTypistPermitForPortal(baseUrl: string | undefined): { hostedTypist?: Record<string, never> } {
  const classification = classifyOrigin(baseUrl ?? CITIUS_MANDATARIOS_BASE_URL);
  return classification.cloudEgressAllowed ? { hostedTypist: {} } : {};
}

/**
 * Shape the typed terminal errors the establishment rail throws.
 *
 * Each maps to something the USER can act on, which is the whole reason CS5 throws them typed
 * instead of folding them into its result union. Anything else is a 500 with a fixed message — an
 * unrecognised error from a layer that was holding a decrypted password is not a string to echo.
 */
function sendSyncError(res: Response, err: unknown): void {
  if (err instanceof CitiusSyncError) {
    sendError(res, 'VALIDATION_FAILED', err.message);
    return;
  }
  if (err instanceof CofreLockedError) {
    // The user locked their own credential. That is the kill switch working, not a fault.
    sendError(res, 'FORBIDDEN', 'A credencial está bloqueada. Desbloqueie-a para sincronizar.');
    return;
  }
  if (err instanceof CredentialOriginError) {
    sendError(res, 'FORBIDDEN', 'A sessão não está associada a este portal.');
    return;
  }
  sendError(res, 'INTERNAL', 'Não foi possível sincronizar as notificações.');
}
