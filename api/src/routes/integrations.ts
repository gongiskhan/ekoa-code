/**
 * Integrations router (ch03 §3.8.13). Since D1 it carries TWO ADMISSION TIERS, and the split is
 * the point:
 *
 *   1. The PUBLIC CAPABILITY surface — `user-or-key` (Capability Contract rule 4): discover the
 *      caller's integrations (`GET /`), read one as a capability (`GET /:key`), and execute an
 *      action under the caller's own credentials (`POST /:key/actions/:actionName/execute`). A
 *      per-user gateway key reaches these; `requireUserOrApiKey` delegates to `requireAuth`
 *      untouched for a platform JWT, so the dashboard's calls are byte-identical to before.
 *   2. Everything else — the dashboard surface: configs CRUD, the active catalog, the org-admin
 *      refresh, the SHARING routes (E1), the five PUBLISH DOORS (S6) and the three WRITE-GATE
 *      consent routes (C2). These carry `requireAuth` and a gateway key can never reach them. The
 *      consent routes in particular are `auth: 'user'` on purpose: an agent refused at the write
 *      gate must not be able to POST the shape it was just handed and retry (see
 *      shared/src/integrations.ts `approveAction`). The publish doors are `user` / `super-admin`
 *      for the sibling reason `setGlobal` is: a key must never publish to every org.
 *
 * HOW THE TWO TIERS ARE KEPT APART, and why the ordering below is load-bearing: express matches in
 * registration order, so `GET /:key` (tier 1) is registered AFTER the dashboard's literal-segment
 * routes (`/active`, `/configs`, `/refresh`, `/definitions/…`, `/recipes`) - otherwise it would
 * swallow them - and the router-wide `requireAuth` blanket sits BELOW it, covering every remaining
 * `:key` route. The same rule applies one level down, inside `/definitions`: the literal
 * `/definitions/publish-requests` is registered before the four `/definitions/:id/…` routes.
 * That blanket is the SAFE DEFAULT for anything appended later. The routes above it each carry
 * their admission EXPLICITLY, and `api/tests/contract/integrations-capability.test.ts` walks this
 * router's own stack and probes every route it finds: unauthenticated must be 401, and every route
 * outside the declared capability set must refuse a real gateway key. A new route added anywhere in
 * this file is therefore covered by that gate without anyone remembering to extend it.
 *
 * Persistence via the integrations service; definitions via the tenant-scoped registry (ch02 §2.7);
 * credentials NEVER returned (summary only).
 */
import { Router, type Response } from 'express';
import {
  type Actor,
  SetDefinitionVisibilityRequest,
  SetDefinitionGlobalRequest,
  ApproveIntegrationActionRequest,
  ExecuteIntegrationActionRequest,
  AchieveIntegrationGoalRequest,
  TrustAuthoredActionRequest,
  IntegrationActionParams,
  IntegrationKeyParams,
  SetIntegrationLessonsRequest,
  SetIntegrationActionFeedbackRequest,
  DiscardActionFeedbackQuery,
  RequestDefinitionPublishRequest,
  PublishDefinitionRequest,
} from '@ekoa/shared';
import { requireAuth, requireRole, type AuthedRequest } from '../auth/middleware.js';
import { requireUserOrApiKey, type ApiKeyPrincipal } from '../auth/api-key-middleware.js';
import { listConfigs, upsertConfig, updateConfig, deleteConfig, configSummary, findConfigForOwner } from '../integrations/service.js';
import { refreshDefinitions, integrationAutomationTemplate } from '../integrations/definitions.js';
import {
  applyPublishFloor,
  previewPublish,
  publishDefinition,
  publishableContentOf,
  scrubPublishText,
  type PublishRefusal,
} from '../integrations/publish-scrub.js';
import { resolveDefinition, listDefinitionsFor, activeCatalogFor } from '../integrations/definition-registry.js';
import {
  actionRequiresConsent,
  approveAction,
  describeAction,
  liveApprovalFor,
  targetResolutionOf,
  revokeActionApprovals,
} from '../integrations/action-consent.js';
import {
  capabilityWireOutcome,
  executeIntegrationCapabilityAction,
  getIntegrationCapability,
  type CapabilityContext,
  type CapabilityRefusal,
} from '../integrations/integration-capability.js';
import {
  achieveIntegrationGoal,
  trustAuthoredAction,
  type AchieveContext,
  type ActionDrafter,
  type PlanDrafter,
} from '../integrations/integration-achieve.js';
import type { AppCollections } from '../integrations/action-compose.js';
import {
  integrationDefinitionStore,
  type DefinitionVisibility,
  type IntegrationDefinitionDoc,
  type SetVisibilityResult,
} from '../integrations/definition-store.js';
import { readLessons, writeLessons } from '../integrations/definition-lessons.js';
// Slice S2: the detail page's evidence read. A sibling module of the capability core rather than a
// member of it - evidence is `auth: 'user'` and must not become reachable by a key through a view
// the capability core already serves.
import { listActionEvidenceFor } from '../integrations/action-evidence-view.js';
// Slice S3: the AUTHOR's three controls over their own notes, and deliberately only those. The
// PROMPT views (`feedbackForPrompt` / `feedbackSectionsForOwner`) are not imported here and must
// not be: this layer serves a person their own byte-exact text, and the scrubbed views exist for
// the model seams alone (`action-feedback.ts`, the raw-vs-scrubbed split).
import { listFeedbackFor, writeFeedbackFor, discardFeedbackFor } from '../integrations/action-feedback.js';
import { integrationRecipeStore } from '../integrations/recipe-store.js';
import { forgetRecipe } from '../integrations/recipe-lifecycle.js';
// Slice S1: the owner's erasure control over their own action evidence. The ONE store method a
// request may reach on that collection, and it is addressed by the verified actor - see the DELETE
// `/:key/actions/:actionName/evidence` handler.
import { actionEvidenceStore } from '../integrations/action-evidence-store.js';
import type { IntegrationActionRecipe } from '../integrations/definitions.js';
import {
  buildMigrationReport,
  provisionIntegrationAutomations,
  sessionActionRows,
  type ProvisionBinding,
} from '../automation/index.js';
import { requestAttendedCeremony } from '../bridge/attended.js';
import { advertisesCapability, getConnectionByOwner } from '../bridge/registry.js';
import { findSessionItemsForOrigin, sessionIsExpired } from '../cofre/sessions.js';
import type { AutomationBackedHandler } from '../integrations/action-executor.js';
import { actorOf, notFound, sendError, parseBody } from './helpers.js';
import { z } from 'zod';

/**
 * Join a definition's automation-bound actions with their template payloads (the provisioner
 * and the session rows both consume this; automation/ never imports integrations/).
 *
 * A2/A3: the DEFINITION is resolved tenant-scoped; the TEMPLATE body still comes off disk
 * (`integrationAutomationTemplate`) because automation templates are package FILES only shipped
 * with BASELINE packages — and since A3 that lookup is baseline-only (the retired runtime tier is
 * never probed on this tenant response path).
 */
async function automationBindings(actor: Actor, key: string): Promise<ProvisionBinding[]> {
  const def = await resolveDefinition(actor, key);
  return (def?.actions ?? [])
    .filter((a) => a.automationBinding?.automationTemplate)
    .map((a) => ({
      actionName: a.actionName,
      description: a.description,
      mutates: a.mutates,
      templateKey: a.automationBinding!.automationTemplate!,
      template: integrationAutomationTemplate(key, a.automationBinding!.automationTemplate!),
    }));
}

/**
 * One stored recipe, projected onto the OWNER's view of it (`IntegrationActionRecipeSummary`).
 *
 * A PROJECTION, not the document. `headerNames`, `bodyTemplate`, `expectShape`, `scriptedSteps` and
 * `capturedCallsRef` are all dropped here: the owner's question is "what did this learn to call, and
 * which call answers", and everything else is either the internals of a request they did not author
 * or a pointer into a collection with its own lifecycle. Written as a whitelist for exactly the
 * reason `publish-scrub` is - a field added to the stored shape later must be OPTED IN to a wire
 * response, never carried onto one by a spread nobody re-read.
 */
function recipeSummary(key: string, actionName: string, recipe: IntegrationActionRecipe) {
  return {
    key,
    actionName,
    version: recipe.version,
    compiledAt: recipe.compiledAt,
    calls: recipe.injectedCalls.map((c) => `${c.method} ${c.urlTemplate}`),
    ...(recipe.answersWith !== undefined ? { answersWithCallIndex: recipe.answersWith.callIndex } : {}),
    lessons: [...recipe.lessons],
    ...(recipe.supersedes !== undefined
      ? { supersedes: { version: recipe.supersedes.version, reason: recipe.supersedes.reason } }
      : {}),
    // K4 - the speed story, opted in field by field (never a spread of `stats`): how often this
    // recipe answered, when it last did, and last-replay vs learned-run wall-clock.
    ...(recipe.stats !== undefined
      ? {
          replayCount: recipe.stats.replayCount,
          ...(recipe.stats.lastReplayedAt !== undefined ? { lastReplayedAt: recipe.stats.lastReplayedAt } : {}),
          ...(recipe.stats.lastReplayMs !== undefined ? { lastReplayMs: recipe.stats.lastReplayMs } : {}),
          ...(recipe.stats.learnedRunMs !== undefined ? { learnedRunMs: recipe.stats.learnedRunMs } : {}),
        }
      : {}),
  };
}

const CreateConfig = z.object({ integrationKey: z.string(), configValues: z.record(z.unknown()), name: z.string().optional() });
const UpdateConfig = z.object({ enabled: z.boolean().optional(), configValues: z.record(z.unknown()).optional() });

/**
 * Map the definition store's write verdict onto the house error envelope — the ONE place both
 * sharing routes below answer from, so the two can never drift apart:
 *   `notfound`  -> 404 NOT_FOUND, byte-for-byte with a genuinely missing id. A row the caller
 *                  cannot READ answers this too: a write must not become an existence oracle for
 *                  a private definition the caller was never allowed to see.
 *   `forbidden` -> 403 FORBIDDEN. The caller can see the row but may not rewrite it (a same-org
 *                  peer of an `org` row), or the write touches the super-admin-only `global` tier.
 *   `ok`        -> the visibility now stored, echoed straight off the persisted document rather
 *                  than off the request, so the response can only ever report the real state.
 */
function sendVisibility(res: Response, result: SetVisibilityResult): void {
  if (result.verdict === 'notfound') return notFound(res);
  if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
  res.json({ ok: true, visibility: result.doc.visibility });
}

/**
 * The REFUSAL half of a `PublishResult`, mapped ONCE for the two routes that publish (S6 review
 * MAJOR-2 folded `/definitions/:id/global`'s promotion into the same path, so there are two).
 *
 * The two doors answer different SUCCESS bodies — `/publish` reports the snapshot's stamp,
 * `/global` reports the tier — so only the refusals are shared. They must be identical: the verdicts
 * come from one gate (`publishPrecheck`/`publishSnapshot` → `visibilityWriteVerdict`), and two
 * hand-written mappings of one gate is how a 404 becomes a 403 on one door and an existence oracle
 * appears on the other.
 *
 * `model_pass_required` is unreachable unless the caller passed `requireModelPass`, and of the two
 * doors ONLY `POST …/publish` ever does - `POST …/global` deliberately never asks, so that a
 * chokepoint outage cannot block the promotion half of a tier toggle whose other half is an
 * un-publish. From the `/global` door this branch is therefore DEAD CODE, and that is DISCLOSED here
 * rather than claimed to be tested: no fixture reaches it through that route, and the only way to
 * make one is to change that route. It is still mapped rather than asserted away, because a default
 * that changes later must not fall through a `!`.
 *
 * THE PARAMETER IS DERIVED FROM `PublishResult`, not re-listed (S6 review round five). Two refusals
 * were added this round, and a hand-written union here would have accepted both silently by widening
 * to `string`. `PublishRefusal` makes the next one a compile error at this line, which is the
 * "a default that changes later must not fall through" rule enforced rather than remembered.
 *
 * NEITHER NEW REFUSAL WIDENS THE `ErrorCode` ENUM, for the reason the publish route already gives:
 * an older client reading the envelope must keep being able to. `key-taken` is `SLUG_TAKEN` (409),
 * which `routes/artifacts.ts` already names as this contract's canonical "identifier already taken"
 * and which `routes/users.ts` already uses for something that is not a slug either. `key-redacted` is
 * `SECRET_GUARD_BLOCKED` (422) - a guard protecting secrets refused the write, the same sentence that
 * code already carries on the config-save, artifact-download and model-pass paths.
 *
 * `key-taken`'s `details` carry the HOLDER's orgId, and that is deliberate but narrow: this refusal
 * is only ever answered to a super-admin (both doors are `requireRole('super-admin')`), which is the
 * same surface the review queue attributes by design. `key-redacted` carries no detail at all - the
 * standing rule that the redaction report names WHERE and HOW MUCH but never WHAT applies with more
 * force to a refusal whose whole subject is the credential.
 */
function sendPublishRefusal(res: Response, out: PublishRefusal): void {
  if (out.verdict === 'notfound') return notFound(res);
  if (out.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
  if (out.verdict === 'key-taken') {
    return sendError(
      res,
      'SLUG_TAKEN',
      'Outra organização já publicou uma integração com esta chave, por isso esta publicação não seria lida por ninguém.',
      { code: 'key_taken', heldBy: out.heldBy },
    );
  }
  if (out.verdict === 'key-redacted') {
    return sendError(
      res,
      'SECRET_GUARD_BLOCKED',
      'A chave da integração parece conter uma credencial. Renomeie a integração antes de publicar.',
      { code: 'key_redacted' },
    );
  }
  return sendError(
    res,
    'SECRET_GUARD_BLOCKED',
    'A revisão automática do conteúdo não pôde ser concluída, por isso a publicação foi recusada. Tente novamente.',
    { code: 'model_pass_required' },
  );
}

/**
 * The SAME verdict mapping as `sendVisibility`, answering the publish-request echo instead - one
 * place for the submit and the withdraw, so the two can never drift.
 *
 * The echo is read off the PERSISTED document: a withdraw answers `null` because the field really is
 * gone from the row, not because the handler knows which route it is on.
 */
function sendPublishRequest(res: Response, result: SetVisibilityResult): void {
  if (result.verdict === 'notfound') return notFound(res);
  if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
  const req = result.doc.publishRequest;
  // A WHITELIST, not a spread, for the same reason `publishQueueEntry` below is one: the shape is
  // read off a stored document, and a document can carry more than its type says it does.
  res.json({
    ok: true,
    publishRequest: req
      ? { requestedBy: req.requestedBy, requestedAt: req.requestedAt, ...(req.note !== undefined ? { note: req.note } : {}) }
      : null,
  });
}

/**
 * ONE row of the review queue, projected onto `IntegrationPublishQueueEntry`.
 *
 * A WHITELIST, and here it is load-bearing rather than tidy: this is the only response in the
 * process that carries another organisation's row to a super-admin who is not a member of it. So
 * `skillMd`, `lessons`, `configSchema`, `credentialGuide` and the action bodies - everything
 * `publish-scrub.ts` exists to clean before it crosses an org boundary - are absent by construction,
 * not by a spread that happened to omit them. The reviewer reads content through
 * `POST …/publish-preview`, which is the scrub.
 *
 * AND THE WHITELIST WAS NOT ENOUGH, which is the correction this function carries. "It carries no
 * content, so it needs no scrub" was the claim, and it was FALSE for the two content-bearing strings
 * that were on the list: `key` and `displayName` are PACKAGE FIELDS - both sit in
 * `packageConfigFromDoc`'s output and are walked by `applyPublishFloor` - so a definition named
 * `CRM sk_live_…` published as `CRM [REDACTED]` while the QUEUE served the reviewer of another org
 * the literal key. The queue was therefore a strictly WIDER read of tenant content than the preview
 * it is supposed to be narrower than: the surface with no bar to earn it had the laxer scrub.
 *
 * SO THE QUEUE RUNS THE SAME FLOOR, and reads its content fields off the floor's OUTPUT rather than
 * off the document. Not a second, narrower rule written here (that is the drift `publish-scrub.ts`'s
 * header refuses) and not a per-field patch either: the next field added to
 * `IntegrationPublishQueueEntry` comes off `floored` and is scrubbed because of where it is read
 * from, not because someone remembered. The floor is pure, synchronous and model-free, the queue is
 * a super-admin-only surface over the handful of rows currently submitted, and the walk it costs is
 * dwarfed by the collection scan `listPublishRequests` already does to find them.
 *
 * WHAT IS DELIBERATELY NOT SCRUBBED IS IDENTITY, not content. `orgId` and `requestedBy` name the
 * asking tenant and the person who asked - which is the queue's entire reason to exist (a reviewer
 * about to hand a package to every organisation must know whose it is), and it is the ONE thing the
 * published artifact deliberately withholds (`publishableAuthoringOf` drops `authoredBy`/`trustedBy`
 * for exactly that reason). The two surfaces differ there ON PURPOSE and in opposite directions:
 * publication is anonymous and permanent, review is attributed and revocable.
 *
 * `actionCount` is the one thing derived from the content: a size signal, never the content, and
 * counted off the PUBLISHABLE action set. WHICH IS THE SAME NUMBER, and the earlier wording implied
 * otherwise (S6 review round five). `publishableActions` is `actionsWithoutRecipes(...).map(...)` -
 * both a `map`, neither a `filter` - so the projection has never dropped an action and `doc.actions`
 * would count identically. No test can tell the two apart, and that is stated here rather than
 * papered over with an assertion that would pass either way. It is still read off `floored`, because
 * the rule this whole function follows is that a field is scrubbed by WHERE it is read from: a later
 * projection that does drop an action gets counted correctly without anyone revisiting this line.
 *
 * `keyHeldBy` is the one field NOT derived from this document at all, and cannot be: it is a fact
 * about the KEY across every tenant. It is passed in, resolved for the whole queue in one query
 * (`globalHoldersForKeys`), because a per-row lookup on an unbounded queue is the scan this slice
 * just finished narrowing.
 */
function publishQueueEntry(doc: IntegrationDefinitionDoc, keyHolder: IntegrationDefinitionDoc | undefined) {
  const req = doc.publishRequest!;
  const floored = applyPublishFloor(publishableContentOf(doc)).content.config;
  return {
    id: doc._id,
    key: floored.integrationKey,
    ...(floored.displayName !== undefined ? { displayName: floored.displayName } : {}),
    orgId: doc.orgId,
    actionCount: (floored.actions ?? []).length,
    republish: doc.publishedSnapshot !== undefined,
    // Compared by `_id`: for one key that is exactly "the holder is some OTHER row", since
    // `definitionIdFor(orgId, key)` makes row identity and org identity the same question here.
    ...(keyHolder && keyHolder._id !== doc._id ? { keyHeldBy: keyHolder.orgId } : {}),
    requestedBy: req.requestedBy,
    requestedAt: req.requestedAt,
    // THE NOTE IS SCRUBBED HERE TOO, and this is not the submit route's scrub repeated. The two
    // enforce DIFFERENT properties: the submit route scrubs so a pasted credential never reaches
    // the DATABASE, and this scrubs so nothing on this row reaches ANOTHER ORG - a boundary that
    // must hold for a note however it got stored, since `requestPublish` takes the string it is
    // given and the store owns no scrub of its own. Each has its own failing test.
    ...(req.note !== undefined ? { note: scrubPublishText(req.note) } : {}),
  };
}

/**
 * The audit/exec context for a capability call: the actor from the VERIFIED principal (never a
 * body field), the username the activity row needs, and — for a key-admitted call — the trace-only
 * key principal. `x-client` arrives already capped by the admission middleware and is carried into
 * the audit row verbatim; nothing below reads it, let alone branches on it (Rule 3).
 */
function capabilityCtxOf(
  req: AuthedRequest,
  res: Response,
  deps: {
    now: () => number;
    genId: () => string;
    runAutomationBackedAction?: AutomationBackedHandler;
    readTenantDataset?: CapabilityContext['readTenantDataset'];
    executorEvidence?: CapabilityContext['executorEvidence'];
    draftAction?: ActionDrafter;
    planStep?: PlanDrafter;
    appCollections?: AppCollections;
    callPlatform?: CapabilityContext['callPlatform'];
    platformConnected?: CapabilityContext['platformConnected'];
    resolveManagedAutomationIds?: CapabilityContext['resolveManagedAutomationIds'];
  },
): AchieveContext {
  const p = res.locals.apiKeyPrincipal as ApiKeyPrincipal | undefined;
  return {
    actor: actorOf(req),
    deps,
    ...(p ? { principal: { keyId: p.keyId, ...(p.xClient ? { xClient: p.xClient } : {}) } } : {}),
    ...(req.user?.username ? { username: req.user.username } : {}),
    ...(deps.runAutomationBackedAction ? { runAutomationBackedAction: deps.runAutomationBackedAction } : {}),
    // Slice S9: the tenant-read seam, threaded beside the automation one so the capability and
    // `achieve` rails run a tenant-read action exactly as the schedule and automation rails do.
    ...(deps.readTenantDataset ? { readTenantDataset: deps.readTenantDataset } : {}),
    // Slice S1: the evidence seams, threaded whole. See `CapabilityContext.executorEvidence` for
    // why they are a bundle rather than two more fields to forget one of.
    ...(deps.executorEvidence ? { executorEvidence: deps.executorEvidence } : {}),
    // D3: the AUTHORING seam, bound once by the composition root exactly like the automation one.
    // Absent, `achieve` still executes and refuses to author (`authoring_unavailable`).
    ...(deps.draftAction ? { draftAction: deps.draftAction } : {}),
    // S4/S5: the PLANNING seam and the CALLER'S OWN collections, bound once by the composition root
    // exactly like the authoring one. Absent, the two upper rungs of the reuse ladder are SKIPPED
    // and `achieve` behaves precisely as it did before they existed.
    ...(deps.planStep ? { planStep: deps.planStep } : {}),
    ...(deps.appCollections ? { appCollections: deps.appCollections } : {}),
    // Bound once by the composition root, same as the two seams above. Its ABSENCE is meaningful:
    // a platform action then falls through to the user-credential rail and is refused there, which
    // is the correct closed answer rather than a silent cross-custody read.
    ...(deps.callPlatform ? { callPlatform: deps.callPlatform } : {}),
    ...(deps.platformConnected ? { platformConnected: deps.platformConnected } : {}),
    // S8 live pass: the caller's org's real automation ids for a bound action. A seam because
    // `integrations/` may not import `automation/`; unbound, the capability reports no automation
    // id, which reads as "not provisioned yet" rather than as a wrong id.
    ...(deps.resolveManagedAutomationIds ? { resolveManagedAutomationIds: deps.resolveManagedAutomationIds } : {}),
  };
}

/**
 * The two capability refusals on the wire.
 *
 * `not_found` is the house 404, byte-identical for "no such integration" and "not visible to you" —
 * the same no-existence-oracle posture the sharing and consent routes already take.
 * `no_tenant` is a 403: the caller authenticated, but their principal names no organisation, and
 * since A2 the org SELECTS which definition resolves — so resolving anything for them would mean
 * resolving an arbitrary tenant's package. Fail closed, and say so rather than answering an
 * ambiguous 404 that reads like a missing integration.
 */
function refuseCapability(res: Response, refusal: CapabilityRefusal): void {
  if (refusal === 'not_found') return notFound(res);
  sendError(res, 'FORBIDDEN', 'A sua conta não pertence a nenhuma organização.');
}

export function integrationsRouter(deps: {
  now: () => number;
  genId: () => string;
  /** The automation seam the composition root binds ONCE and hands to every executor rail. */
  runAutomationBackedAction?: AutomationBackedHandler;
  /** The TENANT-READ seam (slice S9), bound once beside it - see `CapabilityContext`. */
  readTenantDataset?: CapabilityContext['readTenantDataset'];
  /** The EVIDENCE seams (slice S1), bound once beside it. */
  executorEvidence?: CapabilityContext['executorEvidence'];
  /** The AUTHORING seam (D3): one drafting turn on D2's shared authoring core. */
  draftAction?: ActionDrafter;
  /** The PLANNING seam (the reuse ladder's two upper rungs): the same core, a different contract. */
  planStep?: PlanDrafter;
  /** The CALLER'S OWN collections, owner-scoped by the composition root (the compose rung's data). */
  appCollections?: AppCollections;
  /** The PLATFORM seam: google-workspace / microsoft-365 run on org-scoped OAuth custody. */
  callPlatform?: CapabilityContext['callPlatform'];
  /** Its read-side counterpart, so the catalog's `connected` agrees with that rail. */
  platformConnected?: CapabilityContext['platformConnected'];
  /** S8 live pass: the caller's org's REAL automation ids for automation-backed actions. */
  resolveManagedAutomationIds?: CapabilityContext['resolveManagedAutomationIds'];
}): Router {
  const r = Router();

  // ===========================================================================================
  // TIER 1 (part 1) — the PUBLIC CAPABILITY surface: the exact-path route.
  // Registered before any `requireAuth`, so a gateway key reaches it.
  // ===========================================================================================

  // GET /api/v1/integrations -> { items: IntegrationDefinition[] } (auth: USER-OR-KEY since D1).
  // A2: TENANT-SCOPED. The actor's visible stored definitions merged over the shipped baseline —
  // this is the filter that stops one org's authored package being listed to every other org.
  // Wire shape is unchanged (Rule 7): the same `{ items: IntegrationDefinition[] }` the dashboard
  // has always read, from the same call under the same actor. What D1 changed is WHO may ask:
  // this is the capability DISCOVERY endpoint, so an outside client can find its user's
  // integrations before calling `GET /:key` and `POST /:key/actions/:actionName/execute`.
  r.get('/', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    res.json({ items: await listDefinitionsFor(actorOf(req)) });
  });

  // ===========================================================================================
  // TIER 2 (part 1) — dashboard routes whose FIRST SEGMENT IS A LITERAL. They must be registered
  // before the tier-1 `/:key` routes below, or `:key` would swallow `active` / `configs` /
  // `refresh` / `definitions`. Each carries `requireAuth` explicitly (the router-wide blanket
  // starts further down).
  // ===========================================================================================

  // GET /api/v1/integrations/active -> { items: ActiveIntegration[] } (auth: user, 'list-active').
  // The active set = definitions the actor's org has an ENABLED config for; each entry carries
  // the action + webhook/listener event catalogs the trigger picker offers. A2: the catalog is
  // built over the actor's VISIBLE definitions before the enabled-config join.
  r.get('/active', requireAuth, async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const configs = await listConfigs(actor);
    const enabled = new Set(configs.filter((c) => c.enabled).map((c) => c.integrationKey));
    res.json({ items: (await activeCatalogFor(actor)).filter((e) => enabled.has(e.key)) });
  });

  // POST /api/v1/integrations/refresh -> { count, keys } (auth: org-admin, 'refresh-registry').
  // SCOPE (A3): this reloads the SHIPPED BASELINE packages (api/assets/integrations) and nothing
  // else — the disk runtime tier is retired, so the reported {count, keys} is the same shipped set
  // for every caller and can no longer enumerate other tenants' authored keys (A2-residual 1).
  // It does not read, write or invalidate any tenant definition document — those are read per
  // request straight off Mongo and need no refresh.
  r.post('/refresh', requireAuth, requireRole('org-admin', 'super-admin'), (_req: AuthedRequest, res: Response) => {
    res.json(refreshDefinitions());
  });

  // --- Definition SHARING (slice E1) ---------------------------------------------------------
  //
  // Both routes are a thin, validated shell over the ONE gate: `integrationDefinitionStore`'s
  // `setVisibility` (definition-store.ts), which already enforces the owner-or-admin write gate,
  // the no-existence-oracle `notfound`, and "the `global` tier is super-admin only, on promotion
  // AND on demotion". The gate is NOT re-implemented here; nothing below re-derives visibility.
  //
  // A2 CARRY-FORWARD: the acting tenant is `actorOf(req)` — off the verified JWT — and NOTHING
  // else. Neither route reads `orgId` or `userId` from the request body; there is no body field
  // that could name another tenant, and the `:id` is resolved by the store under that actor.

  /**
   * PATCH /api/v1/integrations/definitions/:id/visibility -> { ok, visibility } (auth: user).
   * The TENANT surface: an owner (or their org-admin) shares their own definition with the org, or
   * pulls it back to private. `SetDefinitionVisibilityRequest` is a two-value enum, so a body
   * asking for `global` is a 400 at the schema — the tenant route cannot publish cross-org, and
   * that fact is in the wire contract rather than only in a handler branch. A caller who already
   * owns a `global` row still cannot demote it here: the store answers `forbidden` unless they are
   * a super-admin, which is why the demotion direction is gated too.
   */
  r.patch('/definitions/:id/visibility', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SetDefinitionVisibilityRequest, req.body);
    if (!body) return;
    const result = await integrationDefinitionStore.setVisibility(req.params.id as string, actorOf(req), body.visibility);
    sendVisibility(res, result);
  });

  /**
   * POST /api/v1/integrations/definitions/:id/global -> { ok, visibility } (auth: super-admin).
   *
   * THE UN-PUBLISH DOOR, and — for `{global:true}` — an ALIAS OF THE PUBLISH DOOR. It is no longer a
   * second way across the org boundary, and that change is the subject of S6 review MAJOR-2.
   *
   * WHAT IT WAS. `{global:true}` called `setVisibility(..., 'global')`: the row flipped to the
   * cross-org tier and NO SNAPSHOT WAS WRITTEN. `publishedViewOf` then served every other
   * organisation the AUTHOR'S LIVE ROW through the deterministic read-time floor — which is the
   * exact state `publishSnapshot`'s CAS write exists to make impossible ("a `global` row whose
   * snapshot is missing serves cross-org readers its LIVE content through the read-time floor"), and
   * which costs three properties the publish path has: the chokepoint model pass never runs (the
   * floor is layer one of two, and the second net is the one that catches a credential written as an
   * English sentence); the artifact is not FROZEN, so the author's row keeps editing what every
   * other tenant reads, with no reviewer in the loop after the first click; and nothing records
   * `scrubbedAt`/`scrubbedBy`/`scrubVersion`/`supersedes`, so a published package has no provenance.
   *
   * HOW SLICE S6 MADE IT WORSE — this is the reachability half, and it is why the fix belongs in
   * this slice rather than a later one. Before the submit door was mounted, NOTHING wrote
   * `publishRequest` (`requestPublish` had no caller in `api/src/`), so
   * `isDefinitionVisibleTo`'s review-window branch was dead: a super-admin outside the authoring org
   * could not SEE another tenant's `org` row, and this route answered the uniform 404 for it. The
   * only rows it could reach were its own org's, already-`global` ones, and the legacy sentinel's.
   * Mounting `POST …/publish-request` brings that branch to life — deliberately, for review — and in
   * doing so hands this unscrubbed door its first foreign tenant rows. The tenant asking for a
   * reviewed, scrubbed publication is precisely what made the unreviewed one-line alternative
   * reachable against it.
   *
   * THE DECISION: ONE WAY ACROSS THE BOUNDARY (docs/decisions.md). Not two doors with a documented
   * reason, because the two had IDENTICAL ADMISSION — both land on
   * `visibilityWriteVerdict(row, actor, 'global')`, the same call in the same store — and differed
   * only in whether the scrub ran. A door with the same admission as another and weaker safety is
   * not a second door, it is a bypass of the first, and there is no narrower principal to gate it to.
   * So `{global:true}` now goes through `publishDefinition`, the same function `POST …/publish`
   * calls. It gains no authority it did not have (that gate is literally the same predicate) and
   * loses no availability (`publishDefinition` only refuses on a failed model pass when the caller
   * asks for `requireModelPass`, and this door never does — a chokepoint outage still publishes the
   * floor with the degradation recorded, exactly as before, but now with a snapshot).
   *
   * `{global:false}` IS WHY THE ROUTE STILL EXISTS. Un-publishing has no equivalent on the publish
   * door, and the demotion writes no snapshot because it creates no cross-org reader. Its target is
   * `org`, NOT `private`: `global` is a tier the authoring org's members were already reading, so
   * dropping straight to `private` would additionally revoke the author's own org — a second,
   * unasked-for change. `org` is the narrowest tier that only undoes the cross-org publication; the
   * owner can then go `private` themselves through the tenant route above.
   *
   * IT REMAINS A TIER TOGGLE, WHICH MEANS IT IS IDEMPOTENT (S6 review round four, MINOR-1). The fold
   * above changed WHAT `{global:true}` does, and on an already-`global` row it changed the answer
   * too: `visibilityWriteVerdict` permits `global -> global` on purpose (that is how a published
   * artifact is refreshed at all), so a bare `publishDefinition` here would have made a RETRY - after
   * a timeout, or a reviewer re-asserting a tier they believe is set - a full unreviewed re-scrub of
   * the author's CURRENT live row, replacing the reviewed artifact in every consuming org and
   * stamping `supersedes`, with no preview in the loop. The route's own contract never said that:
   * `{global:boolean}` answers `{ok, visibility}`, and before the fold this call was a no-op. So the
   * door asks for a PROMOTION (`promoteOnly`) and a genuine re-publish is `POST …/publish`, the door
   * whose body IS the snapshot stamp and whose caller has just read a preview. A `global` row with no
   * snapshot is still published here, because repairing that state is what the fold is for.
   */
  r.post('/definitions/:id/global', requireAuth, requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, SetDefinitionGlobalRequest, req.body);
    if (!body) return;
    if (!body.global) {
      const target: DefinitionVisibility = 'org';
      return sendVisibility(res, await integrationDefinitionStore.setVisibility(req.params.id as string, actorOf(req), target));
    }
    const out = await publishDefinition(actorOf(req), req.params.id as string, { promoteOnly: true });
    if (out.verdict !== 'ok' && out.verdict !== 'already-published') return sendPublishRefusal(res, out);
    // The two success verdicts answer IDENTICALLY, and that is the idempotence: this door reports the
    // TIER, and the tier is `global` whether this call promoted the row or found it already there.
    // Echoed off the PERSISTED document, the same rule `sendVisibility` states: the response can
    // only ever report the tier really stored.
    res.json({ ok: true, visibility: out.doc.visibility });
  });

  // --- The PUBLISH DOORS (slice S6) ----------------------------------------------------------
  //
  // Five thin shells over machinery that was built, tested and had NO CALLER: the store's
  // submit/withdraw/queue (`requestPublish`, `withdrawPublishRequest`, `listPublishRequests`) and
  // the scrub module's dry run and write (`previewPublish`, `publishDefinition`). Every gate below
  // is theirs. Nothing here re-derives visibility, admission, the scrub, or the supersede.
  //
  // ORDERING, twice over. (1) Every path here has a LITERAL first segment, so the whole block sits
  // above the `/:key` capability routes or `:key` would swallow `definitions`. (2) Inside the block,
  // `/definitions/publish-requests` is registered BEFORE the `/definitions/:id/...` routes: they do
  // not collide today (two segments vs three), and that is precisely the kind of accident a later
  // `/definitions/:id` read would turn into a queue that answers for an integration named
  // "publish-requests". Literal before parameter, at both levels.
  //
  // ADMISSION: three `user`, two `super-admin` (`requireRole`, defense in depth beside the store's
  // own bar, exactly as `/definitions/:id/global` above). NONE is `user-or-key` - see the descriptor
  // block in `shared/src/integrations.ts` for why each one in turn.

  /**
   * GET /api/v1/integrations/definitions/publish-requests -> { items } (auth: super-admin).
   * The platform REVIEW QUEUE, reachable for the first time. Entries are the whitelist projection
   * (`publishQueueEntry`); the store answers `[]` for any non-super-admin, and the role gate above
   * it means a non-super-admin never even gets an empty queue to infer from.
   */
  r.get('/definitions/publish-requests', requireAuth, requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const rows = await integrationDefinitionStore.listPublishRequests(actorOf(req));
    // ONE extra query for the whole page, not one per row - the queue is unbounded, so a per-row
    // holder lookup would put back the N-query scan `listPublishRequests` was just narrowed to avoid.
    const holders = await integrationDefinitionStore.globalHoldersForKeys(rows.map((row) => row.key));
    res.json({ items: rows.map((row) => publishQueueEntry(row, holders.get(row.key))) });
  });

  /**
   * POST /api/v1/integrations/definitions/:id/publish-request -> { ok, publishRequest } (auth: user).
   *
   * SUBMIT FOR REVIEW. The store requires the row to already be `org` and the actor to be able to
   * write it; presence of the stamp is what opens the E2 review window (`isDefinitionVisibleTo`), so
   * this is the ONLY thing that puts a tenant row in front of a non-member platform reviewer - and
   * it is opened from inside the tenant. Re-submitting re-stamps (the note can be corrected).
   *
   * THE NOTE GETS THE PUBLISH FLOOR, not the egress scrub, and the difference is not cosmetic. It
   * is free text a person typed that LEAVES THE TENANT - read by a super-admin who is not a member
   * of their org - so it belongs to the same class as the artifact it argues for, and it is scrubbed
   * by the same `scrubPublishText`: the read-path scrub plus the strict credential-line rule plus
   * the BLANKET literal-secret scan. `scrubSecretText` alone is the narrower egress rule and leaves
   * a pasted vendor key sitting in prose (measured, not assumed - the security suite planted one and
   * watched it survive).
   *
   * The scrub cannot go in the store: `definition-store.ts` holds no runtime dependency on the
   * modules that own it (its own header, and the reason `withoutRecipes` is restated there rather
   * than imported). It cannot rely on the schema either - `.max()` bounds the length, not the
   * content. So the one place that mints a publish request scrubs, and
   * `tests/security/publish-doors-isolation.test.ts` reads the PERSISTED row back to prove it.
   *
   * THE LENGTH CAP IS NOT HERE, and moving it out is the point. A cap applied at one of several
   * callers bounds that caller, not the field; `requestPublish` is the ONE place the note is
   * written, so that is where it is bounded (see the store). Capping here as well would additionally
   * have made the cap UNFAILABLE through the wire, because the schema already refuses anything
   * longer than the cap at this route - so the only strings that can exceed it are the ones this
   * scrub GREW (a short literal beside a placeholder becomes the longer `[REDACTED]`), and those
   * are exactly what the store now bounds on their way to storage.
   */
  r.post('/definitions/:id/publish-request', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, RequestDefinitionPublishRequest, req.body ?? {});
    if (!body) return;
    const note = body.note === undefined ? undefined : scrubPublishText(body.note);
    const result = await integrationDefinitionStore.requestPublish(req.params.id as string, actorOf(req), note);
    sendPublishRequest(res, result);
  });

  /**
   * DELETE /api/v1/integrations/definitions/:id/publish-request -> { ok, publishRequest: null }.
   *
   * WITHDRAW, closing the review window again (auth: user). The store refuses while the row is
   * `global`, and since S6 review round five that refusal has nothing left to protect: publishing
   * CONSUMES the request, so a published row carries no stamp to withdraw. It stays a refusal so the
   * door gives one answer for a published row however it got there. It also refuses a super-admin
   * who is not a member of the authoring org: a platform reviewer must not be able to delete the
   * org's own record that it ever asked.
   */
  r.delete('/definitions/:id/publish-request', requireAuth, async (req: AuthedRequest, res: Response) => {
    const result = await integrationDefinitionStore.withdrawPublishRequest(req.params.id as string, actorOf(req));
    sendPublishRequest(res, result);
  });

  /**
   * POST /api/v1/integrations/definitions/:id/publish-preview -> PublishPreviewResponse (auth: user).
   *
   * THE DRY RUN: exactly what a foreign org would read if this were published now, from the SAME
   * `scrubForPublish` the write uses. A POST although it stores nothing - it spends a chokepoint
   * call, and an endpoint a prefetch may replay for free must not be one that bills the caller.
   *
   * ADMISSION IS THE MODULE'S (`getWritableForActor`): the author, their org-admin, or a super-admin
   * who can see the row - which for a non-member reviewer means "while the submission stands". The
   * preview reveals strictly LESS than the raw row every one of those principals can already read,
   * which is the whole argument for it not needing the publish's bar.
   */
  r.post('/definitions/:id/publish-preview', requireAuth, async (req: AuthedRequest, res: Response) => {
    const out = await previewPublish(actorOf(req), req.params.id as string);
    if (out.verdict === 'notfound') return notFound(res);
    if (out.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json({
      ok: true,
      snapshot: {
        config: out.snapshot.config,
        skillMd: out.snapshot.skillMd,
        ...(out.snapshot.lessons !== undefined ? { lessons: out.snapshot.lessons } : {}),
      },
      redactions: out.redactions,
      modelPass: out.modelPass,
      ...(out.supersedes !== undefined ? { supersedes: out.supersedes } : {}),
      // Without this the dry run keeps promising "exactly what a foreign org would read" for a row
      // no foreign org will read at all, and the publish that follows answers 409 with nothing
      // having warned the caller. A bare flag - the holder's identity is the reviewer's, on the
      // queue; this response is read by authors.
      ...(out.keyHeldByAnotherOrg ? { keyHeldByAnotherOrg: true } : {}),
    });
  });

  /**
   * POST /api/v1/integrations/definitions/:id/publish -> PublishDefinitionResponse (auth: super-admin).
   *
   * THE PUBLISH: scrub into a frozen snapshot and move to `global`, in ONE gated store write, so a
   * published row and its scrubbed artifact can never disagree. The gate is
   * `publishSnapshot` -> `visibilityWriteVerdict` - the same bar `/definitions/:id/global` meets, in
   * both directions - and this handler adds no authority of its own. Since S6 review MAJOR-2 that
   * sameness is literal rather than parallel: `/definitions/:id/global` `{global:true}` calls
   * `publishDefinition` too, so there is ONE way a definition crosses an org boundary and it always
   * writes a snapshot. This door is the one that can also demand the model pass.
   *
   * SUPERSEDE IS THE NORMAL CASE - WITHIN ONE ORG'S ROW. One snapshot field per definition means a
   * re-publish of THAT ROW replaces it wholesale and stamps the replaced one's provenance into
   * `supersedes`, total rather than a version chain readers would have to choose between. A consuming
   * org that extended the package is untouched: self-extension forked it a row of its own.
   *
   * ACROSS ORGS THERE IS NO REPLACEMENT AT ALL, and this comment used to imply otherwise (S6 review
   * round five). `getForActor` resolves ONE `global` row per key, so a second org's publication of a
   * key someone else holds is not a supersede - it is a write nobody can read. The brief's "promoting
   * a user-built integration may replace the existing public one" reads most naturally as that
   * cross-org case, which is exactly the one this paragraph did not cover. It is now REFUSED
   * (`key-taken`), and un-publishing a key takes its shadowed siblings down with it, so no demotion
   * can hand a key to a different tenant without a review.
   *
   * `model_pass_required` is `SECRET_GUARD_BLOCKED` (422) and not a new code: a guard protecting
   * secrets refused the write, which is exactly what that code already names on the config-save and
   * artifact-download paths, and widening the shared `ErrorCode` enum breaks every older client's
   * reading of the envelope (`shared/src/errors.ts`).
   *
   * ITS `details` CARRY A MACHINE CODE AND NOTHING ELSE. `PublishResult.model_pass_required` carries
   * a `reason` that is the chokepoint's own thrown message - a transport status, a credential-store
   * error, whatever `completeFast` raised - and putting server prose on the wire is the exact defect
   * the 2026-08-16 "derive user-facing errors from a code, never server prose" change closed
   * elsewhere. The operator diagnoses from the logs; the client gets the code.
   */
  r.post('/definitions/:id/publish', requireAuth, requireRole('super-admin'), async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, PublishDefinitionRequest, req.body ?? {});
    if (!body) return;
    const out = await publishDefinition(
      actorOf(req),
      req.params.id as string,
      body.requireModelPass === true ? { requireModelPass: true } : {},
    );
    // `already-published` CANNOT arrive here: it is the answer to `promoteOnly`, and this door never
    // asks for it, because SUPERSEDING IS THIS DOOR'S JOB (see above). Mapped to `INTERNAL` rather
    // than cast away, and `INTERNAL` rather than a plausible-looking 403: it would mean the server
    // reached a state this handler does not model, which is not something to dress up as a refusal
    // the caller could act on. Same discipline as `sendPublishRefusal`'s `model_pass_required` arm -
    // a default that changes later must not fall through into `publishedSnapshot!`.
    if (out.verdict === 'already-published') return sendError(res, 'INTERNAL', 'Erro interno.');
    if (out.verdict !== 'ok') return sendPublishRefusal(res, out);
    const snapshot = out.doc.publishedSnapshot!;
    res.json({
      ok: true,
      visibility: out.doc.visibility,
      scrubbedAt: snapshot.scrubbedAt,
      redactionCount: snapshot.redactionCount,
      modelPass: out.modelPass,
      ...(snapshot.supersedes !== undefined ? { supersedes: snapshot.supersedes } : {}),
    });
  });

  // --- Configs CRUD (literal first segment — must precede the `/:key` routes) -----------------

  r.get('/configs', requireAuth, async (req: AuthedRequest, res: Response) => {
    res.json({ items: (await listConfigs(actorOf(req))).map(configSummary) });
  });

  r.post('/configs', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, CreateConfig, req.body);
    if (!body) return;
    // `secretKeys` comes from the definition's own schema and decides which values may be stored
    // in the non-secret projection the consent path reads (service.ts `publicValuesOf`). Resolved
    // HERE because `service.ts` cannot import the registry - `definitions.ts` imports `service.ts`,
    // so that edge would close an import cycle (docs/findings.md).
    const actorForCreate = actorOf(req);
    const createDef = await resolveDefinition(actorForCreate, body.integrationKey);
    // UPSERT, not insert: the dashboard's save button posts here every time, so an unconditional
    // insert made every re-save a duplicate row for the same integration, and duplicates resolve
    // nondeterministically (`findConfigForOwner`). A re-save updates the row it would have
    // created, merging into the stored bundle. 201 on a genuine connect, 200 on a re-save.
    const result = await upsertConfig(
      actorForCreate,
      {
        ...(body as { integrationKey: string; configValues: Record<string, unknown>; name?: string }),
        secretKeys: (createDef?.configSchema ?? []).filter((f) => f?.secret).map((f) => f.key),
      },
      deps,
    );
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'undecryptable') {
      return sendError(res, 'SECRET_GUARD_BLOCKED', 'As credenciais guardadas não puderam ser lidas, por isso a gravação foi recusada para não as destruir. Volte a introduzir todas as credenciais desta integração.');
    }
    res.status(result.created ? 201 : 200).json(configSummary(result.config!));
  });

  r.patch('/configs/:integrationKey', requireAuth, async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, UpdateConfig, req.body);
    if (!body) return;
    const a = actorOf(req);
    const target = (await listConfigs(a)).find((c) => c.integrationKey === req.params.integrationKey);
    if (!target) return notFound(res);
    const patchDef = await resolveDefinition(a, req.params.integrationKey as string);
    const result = await updateConfig(a, target._id, {
      ...(body as { enabled?: boolean; configValues?: Record<string, unknown> }),
      secretKeys: (patchDef?.configSchema ?? []).filter((f) => f?.secret).map((f) => f.key),
    });
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    // The stored bundle could not be decrypted, so it could not be merged into. Refusing is the
    // point: writing the patch alone would silently wipe every credential it omits. Recovery is
    // to re-enter them all (the client then sends a complete bundle, which merges to itself).
    // `SECRET_GUARD_BLOCKED` (422) rather than a new code: a guard protecting stored secrets
    // refused the write, which is exactly what this code already names on the artifact-download
    // path, and the shared ErrorCode enum is a client contract - adding a member makes every
    // older client read the body as "not the shared error envelope" (clients/cortex-cli).
    if (result.verdict === 'undecryptable') {
      return sendError(res, 'SECRET_GUARD_BLOCKED', 'As credenciais guardadas não puderam ser lidas, por isso a gravação foi recusada para não as destruir. Volte a introduzir todas as credenciais desta integração.');
    }
    res.json(configSummary(result.config!));
  });

  // --- Learned replay recipes: the READ half (slice P2) ---------------------------------------
  //
  // Literal first segment, so it MUST precede the `/:key` routes below or `:key` swallows it - the
  // same positional rule the configs block above states. `requireAuth` explicitly, because it sits
  // above the router-wide blanket: this is `auth: 'user'`, never key-reachable (see the descriptor
  // for why).

  /**
   * GET /api/v1/integrations/recipes -> { items: IntegrationActionRecipeSummary[] }.
   *
   * Every action of this tenant that has LEARNED to replay itself, so its owner can see what the
   * machine decided on their behalf and recognise one that learned the wrong thing. Tenant-wide
   * rather than per-integration: an owner looking for a bad recipe is precisely someone who cannot
   * name it yet.
   *
   * Scoped twice by the store: resolved inside the actor's own org, then re-filtered by the
   * definition read predicate, so a same-org peer's PRIVATE definition never appears here.
   */
  r.get('/recipes', requireAuth, async (req: AuthedRequest, res: Response) => {
    const rows = await integrationRecipeStore.listRecipesForActor(actorOf(req));
    res.json({ items: rows.map(({ key, actionName, recipe }) => recipeSummary(key, actionName, recipe)) });
  });

  /**
   * GET /api/v1/integrations/automation-migration-report -> AutomationMigrationReportResponse
   * (auth: user). Slice S7, decision D3.
   *
   * WHAT WOULD BECOME OF THIS CALLER'S AUTOMATIONS if the automation surface were replaced by
   * integration actions, and what it would cost them. REPORT-ONLY, and not as a mode: the module
   * behind it has no write path, so there is no flag that could turn this into a migration.
   *
   * ANOTHER LITERAL PATH THAT MUST OUTRANK `:key` - registered here with `/active`, `/configs`,
   * `/definitions/...` and `/recipes`, above the `:key` block that starts on the next screen.
   *
   * TENANCY IS THE AUTOMATION SERVICE'S OWN, PASSED IN AND NOT RE-DERIVED: the scan is filtered by
   * the verified actor's `orgId` and then by the same `private` predicate `listAutomations` applies,
   * so this endpoint cannot report a row the caller could not already open. Both arguments come off
   * `actorOf(req)` and never off the request body.
   */
  r.get('/automation-migration-report', requireAuth, async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    res.json(await buildMigrationReport({ orgId: actor.orgId, readerUserId: actor.userId }));
  });

  // ===========================================================================================
  // TIER 1 (part 2) — the PUBLIC CAPABILITY surface's `:key` routes (slice D1).
  //
  // Registered HERE: after every dashboard route whose first segment is a literal (so `:key`
  // cannot swallow `active`/`configs`/`refresh`/`definitions`), and before the router-wide
  // `requireAuth` blanket below (so a gateway key reaches them). Both carry
  // `requireUserOrApiKey` explicitly rather than relying on position.
  //
  // Behaviour lives in `integrations/integration-capability.ts`; these two handlers validate,
  // call it once, and shape the answer.
  // ===========================================================================================

  /**
   * GET /api/v1/integrations/:key -> IntegrationCapability (auth: user-or-key).
   *
   * The definition as the list already projects it (one projection, never a second one that could
   * drift), plus per-action execution metadata: how it runs, where it writes, whether it needs a
   * human approval and whether one already stands for this caller. Resolved through A2's
   * tenant-scoped registry under the verified actor, so an integration the caller may not see is a
   * 404 byte-identical with one that does not exist.
   */
  r.get('/:key', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const out = await getIntegrationCapability(capabilityCtxOf(req, res, deps), params.data.key);
    if (!out.ok) return refuseCapability(res, out.refusal);
    res.json(out.value);
  });

  /**
   * POST /api/v1/integrations/:key/actions/:actionName/execute -> ExecuteIntegrationActionResponse.
   *
   * THE WRITE GATE IS INHERITED, NOT RE-IMPLEMENTED HERE. The call goes to
   * `executeUserIntegrationAction` (through the capability module) and meets C2's
   * `checkActionConsent` inside it, before any credential is loaded. An unapproved `mutates` action
   * therefore answers 403 with `details.code = 'awaiting_consent'` and the descriptor a human must
   * be shown — and the endpoint that BANKS that answer, `POST …/approval`, is `auth: 'user'` and
   * sits below the blanket, so the gateway key that was just refused cannot approve itself.
   *
   * The request body carries `args` and nothing else: no field names an org, a user or an owner,
   * and zod strips unknown keys, so a body inventing one is inert (Rule 5).
   */
  r.post('/:key/actions/:actionName/execute', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, ExecuteIntegrationActionRequest, req.body ?? {});
    if (!body) return;
    const out = await executeIntegrationCapabilityAction(
      capabilityCtxOf(req, res, deps),
      params.data.key,
      params.data.actionName,
      body.args ?? {},
    );
    if (!out.ok) return refuseCapability(res, out.refusal);
    const wire = capabilityWireOutcome(out.value);
    if (wire.kind === 'not_found') return notFound(res);
    if (wire.kind === 'awaiting_consent') {
      return sendError(
        res,
        'FORBIDDEN',
        'Esta ação altera dados e precisa da autorização do titular antes de correr.',
        { code: 'awaiting_consent', consentRequest: wire.consentRequest },
      );
    }
    res.json(wire.body);
  });

  /**
   * POST /api/v1/integrations/:key/achieve -> AchieveIntegrationGoalResponse (slice D3).
   *
   * EXECUTE-OR-AUTHOR. The handler is a shell: validate, call `achieveIntegrationGoal` once, map
   * the outcome. Every guardrail lives in the module, so none of them can be re-decided per route.
   *
   * THE WRITE GATE IS THE SAME ONE, ON THE SAME WIRE. The execute arm returns an executor result,
   * and an unapproved `mutates` action comes back with `code: 'awaiting_consent'` — which this
   * handler answers with the IDENTICAL 403 envelope `/execute` above answers, through the same
   * `capabilityWireOutcome` mapping. A client therefore handles the gate in ONE place rather than
   * learning a second dialect for this endpoint, and there is no path here that could answer 200
   * for a write nobody approved.
   *
   * A REFUSAL IS A 200 CARRYING `outcome: 'refused'`, not an error envelope, and that is deliberate:
   * "no action fits and I could not write one because the host is not bound" is an ANSWER about the
   * caller's integration, exactly like a remote 4xx is an answer about the remote system (the same
   * argument `/execute` makes for returning failed results at 200). The two cases that are NOT
   * answers stay envelopes: unaddressable is a 404, and no-tenant is a 403.
   */
  r.post('/:key/achieve', requireUserOrApiKey, async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, AchieveIntegrationGoalRequest, req.body ?? {});
    if (!body) return;
    const out = await achieveIntegrationGoal(
      capabilityCtxOf(req, res, deps),
      params.data.key,
      body.goal,
      body.args ?? {},
    );
    if (!out.ok) return refuseCapability(res, out.refusal);
    const result = out.value;
    // ONE PROJECTION FOR BOTH ARMS THAT RAN THE ACTION. `composed` used to fall through to the bare
    // `res.json(result)` below, which is how it reached the wire with no `result` at all - the
    // action's own envelope (its upstream status, and every field beside the list inside `data`)
    // destroyed by a stage that only ever meant to ADD a narrowing. Sharing `capabilityWireOutcome`
    // rather than writing a second projection here is what keeps the two arms from drifting into
    // two different renderings of the one executor result.
    if (result.outcome === 'executed' || result.outcome === 'composed') {
      const wire = capabilityWireOutcome(result.result);
      if (wire.kind === 'not_found') return notFound(res);
      if (wire.kind === 'awaiting_consent') {
        return sendError(
          res,
          'FORBIDDEN',
          'Esta ação altera dados e precisa da autorização do titular antes de correr.',
          {
            code: 'awaiting_consent',
            consentRequest: wire.consentRequest,
            // THE ONE MOMENT A HUMAN IS IN THE LOOP ON A WRITE, and until now they were asked to
            // approve a call they could not see the making of. The gate refuses BEFORE the request
            // goes out, so this refusal - never the 200 - is where "which rung produced this call"
            // and "what did a model fill into it" have to be readable. `filledArgs` is the same
            // field, the same names and the same meaning the 200 carries, so a client keeps ONE
            // vocabulary across the two answers; `filledArgValues` is the part only this answer
            // needs, because nobody can authorise "a model chose a titulo" without being shown the
            // titulo. The keys of the second are the first by construction, and both are absent
            // when no argument was model-filled.
            ...(result.ladder ? { ladder: result.ladder } : {}),
            ...(result.filledArgs ? { filledArgs: result.filledArgs } : {}),
            ...(result.outcome === 'executed' && result.filledValues ? { filledArgValues: result.filledValues } : {}),
          },
        );
      }
      if (result.outcome === 'composed') {
        return res.json({
          outcome: 'composed',
          actionName: result.actionName,
          result: wire.body,
          items: result.items,
          composition: result.composition,
          ...(result.ladder ? { ladder: result.ladder } : {}),
          ...(result.filledArgs ? { filledArgs: result.filledArgs } : {}),
        });
      }
      return res.json({
        outcome: 'executed',
        actionName: result.actionName,
        result: wire.body,
        // The ladder travels on the executed arm too: "it just ran the action" and "it filled two
        // arguments and then ran the action" are different events, and only one of them is worth
        // a person's attention.
        ...(result.ladder ? { ladder: result.ladder } : {}),
        // NAMES ONLY, unchanged. The model's VALUES ride the consent refusal (where a person must
        // read them before authorising) and the `capability_achieve_parametrize` audit row (where an
        // auditor must, afterwards); this answer does not become a second copy of them.
        ...(result.filledArgs ? { filledArgs: result.filledArgs } : {}),
      });
    }
    res.json(result);
  });

  // ===========================================================================================
  // TIER 2 (part 2) — everything below is PLATFORM-SESSION ONLY. The blanket is the SAFE DEFAULT
  // for any route appended later: a new handler added past this line inherits `requireAuth`
  // whether or not its author thought about admission. Nothing below may become `user-or-key`
  // without moving above it AND declaring the class in `shared/src/integrations.ts`.
  // ===========================================================================================
  r.use(requireAuth);

  // --- The WRITE GATE (slice C2) --------------------------------------------------------------
  //
  // Three routes over `integrations/action-consent.ts`. None of them is the gate: the gate is in
  // `executeUserIntegrationAction`, so it catches every rail (capability route, automation step,
  // listener tick, agent tool) rather than only the ones that happen to pass through a router.
  // These are the surface a human answers it on.
  //
  // ALL THREE ARE `auth: 'user'` AND STAY THAT WAY (C2, reaffirmed by D1). D1 put an execute
  // endpoint on the key-reachable surface; if approving were key-reachable too, an agent refused at
  // the gate could POST the very shape it was just handed and retry. A gate that grants its own
  // exemption is not a gate.
  //
  // TENANCY: the acting (org, user) is `actorOf(req)` — off the verified JWT — and the integration
  // is resolved UNDER THAT ACTOR, so an action the caller cannot see is a 404, byte-identical with
  // a key that does not exist. No body field names an org, a user or another tenant's action.

  /**
   * GET /api/v1/integrations/:key/action-approvals -> { items: IntegrationActionApproval[] }.
   * Every action of the integration with its rendered target, its shape and the live approval.
   * Non-mutating actions are listed too, flagged `requiresConsent: false`: the dashboard has to be
   * able to show that a read needs no permission, and an empty row would read as "not yet asked".
   */
  r.get('/:key/action-approvals', async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const key = req.params.key as string;
    const def = await resolveDefinition(actor, key);
    if (!def) return notFound(res);
    // The SAME resolution the gate uses, so the target shown here is the target an approval is
    // keyed on. Non-secret values only, off the un-decrypted row.
    const cfg = await findConfigForOwner(actor.orgId, actor.userId, key);
    const resolution = targetResolutionOf(def.configSchema, cfg?.publicConfigValues);
    const items = [];
    for (const action of def.actions ?? []) {
      const descriptor = describeAction(key, action, resolution);
      const requiresConsent = actionRequiresConsent(action);
      // A read is never looked up: it has no approval to have, and querying for one would invent a
      // row shape for actions that are not gated.
      const live = requiresConsent
        ? await liveApprovalFor({ orgId: actor.orgId, userId: actor.userId }, key, action.actionName, descriptor.shape, descriptor.target)
        : null;
      items.push({
        actionName: descriptor.actionName,
        description: descriptor.description,
        target: descriptor.target,
        shape: descriptor.shape,
        requiresConsent,
        decision: live?.decision ?? null,
        expiresAt: live?.expiresAt ?? null,
      });
    }
    res.json({ items });
  });

  /**
   * POST /api/v1/integrations/:key/actions/:actionName/approval -> { ok, decision, expiresAt }.
   *
   * The two refusals that matter:
   *  - a NON-MUTATING action cannot be approved. Banking permission for something that needs none
   *    would leave a row that outlives a later flip of `mutates` to true — an approval for a write
   *    the human never saw. Rule 7's "a `mutates:false` action must not gain a prompt" runs in this
   *    direction too.
   *  - a SHAPE MISMATCH is refused. The body echoes the shape the user was shown; if the action was
   *    re-authored between render and click, the answer is about a different action.
   *
   * Both answer `VALIDATION_FAILED` (400) rather than a conflict status: the shared error
   * vocabulary (`shared/src/errors.ts`) has no generic `CONFLICT`, and widening it is a
   * contract-wide change that does not belong to this slice. Both refusals genuinely are about the
   * request body — it named a decision for an ungated action, or a shape that is not this action's
   * — so the code is not a lie, and the messages say precisely which.
   */
  r.post('/:key/actions/:actionName/approval', async (req: AuthedRequest, res: Response) => {
    const body = parseBody(res, ApproveIntegrationActionRequest, req.body);
    if (!body) return;
    const actor = actorOf(req);
    const key = req.params.key as string;
    const def = await resolveDefinition(actor, key);
    const action = def?.actions?.find((a) => a.actionName === req.params.actionName);
    if (!action) return notFound(res);
    if (!actionRequiresConsent(action)) {
      return sendError(res, 'VALIDATION_FAILED', 'Esta ação não altera dados e não precisa de autorização.');
    }
    const cfg = await findConfigForOwner(actor.orgId, actor.userId, key);
    const descriptor = describeAction(key, action, targetResolutionOf(def?.configSchema, cfg?.publicConfigValues));
    if (descriptor.shape !== body.shape) {
      return sendError(res, 'VALIDATION_FAILED', 'A ação mudou desde que foi apresentada. Reveja e confirme de novo.');
    }
    const { expiresAt } = await approveAction({ orgId: actor.orgId, userId: actor.userId }, descriptor, body.decision);
    res.json({ ok: true, decision: body.decision, expiresAt });
  });

  /**
   * DELETE /api/v1/integrations/:key/actions/:actionName/approval -> { ok, revoked }.
   * Revoking does NOT require the action to still exist in a resolvable definition — a user must be
   * able to withdraw permission from an action that was just deleted or re-authored, which is
   * exactly when they most want to. The delete is scoped to their own (org, user) rows regardless.
   */
  r.delete('/:key/actions/:actionName/approval', async (req: AuthedRequest, res: Response) => {
    const actor = actorOf(req);
    const revoked = await revokeActionApprovals(
      { orgId: actor.orgId, userId: actor.userId },
      req.params.key as string,
      req.params.actionName as string,
    );
    res.json({ ok: true, revoked });
  });

  /**
   * DELETE /api/v1/integrations/:key/actions/:actionName/recipe -> { ok, version?, evidenceDiscarded }.
   *
   * THE OWNER'S VETO over what the machine learned. Below the `requireAuth` blanket like the three
   * consent routes above it, and for the same reason: a recipe is learned FOR a user, and the
   * decision to throw one away is the human's.
   *
   * IDEMPOTENT: an action with no recipe answers `ok` with no `version`. The caller asked for a
   * state, not for a row, and that state holds - the same reading `revokeActionApproval` above has.
   * A 404 would additionally be an existence oracle over whether an action has ever been discovered.
   *
   * TENANCY is the store's: `clearRecipe` derives the row id from the actor's own org (so no other
   * tenant's row is reachable at all) and is handed the actor, so a same-org peer's PRIVATE
   * definition answers exactly as a missing one does - re-asserted inside the CAS, not only before
   * it. The EVIDENCE pairing is `forgetRecipe`'s, shared with the run loop's refusal path so the two
   * removal paths cannot drift apart.
   */
  r.delete('/:key/actions/:actionName/recipe', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const actor = actorOf(req);
    const { dropped, evidenceDiscarded } = await forgetRecipe({
      orgId: actor.orgId,
      integrationKey: params.data.key,
      actionName: params.data.actionName,
      visibleTo: actor,
    });
    res.json({
      ok: true,
      ...(dropped?.version !== undefined ? { version: dropped.version } : {}),
      evidenceDiscarded,
    });
  });

  /**
   * POST /api/v1/integrations/:key/actions/:actionName/trust -> { ok, actionName, state, mutates }.
   *
   * PROMOTE an action `achieve` authored, from provisional to trusted (slice D3). It sits BELOW the
   * `requireAuth` blanket on purpose, and that position is the point: `achieve` is `user-or-key`,
   * so if a gateway key could reach this route an agent would author an action and bless its own
   * work in the next request. Same rule, same place in this file, as the three consent routes above.
   *
   * The gates are `trustAuthoredAction`'s, not this handler's. The five verdicts that are not `ok`
   * map to the house envelope the way the rest of this domain does — a row the caller cannot see
   * and a row that does not exist answer the same 404, and the three body-shaped refusals answer
   * `VALIDATION_FAILED` with a message that says which, exactly as `approveAction` does for its own
   * shape mismatch (`shared/src/errors.ts` has no generic CONFLICT, and widening it is a
   * contract-wide change that does not belong to this slice).
   */
  r.post('/:key/actions/:actionName/trust', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, TrustAuthoredActionRequest, req.body);
    if (!body) return;
    const out = await trustAuthoredAction(actorOf(req), params.data.key, params.data.actionName, body.shape);
    switch (out.verdict) {
      case 'notfound': return notFound(res);
      case 'forbidden': return sendError(res, 'FORBIDDEN', 'Sem permissão.');
      case 'shape_mismatch':
        return sendError(res, 'VALIDATION_FAILED', 'A ação mudou desde que foi apresentada. Reveja e confirme de novo.');
      case 'not_authored':
        return sendError(res, 'VALIDATION_FAILED', 'Esta ação foi escrita por uma pessoa e não precisa de ser confirmada.');
      case 'unverified':
        return sendError(res, 'VALIDATION_FAILED', 'Esta ação mudou desde que foi verificada — peça de novo o objetivo para a reescrever.');
      // Slice S1: the action checks out and has simply never run. Its own message, not
      // `unverified`'s - telling someone to re-author an action whose only problem is that nobody
      // has tried it yet sends them to fix the one thing that is not broken.
      case 'unvalidated':
        return sendError(res, 'VALIDATION_FAILED', 'Esta ação ainda não foi executada com sucesso. Execute-a uma vez e confirme depois - a confirmação passa a assentar nessa execução.');
      default:
        return res.json({ ok: true, actionName: out.actionName, state: out.state, mutates: out.mutates });
    }
  });

  /**
   * DELETE /api/v1/integrations/:key/actions/:actionName/evidence -> { ok, discarded }.
   *
   * THE OWNER'S ERASURE CONTROL over the sample their own last validated run left behind (slice S1,
   * round four). Below the `requireAuth` blanket with the consent and recipe routes, and for the
   * same reason they are: the row holds this person's real third-party request and response, and the
   * decision to keep or destroy it is theirs rather than an agent's.
   *
   * IT IS WHY `discardEvidence` EXISTS AS A PUBLIC METHOD AT ALL. Every other removal on that
   * collection is a consequence of something else - a later run supersedes it, the credential is
   * disconnected, the retention window closes. None of those is "I do not want this kept", which is
   * the one a person actually asks for, and until this route there was no way to ask it.
   *
   * "THE ACTION STOPS RESOLVING" IS NOT ON THAT LIST, AND USED TO BE. Round five deleted every
   * collector that answered "is this action gone?", because a synchronous answer taken at one
   * instant from one vantage cannot govern a row whose lifetime is durable - the removal rule in
   * `action-evidence-store.ts`. An action that stops resolving now ends its row by ageing out of the
   * retention window like any other, which is also why this control matters more than it did.
   *
   * TENANCY IS NOT A FILTER THIS HANDLER APPLIES. The key is built from the VERIFIED actor and
   * hashed into the deterministic `_id`, so the request cannot name a colleague's row or another
   * tenant's; `discardEvidence` then re-checks the stored org and owner on the fetched document
   * before deleting it. IDEMPOTENT: nothing to erase answers `ok` with `discarded: false` — see the
   * descriptor for why that is not a 404.
   */
  r.delete('/:key/actions/:actionName/evidence', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const actor = actorOf(req);
    const discarded = await actionEvidenceStore.discardEvidence({
      orgId: actor.orgId,
      ownerUserId: actor.userId,
      integrationKey: params.data.key,
      actionName: params.data.actionName,
    });
    res.json({ ok: true, discarded });
  });

  // --- Per-integration LESSONS (slice C3) -----------------------------------------------------
  //
  // Two thin routes over `integrations/definition-lessons.ts`. NOTHING about the raw-vs-scrubbed
  // split, the admission set, the ceiling or the CAS is decided here — this layer validates, calls
  // once, and maps the verdict onto the envelope. Both sit BELOW the `requireAuth` blanket: they
  // are `auth: 'user'` and a gateway key never reaches them (the descriptors say why).

  r.get('/:key/lessons', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const result = await readLessons(actorOf(req), params.data.key);
    if (result.verdict === 'notfound') return notFound(res);
    res.json(result.view);
  });

  r.patch('/:key/lessons', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, SetIntegrationLessonsRequest, req.body);
    if (!body) return;
    const result = await writeLessons(actorOf(req), params.data.key, body.lessons, {
      ...(body.expectedUpdatedAt !== undefined ? { expectedUpdatedAt: body.expectedUpdatedAt } : {}),
    });
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') {
      return sendError(res, 'FORBIDDEN', 'Não tem permissão para editar as lições desta integração.');
    }
    if (result.verdict === 'too_long') {
      // Belt-and-braces: the shared schema already refuses this length, so reaching here means the
      // two disagreed. Same 400 either way — the body genuinely is invalid.
      return sendError(res, 'VALIDATION_FAILED', 'As lições excedem o limite de caracteres.', {
        code: 'lessons_too_long', limit: result.limit, length: result.length,
      });
    }
    if (result.verdict === 'stale') {
      // 400 and not a conflict status, for the reason `approveAction` states one screen up: the
      // shared error vocabulary has no generic CONFLICT and widening it does not belong to this
      // slice. The refusal genuinely IS about the body — it named a revision that is no longer
      // current — and `details.current` carries what IS stored, so the editor can show both
      // versions instead of guessing.
      return sendError(res, 'VALIDATION_FAILED', 'Estas lições foram alteradas entretanto. Reveja a versão guardada.', {
        code: 'stale_revision', current: result.view,
      });
    }
    res.json(result.view);
  });

  /**
   * GET /api/v1/integrations/:key/evidence -> { items: IntegrationActionEvidence[] } (auth: user).
   *
   * WHAT EACH ACTION DID THE LAST TIME IT WORKED - the read the integration detail page's steps
   * view renders (slice S2, over the collection slice S1 records into).
   *
   * BELOW THE `requireAuth` BLANKET, and that position IS the admission: a gateway key never
   * reaches this. An evidence row is one tenant's real request and real response body, so a key
   * that could read it could pull the tenant's actual portal data out over an API while gaining no
   * capability it lacks - `executeAction` runs the action either way. The descriptor states the
   * reasoning; this route inherits it by sitting here rather than restating it.
   *
   * NOTHING IS DECIDED HERE. `listActionEvidenceFor` reads with the verified actor's OWN org and
   * user id (the collection is keyed per owner, so the answer is the caller's own samples and never
   * a colleague's), resolves the definition under that same actor (so an integration they cannot
   * see answers the house 404, byte-identical with one that does not exist), and keeps only rows
   * whose action is on that definition (so a row that outlived the package naming its action stops
   * rendering a sample the caller can no longer see, run or name). This handler validates the
   * segment, calls once, and shapes the answer.
   */
  r.get('/:key/evidence', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const out = await listActionEvidenceFor(actorOf(req), params.data.key);
    if (!out.ok) return refuseCapability(res, out.refusal);
    res.json({ items: out.value });
  });

  /* --- PER-USER ACTION FEEDBACK (slice S3) ---------------------------------------------------
   *
   * Three thin routes over `integrations/action-feedback.ts`. NOTHING about the raw-vs-scrubbed
   * split, the ceiling, the definition predicate or the deterministic id is decided here - this
   * layer validates the segment, calls once, and maps the verdict onto the envelope.
   *
   * ALL THREE SIT BELOW THE `requireAuth` BLANKET, and that position IS the admission: a gateway key
   * never reaches them. For the READ and the DELETE that is the reading `listActionEvidence` and
   * `discardActionEvidence` take. For the WRITE it is decision D2 and a Rule 8 argument of its own -
   * this text lands in future prompts, so a key-bearing agent that could POST here would be writing
   * its own next instructions. Agents read these notes; only a person writes one. The descriptors
   * carry the full reasoning; these routes inherit it by sitting here rather than restating it.
   */

  /**
   * GET /api/v1/integrations/:key/feedback -> { items: IntegrationActionFeedback[] } (auth: user).
   *
   * The caller's OWN notes, byte-exact, for the detail page's editors. Never a colleague's: the
   * collection is keyed per user and the read passes the verified actor's own org and user id, so
   * there is no shape of request that names somebody else.
   */
  r.get('/:key/feedback', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationKeyParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const out = await listFeedbackFor(actorOf(req), params.data.key);
    if (!out.ok) return refuseCapability(res, out.refusal);
    res.json({ items: out.value });
  });

  /**
   * PUT /api/v1/integrations/:key/actions/:actionName/feedback -> IntegrationActionFeedback.
   *
   * IDEMPOTENT AT ITS OWN ADDRESS: `(orgId, userId, key, actionName, stepRef?)` hashes to one
   * deterministic `_id`, so writing twice leaves one row and a retried write cannot fork a second
   * note. The over-length body is refused at the SCHEMA (`ACTION_FEEDBACK_MAX_CHARS`), which is why
   * the store's own ceiling is never reached from here - it is there for the callers that are not
   * this route.
   */
  r.put('/:key/actions/:actionName/feedback', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const body = parseBody(res, SetIntegrationActionFeedbackRequest, req.body);
    if (!body) return;
    const out = await writeFeedbackFor(actorOf(req), params.data.key, params.data.actionName, {
      note: body.note,
      ...(body.stepRef !== undefined ? { stepRef: body.stepRef } : {}),
    });
    if (!out.ok) {
      // The ceiling is a 400 naming the limit, never the house 404: the caller CAN see this
      // integration and this action, they simply hold too many notes here, and telling them so is
      // the only answer they can act on.
      if (out.refusal === 'too_many') {
        return sendError(res, 'VALIDATION_FAILED', 'Já tem demasiadas notas nesta ação. Remova uma antes de escrever outra.', {
          code: 'too_many_notes', limit: out.limit,
        });
      }
      // Otherwise the house 404 for BOTH "no such integration for you" and "no such action on it",
      // byte-identical, so this route cannot be walked to learn which actions a package carries.
      return refuseCapability(res, out.refusal);
    }
    res.json(out.value);
  });

  /**
   * DELETE /api/v1/integrations/:key/actions/:actionName/feedback?stepRef= -> { ok, discarded }.
   *
   * The author's erasure control over their own note. IDEMPOTENT: nothing to erase answers `ok`
   * with `discarded: false` rather than a 404 - the caller asked for a STATE and it holds either
   * way, and a 404 would be an existence oracle over whether they had ever written one.
   *
   * `stepRef` rides the QUERY because a DELETE carries no body. Absent removes the ACTION-level
   * note and never a step's: the two are different rows, and a delete that swept every step's note
   * because the caller omitted one field would be an erasure nobody asked for.
   */
  r.delete('/:key/actions/:actionName/feedback', async (req: AuthedRequest, res: Response) => {
    const params = IntegrationActionParams.safeParse(req.params);
    if (!params.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: params.error.issues });
    const query = DiscardActionFeedbackQuery.safeParse(req.query);
    if (!query.success) return sendError(res, 'VALIDATION_FAILED', 'Parâmetros inválidos.', { issues: query.error.issues });
    const out = await discardFeedbackFor(
      actorOf(req),
      params.data.key,
      params.data.actionName,
      query.data.stepRef,
    );
    if (!out.ok) return refuseCapability(res, out.refusal);
    res.json({ ok: true, discarded: out.value });
  });


/**
 * The session a run would actually get for this portal, or null.
 *
 * Newest-first and skipping the unusable: an expired item and one marked unhealthy are both still
 * ROWS, so a naive "does any session exist" read reports `captured` for a session that would fail
 * at checkout — which is the same class of lie the hardcoded stub told, just later and harder to
 * spot. Metadata only ever leaves here; the blob stays sealed.
 */
async function newestUsableSession(
  actor: Parameters<typeof findSessionItemsForOrigin>[0],
  origin: string,
): Promise<{ createdAt?: string; expiresAt?: string } | null> {
  const items = await findSessionItemsForOrigin(actor, origin).catch(() => []);
  const usable = items
    .filter((item) => !sessionIsExpired(item))
    .filter((item) => (item.sessionMetadata?.healthy ?? true) !== false)
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const newest = usable[0];
  return newest ? { createdAt: newest.createdAt, expiresAt: newest.expiresAt } : null;
}

  // --- Config removal + session/provision (the remaining `:key` dashboard routes) -------------

  r.delete('/:key', async (req: AuthedRequest, res: Response) => {
    const result = await deleteConfig(actorOf(req), req.params.key as string);
    if (result.verdict === 'notfound') return notFound(res);
    if (result.verdict === 'forbidden') return sendError(res, 'FORBIDDEN', 'Sem permissão.');
    res.json({ ok: true });
  });

  /**
   * Session capture (Cofre WS-G/WS-I) — the ATTENDED ceremony, over the bridge.
   *
   * These two answered a hardcoded "não disponível nesta versão" while every piece behind them was
   * built and tested: `requestAttendedCeremony` opens a ceremony on a machine, the bridge's
   * `session.push` handler (bridge/server.ts) already accepted the result, and
   * `captureSessionToCofre` sealed it. Nothing in `api/src` called the first one, so the rail was
   * complete and unreachable and the honest stub was the only truthful thing left to say.
   *
   * WHY IT RUNS ON A MACHINE AND NOT HERE. The credentials this exists for cannot travel: an OA
   * certificate in the lawyer's keystore, a Cartão de Cidadão in a reader. And even where they
   * could, the session is bound to the vantage point it was made from — replaying a
   * residentially-established session from a datacenter is the pattern portals flag
   * (cofre/session-checkout.ts). So the browser opens where the human and the credential already
   * are, and only the sealed result comes back.
   *
   * SECRET HYGIENE (shared/src/integrations.ts SessionSnapshot): the captured storageState is
   * encrypted straight into a Cofre item and is NEVER serialized to a client. Both responses carry
   * STATUS METADATA ONLY — that rule survives this change unaltered.
   */
  r.get('/:key/session', async (req: AuthedRequest, res: Response) => {
    const key = req.params.key as string;
    const actor = actorOf(req);
    const definition = await resolveDefinition(actor, key);
    if (!definition) return notFound(res);

    const connect = definition.sessionConnect;
    const machine = connect ? getConnectionByOwner(actor.userId, actor.orgId) : undefined;
    // `supported` is a property of the PACKAGE; `available` is a property of this MOMENT. Collapsing
    // them would tell a user with no machine online that the feature does not exist.
    const supported = !!connect?.loginUrl && definition.authType === 'browser_session';
    const captured = connect?.loginUrl ? await newestUsableSession(actor, connect.loginUrl) : null;

    // A LIVE SOCKET IS NOT A CAPABLE MACHINE. `available` used to mean only "some daemon of this
    // user's is connected", which was a promise the connected daemon might have no way to keep: the
    // bridge's vendored wire contract did not carry `attended.request` at all, so the frame failed
    // its union and was dropped by the transport with no log line and no error path. The user was
    // told "Pronto", the POST answered `started: true`, and the ceremony could only expire.
    // Advertisement (I-1) is what distinguishes the two, so ask for it here.
    const capable = !!machine && (await advertisesCapability(machine.pairingId, 'attended.card_login'));

    res.json({
      integrationKey: key,
      status: captured ? 'captured' : 'none',
      sessionConnect: {
        supported,
        available: supported && capable,
        ...(connect?.loginUrl ? { loginUrl: connect.loginUrl } : {}),
        ...(connect?.guidePt ? { guide: connect.guidePt } : {}),
        message: !supported
          ? 'Esta integração não usa captura de sessão.'
          : capable
            ? 'Pronto: a sessão é capturada na sua máquina.'
            : machine
              ? 'A Ponte Ekoa ligada é demasiado antiga para capturar sessões. Atualize-a nessa máquina e volte a ligá-la.'
              : 'Nenhuma máquina ligada. Abra a Ponte Ekoa na máquina onde tem o certificado ou o leitor de cartões.',
      },
      session: captured
        ? { status: 'captured', capturedAt: captured.createdAt ?? null, expiresAt: captured.expiresAt ?? null }
        : { status: 'none', capturedAt: null },
      actions: await sessionActionRows(actor, key, await automationBindings(actor, key)),
    });
  });

  r.post('/:key/session', async (req: AuthedRequest, res: Response) => {
    const key = req.params.key as string;
    const actor = actorOf(req);
    const definition = await resolveDefinition(actor, key);
    if (!definition) return notFound(res);

    const connect = definition.sessionConnect;
    if (!connect?.loginUrl || definition.authType !== 'browser_session') {
      return res.json({
        started: false,
        session: { status: 'failed', message: 'Esta integração não usa captura de sessão.' },
      });
    }

    // THE MACHINE IS RESOLVED FROM THE ACTOR, never taken from the request. A caller-supplied
    // pairingId would let one user open a login prompt on another user's screen and bank the
    // resulting session against their own org — the ceremony's whole value is that the session
    // which comes back is the one we asked for, from the person we asked.
    const machine = getConnectionByOwner(actor.userId, actor.orgId);
    if (!machine) {
      return res.json({
        started: false,
        session: {
          status: 'failed',
          message: 'Nenhuma máquina ligada. Abra a Ponte Ekoa na máquina onde tem o certificado ou o leitor de cartões.',
        },
      });
    }

    // The same advertisement check the GET makes, repeated rather than inferred from it: the two are
    // separate requests and a daemon can reconnect between them, but more importantly this is the
    // call that PROMISES something. `sendToPairing` returns true for any live socket, so without
    // this the endpoint answered `started: true` — "a browser is opening on your machine" — for a
    // daemon whose wire contract could not parse the frame it had just been sent.
    if (!(await advertisesCapability(machine.pairingId, 'attended.card_login'))) {
      return res.json({
        started: false,
        session: {
          status: 'failed',
          message: 'A Ponte Ekoa ligada é demasiado antiga para capturar sessões. Atualize-a nessa máquina e volte a ligá-la.',
        },
      });
    }

    try {
      await requestAttendedCeremony(actor, {
        pairingId: machine.pairingId,
        // The kinds this rail models are both "a human is standing at the machine"; a card in a
        // reader and a certificate in a keystore are the same ceremony from here.
        kind: 'card_login',
        origin: connect.loginUrl,
        reason: `Autenticação para ${definition.displayName ?? key}`,
        label: `${key} session`,
      });
    } catch (error) {
      // Offline is a REFUSAL, never a queued promise (bridge/attended.ts): a ceremony needs a human
      // there now, so "we will ask when it comes back" would ask when nobody is standing there.
      return res.json({
        started: false,
        session: { status: 'failed', message: error instanceof Error ? error.message : 'A cerimónia não pôde ser iniciada.' },
      });
    }

    // No requestId on the wire: the client learns the outcome by polling GET, which reports the
    // stored item. A ceremony handle would be a second thing to correlate and nothing needs it.
    res.json({
      started: true,
      session: { status: 'waiting_login', message: connect.guidePt ?? 'Conclua a autenticação na máquina ligada.' },
    });
  });

  r.post('/:key/provision-automations', async (req: AuthedRequest, res: Response) => {
    const key = req.params.key as string;
    const actor = actorOf(req);
    // A2: a key the actor cannot see is a 404, byte-for-byte with a key that does not exist.
    if (!(await resolveDefinition(actor, key))) return notFound(res);
    // Materialize the definition's bound automation templates as org automations (idempotent:
    // deterministic ids; re-provision refreshes from the template).
    const { created, updated, rows } = await provisionIntegrationAutomations(actor, key, await automationBindings(actor, key));
    res.json({ provisioned: rows.some((row) => row.provisioned), created, updated, actions: rows });
  });

  return r;
}
