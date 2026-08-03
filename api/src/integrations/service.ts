/**
 * Integrations service (ch03 §3.8.13). Org-scoped integration configs with credentials
 * encrypted at rest (ch09; the one crypto module). Credentials are NEVER returned to any
 * client — the summary omits them. `ownerUserId` undefined means org-scoped/org-admin-authored
 * (shared to the org); else owner-only (Amendment 2 Part 4).
 */
import { integrationConfigs } from '../data/stores.js';
import { envelopeEncrypt } from '../data/crypto.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';
import {
  mintOrRefreshCredentialShadow,
  discardCredentialShadow,
  type CredentialShadowWrite,
} from './credential-cofre.js';

export interface IntegrationConfigDoc extends Doc {
  orgId: string;
  ownerUserId?: string;
  integrationKey: string;
  name?: string;
  enabled: boolean;
  credentialsCiphertext?: string; // never returned
  /**
   * WS-C join (slice B2): the Cofre item shadowing this row's credentials. Stamped server-side by
   * `mintOrRefreshCredentialShadow`, never accepted from a request body. Absent means "not migrated"
   * — the pre-WS-C behaviour, unchanged (Rule 7 additive). The 2026-08-15 Rule-10 review either
   * makes this the only credential home and drops `credentialsCiphertext`, or removes both it and
   * the join (docs/decisions.md).
   */
  cofreItemId?: string;
  /**
   * THE CREDENTIAL'S CUSTODIAN — the user whose credential-typing ceremony produced the bundle this
   * row currently holds. Server-stamped from the verified actor by `createConfig` and by a
   * credential-bearing `updateConfig` (both of which `canWriteConfig` already gates), NEVER read
   * from a request body, and NEVER moved by `persistRotatedCredentials`.
   *
   * It exists because `ownerUserId` cannot answer "whose authority governs this credential" for an
   * ORG-SHARED row — it is undefined there by definition — and something has to, since the
   * definition that decides which hosts the credential may reach is resolved AS a principal. See
   * `credential-cofre.ts: definitionActorForCredential` for the full reasoning and the exfiltration
   * it closes. Deliberately NOT on `configSummary`: it is an internal custody fact, not client data.
   */
  custodianUserId?: string;
  needsReauth?: boolean;
  // --- Platform-integration (managed OAuth) rows only (G8, ch03 §3.8.15). Set on the
  //     org-scoped workspace-connection rows written by integrations/platform-oauth.ts;
  //     undefined on ordinary user-defined integration configs. ---
  /** google | microsoft — marks this row as a managed platform OAuth connection. */
  platformProvider?: 'google' | 'microsoft';
  /** Pending OAuth CSRF state (high-entropy nonce); cleared once the callback completes. */
  oauthState?: string;
  /** Epoch-ms expiry of `oauthState`; a callback presenting an expired/absent state is refused. */
  oauthStateExpiresAt?: number;
  /** Connected account email (from the provider userinfo call); shown in status/list. */
  email?: string;
}

/** Reserved integrationKey of the single org-scoped Pipedream Connect config row
 *  (ch03 §3.8.16). Kept out of the user-defined config surface (see `listConfigs`). */
export const PIPEDREAM_INTEGRATION_KEY = 'pipedream';

/** True when a row is a G8-owned platform/pipedream row, not a user-defined integration
 *  config. Such rows carry their own resource surfaces (§3.8.15/§3.8.16) and must not leak
 *  into the user-defined integrations config list. */
export function isReservedIntegrationRow(c: IntegrationConfigDoc): boolean {
  return c.platformProvider != null || c.integrationKey === PIPEDREAM_INTEGRATION_KEY;
}

export interface Deps { now: () => number; genId: () => string }

/** Client-safe summary — NEVER includes credentials/sessionState (ch03 §3.8.13). */
export function configSummary(c: IntegrationConfigDoc) {
  return { id: c._id, integrationKey: c.integrationKey, name: c.name, enabled: c.enabled, needsReauth: c.needsReauth ?? false, ownerUserId: c.ownerUserId };
}

/** List configs visible to the actor: org-shared (ownerUserId undefined) + own. Platform
 *  and Pipedream rows (G8) are excluded — they are separate resources (§3.8.15/§3.8.16) and
 *  must not surface in the user-defined integrations config list. */
export async function listConfigs(actor: Actor): Promise<IntegrationConfigDoc[]> {
  const inOrg = await integrationConfigs.find({ orgId: actor.orgId });
  return (inOrg as IntegrationConfigDoc[]).filter(
    (c) => (c.ownerUserId == null || c.ownerUserId === actor.userId) && !isReservedIntegrationRow(c),
  );
}

/** Resolve the credential config an owner may USE for an integration action: the owner's own
 *  row wins, else the org-shared (ownerUserId undefined) row. Org-scoped; returns null when the
 *  integration is not connected for this owner. Used by the user-defined action executor (G8).
 *  A bare (orgId, ownerUserId) is taken because the automation engine calls with a run owner,
 *  not a role-bearing actor. */
export async function findConfigForOwner(orgId: string, ownerUserId: string, integrationKey: string): Promise<IntegrationConfigDoc | null> {
  const rows = (await integrationConfigs.find({ orgId, integrationKey })) as IntegrationConfigDoc[];
  return rows.find((c) => c.ownerUserId === ownerUserId) ?? rows.find((c) => c.ownerUserId == null) ?? null;
}

export async function createConfig(actor: Actor, input: { integrationKey: string; configValues: Record<string, unknown>; name?: string }, deps: Deps): Promise<IntegrationConfigDoc> {
  const id = deps.genId();
  const doc: IntegrationConfigDoc = {
    _id: id,
    orgId: actor.orgId,
    ownerUserId: actor.role === 'org-admin' ? undefined : actor.userId, // org-admin authors org-shared
    // The ceremony's custodian, stamped from the VERIFIED actor. For an owner-scoped row this is
    // the same person as `ownerUserId`; for an org-shared row it is the only record of who typed
    // the credentials, and therefore of whose definition may govern them.
    custodianUserId: actor.userId,
    integrationKey: input.integrationKey,
    name: input.name ?? input.integrationKey,
    enabled: true,
    // Cofre B-4: the ORG-BOUND versioned envelope (K-1), not the flat global key. Previously this
    // used the UNSCOPED `encrypt()`, so an integration's ciphertext was not even org-bound — a row
    // copied between tenants decrypted fine. v1 rows still read, so this needed no flag day.
    credentialsCiphertext: await envelopeEncrypt(JSON.stringify(input.configValues), actor.orgId),
  };
  await integrationConfigs.insert(doc as never);
  // WS-C SHADOW + THE CONSENT CEREMONY (B2). Typing the credentials IS the consent, so the mint
  // auto-issues ONE `until_locked` grant on the item it just created (RUN_SPEC assumption 5:
  // listeners poll with no user present, and a per-run interactive grant would ask a human who is
  // not there). The row is inserted FIRST because the item's link names its config id; a failed
  // mint leaves an unshadowed config, which is exactly the pre-B2 state and is reported as
  // `shadow_absent` at every read rather than breaking the connect.
  const cofreItemId = await shadowCredentials(actor, doc, input.configValues);
  if (cofreItemId) {
    doc.cofreItemId = cofreItemId;
    await integrationConfigs.update(id, (cur) => ({ ...cur, cofreItemId }));
  }
  return doc;
}

/**
 * Run the WS-C shadow for a row, unless it is one of the RESERVED rows.
 *
 * Platform-OAuth and Pipedream rows are out of WS-C scope (RUN_SPEC assumption 4): they carry their
 * own rotation machinery — refresh-token exchanges that rewrite the ciphertext behind this module's
 * back — so an item minted here would drift on the first refresh and mean nothing. Only the crypto
 * split was fixed for them (slice B1). The predicate lives HERE, at the call site, because this
 * module already owns it; `credential-cofre.ts` stays agnostic rather than growing a second copy.
 */
async function shadowCredentials(
  actor: Actor,
  doc: IntegrationConfigDoc,
  values: Record<string, unknown>,
  write: CredentialShadowWrite = 'ceremony',
): Promise<string | null> {
  if (isReservedIntegrationRow(doc)) return null;
  return mintOrRefreshCredentialShadow(actor, doc, values, write);
}

/** Get a config the actor may READ (own org + visible), else null → uniform 404. */
export async function getVisibleConfig(actor: Actor, id: string): Promise<IntegrationConfigDoc | null> {
  const c = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (!c || c.orgId !== actor.orgId) return null;
  if (c.ownerUserId != null && c.ownerUserId !== actor.userId) return null;
  return c;
}

/** May the actor WRITE (update/delete) this config? An org-shared (ownerUserId undefined)
 *  config is org-admin-authored and writable ONLY by an org-admin (or super-admin); an
 *  owner-scoped config is writable only by its owner. A same-org builder can USE a shared
 *  config but must not overwrite/delete it (ch03 §3.8.13, Amendment 2 Part 4). */
export function canWriteConfig(actor: Actor, c: IntegrationConfigDoc): boolean {
  if (c.orgId !== actor.orgId) return false;
  if (c.ownerUserId == null) return actor.role === "org-admin" || actor.role === "super-admin";
  return c.ownerUserId === actor.userId;
}

export type WriteVerdict = 'ok' | 'notfound' | 'forbidden';

export async function updateConfig(actor: Actor, id: string, patch: { enabled?: boolean; configValues?: Record<string, unknown> }): Promise<{ verdict: WriteVerdict; config?: IntegrationConfigDoc }> {
  const c = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (!c || c.orgId !== actor.orgId) return { verdict: 'notfound' };
  if (!canWriteConfig(actor, c)) return { verdict: 'forbidden' };
  // Encrypt BEFORE the update callback: `update` takes a synchronous mutator, and the envelope is
  // async because the key wrapper may be a remote KMS call.
  const nextCiphertext = patch.configValues
    ? await envelopeEncrypt(JSON.stringify(patch.configValues), actor.orgId)
    : undefined;
  // WS-C shadow, kept in step with the live column. A REFRESH never re-grants (see
  // `updateIntegrationCredentialValue`): rotating the credentials of a LOCKED integration leaves it
  // locked, because undoing the user's kill switch as a side effect of an unrelated edit would make
  // the lock advisory. Only a first mint carries the connect ceremony's auto-grant.
  const cofreItemId = patch.configValues ? await shadowCredentials(actor, c, patch.configValues) : undefined;
  const config = (await integrationConfigs.update(id, (cur) => ({
    ...cur,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(nextCiphertext ? { credentialsCiphertext: nextCiphertext } : {}),
    // CUSTODY FOLLOWS THE CEREMONY, and only the ceremony. A credential re-save IS the ceremony
    // repeated — `canWriteConfig` above already restricts an org-shared row's re-save to an
    // org-admin, and `mintOrRefreshCredentialShadow` already mints under this writer — so the
    // custodian stamp moves with it. Toggling `enabled` is not a ceremony and leaves it alone.
    ...(patch.configValues ? { custodianUserId: actor.userId } : {}),
    ...(cofreItemId ? { cofreItemId } : {}),
  }))) as IntegrationConfigDoc;
  return { verdict: 'ok', config };
}

/** What a provider-driven rotation did. `legacy_failed` means the rotated credential was NOT saved
 *  at all, which for a one-time grant-code exchange is unrecoverable and must not be silent. */
export type RotationOutcome = 'updated' | 'notfound' | 'legacy_failed';

/**
 * PERSIST A PROVIDER-ROTATED CREDENTIAL (both stores).
 *
 * A rotation is not a user edit: an OAuth refresh (Zoho's grant-code → refresh_token exchange)
 * arrives mid-request, on behalf of the provider, for whichever owner is running. So it is
 * deliberately NOT routed through `updateConfig` — that path enforces `canWriteConfig`, which would
 * refuse a non-admin peer running against an org-shared config and silently drop a grant code that
 * is already burnt.
 *
 * WHAT THIS FIXES (B2 review H2). The served-app Zoho backend's persistence lambda in `server.ts`
 * wrote `credentialsCiphertext` directly and nothing else, bypassing the WS-C shadow entirely.
 * Zoho-shaped rows are NOT in RUN_SPEC assumption 4's carve-out (`isReservedIntegrationRow` covers
 * only platform-OAuth and pipedream), so a shadowed row went to permanent `drift` from its first
 * rotation, and a 2026-08-15 cutover would have replaced a fresh `refresh_token` with the
 * connect-time one. Both writes happen here now.
 *
 * ORDER: the legacy column FIRST. It is still the live read, so a shadow failure must never be able
 * to lose a rotated credential; a legacy failure short-circuits before the shadow, keeping the two
 * from diverging in the one direction that matters.
 *
 * ONE IMPLEMENTATION, FULL STOP. `integrations/action-executor.ts` briefly grew a sibling body for
 * the same job on the action rail while B2's review was in flight; C2 deleted it and adopted this
 * function (commit 102f302, journaled in 54e9131). There is no second rotation-persistence path.
 *
 * IT NEVER MOVES CUSTODY (2026-08-03 review, HIGH-1). The old guard here — `!target.cofreItemId &&
 * target.ownerUserId == null` — described one shape of the problem rather than the rule, and missed
 * the STALE JOIN: with `cofreItemId` set but the item deleted, the shadow write minted a fresh,
 * auto-granted item holding the admin's bundle in the RUNNING user's Cofre and re-stamped the join
 * (probed: `custody after stale re-save: u-admin2`). The guard is gone; the capability is gone
 * instead. `write: 'rotation'` has no mint branch, does not touch `boundOrigins`, does not re-grant
 * and does not re-stamp `custodianUserId` — a rotation refreshes a value and nothing else.
 */
export async function persistRotatedCredentials(
  configId: string,
  ownerUserId: string,
  currentFields: Record<string, unknown>,
  updates: Record<string, string>,
): Promise<RotationOutcome> {
  const target = (await integrationConfigs.get(configId)) as IntegrationConfigDoc | null;
  if (!target) return 'notfound';
  const merged: Record<string, unknown> = { ...currentFields, ...updates };
  // A captured browser session is never folded into the credentials bundle.
  delete merged.storageState;
  try {
    // Rotation must re-encrypt under the SAME org-bound envelope the reader uses; the config's own
    // org scopes the DEK, so a rotated row stays readable and never downgrades to a flat v1 blob.
    const ciphertext = await envelopeEncrypt(JSON.stringify(merged), target.orgId);
    await integrationConfigs.update(configId, (cur) => ({ ...cur, credentialsCiphertext: ciphertext }));
  } catch (err) {
    console.warn(
      `[integrations] failed to persist rotated credentials for ${target.integrationKey} (config ${configId}): ${err instanceof Error ? (err.constructor?.name ?? 'Error') : typeof err}`,
    );
    return 'legacy_failed';
  }
  // A ROTATION REFRESHES A SHADOW; IT DOES NOT PERFORM THE CONNECT CEREMONY. The rotating user is
  // whoever happened to be running — typically not the admin who typed the credentials — so minting
  // here would put a fresh, auto-granted item (and therefore custody, and the lock switch) in that
  // user's Cofre for a credential they never entered. `write: 'rotation'` is what makes that
  // unreachable rather than merely guarded against: it refreshes the item the ceremony produced, or
  // it reports that there is none. Whichever it does, the join on the row is left exactly as found.
  try {
    const actor: Actor = { userId: ownerUserId, orgId: target.orgId, role: 'user' };
    await shadowCredentials(actor, target, merged, 'rotation');
  } catch (err) {
    // The shadow may never break the rail it shadows. A failure here surfaces as `drift` /
    // `shadow_absent` at the next comparator read, which is the signal the Rule-10 review reads.
    console.warn(
      `[integrations] WS-C shadow refresh failed after rotating ${target.integrationKey} (config ${configId}): ${err instanceof Error ? (err.constructor?.name ?? 'Error') : typeof err}`,
    );
  }
  return 'updated';
}

export async function deleteConfig(actor: Actor, integrationKey: string): Promise<{ verdict: WriteVerdict }> {
  const rows = (await integrationConfigs.find({ orgId: actor.orgId, integrationKey })) as IntegrationConfigDoc[];
  if (rows.length === 0) return { verdict: 'notfound' };
  const writable = rows.filter((c) => canWriteConfig(actor, c));
  if (writable.length === 0) return { verdict: 'forbidden' };
  for (const c of writable) {
    // Destroy the shadow item and every grant on it BEFORE the config row goes. Deleting the row
    // first would strand an auto-granted `until_locked` item with no config to reach it from — a
    // standing unlock for a credential the user believes they removed, invisible to every code path
    // that navigates through the join.
    //
    // The OUTCOME IS READ, not discarded (B2 review H1). An org-shared config is deletable by any
    // org-admin but its item belongs to the admin who typed the credentials, so before the
    // shared-config reach existed, admin B deleting admin A's config left A's item alive and
    // granted — and because this call returned void and the result was dropped, that happened with
    // no log line, no status and no trace of any kind. `discardCredentialShadow` now says what
    // happened; the delete still proceeds (an undeletable config would be a worse failure than a
    // reported orphan), and the surviving item is now the loudest thing in the log rather than the
    // quietest.
    const outcome = await discardCredentialShadow(actor, c);
    if (outcome === 'orphaned' || outcome === 'error') {
      console.warn(
        `[integrations] deleting ${c.integrationKey} config ${c._id} left its credential item behind (${outcome}) — it must be locked or removed from the Cofre by its owner`,
      );
    }
    await integrationConfigs.delete(c._id);
  }
  return { verdict: 'ok' };
}
