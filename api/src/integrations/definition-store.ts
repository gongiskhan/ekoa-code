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

/** How a definition came to exist (provenance for A2's fork/legacy-migration flows). */
export interface IntegrationDefinitionOrigin {
  kind: 'authored' | 'forked' | 'legacy-runtime' | 'baseline-override';
  /** The `_id` of the definition this one was forked/derived from (may be another org's). */
  sourceDefinitionId?: string;
  /** The org that owned the source (recorded for a cross-org fork). */
  sourceOrgId?: string;
  forkedAt?: string;
}

/** A scrubbed, publishable snapshot of a definition (credential VALUES already removed upstream). */
export interface IntegrationDefinitionPublishedSnapshot {
  scrubbedAt: string;
  scrubbedBy: string;
  /** The scrubbed package config at publish time (the ONE canonical package shape). */
  config: IntegrationPackageConfig;
  skillMd: string;
  lessons?: string;
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
  /** Origins the definition may talk to (egress allow-list carried from the package). */
  declaredOrigins: string[];
  origin?: IntegrationDefinitionOrigin;
  publishedSnapshot?: IntegrationDefinitionPublishedSnapshot;
}

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

type VisibilityView = Pick<IntegrationDefinitionFields, 'orgId' | 'userId' | 'visibility'>;

/**
 * Can `actor` SEE this definition? The single read predicate, shared by `getForActor` and
 * `listForActor` so the two can never drift (the pattern `OwnerVisibilityScoped.listVisible` and
 * automation `listAutomations` both follow). `global` is cross-org; otherwise the row is confined to
 * its org, where the owner sees it at any visibility and everyone else sees it only when it is `org`.
 */
export function isDefinitionVisibleTo(doc: VisibilityView, actor: Actor): boolean {
  if (doc.visibility === 'global') return true; // cross-org tier
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
   *   - `onConflict: 'replace'`          → overwrites the existing row, preserving its `createdAt`.
   */
  async create(
    input: IntegrationDefinitionCreate,
    opts: { onConflict?: 'reject' | 'replace'; actor?: Actor } = {},
  ): Promise<IntegrationDefinitionDoc> {
    // THE GLOBAL TIER IS SUPER-ADMIN ONLY — on CREATE as well as on setVisibility (A2 review F2).
    // Gating only the transition left the front door open: `create({visibility:'global'})` published
    // to every org in one step, and A2 made that load-bearing (a global row is the resolution for
    // every org without its own, and the source of their credential-egress origins). `actor` is
    // optional so internal seeding/migration can mint a reviewed global deliberately, but ANY caller
    // that passes an actor is held to the same super-admin bar as the toggle.
    if (input.visibility === 'global' && opts.actor && opts.actor.role !== 'super-admin') {
      throw new IntegrationDefinitionStoreError(
        'FORBIDDEN',
        'only a super-admin may create a globally-visible integration definition',
      );
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
    const existing = await this.store.get(_id);
    return this.store.put({
      ...doc,
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
    if (globals.length === 0) return null;
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

  /** Every definition `actor` may see: own org rows they can read (own any-visibility + org-shared)
   *  plus every `global` row from any org, de-duplicated by `_id`. */
  async listForActor(actor: Actor): Promise<IntegrationDefinitionDoc[]> {
    const inOrg = await this.store.find({ orgId: actor.orgId });
    const globals = await this.store.find({ visibility: 'global' });
    const byId = new Map<string, IntegrationDefinitionDoc>();
    for (const row of inOrg) if (isDefinitionVisibleTo(row, actor)) byId.set(row._id, row);
    for (const row of globals) byId.set(row._id, row); // global is visible to every actor
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
    // PUBLISH ONLY WHAT THE AUTHORING ORG ALREADY SHARES (E1 review F4). Nothing records the
    // pre-publish tier, so a later demotion lands on `org` and would WIDEN a row that was `private`
    // before it was published. Requiring `org` as the launch pad makes demotion exactly reversible
    // and keeps a private draft from being exposed to its own org as a side effect of publishing.
    if (visibility === 'global' && row.visibility !== 'org') return { verdict: 'forbidden' };
    return null;
  }
}

/** The process-wide store bound to the real `integration_definitions` collection. */
export const integrationDefinitionStore = new IntegrationDefinitionStore();
