/**
 * automation/credential-gate.ts - the run loop's pre-step credential check, for EVERY integration.
 *
 * ================================ WHAT THIS REPLACES ================================
 * `ensureSession` (`session-establishment.ts`) has existed, been security-tested, and been wired to
 * exactly ONE caller: the Citius sync rail (`routes/sync.ts` -> `legal/citius-sync.ts`). Every other
 * integration got nothing - a browser step against a portal with no session simply failed on the
 * page, or halted in `awaiting_integration`, which is terminal and needs a human to re-run. That
 * asymmetry is a Rule 3 violation by omission (one consumer gets a capability no other consumer
 * gets), and this module is where it ends: the gate below is the general home for `ensureSession`
 * in the run loop, and it contains no branch on any integration key.
 *
 * ================================ WHAT TRIGGERS IT ================================
 * A step's own DECLARATION, and nothing else. `resolveStepDeclaration` (`types.ts`) resolves
 * `credentialRefs` - the `cofre:<itemId>` references the step consumes - and a step that names none
 * is not gated at all. That is the only Rule-3-clean trigger available: the alternative is guessing
 * ("this looks like a portal"), which would halt runs that never needed a credential, and the
 * closed-by-default reading of "declared nothing" is "asks for nothing" (`types.ts` on the
 * declaration defaults). It is also what makes this change backward compatible by construction
 * (plan trap T6): every automation authored before declarations existed carries none, so the gate
 * never fires on one.
 *
 * ================================ WHERE THE ORIGIN COMES FROM ================================
 * NOT from a stored allow-list, and not from a per-integration field - the repo deleted
 * `declaredOrigins` and settled on "the origin truth is the action's `httpConfig.baseUrl` resolved
 * at use" (`definition-store.ts`, decisions.md 2026-08-02). So:
 *
 *   1. a `navigate` step   -> its own `url` (the step IS a statement about where it goes);
 *   2. an `integration` step -> the action's resolved `httpConfig.baseUrl`, through the
 *      `loadIntegrationActionDeclaration` seam (per-run-actor, because the same key resolves to a
 *      different package per org);
 *   3. an `api_call` step  -> its own request URL;
 *   4. anything else (`browser`, `verify`, `wait`) -> the origin of the nearest PRECEDING step that
 *      answers 1-3. A browser step has no URL of its own; the portal it is on is the one the run
 *      navigated to, and that is derivable from the step list without a live browser.
 *
 * An origin that cannot be resolved means the gate has nothing to say, and it says nothing: the
 * step runs exactly as it does today. Halting a run because a URL did not parse would be a stop a
 * human cannot act on.
 */
import type { Actor } from '@ekoa/shared';
import type { Step } from './types.js';
import { resolveStepDeclaration } from './types.js';
import { classifyOrigin, type OriginClassification } from './origin-posture.js';
import { loadIntegrationActionDeclaration, type IntegrationActionDeclaration } from './seams.js';
import { ensureSession, type EnsureSessionResult } from './session-establishment.js';
import { issueLoginRelayPrompt } from '../cofre/index.js';
import type { RunCredentialRequest } from '@ekoa/shared';

/**
 * Where the Cofre portal is, and how a deep link into it is written.
 *
 * A RELATIVE path, deliberately: the halt payload crosses to a browser that already knows its own
 * host, and an absolute URL composed server-side would be one more place a wrong origin could be
 * introduced into something a user is invited to click.
 */
export function cofrePortalDeepLink(origin: string): string {
  return `/cofre?origin=${encodeURIComponent(origin)}`;
}

export interface CredentialGateInput {
  actor: Actor;
  runId: string;
  automationName: string;
  /** The whole working step list - the origin of a browser step is derived from what preceded it. */
  steps: readonly Step[];
  index: number;
  /** Pairing ids that can currently provide residential egress for this org (checkout input). */
  residentialAvailable?: readonly string[];
}

/**
 * What the gate decided.
 *
 *   - `not-applicable` - the step declares no credential, or no origin could be resolved. The run
 *      proceeds exactly as it would have without this module.
 *   - `ready` - there is a usable session. `storageState` is the browser-injectable artefact; it is
 *      credential-equivalent and is handed straight to the browser seam, never logged or persisted.
 *   - `needs-credentials` - HALT. `request` is the persisted + streamed payload, and it carries an
 *      origin and a deep link, never a value.
 *   - `needs-machine` - the session is FINE and there is no compatible way out of the network. Not
 *      a credential problem: sending a human to the Cofre for it would be a lie. Surfaced as the
 *      existing daemon halt, which is the honest "a machine of yours is needed" state.
 */
export type CredentialGateVerdict =
  | { kind: 'not-applicable' }
  | { kind: 'ready'; itemId: string; storageState: unknown }
  | { kind: 'needs-credentials'; request: RunCredentialRequest }
  | { kind: 'needs-machine'; reason: string };

export interface CredentialGateDeps {
  ensure: typeof ensureSession;
  loadActionDeclaration: typeof loadIntegrationActionDeclaration;
  issueRelay: typeof issueLoginRelayPrompt;
}

const REAL_DEPS: CredentialGateDeps = {
  ensure: ensureSession,
  loadActionDeclaration: loadIntegrationActionDeclaration,
  issueRelay: issueLoginRelayPrompt,
};

/**
 * Run the gate for one step.
 *
 * Throws NOTHING it can help: an `ensureSession` refusal that is genuinely terminal (a locked item,
 * an origin refusal) propagates, because those are states a `needs_credentials` halt would
 * MISREPRESENT - "go establish a credential" is the wrong instruction for "you locked this one on
 * purpose". Everything the run can legitimately continue past is a verdict.
 */
export async function evaluateCredentialGate(
  input: CredentialGateInput,
  deps: Partial<CredentialGateDeps> = {},
): Promise<CredentialGateVerdict> {
  const d: CredentialGateDeps = { ...REAL_DEPS, ...deps };
  const step = input.steps[input.index];
  if (!step) return { kind: 'not-applicable' };

  const declaration = resolveStepDeclaration(step);
  if (declaration.credentialRefs.length === 0) return { kind: 'not-applicable' };

  const resolved = await resolveStepOrigin(input.steps, input.index, input.actor, d.loadActionDeclaration);
  if (!resolved) return { kind: 'not-applicable' };
  const { origin, action, integrationKey } = resolved;

  const classification = classifyOrigin(`https://${origin}`, action ?? undefined);

  // FIRST REFERENCE WINS. A step naming several credentials is naming several ITEMS, and
  // `ensureSession` replays at most one password. The first is the one the author wrote first;
  // scoring them would invent a decision nobody asked for (the same reasoning `ensureSession`
  // applies to several candidate sessions).
  const credentialRef = declaration.credentialRefs[0];

  let verdict: EnsureSessionResult;
  try {
    verdict = await d.ensure({
      actor: input.actor,
      integrationKey,
      origin,
      runId: input.runId,
      ...(credentialRef ? { credentialRef } : {}),
      ...(input.residentialAvailable ? { residentialAvailable: input.residentialAvailable } : {}),
      requiresAttendedAuth: classification.requiresAttendedAuth,
    });
  } catch (err) {
    // A missing login URL is a DECLARATION gap, not an incident: the origin has no reviewed login
    // recipe, so nothing here can log in unattended and a human must. Every other throw propagates.
    if (isMissingLoginRecipe(err)) {
      return {
        kind: 'needs-credentials',
        request: buildRequest({
          input,
          origin,
          integrationKey,
          classification,
          mode: 'ceremony',
          reason: `${origin} has no reviewed login recipe, so only a person can establish this session`,
          issueRelay: d.issueRelay,
        }),
      };
    }
    throw err;
  }

  if (verdict.status === 'reused' || verdict.status === 'reestablished') {
    return { kind: 'ready', itemId: verdict.itemId, storageState: verdict.storageState };
  }
  if (verdict.status === 'needs-egress') {
    return {
      kind: 'needs-machine',
      reason: `the session for ${origin} is healthy but needs residential egress from ${verdict.required.pairingId}`,
    };
  }

  // `needs-human`. WHICH ceremony is the P3.2 decision, and it is made in exactly one place
  // (`credentialEstablishmentMode`) so the halt, the re-auth policy and the portal agree.
  return {
    kind: 'needs-credentials',
    request: buildRequest({
      input,
      origin,
      integrationKey,
      classification,
      mode: credentialEstablishmentMode({
        requiresAttendedAuth: classification.requiresAttendedAuth,
        route: verdict.route,
        hasCredentialRef: !!credentialRef,
      }),
      reason: verdict.reason,
      issueRelay: d.issueRelay,
    }),
  };
}

/**
 * WHAT THE HUMAN IS ASKED TO DO. One function, because the halt payload, the portal's rendering and
 * the P3.3 re-auth policy must not each answer it separately.
 *
 *   - `requiresAttendedAuth` ⇒ ceremony, ALWAYS and first. An OTP / MFA / CAPTCHA login has no
 *     unattended answer in this system and is never going to get one (docs/decisions.md
 *     2026-08-18), so no other input can move it.
 *   - route `relay` ⇒ ceremony. Checkout reached for a ceremony this platform will not improvise,
 *     or the typist met a form it does not recognise. Either way a person at a browser.
 *   - route `attended` with no credential reference ⇒ TYPIST. This is the ordinary "nobody has
 *     given us a password for this portal yet" case, and the cheapest honest ask is a password in
 *     the Cofre - the typist takes it from there on resume. Asking for a full headed ceremony here
 *     would be asking a human to do work the typist can do.
 *   - route `attended` WITH a reference ⇒ ceremony: a password exists and checkout still wants a
 *     person, so the password is not the missing piece.
 */
export function credentialEstablishmentMode(input: {
  requiresAttendedAuth: boolean;
  route: 'attended' | 'relay';
  hasCredentialRef: boolean;
}): 'typist' | 'ceremony' {
  if (input.requiresAttendedAuth) return 'ceremony';
  if (input.route === 'relay') return 'ceremony';
  return input.hasCredentialRef ? 'ceremony' : 'typist';
}

function buildRequest(args: {
  input: CredentialGateInput;
  origin: string;
  integrationKey: string;
  classification: OriginClassification;
  mode: 'typist' | 'ceremony';
  reason: string;
  issueRelay: typeof issueLoginRelayPrompt;
}): RunCredentialRequest {
  const { input, origin, integrationKey, mode, reason } = args;
  return {
    stepIndex: input.index,
    origin,
    integrationKey,
    portalDeepLink: cofrePortalDeepLink(origin),
    mode,
    reason: reason.slice(0, 500),
    // A ceremony request gets the login relay prompt so the portal can say WHERE to log in; a
    // typist request does not, because nobody is being asked to open a browser.
    ...(mode === 'ceremony'
      ? {
          ceremony: args.issueRelay({
            automationName: input.automationName,
            siteOrigin: origin,
            reason: reason.slice(0, 500),
          }),
        }
      : {}),
  };
}

/** The reviewed-login-URL refusal, matched on the typed code rather than on message text. */
function isMissingLoginRecipe(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return e?.code === 'SESSION_ESTABLISHMENT_REFUSED' && typeof e.message === 'string'
    && e.message.includes('no login URL for');
}

// ---------------------------------------------------------------------------
// Origin resolution
// ---------------------------------------------------------------------------

interface ResolvedStepOrigin {
  /** Bare host, lower-cased - what the Cofre binds on. */
  origin: string;
  /** The action declaration behind it, when one was found. Feeds `classifyOrigin`. */
  action: IntegrationActionDeclaration | null;
  /** Label for the halt payload. Trace only; never branched on (Rule 3). */
  integrationKey: string;
}

/**
 * The origin a step at `index` will use a credential against. See the module docblock for the
 * precedence and why it is that order. Walks BACKWARDS from `index` so a browser step inherits the
 * portal the run most recently navigated to.
 */
export async function resolveStepOrigin(
  steps: readonly Step[],
  index: number,
  actor: Actor,
  loadDeclaration: typeof loadIntegrationActionDeclaration,
): Promise<ResolvedStepOrigin | null> {
  for (let i = index; i >= 0; i--) {
    const step = steps[i];
    if (!step) continue;

    if (step.type === 'integration' && step.integrationKey && step.integrationAction) {
      const action = await loadDeclaration(step.integrationKey, step.integrationAction, actor);
      const host = hostOfUrl(action?.httpConfig?.baseUrl);
      if (host) return { origin: host, action: action ?? null, integrationKey: step.integrationKey };
      continue;
    }

    const literal = step.type === 'navigate' ? step.url : urlOfApiCall(step);
    const host = hostOfUrl(literal);
    if (host) {
      return { origin: host, action: null, integrationKey: step.integrationKey ?? 'browser' };
    }
  }
  return null;
}

/** The api_call step's request URL, whatever the engine's step shape calls it. */
function urlOfApiCall(step: Step): string | undefined {
  if (step.type !== 'api_call') return undefined;
  const req = (step as unknown as { apiRequest?: { url?: unknown } }).apiRequest;
  return typeof req?.url === 'string' ? req.url : undefined;
}

/**
 * The bare host of an absolute URL. A TEMPLATED url (`{{input.host}}/x`) answers null and therefore
 * gates nothing: a host the run has not resolved yet is not a statement about where a credential
 * goes, and guessing at one is how a credential is aimed at the wrong place.
 */
function hostOfUrl(raw: string | undefined): string | null {
  if (!raw || raw.includes('{{')) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}
