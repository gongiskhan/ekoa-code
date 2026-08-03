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
 */
import type { Actor } from '@ekoa/shared';
import { envelopeEncrypt } from '../data/crypto.js';
import { cofreItems, cofreGrants } from './store.js';
import { issueGrant, mintCofreItem, deleteCofreItem, type CofreDeps } from './items.js';
import { isGrantActive, unwrap, CofreNotFoundError, type UnwrapOptions, type UsageContext } from './service.js';
import type { CofreItemDoc, IntegrationItemLink } from './types.js';

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
  return item;
}

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
 * Returns false (uniform not-found) when the item is not the actor's or its link disagrees.
 */
export async function updateIntegrationCredentialValue(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  values: Record<string, unknown>,
  boundOrigins: string[],
  now = Date.now(),
): Promise<boolean> {
  const item = await cofreItems.getVisible(actor, itemId);
  if (!item || !linkMatches(item, link)) return false;
  const valueCiphertext = await envelopeEncrypt(serialiseBundle(values), item.orgId);
  await cofreItems.raw.update(itemId, (cur) => ({
    ...(cur as CofreItemDoc),
    valueCiphertext,
    ...(boundOrigins.length > 0 ? { boundOrigins } : {}),
    updatedAt: new Date(now).toISOString(),
  }));
  return true;
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
 *   - `unreachable` -> no item of this link is visible to this actor at all. NOT a refusal: during
 *                      the shadow, most configs have no item yet, and an ORG-SHARED config's item
 *                      belongs to the admin who typed it (Cofre items are owner-scoped, decisions.md
 *                      2026-07-27) — so a same-org peer legitimately sees nothing here and the
 *                      caller keeps the pre-WS-C binding. Conflating this with `locked` would have
 *                      broken every not-yet-migrated integration on the day this landed.
 */
export type IntegrationOriginScope =
  | { kind: 'granted'; origins: string[] }
  | { kind: 'locked' }
  | { kind: 'unreachable' };

export async function integrationOriginScope(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
  now = Date.now(),
): Promise<IntegrationOriginScope> {
  const item = await findIntegrationCredentialItem(actor, itemId, link);
  if (!item) return { kind: 'unreachable' };
  const grants = await cofreGrants.listVisible(actor, { itemId });
  if (!grants.some((g) => isGrantActive(g, { now }))) return { kind: 'locked' };
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
  const item = await cofreItems.getVisible(actor, itemId);
  if (!item || !linkMatches(item, link)) throw new CofreNotFoundError();
  const unwrapped = await unwrap(itemId, actor, usage, opts);
  return { itemId: unwrapped.itemId, fields: fieldsFromBundle(unwrapped.value) };
}

/**
 * Disconnecting an integration destroys its credential item and every grant on it.
 *
 * `deleteCofreItem` removes the grants first, so there is no window in which a live grant outlives
 * the item it opens, and no orphan standing unlock is left behind for a credential the user believes
 * they removed. Returns false when the item is not the actor's or the link disagrees.
 */
export async function discardIntegrationCredentialItem(
  actor: Actor,
  itemId: string,
  link: IntegrationItemLink,
): Promise<boolean> {
  const item = await findIntegrationCredentialItem(actor, itemId, link);
  if (!item) return false;
  return deleteCofreItem(actor, itemId);
}
