/**
 * integrations/integration-capability.ts — the PUBLIC capability core (slice D1).
 *
 * ================================ WHAT THIS IS ==============================================
 * RUN_SPEC criterion 7's `get` + `execute-action`: the two operations an OUTSIDE client holding a
 * per-user gateway key performs against an integration. `routes/integrations.ts` mounts them; this
 * module is where the behaviour lives, so the route stays a validate/call/shape shell and the
 * behaviour is testable without a socket.
 *
 * ================================ WHAT IT DELIBERATELY DOES NOT DO ==========================
 * THE WRITE GATE IS INHERITED. `executeIntegrationCapabilityAction` calls
 * `executeUserIntegrationAction` and nothing else — never `checkActionConsent`, never a private
 * step of the executor, never a "the caller already checked" fast path. C2 placed the gate INSIDE
 * the executor, after the shape gates and before `findConfigForOwner`, exactly so that a write
 * nobody approved never causes a credential to be read, on ANY of the four rails. A capability
 * endpoint that reached past that would be a fifth rail with its own rules, which is the failure
 * this design exists to prevent. Pinned statically by
 * `api/tests/integrations/integration-capability.test.ts` and behaviourally by
 * `api/tests/contract/integrations-capability.test.ts`.
 *
 * IT ALSO NEVER APPROVES. Reading whether an approval already stands (`liveApprovalFor`) is a read
 * of the CALLER's own rows and is advisory — the executor re-evaluates the gate at call time, and a
 * `once` row is CLAIMED there, atomically. Granting one is `POST …/approval`, which is `auth:'user'`
 * and therefore unreachable with a gateway key: an agent refused at the gate cannot hand itself the
 * exemption it was just quoted.
 *
 * ================================ TENANCY ===================================================
 * Every read and every execute is taken under the actor built from the verified principal, and
 * under nothing else (Rule 5). There is no argument, body field, header or query on this surface
 * that names an org, a user or an owner — `ExecuteIntegrationActionRequest` carries `args` only,
 * and zod strips the rest, so inventing one is inert rather than influential.
 *
 * FAIL CLOSED ON A MISSING TENANT (the standing A2/A3/B2 precedent). An actor with no `orgId` or no
 * `userId` is refused before any resolution: since A2 the org SELECTS which definition resolves, so
 * an org-less actor would match no own row and EVERY `global` row — i.e. resolve an arbitrary
 * tenant's package and then run it under whatever credential the empty user pair finds. A broken
 * principal is not a tenant.
 *
 * ================================ WHAT THE PROJECTION MAY REVEAL ============================
 * The definition itself is projected by `definitionFromDoc` (A2), unchanged and NOT re-derived
 * here: it drops the storage envelope, exposes `id`/`visibility` only for a row of the caller's OWN
 * org (E1 review F3), and runs the same `redactSecrets` pass on both tiers (A2 review F7). So a
 * cross-org `global` row reaches a capability client with no author, no id and no credential
 * material — the same bytes the dashboard already sees for it. This module adds only DERIVED
 * per-action facts (backing, transport, target, approval shape and state); it adds no field that
 * could carry a secret, and it re-reads none of the tenancy rules.
 */
import type { Actor } from '@ekoa/shared';
import { logActivity, type LogActivityDeps } from '../data/activity.js';
import {
  resolveBackingType,
  type IntegrationAction,
  type IntegrationDefinition,
} from './definitions.js';
import { resolveDefinition } from './definition-registry.js';
// The consent module's READ side only. `checkActionConsent` — the gate — is deliberately NOT
// imported: it belongs to the executor, and importing it here would put a second copy of the
// decision one keystroke away from the rail that must inherit it.
import { actionRequiresConsent, describeAction, liveApprovalFor } from './action-consent.js';
import {
  executeUserIntegrationAction,
  type ExecuteIntegrationActionResult,
  type ExecutorDeps,
} from './action-executor.js';
import { findConfigForOwner } from './service.js';

/** The per-action capability row (shared/src/integrations.ts `IntegrationCapabilityAction`). */
export interface CapabilityActionView {
  actionName: string;
  description: string;
  backingType: string;
  transport: string;
  target: string;
  shape: string;
  requiresApproval: boolean;
  approved: boolean;
}

/** The capability view of one integration (shared/src/integrations.ts `IntegrationCapability`). */
export interface CapabilityView {
  integration: IntegrationDefinition;
  connected: boolean;
  actions: CapabilityActionView[];
}

/**
 * Why a capability call could not proceed, in the two cases the ROUTE has to distinguish. Every
 * other outcome — including a refused write — comes back as an executor result, because the call
 * was addressed and admitted and then produced an answer.
 *
 *   `no_tenant` — the verified principal carries no org/user pair (see the fail-closed note above).
 *   `not_found` — the integration (or the action on it) does not resolve UNDER THIS ACTOR. One
 *                 verdict for "does not exist" and "you may not see it", on purpose.
 */
export type CapabilityRefusal = 'no_tenant' | 'not_found';

export type CapabilityOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; refusal: CapabilityRefusal };

/** The audit principal a gateway-key admission left behind — trace only (Rule 3), never branched on. */
export interface CapabilityPrincipal {
  keyId: string;
  xClient?: string;
}

export interface CapabilityContext {
  actor: Actor;
  deps: LogActivityDeps & { genId?: () => string };
  /** Present ONLY on a key-admitted call; a JWT call leaves it undefined. */
  principal?: CapabilityPrincipal;
  /** Username for the activity row (the shared `Actor` does not carry one). */
  username?: string;
  /** The automation seam, bound once by the composition root and handed to every rail. */
  runAutomationBackedAction?: ExecutorDeps['runAutomationBackedAction'];
}

/** A real tenant means BOTH halves are named. Neither an empty org nor an empty user is a tenant. */
function hasTenant(actor: Actor): boolean {
  return !!actor.orgId && !!actor.userId;
}

/**
 * The action's backing, or the literal `'invalid'`.
 *
 * A malformed package must not throw out of a READ: the executor already refuses it with the coded
 * `invalid_backing_type`, and a client asking "what can I do here" deserves to be told that this
 * action is broken rather than handed a 500 for the whole integration. Same fallback token, and the
 * same reasoning, as `action-consent.ts`'s private `safeBacking` — which is private to the module
 * that owns the write gate and stays that way (C2's file is not ours to widen).
 */
function backingOf(action: IntegrationAction): string {
  try {
    return resolveBackingType(action);
  } catch {
    return 'invalid';
  }
}

/**
 * Project ONE integration onto its capability view.
 *
 * `connected` mirrors the executor's own two refusals (`not_connected`, `disabled`) rather than
 * inventing a third rule: a config that exists and is enabled, or an integration that needs no
 * config at all. Reporting anything else would let this read disagree with the very next execute.
 */
export async function getIntegrationCapability(
  ctx: CapabilityContext,
  integrationKey: string,
): Promise<CapabilityOutcome<CapabilityView>> {
  if (!hasTenant(ctx.actor)) return { ok: false, refusal: 'no_tenant' };

  // A2's tenant-scoped registry, under the verified actor. A key the actor cannot see resolves to
  // null exactly as a key that does not exist does.
  const def = await resolveDefinition(ctx.actor, integrationKey);
  if (!def) return { ok: false, refusal: 'not_found' };

  // The SAME owner-scoped lookup the executor performs, so `connected` cannot drift from it.
  const config = await findConfigForOwner(ctx.actor.orgId, ctx.actor.userId, integrationKey);
  const connected = config ? config.enabled !== false : def.authType === 'none';

  const actions: CapabilityActionView[] = [];
  for (const action of def.actions ?? []) {
    const descriptor = describeAction(integrationKey, action);
    const requiresApproval = actionRequiresConsent(action);
    // A read is never looked up: it has no approval to have, and asking for one would invent a row
    // shape for actions that are not gated (the same rule the dashboard's approvals route follows).
    const live = requiresApproval
      ? await liveApprovalFor(
        { orgId: ctx.actor.orgId, userId: ctx.actor.userId },
        integrationKey,
        action.actionName,
        descriptor.shape,
      )
      : null;
    actions.push({
      actionName: descriptor.actionName,
      description: descriptor.description,
      backingType: backingOf(action),
      transport: action.transport ?? 'http',
      target: descriptor.target,
      shape: descriptor.shape,
      requiresApproval,
      approved: live !== null,
    });
  }

  return { ok: true, value: { integration: def, connected, actions } };
}

/**
 * EXECUTE one action. The whole body is: refuse an actor with no tenant, then hand the call to
 * `executeUserIntegrationAction` and audit what came back.
 *
 * NOTHING IS PRE-RESOLVED. This function deliberately does not look the definition or the action up
 * first: the executor's refusal ORDER is load-bearing (an unapproved write on an integration that
 * is not even connected answers `awaiting_consent` rather than `not_connected`, so the gate cannot
 * be probed for connection state by a caller who has not been approved), and a pre-check here would
 * silently re-order it for this rail alone.
 */
export async function executeIntegrationCapabilityAction(
  ctx: CapabilityContext,
  integrationKey: string,
  actionName: string,
  args: Record<string, unknown>,
): Promise<CapabilityOutcome<ExecuteIntegrationActionResult>> {
  if (!hasTenant(ctx.actor)) return { ok: false, refusal: 'no_tenant' };

  const t0 = Date.now();
  const result = await executeUserIntegrationAction(
    {
      orgId: ctx.actor.orgId,
      ownerUserId: ctx.actor.userId,
      integrationKey,
      actionName,
      args,
    },
    ctx.runAutomationBackedAction ? { runAutomationBackedAction: ctx.runAutomationBackedAction } : {},
  );

  await auditExecute(ctx, integrationKey, actionName, result, t0);
  return { ok: true, value: result };
}

/**
 * One activity row per EXECUTE, under BOTH admissions.
 *
 * Why both, where knowledge's BROWSE audit is key-only: this call has SIDE EFFECTS on a third-party
 * account under the user's own credential. "Who told Cortex to post that message, from where, and
 * what did it answer" must be answerable afterwards whatever admitted the call. A leaked key
 * driving writes and a compromised session driving writes need the same trail.
 *
 * WHAT IS RECORDED, and what is NOT: which integration, which action, the outcome code, the
 * latency, and the key principal (`keyId` + the already-capped `x-client` tag — trace only, never
 * branched on, Rule 3). NOT the `args`, and NOT the response `data`: both are caller/remote payload
 * and can carry client PII or a secret the remote echoed, and an audit trail that quietly becomes a
 * copy of the payload is a new exfiltration surface rather than a control.
 *
 * Fire-and-forget in the sense that matters: an audit failure must not turn a completed remote write
 * into an error the caller retries.
 */
async function auditExecute(
  ctx: CapabilityContext,
  integrationKey: string,
  actionName: string,
  result: ExecuteIntegrationActionResult,
  t0: number,
): Promise<void> {
  try {
    await logActivity(
      { userId: ctx.actor.userId, username: ctx.username ?? ctx.actor.userId, orgId: ctx.actor.orgId },
      'integrations',
      'capability_execute',
      ctx.deps,
      {
        integrationKey,
        actionName,
        verdict: result.success ? 'ok' : 'failed',
        ...(result.code ? { code: result.code } : {}),
        ...(result.status !== undefined ? { status: result.status } : {}),
        ms: Date.now() - t0,
        ...(ctx.principal ? { keyId: ctx.principal.keyId } : {}),
        ...(ctx.principal?.xClient ? { xClient: ctx.principal.xClient } : {}),
      },
    );
  } catch (err) {
    console.warn(`[integration-capability] audit write failed for ${integrationKey}.${actionName}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * How an executor result becomes a wire answer. ONE mapping, here rather than in the route, so the
 * split is testable without a socket and cannot be re-decided per endpoint later.
 *
 *   `not_found`         — the call could not be ADDRESSED. `unknown_integration` and `unknown_action`
 *                         are both resolved under the caller's actor by the executor, so this
 *                         verdict is already uniform between "does not exist" and "not visible to
 *                         you"; the route answers the house 404 for it, byte-identical either way.
 *   `awaiting_consent`  — the call was addressed but NOT PERMITTED, and nothing ran: no credential
 *                         was read, no request left the process. A 2xx here would tell every
 *                         generic HTTP client (and the client generated from our own spec) that a
 *                         write succeeded when it never happened, so this is a 403 carrying the
 *                         descriptor the human must be shown.
 *   `result`            — everything else, at 200: a success, and every outcome of the routed call
 *                         (a remote 4xx/5xx, a locked credential's `origin_refused`, `disabled`, a
 *                         transport timeout). Those are answers ABOUT the remote system, and they
 *                         are exactly what the other three rails already receive.
 */
export type CapabilityWireOutcome =
  | { kind: 'not_found' }
  | { kind: 'awaiting_consent'; consentRequest: NonNullable<ExecuteIntegrationActionResult['consentRequest']> }
  | { kind: 'result'; body: { success: boolean; status?: number; data?: unknown; code?: string; error?: string } };

export function capabilityWireOutcome(result: ExecuteIntegrationActionResult): CapabilityWireOutcome {
  if (result.code === 'unknown_integration' || result.code === 'unknown_action') return { kind: 'not_found' };
  if (result.code === 'awaiting_consent') {
    // The executor always attaches the descriptor with this code; the fallback keeps a malformed
    // result from becoming a 500 on the refusal path — the refusal itself still stands.
    const consentRequest = result.consentRequest
      ?? { integrationKey: '', actionName: '', description: '', target: 'destino indeterminado', shape: '' };
    return { kind: 'awaiting_consent', consentRequest };
  }
  return {
    kind: 'result',
    body: {
      success: result.success,
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(result.error ? { error: result.error } : {}),
    },
  };
}
