/**
 * Tenant-scoped integration DEFINITION store (slice A1 — the storage foundation).
 *
 * Today integration package definitions live on disk (integrations/definitions.ts, two synchronous
 * file tiers). This module is the ADDITIVE, private-by-default database home a later slice (A2) will
 * rewire that file-based registry onto. A1 only ADDS this store + doc shape + the actor-scoped
 * resolver + its isolation suite; it removes and rewires NOTHING, and it is wired into no route or
 * `server.ts` yet.
 *
 * TENANCY MODEL. This is the house `OwnerVisibilityScoped` pattern (data/scoped.ts) extended with a
 * third, cross-org tier:
 *   - `private` — visible only to the authoring user (`userId`) inside its org. Invisible to a
 *     same-org peer AND to the org-admin, exactly as `OwnerVisibilityScoped` states for the one
 *     other resource carrying `visibility: 'private' | 'org'` ("private row of another user —
 *     invisible even to the org admin"), with no super-admin exception on the READ path.
 *   - `org` — visible to every member of the authoring org; confined to that org.
 *   - `global` — visible to every org (the shared/baseline tier A2 folds the shipped packages into).
 *
 * UNIQUENESS. One definition per (orgId, key). Enforced STRUCTURALLY, not with a unique index (the
 * data layer has none — store.ts §4.3.2): the `_id` is a deterministic hash of (orgId, key), so the
 * duplicate-key refusal from `Store.insert` IS the uniqueness primitive. A second org may hold the
 * same `key` because its `_id` differs; a second row for the same (org, key) is refused (or replaced
 * on the explicit opt-in). This mirrors the gateway-keys / run-idempotency deterministic-`_id`
 * discipline already in this repo.
 *
 * The resolver predicates (`isDefinitionVisibleTo`, `canWriteDefinition`) and the id derivation
 * (`definitionIdFor`) are pure and exported so they are unit-testable in isolation and so A2 can
 * reuse the exact same gate rather than re-deriving it.
 *
 * The package/action/config field TYPES are imported type-only from `./definitions.ts` — the ONE
 * canonical shape — never duplicated. The type-only import carries no runtime dependency on the
 * file-based registry (it is erased at compile time), so this store stands entirely on the database.
 */
import { createHash } from 'node:crypto';
import type { Actor } from '@ekoa/shared';
import { Store, type Doc } from '../data/store.js';
import { integrationDefinitions } from '../data/stores.js';
import type {
  IntegrationConfigField,
  IntegrationAction,
  IntegrationPackageConfig,
  IntegrationSessionConnectConfig,
  IntegrationWebhookConfig,
  IntegrationListenerConfig,
} from './definitions.js';

/** The three-tier visibility of a stored definition (private-by-default, org-shared, cross-org). */
export type DefinitionVisibility = 'private' | 'org' | 'global';

/**
 * Sentinel tenant that owns rows imported from the legacy disk runtime tier (slice A3,
 * `legacy-runtime-import.ts`). Reserved: no real org/user id has this shape (real ids are
 * generated), so no actor INHABITS the org — which means an imported row demoted from `global`
 * to `org` is visible to nobody under the plain tenancy gate. That is the point of retiring it,
 * but it must never be a trapdoor: the A3 fresh-context review proved a retired row became
 * unreadable and unwritable by EVERYONE (super-admins included), so retirement was a silent
 * PERMANENT break — the exact thing the import decision promised it would never be. The
 * visibility predicate below therefore grants a SUPER-ADMIN (and only a super-admin) read reach
 * over sentinel-org rows at any visibility, making retire (`global` → `org`) and restore
 * (`org` → `global`) exactly reversible through the one E1 review surface. Ordinary tenants
 * never see a retired sentinel row. The constants live HERE (not in the importer) because the
 * predicate is the one place the exception is enforced; the importer imports them.
 */
export const LEGACY_RUNTIME_ORG = '__legacy_runtime__';
export const LEGACY_RUNTIME_USER = '__legacy_runtime__';

/** How a definition came to exist (provenance for A2's fork/legacy-migration flows). */
export interface IntegrationDefinitionOrigin {
  kind: 'authored' | 'forked' | 'legacy-runtime' | 'baseline-override';
  /** The `_id` of the definition this one was forked/derived from (may be another org's). */
  sourceDefinitionId?: string;
  /** The org that owned the source (recorded for a cross-org fork). */
  sourceOrgId?: string;
  forkedAt?: string;
  /** `legacy-runtime` rows only (A3): content hash of the imported disk package at import time —
   *  the Rule-10 comparator's baseline. A later boot whose disk hash differs reports DRIFT and
   *  never overwrites the row (Mongo wins; it may have been edited/republished). */
  importHash?: string;
  importedAt?: string;
}

/**
 * How the ONE chokepoint model pass went for a given publish (slice E2). Recorded ON the snapshot,
 * durably, because "was this artifact inspected by the second net, or only by the deterministic
 * floor?" is a property of the published artifact, not of the request that produced it. `skipped`
 * (a caller asked for floor-only) is deliberately distinct from `failed` (the model was reachable
 * or not, and did not answer) — collapsing them would hide an outage behind a policy choice.
 */
export interface PublishModelPassRecord {
  status: 'applied' | 'skipped' | 'failed';
  reason?: string;
  spansApplied?: number;
}

/**
 * A scrubbed, FROZEN snapshot of a definition — what every OTHER organisation reads once the row is
 * published (`publish-scrub.ts`; RUN_SPEC 20260801 criterion 8).
 *
 * WHERE IT LIVES AND HOW RE-PUBLISH SUPERSEDES: here, on the definition document, in ONE field.
 * That is the whole supersede protocol — a definition has exactly one live snapshot, a re-publish
 * REPLACES it wholesale (never merges, never appends a version chain that readers would have to
 * choose between), and the replaced snapshot's stamp is recorded in `supersedes` so the lineage of
 * a published artifact is visible without keeping the superseded bytes around. A separate
 * snapshots collection was rejected for the same reason A1 rejected a separate actions collection:
 * the snapshot has no lifecycle independent of its definition (it is written, superseded and
 * deleted with it), and a second document is a second thing that can be missing.
 */
export interface IntegrationDefinitionPublishedSnapshot {
  scrubbedAt: string;
  scrubbedBy: string;
  /** The floor's ruleset version (`PUBLISH_SCRUB_VERSION`) this artifact was scrubbed under. */
  scrubVersion: number;
  /** The scrubbed package config at publish time (the ONE canonical package shape). */
  config: IntegrationPackageConfig;
  skillMd: string;
  lessons?: string;
  modelPass: PublishModelPassRecord;
  /** How many redactions the scrub made — the audit counterpart of the preview's report. */
  redactionCount: number;
  /** The stamp of the snapshot this one replaced, when this is a re-publish. */
  supersedes?: { scrubbedAt: string; scrubbedBy: string };
}

/**
 * The domain fields of an integration definition, WITHOUT the storage envelope. Kept as its own
 * interface so both the stored document and the create input derive from one source of truth (and so
 * the create type stays strongly typed — an `Omit` over `Doc`'s index signature would collapse it).
 */
export interface IntegrationDefinitionFields {
  /** Owning tenant. The isolation boundary — always stamped server-side, never from a caller body. */
  orgId: string;
  /** Authoring user within `orgId`. A `private` definition is visible only to this user. */
  userId: string;
  visibility: DefinitionVisibility;
  /** The integration key (`crm`, `weather`, …); unique per org (see the module header). */
  key: string;
  displayName?: string;
  description?: string;
  version?: string;
  authType?: string;
  provider?: string;
  category?: string;
  /** The config-field schema — the ONE canonical `IntegrationConfigField[]` shape. */
  configSchema: IntegrationConfigField[];
  /** The action set — the existing `IntegrationAction` superset, never a new type. */
  actions: IntegrationAction[];
  credentialGuide?: string;
  /** The integration's SKILL.md knowledge body (was a sibling file on disk). */
  skillMd: string;
  /** Accumulated authoring lessons (free text), if any. */
  lessons?: string;
  /**
   * The three remaining package-level blocks of the ONE canonical `IntegrationPackageConfig`
   * (A2, additive + optional so no A1 row needs migrating). They are carried on the document
   * because the merged read registry (`definition-registry.ts`) projects a stored row onto the
   * SAME `IntegrationDefinition` shape the rest of the code consumes: without them a tenant row
   * that shadows a shipped package would silently lose its webhook verification config and its
   * listener poll contract, and the events/listener rails would read a package that cannot poll.
   */
  sessionConnect?: IntegrationSessionConnectConfig;
  webhookConfig?: IntegrationWebhookConfig;
  listenerConfig?: IntegrationListenerConfig;
  origin?: IntegrationDefinitionOrigin;
  publishedSnapshot?: IntegrationDefinitionPublishedSnapshot;
  /**
   * THE AUTHOR-INITIATED SUBMIT-FOR-REVIEW STATE (slice E2, closing the E1 review's F2, deferred
   * here as a product decision). Cross-org publication is a super-admin act, but the A1 read gate
   * correctly denies a super-admin who is not a member of the org any sight of that org's rows —
   * which left the review gate INERT for platform staff who are not org members. E1's reviewer
   * named the fix precisely: an author-initiated submit state, NOT a super-admin read exception.
   * Presence of this field is that submission, and it is the ONLY thing that puts a tenant row in
   * front of a non-member platform reviewer (`isDefinitionVisibleTo`).
   */
  publishRequest?: { requestedBy: string; requestedAt: string; note?: string };
}
// NOTE (A3, A2-residual 6): the A1 doc carried a `declaredOrigins: string[]` field that NOTHING
// ever read — the one egress truth is the definition's action `httpConfig.baseUrl`s, derived at
// use by the ONE origin-resolver seam (server.ts setIntegrationOriginResolver). A stored
// allow-list nothing enforces is a lie waiting to be trusted, so the field is REMOVED rather than
// wired up; slice B2 re-points the resolver at Cofre per-item `boundOrigins` (docs/decisions.md
// 2026-08-02). Existing rows carrying the property are harmless (untyped extra data, never read).

/**
 * A stored integration definition: the domain fields plus the store envelope (`_id`, `_rev`) and
 * the create/update timestamps. `_id` is derived from (orgId, key) — see `definitionIdFor`.
 */
export interface IntegrationDefinitionDoc extends Doc, IntegrationDefinitionFields {
  createdAt: string;
  updatedAt: string;
}

/** The input to `create`: the domain fields, with the timestamps optional (defaulted server-side). */
export type IntegrationDefinitionCreate = IntegrationDefinitionFields & {
  createdAt?: string;
  updatedAt?: string;
};

/** The outcome of a gated write, mirroring `OwnerVisibilityScoped.writeGuard`'s verdict shape:
 *  a hidden row and a missing one both answer `notfound` (no existence oracle). */
export type SetVisibilityResult =
  | { verdict: 'ok'; doc: IntegrationDefinitionDoc }
  | { verdict: 'notfound' }
  | { verdict: 'forbidden' };

/** The outcome of a lessons write (slice C3): the visibility/write verdicts plus `stale`, the
 *  optimistic-concurrency refusal (the row moved since the caller read it). */
export type SetLessonsResult =
  | { verdict: 'ok'; doc: IntegrationDefinitionDoc }
  | { verdict: 'notfound' }
  | { verdict: 'forbidden' }
  | { verdict: 'stale'; doc: IntegrationDefinitionDoc };

/** A typed store error the caller (A2/route layer) maps onto the error envelope. */
export type IntegrationDefinitionStoreErrorCode = 'DUPLICATE' | 'FORBIDDEN' | 'INVALID';
export class IntegrationDefinitionStoreError extends Error {
  constructor(public readonly code: IntegrationDefinitionStoreErrorCode, message: string) {
    super(message);
    this.name = 'IntegrationDefinitionStoreError';
  }
}

/**
 * The deterministic `_id` for a definition. Keyed on (orgId, key) so that:
 *   - a duplicate (org, key) insert is refused by `Store.insert` — the uniqueness primitive;
 *   - two different orgs never collide on the same key;
 *   - the id is STABLE across a visibility change (it depends on org + key only).
 * JSON-encoded (not separator-joined) so the encoding is injective for any org/key strings, exactly
 * as `runDedupeId` (automation/service.ts) argues for its own composite id.
 */
export function definitionIdFor(orgId: string, key: string): string {
  return createHash('sha256').update(JSON.stringify([orgId, key])).digest('hex');
}

/**
 * The action set with every compiled recipe removed - what a CALLER is allowed to write.
 *
 * The same rule as `actionsWithoutRecipes` (definitions.ts), RESTATED here rather than imported:
 * this module's whole standing claim is that it holds no RUNTIME dependency on the file-based
 * registry (see the module header), and `definitions.ts` sits inside the integrations import cycle
 * that publish-scrub.ts documents. A four-line restatement is the cheaper of the two prices.
 */
function withoutRecipes(actions: IntegrationAction[]): IntegrationAction[] {
  return (actions ?? []).map((action) => {
    if (action.recipe === undefined) return action;
    const { recipe: _dropped, ...rest } = action;
    return rest;
  });
}

/** Re-attach each stored recipe to the incoming action of the same name (see `create`'s replace
 *  branch). `incoming` has already been through `withoutRecipes`, so this is the ONLY way a recipe
 *  can be on a document this seam writes. */
function carryRecipesForward(
  incoming: IntegrationAction[],
  existing: IntegrationAction[] | undefined,
): IntegrationAction[] {
  if (!existing || existing.length === 0) return incoming;
  const stored = new Map(existing.filter((a) => a.recipe !== undefined).map((a) => [a.actionName, a.recipe]));
  if (stored.size === 0) return incoming;
  return incoming.map((action) => {
    const recipe = stored.get(action.actionName);
    return recipe === undefined ? action : { ...action, recipe };
  });
}

type VisibilityView = Pick<IntegrationDefinitionFields, 'orgId' | 'userId' | 'visibility'> &
  Partial<Pick<IntegrationDefinitionFields, 'publishRequest'>>;

/**
 * Can `actor` SEE this definition? The single read predicate, shared by `getForActor` and
 * `listForActor` so the two can never drift (the pattern `OwnerVisibilityScoped.listVisible` and
 * automation `listAutomations` both follow). `global` is cross-org; otherwise the row is confined to
 * its org, where the owner sees it at any visibility and everyone else sees it only when it is `org`.
 */
export function isDefinitionVisibleTo(doc: VisibilityView, actor: Actor): boolean {
  if (doc.visibility === 'global') return true; // cross-org tier
  // SENTINEL-ORG ROWS STAY SUPER-ADMIN-ADDRESSABLE IN EVERY STATE (A3 review F1). A legacy row
  // retired to `org` sits in an org no actor inhabits; without this branch NOBODY could read or
  // write it again (setVisibility answers notfound for a row the actor cannot see), so "retire"
  // was an irreversible break recoverable only by DB surgery. This is deliberately NOT a general
  // super-admin read exception — the A1 tenancy model keeps tenant private rows invisible to
  // every role — it is scoped to the one platform-owned org that, by construction, holds no
  // tenant's data (its rows were the world-readable pre-A3 disk tier).
  if (actor.role === 'super-admin' && doc.orgId === LEGACY_RUNTIME_ORG) return true;
  // THE SUBMIT-FOR-REVIEW WINDOW (E2, closing E1 review F2). A super-admin who is not a member of
  // the authoring org sees an `org`-shared row ONLY while that org is asking to publish it. The
  // authority runs from the AUTHOR outward — nothing here lets platform staff browse a tenant's
  // packages, a `private` row is never in scope (submission requires `org`, and this branch
  // re-checks the tier rather than trusting the write path), and withdrawing the request closes the
  // window again. The alternative E1's reviewer rejected — relaxing the 404 for super-admins — would
  // have made every tenant's private authoring visible to the platform by default.
  if (actor.role === 'super-admin' && doc.visibility === 'org' && doc.publishRequest !== undefined) return true;
  // The SAME empty-string hazard as the userId branch below, one field over: an org-less actor
  // (a broken row, or a seam that defaulted `orgId` to '') must not become "same org" as an
  // org-less document. Both sides must name a real tenant before they can be equal.
  if (doc.orgId === '' || actor.orgId === '') return false;
  if (doc.orgId !== actor.orgId) return false; // NEVER another org's private/org row
  // OWN-ROW BRANCH, with the empty-userId hole closed (A2 review F3). Several server-side readers
  // are built as org-scoped SYSTEM actors carrying `userId: ''` (platform-call, the poll rail), and
  // their whole safety argument is "an empty userId can never equal a real author's". That argument
  // is only as good as the data: a row stamped `userId: ''` (the obvious shape for an ownerless
  // migrated package) would be matched as the system actor's OWN row and hand it a private
  // definition. Require BOTH sides non-empty so the identity can never be the empty string.
  if (doc.userId !== '' && actor.userId !== '' && doc.userId === actor.userId) return true;
  return doc.visibility === 'org'; // org-shared peer row; a peer's PRIVATE row → invisible
}

/**
 * Can `actor` WRITE this definition (e.g. change its visibility)? The `canWriteAutomation` shape:
 * never what the actor cannot even see; a super-admin always; otherwise the owner or an org-admin
 * within the same org. A foreign org-admin cannot rewrite a global row authored elsewhere.
 */
export function canWriteDefinition(doc: VisibilityView, actor: Actor): boolean {
  if (!isDefinitionVisibleTo(doc, actor)) return false;
  if (actor.role === 'super-admin') return true;
  if (doc.orgId !== actor.orgId) return false;
  return doc.userId === actor.userId || actor.role === 'org-admin';
}

/**
 * The actor-scoped definition store. Wraps the `integrationDefinitions` collection; every tenant-safe
 * read goes through `getForActor` / `listForActor`. `getById` is the RAW primitive (unscoped by
 * design, the analogue of `OrgScoped.getAnyOrg`) that A2 uses to follow `origin.sourceDefinitionId`
 * across orgs — callers must scope its result themselves.
 *
 * The collection is registered in data/stores.ts as the untyped `Store<Doc>` house currency (like
 * `integrationConfigs`); the constructor takes it and applies the typed view here — the single cast
 * boundary, exactly as `automation/service.ts` treats its own `automations` `Store<Doc>`.
 */
export class IntegrationDefinitionStore {
  private readonly store: Store<IntegrationDefinitionDoc>;

  constructor(
    store: Store<Doc> = integrationDefinitions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store as unknown as Store<IntegrationDefinitionDoc>;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  /**
   * Create a definition. Enforces one row per (orgId, key) via the deterministic `_id` insert:
   *   - `onConflict: 'reject'` (default) → throws `IntegrationDefinitionStoreError('DUPLICATE')`;
   *   - `onConflict: 'replace'`          → overwrites the existing row, preserving its `createdAt`
   *     — gated on `canWriteDefinition` against the EXISTING row, and the row's `visibility` must
   *     be carried through unchanged (`setVisibility` is the one visibility chokepoint).
   *
   * THE ACTOR IS MANDATORY (A3, A2-residual 5). The old optional-actor escape hatch meant every
   * gate below was one forgotten argument away from off: an actor-less create could mint a
   * `global` row, or a row in any org. Now every write names who is writing, and a non-super-admin
   * may only create inside their OWN org — role `user` only as THEMSELVES, an `org-admin` may
   * also preserve a same-org peer's authorship on a replace (mirroring `canWriteDefinition`).
   * Platform-level migration (the boot legacy import) carries an explicit super-admin actor and
   * is journaled, not an ambient bypass.
   */
  async create(
    input: IntegrationDefinitionCreate,
    opts: { actor: Actor; onConflict?: 'reject' | 'replace' },
  ): Promise<IntegrationDefinitionDoc> {
    const { actor } = opts;
    // THE GLOBAL TIER IS SUPER-ADMIN ONLY — on CREATE as well as on setVisibility (A2 review F2).
    // Gating only the transition left the front door open: `create({visibility:'global'})` published
    // to every org in one step, and A2 made that load-bearing (a global row is the resolution for
    // every org without its own, and the source of their credential-egress origins).
    if (input.visibility === 'global' && actor.role !== 'super-admin') {
      throw new IntegrationDefinitionStoreError(
        'FORBIDDEN',
        'only a super-admin may create a globally-visible integration definition',
      );
    }
    // ACTOR/ROW CONGRUENCE. A non-super-admin writes only inside their own org, and a plain user
    // only as themselves — the seam refuses a forged owner instead of trusting every caller to
    // stamp the row from the verified JWT (the route rule "never read orgId from a body", enforced
    // one layer down).
    if (actor.role !== 'super-admin') {
      if (input.orgId !== actor.orgId) {
        throw new IntegrationDefinitionStoreError('FORBIDDEN', 'a definition may only be created in the acting user\'s own organisation');
      }
      if (actor.role !== 'org-admin' && input.userId !== actor.userId) {
        throw new IntegrationDefinitionStoreError('FORBIDDEN', 'a definition may only be authored as the acting user');
      }
    }
    // An author identity is required and may never be the empty string: `isDefinitionVisibleTo`
    // treats a non-empty match as "own row", and org-scoped system actors carry `userId: ''`.
    if (input.userId === '' || input.orgId === '') {
      throw new IntegrationDefinitionStoreError('INVALID', 'a definition must name a real owning org and author (orgId, userId)');
    }
    const onConflict = opts.onConflict ?? 'reject';
    const nowIso = this.nowIso();
    const _id = definitionIdFor(input.orgId, input.key);
    const doc: IntegrationDefinitionDoc = {
      ...input,
      // A COMPILED RECIPE IS NOT CALLER CONTENT (P2.0), the same rule the publication record below
      // is held to, for a sharper reason: a hand-written `recipe` would be a caller-supplied list of
      // URLs and header names that the replay path (P2.3) later dials WITH THE LIVE SESSION'S
      // headers attached. Authoring one is `recipe-store.ts`'s job and nobody else's, so every
      // create/replace/fork/import through this seam drops whatever the caller supplied.
      actions: withoutRecipes(input.actions),
      _id,
      createdAt: input.createdAt ?? nowIso,
      updatedAt: input.updatedAt ?? nowIso,
    };
    if (await this.store.insert(doc)) return doc;

    // (orgId, key) already taken.
    if (onConflict === 'reject') {
      throw new IntegrationDefinitionStoreError(
        'DUPLICATE',
        `an integration definition for key '${input.key}' already exists in this org`,
      );
    }
    const existing = (await this.store.get(_id)) as IntegrationDefinitionDoc | null;
    // REPLACE IS A WRITE ON THE EXISTING ROW and is gated as one: without this, a same-org user
    // whose insert collided with a peer's PRIVATE row would silently overwrite it.
    if (existing && !canWriteDefinition(existing, actor)) {
      throw new IntegrationDefinitionStoreError('FORBIDDEN', 'not allowed to overwrite the existing definition for this key');
    }
    // A replace that CHANGES the tier is a visibility transition and is judged by THE SAME rule
    // as `setVisibility` (`visibilityWriteVerdict` — one rule, two doors): an owner may move
    // between private/org, but nothing can smuggle a row into or out of the super-admin-gated
    // `global` tier through the replace door.
    if (existing && existing.visibility !== input.visibility
      && this.visibilityWriteVerdict(existing, actor, input.visibility)) {
      throw new IntegrationDefinitionStoreError('FORBIDDEN', 'this visibility transition is not allowed for the acting user');
    }
    // THE PUBLICATION RECORD IS NOT CALLER CONTENT (E2). A replace rewrites the package the caller
    // supplied; `publishedSnapshot` and `publishRequest` are records of PLATFORM decisions about the
    // row, and a content write that silently dropped them would take a `global` row back to serving
    // its LIVE content cross-org (the snapshot is what `definition-registry` reads for a foreign
    // org) and would revoke the org's standing review request as a side effect of an edit. Carried
    // forward unless the caller states them explicitly, so `definition-save.ts`'s own preservation
    // becomes belt-and-braces instead of the only thing holding it.
    return this.store.put({
      ...doc,
      // …and the LEARNING about an action survives a rewrite of that action for the same reason the
      // publication record does: an ordinary builder save posts the package the author edited, which
      // has never carried a recipe, so without this every save would silently throw away an
      // expensive discovery pass and quietly return the action to re-deriving its flow every run.
      // Carried per action NAME - a save that removes an action drops its recipe with it, which is
      // correct: the recipe describes that action and nothing else.
      actions: carryRecipesForward(doc.actions, existing?.actions),
      ...(doc.publishedSnapshot === undefined && existing?.publishedSnapshot !== undefined
        ? { publishedSnapshot: existing.publishedSnapshot } : {}),
      ...(doc.publishRequest === undefined && existing?.publishRequest !== undefined
        ? { publishRequest: existing.publishRequest } : {}),
      createdAt: existing?.createdAt ?? doc.createdAt,
      updatedAt: nowIso,
    });
  }

  /** RAW by-id fetch — NOT tenant-scoped (see the class doc). */
  async getById(id: string): Promise<IntegrationDefinitionDoc | null> {
    return this.store.get(id);
  }

  /**
   * Resolve a definition by `key` for `actor`, in the documented order:
   *   1. the actor's own org row for that key, IF the actor may see it (own at any visibility, or an
   *      org-shared peer row, or a global row authored in the actor's org);
   *   2. otherwise a `global` definition of that key authored in ANY other org.
   * A same-org peer's PRIVATE row is skipped, and another org's private/org row is NEVER returned.
   */
  async getForActor(actor: Actor, key: string): Promise<IntegrationDefinitionDoc | null> {
    const own = await this.store.get(definitionIdFor(actor.orgId, key));
    if (own && isDefinitionVisibleTo(own, actor)) return own;

    const globals = (await this.store.find({ key, visibility: 'global' })).filter(
      (g) => g.orgId !== actor.orgId, // the actor's own org row was already considered above
    );
    if (globals.length > 0) {
      // Deterministic pick so the resolver is a pure function of the data: oldest first, orgId tiebreak.
      globals.sort((a, b) =>
        a.createdAt < b.createdAt ? -1
          : a.createdAt > b.createdAt ? 1
            : a.orgId < b.orgId ? -1
              : a.orgId > b.orgId ? 1
                : 0,
      );
      return globals[0] ?? null;
    }
    // NO sentinel fallback here (A3 re-review MEDIUM-1/MEDIUM-2). `getForActor` is the EXECUTION
    // and PROMPT resolver — `resolveDefinition`, `resolveSkillMd`, `activeCatalogFor`, the planner
    // catalog and the origin-resolver seam all come through it — and it cannot see the shipped
    // BASELINE tier, which lives one layer up in `definition-registry.ts`. Answering a retired row
    // here therefore DISPLACED the shipped package for a super-admin whenever a release shipped a
    // key an imported legacy row occupied (list and resolve openly disagreed), and let a planner
    // plan against a retired package the executor then refuses. Retirement is honoured
    // consistently instead: a retired row is reachable ONLY through the REVIEW surface —
    // `listForActor` (discovery) and `isDefinitionVisibleTo` (which `setVisibility` consults to
    // restore it) — never through a resolution that feeds execution or a model.
    return null;
  }

  /**
   * A RETIRED sentinel-org row by key, for the super-admin REVIEW surface only (A3 review F1's
   * reversibility requirement, re-scoped by the re-review). Deliberately NOT consulted by
   * `getForActor`: nothing that resolves a definition for execution, egress or a prompt may see a
   * retired row.
   */
  async getRetiredForReview(actor: Actor, key: string): Promise<IntegrationDefinitionDoc | null> {
    if (actor.role !== 'super-admin') return null;
    const sentinel = await this.store.get(definitionIdFor(LEGACY_RUNTIME_ORG, key));
    return sentinel && isDefinitionVisibleTo(sentinel, actor) ? sentinel : null;
  }

  /** Every definition `actor` may see: own org rows they can read (own any-visibility + org-shared)
   *  plus every `global` row from any org, de-duplicated by `_id`. A super-admin additionally sees
   *  the sentinel legacy-runtime org's rows at ANY visibility (A3 review F1: a RETIRED legacy row
   *  must stay discoverable, or it can never be restored through the review surface). */
  async listForActor(actor: Actor): Promise<IntegrationDefinitionDoc[]> {
    const inOrg = await this.store.find({ orgId: actor.orgId });
    const globals = await this.store.find({ visibility: 'global' });
    const byId = new Map<string, IntegrationDefinitionDoc>();
    for (const row of inOrg) if (isDefinitionVisibleTo(row, actor)) byId.set(row._id, row);
    for (const row of globals) byId.set(row._id, row); // global is visible to every actor
    if (actor.role === 'super-admin') {
      for (const row of await this.store.find({ orgId: LEGACY_RUNTIME_ORG })) {
        if (isDefinitionVisibleTo(row, actor)) byId.set(row._id, row);
      }
    }
    return [...byId.values()];
  }

  /**
   * Change a definition's visibility, owner-or-admin gated (`canWriteDefinition`). A row the actor
   * may not even see answers `notfound`, byte-for-byte with a genuinely missing one — a caller who
   * cannot READ a private definition cannot probe for it with a write either.
   *
   * THE `global` TIER IS SUPER-ADMIN ONLY (brief lock: global visibility is the super-admin review
   * gate). Enforced here at the single store chokepoint, not just at the E1 route, so no caller — the
   * route, the D3 copy-on-author path, or any future one — can self-publish a tenant's definition to
   * every org, or silently un-publish a shared one. A base owner may still flip their own row between
   * `private` and `org` freely; only promotion TO or demotion FROM `global` needs super-admin.
   *
   * THE PUBLISHED SNAPSHOT IS DELIBERATELY NOT CLEARED ON DEMOTION (E2). Nobody reads it while the
   * row is not `global`, and keeping it makes the failure mode of a re-promotion through THIS route
   * (rather than through `publishSnapshot`) the SAFE one: cross-org readers get the previously
   * scrubbed, reviewed artifact instead of the row's live, only-floor-scrubbed content. Clearing it
   * would turn an un-publish/re-publish cycle into a way to widen what other orgs read.
   */
  async setVisibility(id: string, actor: Actor, visibility: DefinitionVisibility): Promise<SetVisibilityResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    const verdict = this.visibilityWriteVerdict(row, actor, visibility);
    if (verdict) return verdict;
    // RE-ASSERT INSIDE THE MUTATOR (E1 review F4b). `Store.update` is CAS with retry: it re-reads
    // `cur` on each attempt, so the row it finally writes may be in a state that was never the one
    // authorised above (e.g. an org-admin's in-flight demotion landing after a super-admin promoted
    // the row to `global`). Judging the gate again against `cur` closes that interleave; a state
    // that no longer passes aborts the write by returning `cur` unchanged.
    let raced = false;
    const updated = await this.store.update(id, (cur) => {
      if (this.visibilityWriteVerdict(cur as IntegrationDefinitionDoc, actor, visibility)) {
        raced = true;
        return cur;
      }
      return { ...cur, visibility, updatedAt: this.nowIso() };
    });
    if (raced) return { verdict: 'forbidden' };
    return updated ? { verdict: 'ok', doc: updated } : { verdict: 'notfound' };
  }

  /**
   * Replace a definition's LESSONS body (slice C3), under compare-and-swap.
   *
   * THE ADMISSION PREDICATE IS INJECTED, NOT RE-DERIVED. C3's raw-lessons gate is
   * `canEditDefinitionRaw` (definition-registry.ts) — the save path's own admission set — and this
   * file cannot import the registry without a cycle (the registry imports this file). Taking the
   * predicate as an argument keeps ONE implementation of the rule and lets the E1-review-F4b
   * re-assert run THAT rule again inside the mutator, against the row actually being written,
   * instead of a weaker local approximation of it.
   *
   * `expectedUpdatedAt` is optimistic concurrency, and its ABSENCE is a decision rather than a
   * default: a caller that omits it is explicitly asking to overwrite whatever is stored. Present,
   * it is checked before the swap AND again inside the CAS mutator, so a write that lands between
   * the caller's read and this one is refused rather than silently discarded.
   *
   * `updatedAt` is bumped STRICTLY MONOTONICALLY, never merely "to now": the stamp IS the
   * concurrency token, and two writes inside one millisecond would otherwise share one — precisely
   * the case the token exists to catch.
   */
  async setLessons(
    id: string,
    actor: Actor,
    lessons: string,
    opts: { admit: (doc: IntegrationDefinitionDoc) => boolean; expectedUpdatedAt?: string },
  ): Promise<SetLessonsResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    if (!opts.admit(row)) return { verdict: 'forbidden' };
    if (opts.expectedUpdatedAt !== undefined && row.updatedAt !== opts.expectedUpdatedAt) {
      return { verdict: 'stale', doc: row };
    }
    let racedForbidden = false;
    let racedStale = false;
    const updated = await this.store.update(id, (cur) => {
      // RESET on every attempt: `Store.update` re-runs the mutator after losing a CAS race, and a
      // flag set on a losing attempt would report a refusal the winning attempt never made.
      racedForbidden = false;
      racedStale = false;
      const doc = cur as IntegrationDefinitionDoc;
      if (!isDefinitionVisibleTo(doc, actor) || !opts.admit(doc)) { racedForbidden = true; return cur; }
      if (opts.expectedUpdatedAt !== undefined && doc.updatedAt !== opts.expectedUpdatedAt) {
        racedStale = true;
        return cur;
      }
      return { ...cur, lessons, updatedAt: this.nextStamp(doc.updatedAt) };
    });
    if (racedForbidden) return { verdict: 'forbidden' };
    if (racedStale) {
      const current = await this.store.get(id);
      return current ? { verdict: 'stale', doc: current } : { verdict: 'notfound' };
    }
    return updated ? { verdict: 'ok', doc: updated } : { verdict: 'notfound' };
  }

  /** The next `updatedAt`, guaranteed to differ from `prev` — see `setLessons`. */
  private nextStamp(prev: string): string {
    const prior = Date.parse(prev);
    const now = this.now().getTime();
    return new Date(Number.isNaN(prior) ? now : Math.max(now, prior + 1)).toISOString();
  }

  /**
   * SUBMIT FOR REVIEW — the author (or their org-admin) asking the platform to publish their
   * definition cross-org. This is the ONLY door that puts a tenant row in front of a non-member
   * super-admin, and it is opened from inside the tenant.
   *
   * The row must already be `org`: the same launch pad `visibilityWriteVerdict` requires for the
   * publish itself, so a submission can never expose a `private` draft that the author's own
   * colleagues cannot see. Re-submitting an already-submitted row re-stamps it (idempotent, and the
   * note can be corrected) rather than answering an error.
   */
  async requestPublish(id: string, actor: Actor, note?: string): Promise<SetVisibilityResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    if (!canWriteDefinition(row, actor) || row.visibility !== 'org') return { verdict: 'forbidden' };
    let raced = false;
    const updated = await this.store.update(id, (cur) => {
      const doc = cur as IntegrationDefinitionDoc;
      if (!canWriteDefinition(doc, actor) || doc.visibility !== 'org') { raced = true; return cur; }
      return {
        ...cur,
        publishRequest: { requestedBy: actor.userId, requestedAt: this.nowIso(), ...(note !== undefined ? { note } : {}) },
        updatedAt: this.nowIso(),
      };
    });
    if (raced) return { verdict: 'forbidden' };
    return updated ? { verdict: 'ok', doc: updated } : { verdict: 'notfound' };
  }

  /**
   * WITHDRAW the submission, closing the review window again. Refused while the row is `global`:
   * a published row is already visible to every org, so "withdraw" there would only strip the
   * reviewer's ability to UN-publish it — the un-publish is the way back, and it keeps the request
   * standing so the transition remains exactly reversible (E1 review F1's rule).
   */
  async withdrawPublishRequest(id: string, actor: Actor): Promise<SetVisibilityResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    // Only a member of the authoring org may withdraw — a platform reviewer must not be able to
    // remove the org's own request (and thereby its record that the org ever asked).
    if (!canWriteDefinition(row, actor) || row.orgId !== actor.orgId || row.visibility === 'global') {
      return { verdict: 'forbidden' };
    }
    let raced = false;
    const updated = await this.store.update(id, (cur) => {
      const doc = cur as IntegrationDefinitionDoc;
      if (!canWriteDefinition(doc, actor) || doc.orgId !== actor.orgId || doc.visibility === 'global') { raced = true; return cur; }
      const { publishRequest: _dropped, ...rest } = doc;
      return { ...rest, updatedAt: this.nowIso() };
    });
    if (raced) return { verdict: 'forbidden' };
    return updated ? { verdict: 'ok', doc: updated } : { verdict: 'notfound' };
  }

  /** The platform REVIEW QUEUE: every `org` row whose tenant has asked for cross-org publication.
   *  Super-admin only, and deliberately NOT folded into `listForActor` — the review queue is its own
   *  surface, and a submitted row must never masquerade as a definition the reviewer's org holds. */
  async listPublishRequests(actor: Actor): Promise<IntegrationDefinitionDoc[]> {
    if (actor.role !== 'super-admin') return [];
    return (await this.store.find({ visibility: 'org' })).filter((row) => row.publishRequest !== undefined);
  }

  /**
   * PUBLISH: stamp the FROZEN scrubbed snapshot and move the row to `global`, in ONE gated CAS
   * write (slice E2). The two must land together — a `global` row whose snapshot is missing serves
   * cross-org readers its LIVE content through the read-time floor, and a snapshot on a row that
   * never went global is dead weight. Judged by exactly the same `visibilityWriteVerdict` as
   * `setVisibility`, in the pre-check AND inside the mutator (the E1 F4b re-assert), so publishing
   * grants no authority the visibility chokepoint does not already grant: super-admin only, and the
   * row must already be `org`.
   *
   * `supersedes` is stamped HERE, from `cur` inside the mutator, so the recorded lineage is the
   * snapshot actually replaced by this write rather than the one the caller happened to read first.
   */
  async publishSnapshot(
    id: string,
    actor: Actor,
    snapshot: Omit<IntegrationDefinitionPublishedSnapshot, 'supersedes'>,
  ): Promise<SetVisibilityResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    const verdict = this.visibilityWriteVerdict(row, actor, 'global');
    if (verdict) return verdict;
    let raced = false;
    const updated = await this.store.update(id, (cur) => {
      const doc = cur as IntegrationDefinitionDoc;
      if (this.visibilityWriteVerdict(doc, actor, 'global')) {
        raced = true;
        return cur;
      }
      const prior = doc.publishedSnapshot;
      return {
        ...cur,
        visibility: 'global',
        publishedSnapshot: {
          ...snapshot,
          ...(prior ? { supersedes: { scrubbedAt: prior.scrubbedAt, scrubbedBy: prior.scrubbedBy } } : {}),
        },
        updatedAt: this.nowIso(),
      };
    });
    if (raced) return { verdict: 'forbidden' };
    return updated ? { verdict: 'ok', doc: updated } : { verdict: 'notfound' };
  }

  /**
   * Would `actor` be allowed to publish `id` right now? The SAME verdict `publishSnapshot` will
   * reach, exposed so the publish flow can refuse before paying for a model call. It is a cheap
   * pre-check, never the gate: `publishSnapshot` re-judges everything, twice.
   */
  async publishPrecheck(id: string, actor: Actor): Promise<SetVisibilityResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    return this.visibilityWriteVerdict(row, actor, 'global') ?? { verdict: 'ok', doc: row };
  }

  /**
   * The row `actor` may WRITE, or the no-existence-oracle refusal. The admission set of the DRY-RUN
   * publish preview: an author (or their org-admin) must be able to see what publication would
   * expose before asking for it, and `canWriteDefinition` is exactly the set that can already read
   * the row's raw bytes — so the preview reveals strictly less than they hold already.
   */
  async getWritableForActor(id: string, actor: Actor): Promise<SetVisibilityResult> {
    const row = await this.store.get(id);
    if (!row || !isDefinitionVisibleTo(row, actor)) return { verdict: 'notfound' };
    return canWriteDefinition(row, actor) ? { verdict: 'ok', doc: row } : { verdict: 'forbidden' };
  }

  /**
   * The write rules for a visibility transition, or `null` when it is allowed. Extracted so the
   * pre-check and the in-mutator re-check (F4b) can never diverge.
   */
  private visibilityWriteVerdict(
    row: IntegrationDefinitionDoc,
    actor: Actor,
    visibility: DefinitionVisibility,
  ): { verdict: 'forbidden' } | null {
    if (!canWriteDefinition(row, actor)) return { verdict: 'forbidden' };
    const touchesGlobal = visibility === 'global' || row.visibility === 'global';
    if (touchesGlobal && actor.role !== 'super-admin') return { verdict: 'forbidden' };
    // UN-PUBLISHING LANDS ON `org`, NEVER `private` (E1 review F1). A super-admin is a platform
    // role and can write any row it can see — and it can see every `global` row, including other
    // orgs'. Without this rule, `PATCH .../visibility {"private"}` on a foreign published row was a
    // destructive one-way trapdoor: the authoring org ALSO lost its own definition, and the actor
    // could no longer see the row (now private in a foreign org) to undo it. `org` is the narrowest
    // tier that returns the row to exactly the people who had it before publication.
    if (row.visibility === 'global' && visibility === 'private') return { verdict: 'forbidden' };
    // A NON-MEMBER MAY ONLY MOVE A ROW BETWEEN `org` AND `global` (E2). The two ways an actor can
    // reach a row of an org they do not belong to — a `global` row and the submit-for-review window
    // above — both exist for ONE purpose: deciding cross-org publication. Letting that reach also
    // take a tenant's row to `private` would re-open the exact trapdoor E1's review closed (F1): the
    // authoring org loses its own definition, and the platform actor can no longer see the row to
    // undo it. Publishing and un-publishing stay exactly inverse; nothing else is on offer.
    if (row.orgId !== actor.orgId && visibility === 'private') return { verdict: 'forbidden' };
    // PUBLISH ONLY WHAT THE AUTHORING ORG ALREADY SHARES (E1 review F4). Nothing records the
    // pre-publish tier, so a later demotion lands on `org` and would WIDEN a row that was `private`
    // before it was published. Requiring `org` as the launch pad makes demotion exactly reversible
    // and keeps a private draft from being exposed to its own org as a side effect of publishing.
    //
    // NARROWED FROM `!== 'org'` TO `=== 'private'` (E2). The rule is about the LAUNCH PAD, and
    // `global -> global` is not a launch: it is a RE-PUBLISH, which is how a published definition
    // gets a fresh scrubbed snapshot after the author's row moves on. Forbidding it made the
    // published artifact unrefreshable — a row could only ever be scrubbed once, and correcting a
    // published snapshot would have meant un-publishing (breaking every consumer) and publishing
    // again. The demotion argument above is untouched: the pre-publish tier of a re-published row is
    // still `org`, because that is the only tier it can have been promoted from.
    if (visibility === 'global' && row.visibility === 'private') return { verdict: 'forbidden' };
    return null;
  }
}

/** The process-wide store bound to the real `integration_definitions` collection. */
export const integrationDefinitionStore = new IntegrationDefinitionStore();
