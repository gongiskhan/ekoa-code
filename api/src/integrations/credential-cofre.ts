/**
 * integrations/credential-cofre.ts — the WS-C credential SHADOW and its comparator (slice B2).
 *
 * ================================ WHAT THIS IS, IN RULE-10 TERMS ============================
 * CLAUDE.md rule 10: a state migration is SHADOW -> COMPARE -> cutover-or-remove, with the review
 * date fixed at the start. This module is all three halves of the first two, and nothing else:
 *
 *   SHADOW  — every write to a user-defined integration config ALSO mints (or refreshes) a Cofre
 *             item holding the same credential bundle, joined to the config both ways
 *             (`config.cofreItemId` <-> `item.integrationLink`). `credentialsCiphertext` remains
 *             the LIVE read: nothing that works today starts depending on the new store.
 *   COMPARE — every real credential read (the composition root's credential-loader seam) runs
 *             `compareCredentialShadow`, which reads the SAME credential back through the Cofre —
 *             tenancy, grant, link and origin binding included — and reports whether a cutover
 *             today would return the same values under the same policy. The report carries field
 *             NAMES and a status, never a value.
 *   CUTOVER-OR-REMOVE — 2026-08-15 (docs/decisions.md). On that date the Cofre read becomes the
 *             only read and `credentialsCiphertext` is backfilled and dropped, or this whole
 *             module and the join go. There is no third option and no flag that becomes furniture.
 *
 * ONE THING IS NOT SHADOWED, DELIBERATELY: the ORIGIN BINDING is live from day one. The origin
 * resolver below prefers the Cofre item's own `boundOrigins` (and answers REFUSE when the grant is
 * revoked) over the previous derivation from the definition's action base URLs. That is not a
 * shadow, it is the security half of the slice, and it is safe to land ahead of the value cutover
 * because it only ever NARROWS: an integration with no item keeps exactly the binding it had.
 *
 * WHY NARROWING MATTERS (the acceptance criterion). Before B2 the allow-list for an integration's
 * credential was derived from that same integration's own action `baseUrl`s — a definition an agent
 * or a user AUTHORS. So the artifact being authorised and the artifact granting the authorisation
 * were the same file: adding an action pointing at `attacker.example` widened the credential's own
 * egress in the same edit. After B2 the allow-list is the set of hosts bound INTO the Cofre item at
 * the moment the human typed the credentials, and an authored action naming a host outside it is
 * refused at `assertOriginAllowed` before any request is issued.
 *
 * ================================ KNOWN, JOURNALED RESIDUALS ================================
 * 1. ORG-SHARED CONFIGS: the VALUE, and only the value. Cofre items are OWNER-scoped (decisions.md
 *    2026-07-27, sub-decision (a)) — a credential is not a document — so an org-shared config's item
 *    belongs to the admin who typed it and a same-org PEER cannot READ it: the comparator answers
 *    `shadow_unreachable` for them and a cutover today would leave that class unreadable. That is
 *    the explicit question for the 2026-08-15 review.
 *    WHAT IS NO LONGER RESIDUAL (B2 review C1/H1): the peer's EGRESS BINDING and the config's
 *    DESTRUCTION. Both now cross the owner boundary through the server-stamped join, because both
 *    are restrictions rather than disclosures — see the org-shared custody section of
 *    `cofre/integration-items.ts`. Until that landed, a peer of an org-shared config fell through to
 *    the definition-derived list, i.e. the author-widenable artifact this whole slice exists to stop
 *    trusting, and it was the ADMIN's credential that egressed to the author's new host.
 *    WHAT WAS STILL RESIDUAL UNTIL 2026-08-03 (review CRITICAL-1): the peer's binding crossed the
 *    owner boundary only when an ITEM existed. With no item both rails fell back to
 *    `declaredOriginsForIntegration(READER, key)` — the definition as the READER resolves it — so
 *    for the whole no-item org-shared class the allow-list was authored by the attacker after all,
 *    one branch further down than B2's review looked. Closed by resolving the definition as the
 *    credential's CUSTODIAN (`definitionActorForCredential`), on both rails, from one rule.
 * 2. RESERVED ROWS (platform-oauth / pipedream) are out of WS-C scope by RUN_SPEC assumption 4 and
 *    are filtered out by the CALLER (`integrations/service.ts`), which owns that predicate.
 * 3. THE `unbound` EGRESS BRANCH — no item and no literal declared host (the bare-templated-baseUrl
 *    packages). Named in `resolveCredentialEgressBinding`, measured in docs/decisions.md.
 */
import type { Actor } from '@ekoa/shared';
import {
  mintIntegrationCredentialItem,
  updateIntegrationCredentialValue,
  findIntegrationCredentialItem,
  integrationOriginScope,
  unwrapForIntegration,
  discardIntegrationCredentialItem,
  CofreLockedError,
  CredentialOriginError,
  type IntegrationItemAccess,
  type IntegrationItemLink,
} from '../cofre/index.js';
import { originFromBaseUrl } from '../security/origin-binding.js';
import { resolveDefinition, systemActorForOrg } from './definition-registry.js';

/**
 * The part of an `IntegrationConfigDoc` this module needs. Structural rather than an import so the
 * dependency runs ONE way (`service.ts` -> here) with no import cycle, even a type-only one.
 */
export interface IntegrationCredentialConfig {
  _id: string;
  orgId: string;
  integrationKey: string;
  name?: string;
  /**
   * Undefined means ORG-SHARED (org-admin-authored, usable by the whole org); a value means
   * owner-only. Load-bearing here, not decoration: it is what tells the Cofre join that a reader or
   * a deleter who does not own the item may still be the config's legitimate holder.
   */
  ownerUserId?: string;
  /**
   * THE CREDENTIAL'S CUSTODIAN: the user whose credential-typing ceremony produced the bundle this
   * row currently holds (the connect, or a later deliberate credential re-save). Server-stamped
   * from the verified actor, never accepted from a request body, and NEVER moved by a provider
   * rotation — a rotation refreshes a value, it does not perform the ceremony.
   *
   * WHY IT EXISTS (2026-08-03 review, CRITICAL-1). `ownerUserId` answers "who may use this config",
   * which for an ORG-SHARED row is the whole org and therefore names nobody. But the definition
   * that governs the credential — its actions, and through them its egress allow-list — has to be
   * resolved as SOMEONE, and resolving it as the READER let any org member author the contract
   * their org-admin's secret is spent under. This field is the missing half: the identity the
   * definition is resolved as, so the artifact authorising a credential is always one the
   * credential's custodian could write. See `definitionActorForCredential`.
   *
   * Absent on rows written before this landed: those fall back to the ORG tier (`org` + `global` +
   * baseline definitions only), which is the fail-closed direction — a re-save restores the stamp.
   */
  custodianUserId?: string;
  /** The WS-C join: the Cofre item shadowing this config's credentials. Server-stamped. */
  cofreItemId?: string;
  /** The legacy column — still the live read until the 2026-08-15 cutover. */
  credentialsCiphertext?: string;
}

/** The link identifying this config's credential item, in both directions. */
export function linkForConfig(config: IntegrationCredentialConfig): IntegrationItemLink {
  return { integrationKey: config.integrationKey, configId: config._id };
}

/** The access this config grants over its joined item: org-shared configs reach the owner's item
 *  for RESTRICTION and DESTRUCTION only (see `cofre/integration-items.ts`). One expression of the
 *  predicate, so no call site can quietly disagree about which configs are shared. */
function accessForConfig(config: IntegrationCredentialConfig, now?: number): IntegrationItemAccess {
  return { sharedConfig: config.ownerUserId == null, ...(now !== undefined ? { now } : {}) };
}

// ---------------------------------------------------------------------------
// Origins
// ---------------------------------------------------------------------------

/**
 * The hosts an integration DECLARES, derived from its own action base URLs — the pre-WS-C binding,
 * lifted verbatim out of the composition root so the fallback and the mint-time binding are the one
 * implementation instead of two that can drift.
 *
 * Tenant-scoped through `resolveDefinition` (A2): the same key resolves to a different package per
 * org, so resolving it unscoped would bind one org's credential to another org's declared hosts. A
 * templated host (`{{region}}.api.example.com`) is SKIPPED rather than pinned — binding to a pattern
 * would match more than it should. An integration with no usable declared host yields an EMPTY list,
 * and every consumer of this list treats empty as refuse.
 */
export async function declaredOriginsForIntegration(actor: Actor, integrationKey: string): Promise<string[]> {
  const def = await resolveDefinition(actor, integrationKey);
  if (!def) return [];
  const origins = new Set<string>();
  for (const action of Object.values(def.actions ?? {})) {
    const baseUrl = (action as { httpConfig?: { baseUrl?: string } }).httpConfig?.baseUrl;
    if (!baseUrl) continue;
    const host = originFromBaseUrl(baseUrl);
    if (host) origins.add(host);
  }
  return [...origins];
}

/**
 * WHO THE DEFINITION GOVERNING A CREDENTIAL IS RESOLVED AS (2026-08-03 review, CRITICAL-1).
 *
 * An integration definition is TENANT-scoped AND USER-scoped: `getForActor` answers the reader's
 * own-org row (at any visibility, including `private`) before it answers `org`/`global`/baseline.
 * So "resolve the definition" is not a fact about a key, it is a fact about a key AND a principal —
 * and every credential-bearing path was passing the READER.
 *
 * THAT WAS THE HOLE. For an ORG-SHARED config (`ownerUserId == null`) the reader is not the
 * credential's custodian. A same-org peer with role `user` could `PUT
 * /api/v1/integration-builder/package` a PRIVATE row under the org-shared config's key (accepted
 * whenever the org held no row for it — i.e. whenever the key resolved to a `global`/legacy-runtime
 * publication or to nothing yet), and from then on THEIR definition decided both which action ran
 * and — through `declaredOriginsForIntegration` — which hosts the ADMIN's credential could be sent
 * to. Reproduced end to end through the documented wire surfaces: save `{"ok":true,"created":true}`,
 * then `{"success":true}` with the org-admin's live key on the query string of `exfil.example`, on
 * BOTH the action rail and the automation `api_call` rail. The "no item" precondition is ordinary
 * rather than exotic: 5 of the 11 shipped packages declare a BARE templated `baseUrl`
 * (`{{api_base}}`, `{{api_access_point}}`, `{{graph_base_url}}` — zoho-sign, adobe-acrobat-sign,
 * invoicexpress, whatsapp, ifthenpay), which binds to nothing, so `mintOrRefreshCredentialShadow`
 * returns null and there is no item to govern the read.
 *
 * THE RULE: the definition is resolved as the credential's CUSTODIAN, never as the reader.
 *   - No config at all      -> the reader. There is no credential at stake to steal.
 *   - Owner-scoped config   -> its owner, which `findConfigForOwner` already guarantees IS the
 *                              reader. Unchanged behaviour, and the reader's role is preserved
 *                              rather than flattened to `user`.
 *   - Org-shared, stamped   -> `custodianUserId`: the admin whose ceremony produced the bundle.
 *                              A peer therefore runs the definition the CUSTODIAN sees — which
 *                              also repairs org-sharing, since a peer previously got
 *                              `unknown_integration` for an admin-authored private package.
 *   - Org-shared, unstamped -> the ORG tier (`systemActorForOrg`: `org` + `global` + baseline, and
 *                              never any single user's `private` row). The fail-closed direction
 *                              for rows written before the stamp existed; a credential re-save
 *                              restores it.
 *   - Anything incoherent   -> null, i.e. REFUSE. An actor with no org matches every `global` row
 *                              (A2 review F4), so "we could not determine the custodian" must never
 *                              collapse into "resolve as somebody".
 *
 * ROLE IS DELIBERATELY NOT CONSULTED. The obvious alternative — "trust the reader when the reader
 * is an org-admin" — is unimplementable across the rails: the automation `api_call` seam builds its
 * actor with `role: 'user'` hard-coded (`executors/api-call.ts`), so the same config would resolve
 * differently on the two rails and the copy that lies about the role would be the permissive one.
 * This rule reads only server-stamped row state, so both rails give the same answer.
 */
export function definitionActorForCredential(
  reader: Actor,
  config: IntegrationCredentialConfig | null,
): Actor | null {
  if (!reader.orgId) return null; // an org-less reader resolves every `global` row: refuse
  if (!config) return reader;
  if (!config.orgId || config.orgId !== reader.orgId) return null; // never cross a tenant boundary
  const custodian = config.ownerUserId ?? config.custodianUserId;
  if (!custodian) return systemActorForOrg(config.orgId);
  return custodian === reader.userId ? reader : { userId: custodian, orgId: config.orgId, role: 'user' };
}

/**
 * What egress this credential is bound to, as a THREE-WAY answer. Three-way because the two "no
 * origins" outcomes mean opposite things and collapsing them is exactly how `lock = revoke` gets
 * routed around:
 *   - `granted` -> enforce these hosts and only these.
 *   - `refused` -> enforce an EMPTY allow-list, i.e. nothing may be sent. The kill switch, a stale
 *                  or tampered join, an incoherent custodian, or a resolver failure.
 *   - `unbound` -> no item and no declared host: the pre-C2 posture (SSRF guard only). See the
 *                  residual note below.
 */
export type CredentialEgressBinding =
  | { kind: 'granted'; origins: string[] }
  | { kind: 'refused' }
  | { kind: 'unbound' };

/**
 * THE ONE EGRESS-BINDING RULE. Both credential-bearing rails call THIS — the automation `api_call`
 * seam through `egressOriginsForIntegration` below, and the action executor through its own
 * `resolveEgressBinding`. It used to be two copies of the rule in two files, and the copies
 * disagreed in exactly the way that mattered: the executor's fallback resolved the declared hosts
 * as the READER (CRITICAL-1 above). One implementation, two documented projections.
 *
 * Resolution order, and why each branch is what it is:
 *   1. The config holds a Cofre item with a LIVE grant -> the item's own `boundOrigins`. This is
 *      the granted scope, fixed when the human typed the credentials; an action authored afterwards
 *      cannot extend it. For an ORG-SHARED config the item is the admin author's, and the peer gets
 *      the admin's granted scope (see `cofre/integration-items.ts` on why a restriction may cross
 *      the owner boundary when a value may not).
 *   2. The item is joined but LOCKED, or joined and NOT REACHABLE -> `refused`. Lock is the kill
 *      switch. Unreachable-despite-a-join means the item was deleted out from under the config or
 *      the id was tampered with; falling back there would restore the wider list precisely when the
 *      narrower authority has gone missing. Re-saving the config re-mints and unsticks it.
 *   3. No item at all -> the declared-origin derivation, resolved AS THE CUSTODIAN
 *      (`definitionActorForCredential`). Additive for the custodian — an integration that worked
 *      yesterday works today (Rule 7) — and closed for everyone else.
 *
 * THE RESIDUAL, NAMED HONESTLY. Branch 3 is still self-referential: the artifact being authorised
 * (the definition's actions) and the artifact granting the authorisation (its declared hosts) are
 * one file. What changed is WHO writes that file — it is now always a principal who could have
 * connected the credential, never an arbitrary reader — and the `unbound` sub-case (no literal host
 * declared at all) is unchanged from C2. Both close when a templated host can be bound at connect,
 * or at the 2026-08-15 cutover when every config has an item. Failing closed on branch 3 today
 * would take out every org-shared integration in the templated class, the shipped signing rail
 * included; the blast-radius measurement is in docs/decisions.md.
 */
export async function resolveCredentialEgressBinding(
  reader: Actor,
  config: IntegrationCredentialConfig | null,
  integrationKey: string,
  now = Date.now(),
): Promise<CredentialEgressBinding> {
  try {
    if (config?.cofreItemId) {
      const scope = await integrationOriginScope(
        reader,
        config.cofreItemId,
        linkForConfig(config),
        accessForConfig(config, now),
      );
      return scope.kind === 'granted' ? { kind: 'granted', origins: scope.origins } : { kind: 'refused' };
    }
    const definitionActor = definitionActorForCredential(reader, config);
    if (!definitionActor) return { kind: 'refused' };
    const declared = await declaredOriginsForIntegration(definitionActor, integrationKey);
    return declared.length > 0 ? { kind: 'granted', origins: declared } : { kind: 'unbound' };
  } catch (err) {
    // A resolver failure must never silently WIDEN a binding. `refused` (an empty allow-list every
    // consumer treats as "send nothing"), never `unbound`.
    console.warn(`[credential-cofre] egress binding resolution failed for ${integrationKey}: ${errorKind(err)}`);
    return { kind: 'refused' };
  }
}

/**
 * THE ORIGIN-RESOLVER BODY (the `setIntegrationOriginResolver` seam, re-pointed at the Cofre).
 *
 * The api_call rail has NO unbound branch: `assertOriginAllowed` refuses an empty allow-list by
 * construction, so `unbound` and `refused` both come back as `[]` here and the step fails. That is
 * the pre-existing behaviour of this seam, restated rather than changed — the projection is written
 * out so the difference from the executor's rail (which does have an unbound branch) is legible
 * instead of implicit.
 *
 * `findConfigForOwner` is injected rather than imported so this module stays free of an import
 * cycle with `service.ts`, which calls the mint below.
 */
export async function egressOriginsForIntegration(
  actor: Actor,
  integrationKey: string,
  findConfig: (orgId: string, ownerUserId: string, key: string) => Promise<IntegrationCredentialConfig | null>,
  now = Date.now(),
): Promise<string[]> {
  const config = await findConfig(actor.orgId, actor.userId, integrationKey);
  const binding = await resolveCredentialEgressBinding(actor, config, integrationKey, now);
  return binding.kind === 'granted' ? binding.origins : [];
}

// ---------------------------------------------------------------------------
// The shadow write
// ---------------------------------------------------------------------------

/**
 * WHICH WRITE IS ASKING (2026-08-03 review, HIGH-1). The two callers of the shadow write want
 * genuinely different things, and until now they shared one body that did the stronger thing for
 * both:
 *   - `ceremony`  a HUMAN typed the credentials (connect, or a deliberate credential re-save,
 *                 gated by `canWriteConfig`). May MINT — that is the consent ceremony — and
 *                 re-derives the origin binding from the definition the writer sees, because the
 *                 writer IS the custodian this write is establishing.
 *   - `rotation`  a PROVIDER rotated a value mid-request, for whichever owner happened to be
 *                 running (Zoho's grant-code -> refresh_token exchange). May ONLY refresh the value
 *                 of an item that already exists. It never mints, never re-binds the origins and
 *                 never re-grants: custody, egress scope and the lock switch all belong to the
 *                 ceremony, and a rotation is not one.
 */
export type CredentialShadowWrite = 'ceremony' | 'rotation';

/**
 * Mint (or refresh) the Cofre item shadowing this config's credentials. Returns the item id to
 * stamp onto the config row, or null when no item could be written.
 *
 * NULL IS NOT AN ERROR AND IS NOT SWALLOWED SILENTLY: on a `ceremony` it means the integration
 * declares no usable host, so an origin-bound item would be refused at mint (`mintCofreItem` fails
 * a `password`/`api_key` with an empty binding by design — unbound is not unrestricted). Such an
 * integration's credential is equally refused on the api_call rail today, so the shadow simply has
 * nothing to hold; the comparator reports `shadow_absent` and the Rule-10 review sees the count.
 * On a `rotation` it means there was no reachable item to refresh, and the caller must leave the
 * join exactly as it found it.
 *
 * A REFRESH KEEPS THE GRANT STATE (see `updateIntegrationCredentialValue`): rotating credentials
 * must not silently undo a lock the user set.
 *
 * WHY A ROTATION MAY NOT MINT (HIGH-1). The old body's custody guard lived in the CALLER and was
 * shaped `!cofreItemId && ownerUserId == null`, which reads as "an org-shared config with no item".
 * It missed the case where the join names an item that no longer exists: the owner deletes their
 * Cofre item (a supported `DELETE /cofre/items/:id`), `updateIntegrationCredentialValue` answers
 * `stale`, and this function then minted a FRESH, auto-granted `until_locked` item holding the
 * admin's bundle IN THE RUNNING USER'S OWN COFRE and re-stamped the join onto the row. Probed:
 * `custody after stale re-save: u-admin2`. From that moment the new owner reads the value through
 * `resolveEnvInjection` and holds the lock switch over a credential they never typed. The fix is
 * not a wider guard — a guard's shape is the thing that keeps being wrong — it is removing the
 * capability: a rotation has no mint branch to reach.
 */
export async function mintOrRefreshCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
  values: Record<string, unknown>,
  write: CredentialShadowWrite = 'ceremony',
): Promise<string | null> {
  const link = linkForConfig(config);
  try {
    // A ROTATION NEVER RE-BINDS. `rewriteValue` leaves `boundOrigins` untouched for an empty list,
    // so passing one is how "refresh the value, keep the scope the ceremony fixed" is expressed.
    // It also closes the mirror image of CRITICAL-1 on the write side: without it, a rotation
    // triggered by a peer would recompute the binding from the PEER's definition and write the
    // widened list into the custodian's item, through the org-shared rotation path.
    const boundOrigins = write === 'rotation' ? [] : await declaredOriginsForIntegration(actor, config.integrationKey);
    if (config.cofreItemId) {
      const rotation = await updateIntegrationCredentialValue(
        actor,
        config.cofreItemId,
        link,
        values,
        boundOrigins,
        accessForConfig(config),
      );
      if (rotation === 'updated') return config.cofreItemId;
      if (rotation === 'foreign') {
        // The item exists and belongs to ANOTHER user, and this config did not authorise reaching
        // it (it is owner-scoped, or the item is in another org). Minting a replacement would move
        // custody to the writer AND strand the original owner's item, still auto-granted, joined to
        // nothing. Keep the join; the comparator reports `drift` to the owner and
        // `shadow_unreachable` to the writer, which is the honest description of what happened.
        //
        // The ORG-SHARED case no longer arrives here (B2 review H2/C1): two org-admins sharing a
        // config now rotate the SAME item in place — custody is unchanged, which is 46df997's
        // property, but the shadow stays in step instead of drifting permanently from the first
        // rotation onward.
        console.warn(
          `[credential-cofre] WS-C shadow not rotated for ${config.integrationKey}: the joined item belongs to another user and this config does not reach it; the join is left intact`,
        );
        return config.cofreItemId;
      }
      // `stale` — the id names nothing reachable, or one of this actor's own items under a
      // different link. On a CEREMONY a fresh mint orphans nobody and unsticks a config whose item
      // was deleted; on a ROTATION it would MOVE CUSTODY to whoever happened to be running, so the
      // rotation stops here and says so (HIGH-1).
      if (write === 'rotation') {
        console.warn(
          `[credential-cofre] WS-C shadow not refreshed for ${config.integrationKey} (config ${config._id}): the joined item is no longer reachable; a rotation never mints, so it stays shadow_unreachable until the credentials are re-saved`,
        );
        return null;
      }
    }
    if (write === 'rotation') {
      console.warn(
        `[credential-cofre] WS-C shadow absent for ${config.integrationKey} (config ${config._id}): a rotation refreshes a shadow, it does not perform the connect ceremony — no item is minted`,
      );
      return null;
    }
    if (boundOrigins.length === 0) return null;
    const item = await mintIntegrationCredentialItem(actor, {
      link,
      label: config.name ?? config.integrationKey,
      values,
      boundOrigins,
    });
    return item._id;
  } catch (err) {
    console.warn(`[credential-cofre] WS-C shadow mint failed for ${config.integrationKey}: ${errorKind(err)}`);
    return null;
  }
}

/**
 * The CLASS of a failure, never its text (B2 review L2).
 *
 * Both catch blocks around this line sit downstream of a bundle that was in plaintext microseconds
 * earlier: a serialisation error carries the offending value's own `toJSON`/getter message, an
 * envelope error carries whatever the crypto layer or a third-party library put in it. Logging that
 * verbatim puts unbounded, externally-influenced text on a secret-adjacent path — the
 * `secretregistry-serialized-credentials-in-plaintext` class of defect, arrived at from the other
 * end. The constructor name is what actually distinguishes these failures in practice (a
 * `CofreLockedError` from a `CredentialOriginError` from a `TypeError`), and the statuses the
 * comparator reports are the diagnosis surface — not this line.
 */
function errorKind(err: unknown): string {
  if (err instanceof Error) return err.constructor?.name || err.name || 'Error';
  return typeof err;
}

/**
 * What became of a config's shadow item when the config was deleted. NOT a boolean, and not
 * discarded (B2 review H1): the failure mode this path had was SILENT, so the outcome has to be
 * expressible.
 *   - `discarded` the item and every grant on it are gone.
 *   - `absent`    the config carried no join — nothing to destroy.
 *   - `orphaned`  a join existed and the item did not go. It is still out there, still granted, and
 *                 no longer reachable through any config: an operator has to be told.
 *   - `error`     the discard threw. Same consequence as `orphaned`, different cause.
 */
export type CredentialShadowDiscard = 'discarded' | 'absent' | 'orphaned' | 'error';

/** Disconnecting an integration destroys its shadow item and every grant on it. Never throws. */
export async function discardCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
): Promise<CredentialShadowDiscard> {
  if (!config.cofreItemId) return 'absent';
  try {
    const discarded = await discardIntegrationCredentialItem(
      actor,
      config.cofreItemId,
      linkForConfig(config),
      accessForConfig(config),
    );
    if (discarded) return 'discarded';
    // A live, auto-granted, fully extractable credential for an integration the user just removed.
    // Loud by construction: this used to return void and the caller used to discard the boolean, so
    // the exact failure the reviewer reproduced left no trace anywhere.
    console.warn(
      `[credential-cofre] WS-C shadow ORPHANED for ${config.integrationKey} (config ${config._id}): the joined credential item was not reachable and survives the config's deletion, still granted`,
    );
    return 'orphaned';
  } catch (err) {
    console.warn(
      `[credential-cofre] WS-C shadow discard failed for ${config.integrationKey} (config ${config._id}): ${errorKind(err)}; the item may survive the config, still granted`,
    );
    return 'error';
  }
}

// ---------------------------------------------------------------------------
// The comparator
// ---------------------------------------------------------------------------

/**
 * What a cutover-today would do for this config.
 *   - `match`              both stores decrypt to the same bundle under the same policy. Ready.
 *   - `drift`              both readable, values disagree. A write reached one store and not the
 *                          other; the field NAMES are reported so it is diagnosable without a value.
 *   - `legacy_absent`      the config carries no ciphertext — nothing to compare against.
 *   - `shadow_absent`      no item joined (not migrated yet, or the mint had no origin to bind to).
 *   - `shadow_unreachable` an item id is joined but no such item is visible to this reader under
 *                          this link — the org-shared-peer residual, or a tampered/stale id.
 *   - `shadow_locked`      the user revoked the grant. At cutover this read REFUSES, correctly.
 *   - `shadow_refused`     an active grant, but the item's bound origins no longer cover the host
 *                          the definition now declares. The single most useful pre-cutover signal:
 *                          it names the integrations whose authored actions have drifted away from
 *                          the scope the human granted.
 *   - `shadow_error`       anything else (a decrypt/parse failure). Never silent.
 */
export type CredentialShadowStatus =
  | 'match'
  | 'drift'
  | 'legacy_absent'
  | 'shadow_absent'
  | 'shadow_unreachable'
  | 'shadow_locked'
  | 'shadow_refused'
  | 'shadow_error';

/**
 * The comparator's verdict. CARRIES NO CREDENTIAL VALUE and must never be given one: it is logged,
 * and at cutover it is what the review reads. `driftKeys` are CONFIG-FIELD NAMES, which are already
 * public in the definition's `configSchema` (`GET /api/v1/integrations` returns them) — never the
 * values behind them. This is the `secretregistry-serialized-credentials-in-plaintext` class
 * (docs/findings.md): a type that rides on a logged result must be safe to serialise in full.
 */
export interface CredentialShadowReport {
  status: CredentialShadowStatus;
  integrationKey: string;
  configId: string;
  itemId?: string;
  /** Field NAMES whose values differ between the two stores, or exist in only one. Never values. */
  driftKeys?: string[];
}

/** Field names that disagree between the live bundle and the shadow bundle. Names only. */
function driftingKeys(legacy: Record<string, string>, shadow: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(legacy), ...Object.keys(shadow)]);
  return [...keys].filter((k) => legacy[k] !== shadow[k]).sort();
}

/**
 * Read this config's credentials back through the Cofre and compare them with what the live column
 * just produced. NEVER THROWS: a comparator that can break the path it is measuring is worse than
 * no comparator.
 *
 * THE USAGE ORIGIN IS THE DEFINITION'S OWN DECLARED HOST, not one derived from the item, and that
 * choice is what makes the origin ground non-tautological: it asks "would this credential still be
 * allowed to reach the host this integration actually calls today?". When the definition declares no
 * host at all (it was edited after the connect), the item's own first bound origin is used — the
 * origin question is moot there because the api_call rail refuses an empty declared list anyway, and
 * the DATA question is still worth answering.
 */
export async function compareCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
  legacyFields: Record<string, string>,
): Promise<CredentialShadowReport> {
  const base = { integrationKey: config.integrationKey, configId: config._id };
  if (!config.credentialsCiphertext) return { ...base, status: 'legacy_absent' };
  if (!config.cofreItemId) return { ...base, status: 'shadow_absent' };
  const link = linkForConfig(config);
  const itemId = config.cofreItemId;
  try {
    const item = await findIntegrationCredentialItem(actor, itemId, link);
    if (!item) return { ...base, status: 'shadow_unreachable' };
    const declared = await declaredOriginsForIntegration(actor, config.integrationKey);
    const origin = declared[0] ?? item.boundOrigins[0];
    if (!origin) return { ...base, itemId, status: 'shadow_error' };
    const { fields } = await unwrapForIntegration(actor, itemId, link, { kind: 'http', origin });
    const driftKeys = driftingKeys(legacyFields, fields);
    return driftKeys.length > 0
      ? { ...base, itemId, status: 'drift', driftKeys }
      : { ...base, itemId, status: 'match' };
  } catch (err) {
    if (err instanceof CofreLockedError) return { ...base, itemId, status: 'shadow_locked' };
    if (err instanceof CredentialOriginError) return { ...base, itemId, status: 'shadow_refused' };
    return { ...base, itemId, status: 'shadow_error' };
  }
}

/**
 * Log a comparator verdict — ONLY when it changes for that config AND THAT READER.
 *
 * The credential loader runs on every api_call step, so an unconditional line would be a per-minute
 * log flood per integration, which is how a signal becomes noise and then becomes filtered out
 * entirely. A transition IS the event worth reading: "config X went match -> drift" is the Rule-10
 * alarm; "config X is still match" is not.
 *
 * KEYED ON (config, reader), not on the config alone (B2 review M3). One org-shared config has many
 * readers and they legitimately get DIFFERENT verdicts — the admin who owns the item reads `match`,
 * a peer reads `shadow_unreachable`. Under a config-only key those two alternate forever, so every
 * single read was a transition and the de-dup produced exactly the flood it was written to prevent
 * (measured: 6 lines for 12 reads). The reader is part of the verdict, so it is part of the key.
 */
const lastReported = new Map<string, { status?: CredentialShadowStatus; sampledAt?: number }>();
const MAX_TRACKED_READERS = 1000;

/** The de-dup / sampling key: a verdict belongs to a (config, reader) pair, never to a config. */
function shadowKey(configId: string, readerUserId: string): string {
  return `${configId}|${readerUserId}`;
}

function trackerFor(key: string): { status?: CredentialShadowStatus; sampledAt?: number } {
  const existing = lastReported.get(key);
  if (existing) return existing;
  if (lastReported.size >= MAX_TRACKED_READERS) lastReported.clear();
  const fresh = {};
  lastReported.set(key, fresh);
  return fresh;
}

export function reportCredentialShadow(report: CredentialShadowReport, readerUserId = ''): void {
  const tracker = trackerFor(shadowKey(report.configId, readerUserId));
  if (tracker.status === report.status) return;
  tracker.status = report.status;
  if (report.status === 'match') return; // the healthy steady state is not news
  const drift = report.driftKeys?.length ? ` fields=[${report.driftKeys.join(',')}]` : '';
  console.warn(
    `[credential-cofre] WS-C shadow ${report.status} for ${report.integrationKey} (config ${report.configId})${drift}`,
  );
}

/**
 * How often ONE (config, reader) pair is actually measured. See `observeCredentialShadow`.
 */
export const CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS = 60_000;

/**
 * THE COMPARATOR'S ONE ENTRY POINT for a live credential read: measure, report, never throw, and
 * never measure more often than the migration can change (B2 review L1 + M1 + M2).
 *
 * SAMPLED, AND WHY THE SAMPLE IS NOT BIASED. A full comparison costs an item read, a grant list, a
 * tenant definition resolve and a second decrypt — measured at 6.2x the legacy-only read, paid on
 * every api_call step of every run. What it measures, though, is a STEP FUNCTION, not a per-read
 * random variable: a config is `match` until a write lands in one store and not the other, and then
 * it is `drift` until something fixes it. Sampling the first read of each (config, reader) per
 * minute therefore observes every state the unsampled comparator would observe, with a detection
 * latency bounded by the interval — it cannot miss a transition, only date it up to a minute late.
 * A sample that dropped reads at random WOULD be biased (short-lived runs would under-report), which
 * is why this is a time window per pair rather than a probability per read.
 *
 * NEVER THROWS, and it is called OUTSIDE the caller's own `try`. `compareCredentialShadow` already
 * absorbs everything, but the reporting around it did not: while the observer sat inside the live
 * read's `try { … } catch { return null }`, any throw on the measurement path would have been
 * indistinguishable from "this integration is not connected" (B2 review L1).
 *
 * WHICH RAILS ACTUALLY REACH THIS — stated exactly, because B2's own claim ("every real credential
 * read, per api_call step and per listener tick") was wrong in both directions. All three rails are
 * COVERED as of C2 (commit 102f302, journaled in 433aec1), so the 2026-08-15 census is drawn from
 * an unbiased sample:
 *   - the automation `api_call` rail (`loadIntegrationCredentialFields` below, wired into
 *     `setIntegrationCredentialLoader`);
 *   - the served-app Zoho Sign rail (`integrations/zoho-sign.ts`, through its injected
 *     `observeCredentialRead`);
 *   - `integrations/action-executor.ts`, which decrypts the config itself — and which is BOTH the
 *     integration-action route and the listener rail (`event-sources/user-defined-poll.ts` polls
 *     through that executor), so listener ticks are measured too. B2 named this one as NOT COVERED
 *     because the file belonged to another slice at the time; C2 closed it.
 */
export async function observeCredentialShadow(
  actor: Actor,
  config: IntegrationCredentialConfig,
  legacyFields: Record<string, string>,
  now = Date.now(),
): Promise<void> {
  try {
    const tracker = trackerFor(shadowKey(config._id, actor.userId));
    if (tracker.sampledAt !== undefined && now - tracker.sampledAt < CREDENTIAL_SHADOW_SAMPLE_INTERVAL_MS) return;
    tracker.sampledAt = now;
    reportCredentialShadow(await compareCredentialShadow(actor, config, legacyFields), actor.userId);
  } catch {
    // A comparator that can break the path it measures is worse than no comparator. There is
    // nothing useful to log here either: the logging is what would have thrown.
  }
}

export function __resetCredentialShadowReportingForTests(): void {
  lastReported.clear();
}

// ---------------------------------------------------------------------------
// The live credential read
// ---------------------------------------------------------------------------

/** The stores and crypto the live read needs, injected so this body is a testable function rather
 *  than a lambda in the composition root — the A2 review's dead-code class. */
export interface CredentialReadDeps {
  /** users.get(...).orgId. Null when the user has no org: fail closed, never resolve a tenant. */
  resolveOwnerOrgId: (ownerUserId: string) => Promise<string | null>;
  findConfig: (orgId: string, ownerUserId: string, key: string) => Promise<IntegrationCredentialConfig | null>;
  /** The org-bound versioned envelope (K-1); v1 rows read unchanged. */
  decrypt: (ciphertext: string, orgId: string) => Promise<string>;
}

/**
 * THE LIVE CREDENTIAL READ for the automation `api_call` rail (the `setIntegrationCredentialLoader`
 * seam's body). Still the LEGACY column — `credentialsCiphertext` decides what the step
 * interpolates, exactly as before B2 — with the Cofre comparison running beside it.
 *
 * The measurement is OUTSIDE the decrypt's `try`: "the credential did not decrypt" and "the
 * measurement of the credential failed" must never be the same answer to the caller, and while the
 * observer sat inside that block the second silently became "integration not connected" (L1).
 */
export async function loadIntegrationCredentialFields(
  deps: CredentialReadDeps,
  integrationKey: string,
  ownerUserId: string,
): Promise<Record<string, string> | null> {
  const orgId = await deps.resolveOwnerOrgId(ownerUserId);
  if (!orgId) return null;
  const config = await deps.findConfig(orgId, ownerUserId, integrationKey);
  if (!config?.credentialsCiphertext) return null;
  let fields: Record<string, string>;
  try {
    const values = JSON.parse(await deps.decrypt(config.credentialsCiphertext, config.orgId)) as Record<string, unknown>;
    fields = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
  } catch {
    return null;
  }
  await observeCredentialShadow({ userId: ownerUserId, orgId, role: 'user' }, config, fields);
  return fields;
}
