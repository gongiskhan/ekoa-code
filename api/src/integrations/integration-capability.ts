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
 * THE WRITE GATE IS INHERITED. `executeIntegrationCapabilityAction` never calls
 * `checkActionConsent`, never a private step of an executor, never a "the caller already checked"
 * fast path. It reaches exactly TWO executors, each of which owns the gate itself:
 * `executeUserIntegrationAction` for a user-credential package, and — through the injected
 * `callPlatform` seam — `callPlatformIntegration` for the two platform packages, whose OAuth
 * tokens live on an org-scoped row the user rail cannot read. That second branch is a CUSTODY
 * dispatch, not a second gate: platform-call.ts enforces the same decision over the same
 * `action-consent.ts` primitives, in the one function every platform rail calls. C2 placed the gate INSIDE
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
 * ================================ WHOSE DEFINITION THIS IS (slice D3) =======================
 * THE CATALOG AND THE EXECUTE RESOLVE THE SAME PACKAGE, AS THE SAME PRINCIPAL. They did not.
 *
 * The 2026-08-03 credential fix made EXECUTION resolve a definition as the credential's CUSTODIAN
 * (`definitionActorForCredential`), because for an ORG-SHARED config the reader is not the person
 * whose ceremony produced the bundle — and resolving as the reader let any org member author the
 * contract their admin's secret is spent under. That fix landed on both executor rails and was
 * routed to this file as a COHERENCE residual: `getIntegrationCapability` still resolved as
 * `ctx.actor`, so a peer's catalog could list the actions of their OWN private package while the
 * very next execute ran the custodian's. Security held (the executor is the gate), but the read
 * and the write disagreed about what the integration IS, which is how a client is told one thing
 * and handed another — and it is how the next reader of this file concludes the reader-resolution
 * is the correct one.
 *
 * `resolveCapabilityDefinition` is now the ONE resolution both this module and
 * `integration-achieve.ts` use, and it mirrors the executor's order exactly: read the config row
 * first, derive the custodian from it, resolve the definition as THAT principal. Nothing is
 * re-derived here — `definitionActorForCredential` is imported, not copied — and an incoherent
 * (actor, config) pair fails closed rather than resolving as somebody.
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
import { actionRequiresConsent, describeAction, liveApprovalFor, targetResolutionOf } from './action-consent.js';
import { authoringStateOf } from './authored-action.js';
import { definitionActorForCredential } from './credential-cofre.js';
import {
  executeUserIntegrationAction,
  type ExecuteIntegrationActionResult,
  type ExecutorDeps,
} from './action-executor.js';
import { findConfigForOwner, type IntegrationConfigDoc } from './service.js';
import { isPlatformIntegrationKey } from './platform-call.js';

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
  /**
   * Who wrote this action (slice D3). `none` — a human did (a shipped package, a builder save);
   * `provisional` — the platform authored it via `achieve` and no person has confirmed it, so it
   * is stored as a write and `achieve` will not run it; `trusted` — a person promoted it.
   *
   * Derived, never stored twice: `authoringStateOf` demotes a `trusted` record whose fingerprint
   * no longer matches the action's bytes, so a re-authored action reads as provisional here for
   * exactly the same reason the executor's gate re-prompts for it.
   */
  authoringState: 'none' | 'provisional' | 'trusted';
  /**
   * THE ORG'S OWN automation id for an automation-backed action, when one has been materialised.
   *
   * NOT the id the package declares. `automationBinding.automationId` on a shipped package is a
   * PLACEHOLDER its author wrote (`citius-notificacoes-template`) and names nothing; the row a
   * tenant runs is minted per org and joined back by provenance. The S8 live pass is where that
   * bit: the detail page read the declared id straight off the definition, fetched it, and rendered
   * "automation not found" beside four automations that existed.
   *
   * ABSENT for every api-call action (there is no automation) AND for a bound action this org has
   * not provisioned yet - which is a state the reader must be able to see rather than a 404 one
   * fetch later.
   */
  automationId?: string;
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
  /**
   * Resolve the caller's org's materialised automation ids for one integration, keyed by
   * `templateKey`. A SEAM rather than an import because `integrations/` may not reach into
   * `automation/` (the S1 evidence collector is the standing precedent), and the composition root
   * binds it to `managedAutomationIdsFor`.
   *
   * Unbound, every action reports no automation id - the honest degradation, and the same one an
   * unprovisioned integration produces.
   */
  resolveManagedAutomationIds?: (orgId: string, integrationKey: string) => Promise<Record<string, string>>;
  /**
   * The TENANT-READ seam (slice S9), bound once beside the automation one and for its exact wiring
   * reason. Omitting it here would leave the shipped `citius processos` action answering
   * `unsupported_backing_type` on the capability and `achieve` rails while working on the schedule
   * and automation ones - one rail quietly behaving differently from the rest, which is the failure
   * the D1 note beside `runAutomationBackedAction` in `server.ts` was written about.
   */
  readTenantDataset?: ExecutorDeps['readTenantDataset'];
  /**
   * THE EVIDENCE SEAMS (slice S1), bound once by the composition root alongside the automation one
   * and merged into the executor deps at the dispatch below.
   *
   * Carried as a BUNDLE rather than as more named fields, deliberately: every seam added to this
   * context so far has had to be remembered separately at each call site, and the failure mode when
   * one is forgotten is SILENCE - the rail keeps working and quietly stops doing the thing. A bundle
   * can only be threaded whole, so a seam added to it reaches every rail without four call sites
   * remembering it.
   *
   * CAPTURE SEAMS ONLY. Round four briefly carried a third member - `discardOwnActionEvidence`, the
   * reader's own collection - and round five removed it along with every other synchronous
   * collector; nothing on an execution path deletes an evidence row any more.
   *
   * Absent ⇒ the capability rail executes exactly as it did before this slice and records no
   * evidence. It IS bound in production, and
   * `api/tests/automation/composition-root-action-seam.test.ts` is what stops that binding from
   * quietly disappearing.
   */
  executorEvidence?: Pick<ExecutorDeps, 'recordActionEvidence' | 'collectRunEvidence'>;
  /**
   * The PLATFORM seam (google-workspace / microsoft-365), bound once by the composition root
   * exactly like the automation one. Absent, a platform action is refused as `not_connected`
   * rather than silently routed down the user-credential rail — see the dispatch below.
   */
  callPlatform?: (input: {
    orgId: string;
    integrationKey: string;
    actionName: string;
    args: Record<string, unknown>;
    actingUserId?: string;
  }) => Promise<ExecuteIntegrationActionResult>;
  /**
   * Whether the ORG's platform connection for this key is live — the read-side counterpart of
   * `callPlatform`, so the catalog cannot claim a package is disconnected while the very next
   * execute succeeds. Absent, the pre-existing user-config rule applies unchanged.
   */
  platformConnected?: (orgId: string, integrationKey: string) => Promise<boolean>;
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

/** What one capability-scoped resolution produced: the definition, the config row it was resolved
 *  THROUGH, and the principal it was resolved AS. All three are what `achieve` needs too. */
export interface ResolvedCapabilityDefinition {
  definition: IntegrationDefinition;
  config: IntegrationConfigDoc | null;
  /** The credential's CUSTODIAN — see the module header. Equals the actor when there is no
   *  org-shared credential in play, which is the ordinary case. */
  definitionActor: Actor;
}

/**
 * THE ONE CAPABILITY-SIDE RESOLUTION, in the executor's own order (D3, closing the coherence
 * residual the credential fix routed here).
 *
 *   1. fail closed on a principal that names no tenant;
 *   2. read the CONFIG ROW — the same owner-scoped lookup `executeUserIntegrationAction` performs,
 *      so `connected` cannot drift from the executor's `not_connected`/`disabled` either;
 *   3. derive the custodian with `definitionActorForCredential` (imported, never re-derived);
 *   4. resolve the definition AS THAT PRINCIPAL through A2's tenant-scoped registry.
 *
 * An incoherent (actor, config) pair — the executor's `credential_invalid` case — answers
 * `not_found` here rather than resolving as somebody: "we could not determine whose package this
 * is" must never collapse into "resolve an arbitrary one". A key the actor cannot see resolves to
 * null exactly as a key that does not exist does; one verdict for both, on purpose.
 */
export async function resolveCapabilityDefinition(
  actor: Actor,
  integrationKey: string,
): Promise<CapabilityOutcome<ResolvedCapabilityDefinition>> {
  if (!hasTenant(actor)) return { ok: false, refusal: 'no_tenant' };
  const config = await findConfigForOwner(actor.orgId, actor.userId, integrationKey);
  const definitionActor = definitionActorForCredential(actor, config);
  if (!definitionActor) return { ok: false, refusal: 'not_found' };
  const definition = await resolveDefinition(definitionActor, integrationKey);
  if (!definition) return { ok: false, refusal: 'not_found' };
  return { ok: true, value: { definition, config, definitionActor } };
}

/**
 * The org's automation id for one action, or `undefined`.
 *
 * Keyed on the binding's `automationTemplate` - the provenance the materialised row carries - and
 * never on its `automationId`, which is the placeholder that caused this field to exist.
 */
function managedAutomationIdFor(action: IntegrationAction, managedIds: Record<string, string>): string | undefined {
  const templateKey = action.automationBinding?.automationTemplate;
  if (templateKey === undefined || templateKey === '') return undefined;
  return managedIds[templateKey];
}

/**
 * Project ONE integration onto its capability view.
 *
 * `connected` mirrors the executor's own two refusals (`not_connected`, `disabled`) rather than
 * inventing a third rule: a config that exists and is enabled, or an integration that needs no
 * config at all. Reporting anything else would let this read disagree with the very next execute.
 *
 * WHICH EXECUTOR, though. The two platform packages are dispatched to `callPlatformIntegration`
 * (see `executeIntegrationCapabilityAction`), and their custody is an ORG-scoped OAuth row, not the
 * per-user config this function reads — so the user-config rule reported `connected: false` for an
 * org whose Google account was live and whose actions executed fine. That is the D3 failure in the
 * opposite direction: the read and the write disagreeing about what the integration IS, with the
 * read now the pessimistic one. The `platformConnected` seam answers for exactly those keys.
 */
export async function getIntegrationCapability(
  ctx: CapabilityContext,
  integrationKey: string,
): Promise<CapabilityOutcome<CapabilityView>> {
  const resolved = await resolveCapabilityDefinition(ctx.actor, integrationKey);
  if (!resolved.ok) return resolved;
  const { definition: def, config } = resolved.value;
  const connected =
    isPlatformIntegrationKey(integrationKey) && ctx.platformConnected
      ? await ctx.platformConnected(ctx.actor.orgId, integrationKey)
      : config
        ? config.enabled !== false
        : def.authType === 'none';

  // The SAME resolution the executor's gate uses, so `target`/`approved` here describe the call the
  // executor would actually make. Non-secret values only, straight off the un-decrypted row.
  const resolution = targetResolutionOf(def.configSchema, config?.publicConfigValues);

  // ONE resolution for the whole integration, before the per-action loop: the seam's query is
  // already narrowed by (org, integrationKey), and asking per action would multiply it by five.
  let managedIds: Record<string, string> = {};
  if (ctx.resolveManagedAutomationIds) {
    try {
      managedIds = await ctx.resolveManagedAutomationIds(ctx.actor.orgId, integrationKey);
    } catch {
      // A failed lookup reports NO automation id rather than a wrong one: the reader then sees the
      // same "not prepared yet" state an unprovisioned integration shows, which is recoverable.
      managedIds = {};
    }
  }

  const actions: CapabilityActionView[] = [];
  for (const action of def.actions ?? []) {
    const descriptor = describeAction(integrationKey, action, resolution);
    const requiresApproval = actionRequiresConsent(action);
    // A read is never looked up: it has no approval to have, and asking for one would invent a row
    // shape for actions that are not gated (the same rule the dashboard's approvals route follows).
    const live = requiresApproval
      ? await liveApprovalFor(
        { orgId: ctx.actor.orgId, userId: ctx.actor.userId },
        integrationKey,
        action.actionName,
        descriptor.shape,
        descriptor.target,
      )
      : null;
    actions.push({
      actionName: descriptor.actionName,
      description: descriptor.description,
      backingType: backingOf(action),
      // SLICE S9 (review round). `transport` is documented on the wire as "the wire protocol the
      // action needs", and a `tenant-read` action needs none - D-S9-3 argues at length that naming
      // one "would be a lie of the same class as the http://127.0.0.1:0 placeholder". Reporting the
      // ?? 'http' default for it published exactly that lie on the versioned capability surface.
      //
      // PROJECTION ONLY, and the distinction is load-bearing: the action must keep DECLARING no
      // transport, because the executor's transport gate refuses anything but 'http' and sits ABOVE
      // the backing dispatch - so writing 'none' into the package would make the action unrunnable.
      // What is corrected is what a client is TOLD, not what the executor reads.
      transport: backingOf(action) === 'tenant-read' ? 'none' : (action.transport ?? 'http'),
      target: descriptor.target,
      shape: descriptor.shape,
      requiresApproval,
      approved: live !== null,
      authoringState: authoringStateOf(integrationKey, action),
      ...(managedAutomationIdFor(action, managedIds) !== undefined
        ? { automationId: managedAutomationIdFor(action, managedIds) }
        : {}),
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
  // WHICH CUSTODY THIS KEY HAS, not which backing the action declares. The two shipped platform
  // packages keep their OAuth tokens on an ORG-scoped row that only `callPlatformIntegration` can
  // read; `executeUserIntegrationAction` resolves a PER-USER config row and, finding none, answers
  // `not_connected` however connected the org really is. Before this dispatch the capability
  // surface listed google-workspace and all 24 of its actions, gated its writes, and could not
  // execute a single one of them - the catalog advertised a rail that did not exist.
  //
  // THE WRITE GATE SURVIVES THE BRANCH, which is the only reason the branch is allowed. C2 put the
  // gate inside `executeUserIntegrationAction`; `callPlatformIntegration` enforces its own, in the
  // one function every platform rail calls, over the SAME `action-consent.ts` primitives - and it
  // needs `actingUserId` to look up the approval, so the acting user is passed explicitly. A
  // mutating platform action with no live approval still comes back `awaiting_consent`, and still
  // cannot be approved with a key (the approval route is `auth: 'user'`).
  const result =
    isPlatformIntegrationKey(integrationKey) && ctx.callPlatform
      ? await ctx.callPlatform({
          orgId: ctx.actor.orgId,
          integrationKey,
          actionName,
          args,
          actingUserId: ctx.actor.userId,
        })
      : await executeUserIntegrationAction(
          {
            orgId: ctx.actor.orgId,
            ownerUserId: ctx.actor.userId,
            integrationKey,
            actionName,
            args,
          },
          {
            ...(ctx.runAutomationBackedAction ? { runAutomationBackedAction: ctx.runAutomationBackedAction } : {}),
            // Slice S9: the tenant-read seam rides the same deps object, so a tenant-read action
            // answers identically on this rail and on the three others.
            ...(ctx.readTenantDataset ? { readTenantDataset: ctx.readTenantDataset } : {}),
            // Slice S1: the evidence seams ride the same deps object the automation seam does, so a
            // capability-rail execute records the same evidence every other rail records. Spread
            // whole - see `executorEvidence`.
            ...(ctx.executorEvidence ?? {}),
          },
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
        // K4: HOW an automation-backed action answered - by recipe replay or by its authored run.
        // Before this the row could not tell the two apart, so a replayed execution (which writes
        // no automation_runs document) was unfindable after the fact. Facts only, never payload:
        // the envelope's ids and version - and ONLY behind the executor's out-of-band
        // `automationEnvelope` marker, never a structural probe a remote body could satisfy
        // (review fix: an api-call action's `data` is the REMOTE's JSON, and a payload-controlled
        // audit row is the exact contamination the docblock above forbids).
        ...(result.automationEnvelope === true ? (replayAuditFieldsOf(result.data) ?? {}) : {}),
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

/**
 * The automation-backed envelope's LEG MARKERS (K4). The envelope is `ActionRunEnvelope`
 * (automation/service.ts) riding `data` as `unknown` - a lower tier this module does not import -
 * so the FIELDS are read structurally, but WHETHER `data` is the envelope at all is never a
 * structural question: callers gate on the executor's out-of-band `automationEnvelope` marker
 * (review fix - an api-call action's `data` is the remote's JSON, and a remote answering
 * {"runId","status","replayed"} must not be able to forge replay provenance onto the wire or the
 * audit row).
 */
function envelopeMarkersOf(data: unknown): { runId: string; replayed?: boolean; recipeVersion?: number; replayMs?: number } | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as { runId?: unknown; status?: unknown; replayed?: unknown; recipeVersion?: unknown; replayMs?: unknown };
  if (typeof d.runId !== 'string' || typeof d.status !== 'string') return null;
  return {
    runId: d.runId,
    ...(d.replayed === true ? { replayed: true } : {}),
    ...(typeof d.recipeVersion === 'number' ? { recipeVersion: d.recipeVersion } : {}),
    ...(typeof d.replayMs === 'number' ? { replayMs: d.replayMs } : {}),
  };
}

/** The audit-row slice of the markers: present only when the data IS the one envelope. */
function replayAuditFieldsOf(data: unknown): Record<string, unknown> | null {
  const m = envelopeMarkersOf(data);
  if (!m) return null;
  return {
    runId: m.runId,
    replayed: m.replayed === true,
    ...(m.recipeVersion !== undefined ? { recipeVersion: m.recipeVersion } : {}),
  };
}

export function capabilityWireOutcome(result: ExecuteIntegrationActionResult): CapabilityWireOutcome {
  if (result.code === 'unknown_integration' || result.code === 'unknown_action') return { kind: 'not_found' };
  if (result.code === 'awaiting_consent') {
    // The executor always attaches the descriptor with this code; the fallback keeps a malformed
    // result from becoming a 500 on the refusal path — the refusal itself still stands.
    const consentRequest = result.consentRequest
      ?? { integrationKey: '', actionName: '', description: '', target: 'destino indeterminado', shape: '' };
    return { kind: 'awaiting_consent', consentRequest };
  }
  // K4: the typed replay block. The same facts used to ride only inside `data` (z.unknown on the
  // wire), where no client could rely on them; the block is attached exactly when the EXECUTOR
  // says `data` is the one automation-backed envelope (`automationEnvelope`, out-of-band), so
  // api-call/tenant-read responses are unchanged and a remote body cannot fabricate one.
  const markers = result.automationEnvelope === true ? envelopeMarkersOf(result.data) : null;
  return {
    kind: 'result',
    body: {
      success: result.success,
      ...(result.status !== undefined ? { status: result.status } : {}),
      ...(result.data !== undefined ? { data: result.data } : {}),
      ...(result.code ? { code: result.code } : {}),
      ...(result.error ? { error: result.error } : {}),
      ...(markers
        ? {
            replay: {
              replayed: markers.replayed === true,
              runId: markers.runId,
              ...(markers.recipeVersion !== undefined ? { recipeVersion: markers.recipeVersion } : {}),
              ...(markers.replayMs !== undefined ? { durationMs: markers.replayMs } : {}),
            },
          }
        : {}),
    },
  };
}
