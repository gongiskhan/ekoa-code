/**
 * cofre/integration-items.ts — the INTEGRATION -> COFRE-ITEM join (slice B2, WS-C).
 *
 * WHY THIS LIVES INSIDE `cofre/`. `cofre/store.ts` is lint-fenced (`COFRE_STORE_BAN`): nothing
 * outside this module may reach the raw item/grant handles, precisely so the owner-scoping predicate
 * is written ONCE. A caller in `integrations/` that wanted "the Cofre item holding this config's
 * credentials" would otherwise re-derive both the tenancy filter and the link match — the drift the
 * fence exists to prevent, and the explicit outcome of the CS5 review (which moved two session
 * queries here for the same reason). So the query, the mint and the read all sit on the module's own
 * surface, and `integrations/` consumes them without ever seeing a store handle.
 *
 * WHAT B2 ADDS ON TOP OF `items.ts`:
 *   1. THE JOIN. An integration-minted item carries `integrationLink = {integrationKey, configId}`
 *      and the config row carries `cofreItemId`. Both directions are stamped server-side. Every read
 *      below re-checks the link, so a config row whose `cofreItemId` was tampered with — or an
 *      action authored under integration A naming integration B's item — is refused BEFORE anything
 *      decrypts, on top of (never instead of) the owner-scoping check.
 *   2. THE AUTO-GRANT, and its exact scope. Connecting an integration issues ONE `until_locked`
 *      grant, on the item this call just minted and nothing else (RUN_SPEC assumption 5:
 *      listeners poll with no user present, so typing the credentials at connect IS the consent
 *      ceremony). This mirrors — and is deliberately shaped like — `captureSessionWithGrant`: a
 *      SEPARATE function rather than a flag on `mintCofreItem`, so the plain mint stays
 *      locked-by-default and the security suite keeps testing that a HAND-minted item never
 *      auto-grants. A boolean would have made the dangerous direction one character away from the
 *      safe one.
 *   3. THE GRANTED SCOPE, as a value the egress rail can ask for. `grantedOriginsForIntegration`
 *      answers "which hosts may this integration's credential reach RIGHT NOW", and it answers the
 *      empty list the moment the grant is revoked. That is what makes `lock = revoke` real on the
 *      api_call rail during the WS-C shadow, while the VALUE still comes from the legacy column.
 *
 * NOTHING HERE RETURNS A VALUE EXCEPT `unwrapForIntegration`, and that one routes through
 * `unwrap()` — the single policy seam — so the four fail-closed grounds (tenancy, active grant,
 * origin binding, existence) apply to integration credentials exactly as they do to everything else.
 *
 * ================= ORG-SHARED CONFIG CUSTODY (B2 review, findings C1 + H1) =================
 * An org-shared integration config (`ownerUserId == null`, org-admin-authored) is USED by every
 * member of the org and DELETED by any org-admin, but its Cofre item belongs to the one admin who
 * typed the credentials — items are owner-scoped and a credential is not a document (decisions.md
 * 2026-07-27, sub-decision (a)). B2 shipped with that asymmetry unresolved and it was a hole in both
 * directions: a peer's run fell back to the definition-derived origin list (the author-widenable
 * artifact the slice exists to stop trusting), and a peer-admin's delete left the item alive with its
 * `until_locked` grant intact.
 *
 * The three operations below therefore take an explicit `sharedConfig` flag, and the CALLER — which
 * is the one that knows the config is org-shared and has already established custody of it — must
 * pass it. What the flag widens is deliberately minimal and asymmetric:
 *   - RESTRICTION and DESTRUCTION cross the owner boundary (which hosts the credential may reach,
 *     whether a grant is live, and destroying the item with the config). None of these disclose a
 *     value, and every one of them makes the peer's position STRICTER, never looser.
 *   - DISCLOSURE does not. `unwrapForIntegration` stays owner-scoped with no flag at all, so the
 *     2026-07-27 invariant stands where it was written: a peer still cannot read the admin's
 *     credential, and the 2026-08-15 review still owns the question of whether the VALUE should
 *     become org-reachable.
 * The reach is bounded by the SERVER-STAMPED join, not by an id a caller chose: the item must carry
 * `integrationLink == {integrationKey, configId}` of the very config the caller holds, and be in the
 * caller's org. There is no id a client can supply that reaches an item joined to a config it does
 * not already hold, so this is not an existence oracle and cannot be pointed at a personal item
 * (a hand-minted item has no link at all — the wire schema cannot express one).
 */
import type { Actor } from '@ekoa/shared';
import { envelopeEncrypt } from '../data/crypto.js';
import { cofreItems, cofreGrants } from './store.js';
import { issueGrant, mintCofreItem, purgeCofreItem, type CofreDeps } from './items.js';
import { notifyCredentialEstablished } from './notify.js';
import {
  isGrantActive,
  unwrapResolved,
  CofreNotFoundError,
  type UnwrapOptions,
  type UsageContext,
} from './service.js';
import type { CofreItemDoc, CofreGrantDoc, IntegrationItemLink } from './types.js';

/** The credential bundle an integration config holds: its config-field map, values as strings. */
export type IntegrationCredentialFields = Record<string, string>;

export interface MintIntegrationCredentialInput {
  link: IntegrationItemLink;
  /** What the user sees in the Cofre list — the integration's own name, never a value. */
  label: string;
  /** The whole config-values bundle. Serialised and encrypted here; never stored in plaintext. */
  values: Record<string, unknown>;
  /** Hosts this credential may reach (I6). Non-empty is enforced by `mintCofreItem`. */
  boundOrigins: string[];
}

/**
 * The item type an integration credential bundle is stored as.
 *
 * `api_key` rather than a new enum member: the bundle IS an API credential for a third-party
 * service, it is origin-bound exactly like one (`ORIGIN_BOUND_TYPES` in items.ts covers it, so an
 * unbound mint fails at creation), and adding a member to the closed `CofreItemType` enum would push
 * a wire-visible vocabulary change onto every client that renders the item list for a shadow that
 * has not cut over yet. When WS-C cuts over and the legacy column is removed, the type can be
 * revisited as one deliberate contract change instead of two.
 */
const INTEGRATION_ITEM_TYPE = 'api_key' as const;

/** Serialise a credential bundle exactly as the legacy `credentialsCiphertext` column does, so the
 *  Rule-10 comparator is comparing like with like rather than two encodings of the same map. */
function serialiseBundle(values: Record<string, unknown>): string {
  return JSON.stringify(values);
}

/** Parse a stored bundle back into the field map the api_call template interpolation consumes —
 *  the SAME `String(v)` projection the legacy loader applies, for the same reason. */
export function fieldsFromBundle(plaintext: string): IntegrationCredentialFields {
  const parsed = JSON.parse(plaintext) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
}

/** True when `item` is the integration item for `link`. Both halves must agree: an item minted for
 *  another integration, or for another config of the same integration, is NOT this credential. */
function linkMatches(item: CofreItemDoc, link: IntegrationItemLink): boolean {
  const l = item.integrationLink;
  return l != null && l.integrationKey === link.integrationKey && l.configId === link.configId;
}

/**
 * How far a caller's authority over the joined item reaches. `sharedConfig` is TRUE only when the
 * config this link names is org-shared (`ownerUserId == null`) — see the module docblock for what
 * that widens (restriction and destruction) and what it deliberately does not (disclosure).
 */
export interface IntegrationItemAccess {
  sharedConfig?: boolean;
  now?: number;
}

/**
 * The item joined to `link`, resolved for this actor. Owner-scoped first, ALWAYS: an actor who owns
 * the item takes the same path they always did. Only when that misses AND the caller declared an
 * org-shared config does it fall through to the org-scoped read — and even then the link and the org
 * must both agree, so the widening reaches exactly one row: the credential item of the very config
 * the caller is holding.
 */
async function resolveJoinedItem(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  access: IntegrationItemAccess,
): Promise<CofreItemDoc | null> {
  const own = await cofreItems.getVisible(actor, itemId);
  if (own) return linkMatches(own, link) ? own : null;
  if (!access.sharedConfig) return null;
  const shared = await cofreItems.raw.get(itemId);
  if (!shared || shared.orgId !== actor.orgId) return null;
  return linkMatches(shared, link) ? shared : null;
}

/** Grants on an item, read for its OWNER. The lock a peer must respect on an org-shared config is
 *  the owner's lock — grants are owner-scoped rows, so `listVisible(peer)` would answer the empty
 *  list and a peer would read "locked" for a perfectly live credential. */
async function grantsOnItem(item: CofreItemDoc): Promise<CofreGrantDoc[]> {
  const rows = await cofreGrants.raw.find({ itemId: item._id, orgId: item.orgId });
  return rows.filter((g) => g.userId === item.userId);
}

/**
 * Mint the integration's credential item AND arm it for use, in one step (the connect ceremony).
 *
 * The grant is `until_locked` — the narrowest scope the model has that survives the connect that
 * made it. `this_run` would expire before the first listener tick (which runs with no user present)
 * and a TTL would pick an arbitrary clock, so both would reinstate exactly the "the automation asks
 * a human who is not there" failure the ceremony exists to avoid. Lock-now / lock-all remain the
 * kill switch, unchanged.
 *
 * ONE grant, on ONE item: `issueGrant` is called with the id this function just minted, so the
 * ceremony can never widen to another item the user happens to own.
 */
export async function mintIntegrationCredentialItem(
  actor: Actor,
  input: MintIntegrationCredentialInput,
  deps: CofreDeps = {},
): Promise<CofreItemDoc> {
  const item = await mintCofreItem(
    actor,
    {
      type: INTEGRATION_ITEM_TYPE,
      label: input.label,
      value: serialiseBundle(input.values),
      boundOrigins: input.boundOrigins,
      integrationLink: input.link,
    },
    deps,
  );
  await issueGrant(actor, item._id, 'until_locked', {}, deps);
  // NO `notifyCredentialEstablished` here on purpose (P3.1): both calls above already announce it,
  // and a third announcement for one act would re-dispatch a waiting run twice for nothing. The
  // same is true of `captureSessionToCofre` / `captureSessionWithGrant` (`sessions.ts`) and of
  // `ensureSession`'s success path, which reaches the Cofre through exactly these two functions.
  return item;
}

/**
 * The outcome of a rotation attempt. Three-way, and the third value is the whole reason:
 *   - `updated`  the item was re-encrypted in place.
 *   - `stale`    no item of that id is REACHABLE to anyone (deleted), or it is this actor's own
 *                item under a different link (a wrong id on the config row). Minting a replacement
 *                is correct: it orphans nothing and it unsticks a user who deleted their own item
 *                from the Cofre and then re-typed their credentials.
 *   - `foreign`  an item of that id EXISTS but belongs to someone else. Minting a replacement here
 *                would silently re-point the config's custody at the new writer AND strand the
 *                original owner's item, still auto-granted and still bound, joined to nothing —
 *                exactly the orphan standing unlock `discardIntegrationCredentialItem` exists to
 *                prevent, one door over. Reachable in the ordinary org-shared case: two org-admins
 *                share a config and the second rotates its credentials. The caller keeps the
 *                existing join and the comparator reports the divergence instead.
 */
export type CredentialRotation = 'updated' | 'stale' | 'foreign';

/**
 * Re-encrypt an existing integration item with rotated credential values (and refresh its origin
 * binding), WITHOUT touching its grants.
 *
 * DELIBERATELY NOT A RE-MINT. Re-minting would issue a fresh `until_locked` grant, which means a
 * user who LOCKED this credential would find it silently unlocked again by an unrelated "update my
 * password" action. Lock is the user's kill switch; nothing but an explicit unlock may undo it. The
 * consequence is stated plainly rather than hidden: rotating the credentials of a locked integration
 * leaves it locked, and the Cofre UI is where it is unlocked again.
 *
 * The `foreign` verdict needs a RAW existence read, which is legitimate only inside this module (the
 * `COFRE_STORE_BAN` fence). It is not an existence oracle: nothing outside gets to ask "does item X
 * exist" — the answer only ever decides whether the CALLER mints a replacement for its own config,
 * and the returned verdict is not derived from any id the caller chose freely (the id comes off a
 * server-stamped join).
 */
export async function updateIntegrationCredentialValue(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  values: Record<string, unknown>,
  boundOrigins: string[],
  access: IntegrationItemAccess = {},
): Promise<CredentialRotation> {
  const own = await cofreItems.getVisible(actor, itemId);
  if (own) {
    if (!linkMatches(own, link)) return 'stale';
    return rewriteValue(own, values, boundOrigins, access.now ?? Date.now());
  }
  const raw = await cofreItems.raw.get(itemId);
  if (!raw) return 'stale';
  // ORG-SHARED ROTATION (B2 review H2). The provider rotated a credential (Zoho's grant-code →
  // refresh_token exchange) on a config whose item belongs to the admin who connected it. Writing
  // the new bundle into that item is the only way the shadow stays in step; `foreign` here would
  // mean permanent `drift` and, at cutover, a fresh refresh_token replaced by a burnt one. It is a
  // WRITE of the credential the caller already holds in plaintext — it discloses nothing.
  if (access.sharedConfig && raw.orgId === actor.orgId && linkMatches(raw, link)) {
    return rewriteValue(raw, values, boundOrigins, access.now ?? Date.now());
  }
  return 'foreign';
}

/** Re-encrypt a RESOLVED item in place. Grants are untouched by construction: this function cannot
 *  see them, which is what makes "a rotation never re-grants" a property rather than a promise. */
async function rewriteValue(
  item: CofreItemDoc,
  values: Record<string, unknown>,
  boundOrigins: string[],
  now: number,
): Promise<CredentialRotation> {
  const valueCiphertext = await envelopeEncrypt(serialiseBundle(values), item.orgId);
  await cofreItems.raw.update(item._id, (cur) => ({
    ...(cur as CofreItemDoc),
    valueCiphertext,
    ...(boundOrigins.length > 0 ? { boundOrigins } : {}),
    updatedAt: new Date(now).toISOString(),
  }));
  // THE ONE PATH MINT/GRANT DO NOT COVER (P3.1). A rotation re-encrypts in place: no mint, no
  // grant, so neither of the two hooks in `items.ts` fires - yet from a waiting run's point of view
  // a working credential just appeared where a broken one was. Announced with the item's OWN owner
  // and org, not the caller's: an org-shared rotation is written by a peer into the connecting
  // admin's item, and the waiter that can use it is the item owner's.
  notifyCredentialEstablished({
    orgId: item.orgId,
    userId: item.userId,
    boundOrigins: boundOrigins.length > 0 ? boundOrigins : item.boundOrigins,
  });
  return 'updated';
}

/**
 * The actor's integration item for `link`, or null. Owner-scoped through the repository (a foreign
 * item reads as absent, never as forbidden) and link-checked, so the id alone is not authority.
 */
export async function findIntegrationCredentialItem(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
): Promise<CofreItemDoc | null> {
  const item = await cofreItems.getVisible(actor, itemId);
  return item && linkMatches(item, link) ? item : null;
}

/**
 * What egress this integration's credential is granted RIGHT NOW, as a three-way answer.
 *
 * THREE-WAY, not "a list of origins", because the two empty cases mean opposite things to the
 * caller and collapsing them was the trap:
 *   - `granted`     -> these hosts, and only these. The GRANTED scope.
 *   - `locked`      -> the item is this actor's, but no grant is active. The user pulled the kill
 *                      switch, so the answer is REFUSE — never "fall back to something weaker".
 *                      This is what makes `lock = revoke` load-bearing during the WS-C shadow: the
 *                      legacy column still supplies the value, but the bytes have nowhere to go.
 *   - `unreachable` -> no item of this link is reachable by this actor at all. NOT a refusal on its
 *                      own: during the shadow most configs have no item yet, and the CALLER decides
 *                      what that means (`egressOriginsForIntegration` refuses when a join exists and
 *                      falls back to the declared list only when there is none). Conflating this
 *                      with `locked` would have broken every not-yet-migrated integration on the day
 *                      this landed.
 *
 * WITH `sharedConfig` the answer is the OWNER's, for the whole org: an org-shared config's peers get
 * the hosts the admin bound at connect and are refused the moment the admin locks it (B2 review C1).
 * The peer previously fell through to the definition-derived list, which is the author-widenable
 * artifact this slice exists to stop trusting — so for that class the slice's acceptance criterion
 * was not met at all until this flag existed.
 */
export type IntegrationOriginScope =
  | { kind: 'granted'; origins: string[] }
  | { kind: 'locked' }
  | { kind: 'unreachable' };

export async function integrationOriginScope(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  access: IntegrationItemAccess = {},
): Promise<IntegrationOriginScope> {
  const item = await resolveJoinedItem(actor, itemId, link, access);
  if (!item) return { kind: 'unreachable' };
  const grants = await grantsOnItem(item);
  if (!grants.some((g) => isGrantActive(g, { now: access.now ?? Date.now() }))) return { kind: 'locked' };
  return { kind: 'granted', origins: [...item.boundOrigins] };
}

/**
 * THE INTEGRATION CREDENTIAL READ (WS-C). The one function that turns an integration config's Cofre
 * reference into its credential fields.
 *
 * It adds ONE check to `unwrap()` and delegates the rest: the requested `link` must match the item's
 * own stamped provenance. That is the "cannot name a secret outside the integration's granted scope"
 * half of the B2 acceptance criterion — an id is not authority, the item has to agree that it
 * belongs to the integration and config being read for. The other four grounds (tenancy, an active
 * grant, origin binding, existence) are `unwrap()`'s, unchanged and not re-implemented here: this
 * seam must never become a second place where a credential can be decrypted.
 *
 * The link check runs FIRST and answers the same uniform `CofreNotFoundError` an unknown id gets, so
 * probing another integration's item is not an existence oracle.
 *
 * The returned fields are RAM-only for the use window. They are deliberately a plain field map — the
 * same shape the credential seam already carries — so this introduces no new secret-bearing object
 * that could be logged or serialised (the `SecretRegistry` class of defect); nothing in this module
 * stores, returns or logs the map, and the Rule-10 comparator that consumes it reports field NAMES
 * and statuses only.
 */
export async function unwrapForIntegration(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  usage: UsageContext,
  opts: UnwrapOptions = {},
): Promise<{ itemId: string; fields: IntegrationCredentialFields }> {
  // OWNER-SCOPED, WITH NO `sharedConfig` ESCAPE. This is the DISCLOSURE half, and the module
  // docblock's asymmetry is enforced right here: a peer of an org-shared config may be restricted
  // by the admin's item and may destroy it with the config, but may not read it.
  const item = await cofreItems.getVisible(actor, itemId);
  if (!item || !linkMatches(item, link)) throw new CofreNotFoundError();
  // `unwrapResolved` continues `unwrap()` at ground 2 on the row ground 1 just produced, rather
  // than re-fetching it: same policy body, one read instead of two (B2 review L4).
  const unwrapped = await unwrapResolved(item, actor, usage, opts);
  return { itemId: unwrapped.itemId, fields: fieldsFromBundle(unwrapped.value) };
}

/**
 * Disconnecting an integration destroys its credential item and every grant on it.
 *
 * `purgeCofreItem` removes the grants first, so there is no window in which a live grant outlives
 * the item it opens, and no orphan standing unlock is left behind for a credential the user believes
 * they removed. Returns false when the item is not reachable under this link.
 *
 * WITH `sharedConfig` it destroys the item even when another org member owns it (B2 review H1).
 * Before that flag, admin B deleting admin A's org-shared config left A's item alive, still
 * `until_locked`-granted, still bound, and joined to a config row that no longer exists — reachable
 * by item id through `resolveEnvInjection` (`{kind:'process'}` needs no origin) and listed in A's own
 * Cofre. That is verbatim the "standing unlock for a credential the user believes they removed"
 * this function's comment already claimed to prevent. The authority is the caller's: `deleteConfig`
 * has already run `canWriteConfig`, which is what makes an org-admin allowed to delete this config
 * at all, and destroying its credential is strictly narrower than deleting the config itself.
 */
export async function discardIntegrationCredentialItem(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  access: IntegrationItemAccess = {},
): Promise<boolean> {
  const item = await resolveJoinedItem(actor, itemId, link, access);
  if (!item) return false;
  await purgeCofreItem(item);
  return true;
}
