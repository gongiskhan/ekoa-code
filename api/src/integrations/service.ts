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
import { mintOrRefreshCredentialShadow, discardCredentialShadow } from './credential-cofre.js';

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
): Promise<string | null> {
  if (isReservedIntegrationRow(doc)) return null;
  return mintOrRefreshCredentialShadow(actor, doc, values);
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
    ...(cofreItemId ? { cofreItemId } : {}),
  }))) as IntegrationConfigDoc;
  return { verdict: 'ok', config };
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
    await discardCredentialShadow(actor, c);
    await integrationConfigs.delete(c._id);
  }
  return { verdict: 'ok' };
}
