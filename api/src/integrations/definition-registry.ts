/**
 * The MERGED integration-definition read API (slice A2).
 *
 * Slice A1 landed the tenant-scoped Mongo store (`definition-store.ts`) but wired it into nothing.
 * This module is the single ASYNC read surface that puts that store IN FRONT of the existing
 * synchronous disk registry (`definitions.ts`), so every read of "what does integration <key> look
 * like" becomes tenant-scoped without any caller changing the SHAPE it consumes.
 *
 * THE TWO TIERS, in resolution order:
 *   1. TENANT (Mongo, `integration_definitions`) — the actor-scoped rows: their own private rows,
 *      their org's shared rows, and the cross-org `global` tier. Resolved by
 *      `IntegrationDefinitionStore.getForActor`, which is the ONE visibility gate (A1); this module
 *      never re-derives it and never reads a row by id.
 *   2. BASELINE (disk, `api/assets/integrations/**`) — the SHIPPED packages. A global, read-only
 *      tier visible to every org (RUN_SPEC assumption 2: deploy-versioned with code, never seeded
 *      into Mongo). The legacy disk RUNTIME tier is gone from every read path since A3: its
 *      packages were imported at boot as `global` rows of tier 1 (legacy-runtime-import.ts) and
 *      the directory is frozen.
 *
 * A tenant row SHADOWS a baseline package of the same key FOR THAT TENANT ONLY. Another org keeps
 * seeing the baseline — which is precisely the cross-tenant listing leak this slice closes on the
 * read path: before A2, `listDefinitions()` handed every org every runtime-tier package on the box.
 * The fallback below is BASELINE-ONLY (`getBaselineDefinition`/`listBaselineDefinitions`) — falling
 * back to the MERGED disk cache would have walked straight back into that leak, because the runtime
 * tier is one global directory any tenant can write (A2 review F1). See definitions.ts for the
 * full reasoning.
 *
 * SHAPE. `definitionFromDoc` projects a stored doc onto the SAME `IntegrationDefinition` the disk
 * registry emits — including the `integrationKey` alias the catalog seam keys on — so no caller
 * needs a shape change, and it runs the SAME defensive `redactSecrets` pass the disk loader runs
 * (definitions carry no credential VALUES; belt-and-braces on both tiers, one implementation).
 * The projection deliberately drops the storage envelope (`_id`, `orgId`, `userId`, `visibility`):
 * a `global` row authored in another org must not tell the reader which org authored it.
 *
 * PURITY. Nothing here caches. The disk tier keeps its own process cache (`definitions.ts`); the
 * Mongo tier is read per call, which at this scale is two small collection scans (A1's carry-forward
 * note) and keeps a just-saved tenant definition immediately visible without an invalidation
 * protocol. The store is injectable (last parameter, defaulting to the real singleton) so tests
 * drive the merge logic without standing up Mongo.
 */
import type { Actor } from '@ekoa/shared';
import {
  getBaselineDefinition,
  listBaselineDefinitions,
  baselineSkillMd,
  redactSecrets,
  scrubSecretText,
  type IntegrationDefinition,
  type ActiveIntegrationCatalog,
} from './definitions.js';
import { integrationDefinitionStore, type IntegrationDefinitionDoc } from './definition-store.js';

/**
 * The slice of the A1 store this module needs: the two ACTOR-SCOPED reads. Deliberately narrow —
 * the unscoped `getById` primitive is not on it, so no tenant path can reach a row by id.
 */
export interface DefinitionStoreReader {
  getForActor(actor: Actor, key: string): Promise<IntegrationDefinitionDoc | null>;
  listForActor(actor: Actor): Promise<IntegrationDefinitionDoc[]>;
}

/**
 * A minimal ORG-SCOPED actor for a machine-driven read (a listener poll tick, a webhook ingress, a
 * platform action) where the row that triggered the work carries an org but no acting user.
 *
 * WHY THIS IS SAFE. The read gate (`isDefinitionVisibleTo`, A1) grants: `global` rows to everyone;
 * inside the actor's own org, the actor's OWN rows at any visibility plus peer rows marked `org`.
 * With an empty `userId` the "own row" branch can never match a real row (no row is authored by the
 * empty user), so this actor sees exactly `org` + `global` — never any user's PRIVATE definition,
 * and never anything outside `orgId`. `role` is `'user'`, the least-privileged role, and the read
 * gate does not consult the role at all, so it can only ever be an over-restriction, never a
 * bypass. Prefer `{userId: <ownerUserId>, orgId, role: 'user'}` wherever the row does carry an
 * owner — this helper is the honest fallback for rows that do not.
 */
export function systemActorForOrg(orgId: string): Actor {
  return { userId: '', orgId, role: 'user' };
}

/** Build the read actor for a machine-driven path from whatever the triggering row carries. */
export function actorForOwnedRow(orgId: string, ownerUserId?: string): Actor {
  return ownerUserId ? { userId: ownerUserId, orgId, role: 'user' } : systemActorForOrg(orgId);
}

/**
 * Project a stored definition onto the canonical `IntegrationDefinition` read shape. `userCreated`
 * is TRUE for every stored row: the Mongo tier only ever holds authored/forked/migrated packages,
 * while the shipped read-only packages remain the disk baseline (`userCreated: false`).
 */
export function definitionFromDoc(doc: IntegrationDefinitionDoc, actor?: Actor): IntegrationDefinition {
  // ADDRESSABILITY, scoped to the actor's OWN org (E1 review F3). The sharing routes key on the
  // store `_id`, and the tier they change is `visibility` — yet this projection dropped both, so a
  // conforming client could neither name its own definition nor read back its current tier, and the
  // only way to get an id was to re-derive the hash client-side. Both fields are now projected, but
  // ONLY for a row of the actor's own org: a cross-org `global` row must still not reveal its
  // author or its id (the id is derivable from `(orgId, key)`, so leaking it leaks the org).
  const own = actor !== undefined && doc.orgId === actor.orgId;
  return redactSecrets<IntegrationDefinition>({
    ...(own ? { id: doc._id, visibility: doc.visibility } : {}),
    key: doc.key,
    integrationKey: doc.key, // the alias the catalog seam + builder key on
    displayName: doc.displayName,
    description: doc.description,
    version: doc.version,
    authType: doc.authType,
    provider: doc.provider,
    category: doc.category,
    userCreated: true,
    configSchema: doc.configSchema ?? [],
    actions: doc.actions ?? [],
    credentialGuide: doc.credentialGuide,
    sessionConnect: doc.sessionConnect,
    webhookConfig: doc.webhookConfig,
    listenerConfig: doc.listenerConfig,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  });
}

/**
 * One definition by key, TENANT FIRST: the actor-scoped stored row if one resolves, else the disk
 * baseline. Null when neither tier has the key — a key the actor may not see is indistinguishable
 * from a key that does not exist (no existence oracle), which is the A1 store's own posture.
 */
export async function resolveDefinition(
  actor: Actor,
  key: string,
  store: DefinitionStoreReader = integrationDefinitionStore,
): Promise<IntegrationDefinition | null> {
  const doc = await store.getForActor(actor, key);
  if (doc) return definitionFromDoc(doc, actor);
  return getBaselineDefinition(key);
}

/**
 * Deterministic pick among the cross-org `global` rows for one key — the SAME order
 * `IntegrationDefinitionStore.getForActor` uses (oldest first, `orgId` as tiebreak) so a key
 * resolves identically whether it is reached through `resolveDefinition` or through the list.
 */
function sortGlobals(docs: IntegrationDefinitionDoc[]): IntegrationDefinitionDoc[] {
  return [...docs].sort((a, b) =>
    a.createdAt < b.createdAt ? -1
      : a.createdAt > b.createdAt ? 1
        : a.orgId < b.orgId ? -1
          : a.orgId > b.orgId ? 1
            : 0,
  );
}

/**
 * Every definition the actor may see: the union of their visible stored rows and the disk baseline,
 * de-duplicated BY KEY with the tenant row winning. Within the stored rows the precedence mirrors
 * `getForActor` exactly: the actor's OWN-ORG row beats a `global` row authored elsewhere, and among
 * foreign globals the deterministic oldest-first pick wins.
 *
 * This is the tenant filter behind `GET /api/v1/integrations`: another org's private or org-scoped
 * definition is never in `listForActor`'s output, so it can never appear here.
 */
export async function listDefinitionsFor(
  actor: Actor,
  store: DefinitionStoreReader = integrationDefinitionStore,
): Promise<IntegrationDefinition[]> {
  const docs = await store.listForActor(actor);

  const chosen = new Map<string, IntegrationDefinitionDoc>();
  // Foreign `global` rows first, in the deterministic order; first one for a key wins.
  for (const doc of sortGlobals(docs.filter((d) => d.orgId !== actor.orgId))) {
    if (!chosen.has(doc.key)) chosen.set(doc.key, doc);
  }
  // The actor's own-org row always wins (at most one per (org, key) — A1's deterministic `_id`).
  for (const doc of docs.filter((d) => d.orgId === actor.orgId)) chosen.set(doc.key, doc);

  // Baseline first so the shipped ordering is preserved; `Map.set` on an existing key overwrites
  // IN PLACE, so a tenant row shadows its baseline without reordering the list.
  const merged = new Map<string, IntegrationDefinition>();
  for (const def of listBaselineDefinitions()) merged.set(def.key, def);
  for (const [key, doc] of chosen) merged.set(key, definitionFromDoc(doc, actor));
  return [...merged.values()];
}

/**
 * The integration's knowledge SKILL.md, TENANT FIRST. When a stored row resolves, ITS body is the
 * answer — including an empty one: a tenant that replaced the shipped knowledge must not silently
 * get the shipped body back. Only when no stored row resolves does the disk baseline answer.
 *
 * A STORED body is scrubbed on the way out (A2 review F7): this string rides verbatim into agent
 * prompts (the `load_context` seam), and a user-authored doc can carry a pasted credential.
 * `scrubSecretText` is the deterministic read-path floor; the strict publish-time scrub into a
 * frozen snapshot is slice E2's. The BASELINE body is repo-authored and reviewed — served as-is.
 */
export async function resolveSkillMd(
  actor: Actor,
  key: string,
  store: DefinitionStoreReader = integrationDefinitionStore,
): Promise<string | null> {
  const doc = await store.getForActor(actor, key);
  if (doc) return doc.skillMd == null ? null : scrubSecretText(doc.skillMd);
  return baselineSkillMd(key);
}

/**
 * The action + webhook/listener event catalog over the actor's VISIBLE definitions — the exact
 * projection `activeCatalog()` performs, just over the merged tenant+baseline set. The route still
 * joins the result against the org's enabled configs; this only narrows WHICH definitions exist.
 */
export async function activeCatalogFor(
  actor: Actor,
  store: DefinitionStoreReader = integrationDefinitionStore,
): Promise<ActiveIntegrationCatalog[]> {
  return (await listDefinitionsFor(actor, store)).map((d) => ({
    key: d.key,
    displayName: d.displayName,
    actions: d.actions.map((a) => ({ actionName: a.actionName, description: a.description, mutates: a.mutates })),
    webhookEvents: d.webhookConfig?.events ?? [],
    listenerEvents: d.listenerConfig?.events ?? [],
  }));
}
