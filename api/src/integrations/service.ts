/**
 * Integrations service (ch03 §3.8.13). Org-scoped integration configs with credentials
 * encrypted at rest (ch09; the one crypto module). Credentials are NEVER returned to any
 * client — the summary omits them. `ownerUserId` undefined means org-scoped/org-admin-authored
 * (shared to the org); else owner-only (Amendment 2 Part 4).
 */
import { integrationConfigs } from '../data/stores.js';
import { envelopeEncrypt, envelopeDecrypt } from '../data/crypto.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';
import {
  mintOrRefreshCredentialShadow,
  discardCredentialShadow,
  type CredentialShadowWrite,
} from './credential-cofre.js';
// THE OWNER'S ERASURE CONTROL over `integration_action_evidence`. Database-only, exactly like the
// edges `definition-store.ts` takes for the same reason: disconnecting a credential is the one
// moment a person says "remove what my third-party account produced", and `deleteConfig` is the only
// place that hears it. See `action-evidence-store.ts`'s removal-path enumeration, path 3.
import { discardEvidenceOfDisconnectedConfig } from './action-evidence-store.js';

export interface IntegrationConfigDoc extends Doc {
  orgId: string;
  ownerUserId?: string;
  integrationKey: string;
  name?: string;
  enabled: boolean;
  credentialsCiphertext?: string; // never returned
  /**
   * The NON-SECRET config values, in plaintext (`publicValuesOf`). Only fields the definition's
   * `configSchema` does NOT declare `secret` are ever written here, so this holds nothing the
   * product does not already show in the clear.
   *
   * It exists so the write gate can name the REAL destination of an action whose template
   * interpolates a config value, and bind a human's approval to it, WITHOUT decrypting anything -
   * the gate runs before credential load on purpose (`action-executor.ts`). Absent on rows written
   * before this landed and on any write whose caller could not name the schema; the consent path
   * then falls back to the `{{template}}`, i.e. exactly the previous behaviour.
   */
  publicConfigValues?: Record<string, string>;
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

/**
 * THE NON-SECRET PROJECTION of a config's values, stored in PLAINTEXT beside the ciphertext.
 *
 * WHY IT EXISTS. A config value can decide WHERE an action writes - a topic, a channel, a
 * tenant path - and the write gate has to know that destination to bind a human's approval to it
 * (`action-consent.ts`). The gate deliberately runs BEFORE anything is decrypted, so it cannot
 * read the encrypted bundle; without this projection the consent record can only name the
 * `{{template}}`, and a later edit of the value silently redirects an approval nobody re-granted.
 *
 * WHY IT IS SAFE. `secretKeys` comes from the definition's own `configSchema`: a field the schema
 * declares `secret` NEVER lands here, so this holds only values the product already shows in the
 * clear (they are echoed back in the builder and rendered in the dashboard). A caller that cannot
 * name the schema passes nothing and gets NO projection, which degrades to the previous behaviour
 * - the dialog names the template - rather than guessing which values are safe.
 *
 * WHY NOT JUST HASH THE CIPHERTEXT. It would bind the approval to the whole credential blob, and
 * the envelope is non-deterministic - so every routine OAuth token refresh
 * (`persistRotatedCredentials`) would invalidate every standing approval. Rotating a secret must
 * not re-prompt; moving a destination must.
 */
export function publicValuesOf(
  configValues: Record<string, unknown>,
  secretKeys?: readonly string[],
): Record<string, string> | undefined {
  if (!secretKeys) return undefined;
  const secret = new Set(secretKeys);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(configValues)) {
    if (secret.has(key)) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = String(value);
  }
  return out;
}

export async function createConfig(
  actor: Actor,
  input: { integrationKey: string; configValues: Record<string, unknown>; name?: string; secretKeys?: readonly string[] },
  deps: Deps,
): Promise<IntegrationConfigDoc> {
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
    // Absent optionals are OMITTED, never written as `undefined`: the Mongo driver serialises that
    // as `null`, which the read schemas reject (the same hazard `fieldsFromPackageConfig` documents).
    ...(publicValuesOf(input.configValues, input.secretKeys) !== undefined
      ? { publicConfigValues: publicValuesOf(input.configValues, input.secretKeys) }
      : {}),
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
 * CONNECT-OR-RE-SAVE, the dashboard's single credential-save action.
 *
 * `createConfig` inserts unconditionally. The dashboard's "guardar credenciais" button only ever
 * called that, so every re-save inserted ANOTHER row for the same integration - and
 * `findConfigForOwner` resolves duplicates by "first row that matches", i.e. whichever the driver
 * returns first. So a re-saved credential could go on being ignored in favour of the old row, or
 * take effect and drop every field this save did not resend. Neither is visible in the UI: both
 * rows render as one connected integration.
 *
 * A save for an integration this actor already has a config for is therefore an UPDATE of that
 * row (merging, per `mergeCredentialValues`), and only a genuinely new one inserts. The row this
 * looks for is the one `createConfig` WOULD have authored - an org-admin authors the org-shared
 * row (`ownerUserId == null`), anyone else their own - so this never redirects a user's save into
 * a shared row or vice versa.
 */
export async function upsertConfig(
  actor: Actor,
  input: { integrationKey: string; configValues: Record<string, unknown>; name?: string; secretKeys?: readonly string[] },
  deps: Deps,
): Promise<{ verdict: WriteVerdict; config?: IntegrationConfigDoc; created: boolean }> {
  const authorsShared = actor.role === 'org-admin' || actor.role === 'super-admin';
  const rows = (await integrationConfigs.find({ orgId: actor.orgId, integrationKey: input.integrationKey })) as IntegrationConfigDoc[];
  const existing = rows.find((c) => !isReservedIntegrationRow(c) && (authorsShared ? c.ownerUserId == null : c.ownerUserId === actor.userId));
  if (!existing) {
    return { verdict: 'ok', config: await createConfig(actor, input, deps), created: true };
  }
  const updated = await updateConfig(actor, existing._id, {
    configValues: input.configValues,
    ...(input.secretKeys ? { secretKeys: input.secretKeys } : {}),
  });
  return { ...updated, created: false };
}

// ============================================================================
// OAuth-connect support for INTEGRATION-CONFIG-backed providers (Zoho Sign)
//
// Google/Microsoft connect into reserved `platform-<orgId>-<provider>` rows. Zoho cannot: its
// credentials are read by the zoho-sign service and by the generic action executor, both of which
// resolve the ordinary `zoho-sign` integration config for an owner. So its OAuth grant lands in
// THAT row's encrypted bundle - the same bundle the manual path writes - and nothing downstream
// has to know which path produced it.
// ============================================================================

/** Find-or-create the caller's config row for `integrationKey` and stamp a pending OAuth state. */
export async function beginConfigOAuth(
  actor: Actor,
  integrationKey: string,
  state: string,
  expiresAt: number,
  deps: Deps,
): Promise<IntegrationConfigDoc> {
  const authorsShared = actor.role === 'org-admin' || actor.role === 'super-admin';
  const rows = (await integrationConfigs.find({ orgId: actor.orgId, integrationKey })) as IntegrationConfigDoc[];
  const existing = rows.find((c) => !isReservedIntegrationRow(c) && (authorsShared ? c.ownerUserId == null : c.ownerUserId === actor.userId));
  if (existing) {
    return (await integrationConfigs.update(existing._id, (cur) => ({
      ...cur,
      oauthState: state,
      oauthStateExpiresAt: expiresAt,
    }))) as IntegrationConfigDoc;
  }
  // A row created by a connect starts DISABLED and credential-less: only a completed callback
  // turns it on, so an abandoned popup never leaves an integration looking connected.
  const doc: IntegrationConfigDoc = {
    _id: deps.genId(),
    orgId: actor.orgId,
    ...(authorsShared ? {} : { ownerUserId: actor.userId }),
    custodianUserId: actor.userId,
    integrationKey,
    name: integrationKey,
    enabled: false,
    oauthState: state,
    oauthStateExpiresAt: expiresAt,
  };
  await integrationConfigs.insert(doc as never);
  return doc;
}

/** The config row holding this pending OAuth state, or null when unknown or expired. */
export async function findConfigByOAuthState(
  integrationKey: string,
  state: string,
  now: number,
): Promise<IntegrationConfigDoc | null> {
  if (!state) return null;
  const rows = (await integrationConfigs.find({ integrationKey })) as IntegrationConfigDoc[];
  const row = rows.find((c) => c.oauthState === state);
  if (!row) return null;
  // An expiry the row does not carry is treated as expired rather than eternal: a state with no
  // deadline is exactly the pre-TTL behaviour this field exists to end.
  if (typeof row.oauthStateExpiresAt !== 'number' || row.oauthStateExpiresAt < now) return null;
  return row;
}

/**
 * Merge a completed OAuth grant into a config's encrypted bundle and turn the row on.
 *
 * NOT `updateConfig`: that path authorises a human actor, and this one runs on a public callback
 * whose only credential is the CSRF state already matched to this exact row. It shares the
 * important half - `mergeCredentialValues`, so `CLEAR_CREDENTIAL` really deletes and an untouched
 * field really survives - and deliberately does not move `custodianUserId`, because completing a
 * consent is not the credential-typing ceremony that decides custody.
 *
 * An undecryptable stored bundle REPLACES rather than refusing here, unlike a user edit: the
 * alternative is an account that can never be reconnected through the UI, and a fresh grant is a
 * complete, self-sufficient credential set.
 */
export async function persistConfigOAuthGrant(
  configId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const row = (await integrationConfigs.get(configId)) as IntegrationConfigDoc | null;
  if (!row) throw new Error('integration config not found');
  let current: Record<string, unknown> = {};
  try {
    current = await decryptForMerge(row);
  } catch (err) {
    if (!(err instanceof UndecryptableBundleError)) throw err;
    console.warn(`[integrations] ${row.integrationKey}: stored credentials are undecryptable; replacing them with this grant.`);
  }
  const { values } = mergeCredentialValues(current, patch);
  const ciphertext = await envelopeEncrypt(JSON.stringify(values), row.orgId);
  await integrationConfigs.update(configId, (cur) => ({
    ...cur,
    credentialsCiphertext: ciphertext,
    enabled: true,
    oauthState: undefined,
    oauthStateExpiresAt: undefined,
    // Fresh consent means the account is live again - a stale dead-token flag would otherwise keep
    // reporting it disconnected right after a successful reconnect.
    needsReauth: false,
  }));
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

export type WriteVerdict = 'ok' | 'notfound' | 'forbidden' | 'undecryptable';

/**
 * Explicit "blank this key" sentinel for a credential patch. A STRING, not a symbol, so it
 * travels through JSON and the `Record<string, unknown>` value maps every call site already
 * uses. Only a deliberate "clear this field" action may produce it.
 */
export const CLEAR_CREDENTIAL = '__ekoa_clear_credential__';

/**
 * MERGE A PARTIAL CREDENTIAL PATCH INTO THE STORED BUNDLE.
 *
 * A credential form only carries what was typed in THIS browser session: a masked field the
 * user did not retype comes back empty, and a field the form does not render does not come
 * back at all. Replacing the whole bundle with such a patch destroys every value it omits -
 * which is exactly how a re-pasted Zoho client_id/secret wiped the permanent `refresh_token`
 * and took a customer's e-signature down in the old platform (ekoa-dev `ca446cb0`, 2026-07-28).
 * Merging is the only safe default; a wipe must be ASKED FOR.
 *
 *   - a key ABSENT from the patch      -> unchanged
 *   - `undefined` / `null`             -> unchanged (never an implicit wipe)
 *   - an empty / whitespace-only string -> unchanged: that is what an untouched masked input
 *                                          emits. The ambiguous case, resolved in favour of
 *                                          never losing a secret.
 *   - `CLEAR_CREDENTIAL`               -> the key is deleted. The only way to blank a field.
 *
 * A rotation (`persistRotatedCredentials`) merges too, but on its own path and against fields
 * the caller already decrypted - it is a provider refresh, not a user's edit.
 */
export function mergeCredentialValues(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): { values: Record<string, unknown>; changed: boolean } {
  const values: Record<string, unknown> = { ...current };
  let changed = false;
  for (const [key, value] of Object.entries(patch)) {
    if (value === CLEAR_CREDENTIAL) {
      if (key in values) { delete values[key]; changed = true; }
      continue;
    }
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Object.is(values[key], value)) continue;
    values[key] = value;
    changed = true;
  }
  return { values, changed };
}

/**
 * The stored bundle, decrypted, for a write that must not lose it. THROWS on an undecryptable
 * blob rather than degrading to `{}` - degrading here would turn "the key rotated" into a full
 * credential wipe on the very next save, which is the failure this whole path exists to prevent.
 * Read/presence paths that must not fail a request use their own tolerant decrypt.
 */
class UndecryptableBundleError extends Error {
  readonly code = 'credential_bundle_undecryptable';
}
async function decryptForMerge(c: IntegrationConfigDoc): Promise<Record<string, unknown>> {
  if (!c.credentialsCiphertext) return {};
  let plaintext: string;
  try {
    plaintext = await envelopeDecrypt(c.credentialsCiphertext, c.orgId);
  } catch {
    // Deliberately content-free: nothing from the blob may reach a message or a log.
    throw new UndecryptableBundleError('stored credentials could not be decrypted');
  }
  try {
    const parsed = JSON.parse(plaintext) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* legacy single-value blob */
  }
  return { value: plaintext };
}

export async function updateConfig(
  actor: Actor,
  id: string,
  patch: { enabled?: boolean; configValues?: Record<string, unknown>; secretKeys?: readonly string[] },
): Promise<{ verdict: WriteVerdict; config?: IntegrationConfigDoc }> {
  const c = (await integrationConfigs.get(id)) as IntegrationConfigDoc | null;
  if (!c || c.orgId !== actor.orgId) return { verdict: 'notfound' };
  if (!canWriteConfig(actor, c)) return { verdict: 'forbidden' };
  // MERGE, never replace (see `mergeCredentialValues`). Everything downstream - the ciphertext,
  // the WS-C shadow, and the non-secret projection the consent gate reads - is computed from the
  // MERGED bundle, so a partial save can no longer shrink any of the three out of step.
  //
  // A patch that changes NOTHING (every field re-sent identical, or all of them left untouched)
  // is treated as no credential write at all: it must not re-encrypt, must not re-shadow, and
  // above all must not re-stamp `custodianUserId`. Custody follows the ceremony, and posting an
  // empty or unchanged bundle is not one - otherwise any writer could take custody of a
  // credential they never typed by saving the form without touching it.
  let values: Record<string, unknown> | undefined;
  if (patch.configValues) {
    try {
      const merged = mergeCredentialValues(await decryptForMerge(c), patch.configValues);
      if (merged.changed || !c.credentialsCiphertext) values = merged.values;
    } catch (err) {
      if (err instanceof UndecryptableBundleError) return { verdict: 'undecryptable' };
      throw err;
    }
  }
  // Encrypt BEFORE the update callback: `update` takes a synchronous mutator, and the envelope is
  // async because the key wrapper may be a remote KMS call.
  const nextCiphertext = values ? await envelopeEncrypt(JSON.stringify(values), actor.orgId) : undefined;
  // WS-C shadow, kept in step with the live column. A REFRESH never re-grants (see
  // `updateIntegrationCredentialValue`): rotating the credentials of a LOCKED integration leaves it
  // locked, because undoing the user's kill switch as a side effect of an unrelated edit would make
  // the lock advisory. Only a first mint carries the connect ceremony's auto-grant.
  const cofreItemId = values ? await shadowCredentials(actor, c, values) : undefined;
  const config = (await integrationConfigs.update(id, (cur) => ({
    ...cur,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(nextCiphertext ? { credentialsCiphertext: nextCiphertext } : {}),
    // CUSTODY FOLLOWS THE CEREMONY, and only the ceremony. A credential re-save IS the ceremony
    // repeated — `canWriteConfig` above already restricts an org-shared row's re-save to an
    // org-admin, and `mintOrRefreshCredentialShadow` already mints under this writer — so the
    // custodian stamp moves with it. Toggling `enabled` is not a ceremony and leaves it alone.
    ...(values ? { custodianUserId: actor.userId } : {}),
    // The non-secret projection moves with the values it projects. Recomputed only on a values
    // write, so toggling `enabled` cannot disturb a standing approval's destination binding.
    // Projected from the MERGED bundle: from the patch alone, a save that did not resend a
    // destination field would drop it here and silently re-open a bound approval.
    ...(values && publicValuesOf(values, patch.secretKeys) !== undefined
      ? { publicConfigValues: publicValuesOf(values, patch.secretKeys) }
      : {}),
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
    // …AND THE SAMPLES THAT CREDENTIAL PRODUCED GO WITH IT (slice S1, verification round three).
    //
    // AFTER the delete, for the same reason the shadow goes BEFORE it: order each obligation by what
    // it would strand on a failure. A shadow left behind is a standing unlock, so it must not
    // outlive the row that reaches it; an evidence row left behind is a sample of an account nobody
    // is connected to any more, which is untidy but reachable - and discarding it before a delete
    // that then failed would destroy the sample of a credential the user still has.
    //
    // WHY THIS IS NOT THE RECONCILER. `discardEvidenceOfUnresolvableActions` asks whether the owner
    // can still REACH the action, and disconnecting a credential does not change that answer - the
    // definition still resolves, so a reconcile keeps every row. What ended is the connection to the
    // third-party account whose real request and real response body the row holds, and the person
    // who made that connection has just asked for it to end. Until this existed, connecting an
    // integration, running one browser-steps action and then disconnecting left a durable row of
    // that account's traffic plus a permanent screenshot pin, with no way to remove it and no way to
    // supersede it (that needs re-connecting and re-running).
    const forgotten = await discardEvidenceOfDisconnectedConfig({
      orgId: c.orgId,
      integrationKey: c.integrationKey,
      // A row with no custodian is the legacy ORG-SHARED config - the credential `findConfigForOwner`
      // hands to every member of the org - so deleting it disconnects all of them at once, and every
      // member's sample was produced through it.
      owner: c.ownerUserId ? { userId: c.ownerUserId } : 'every-owner-in-org',
    });
    if (forgotten > 0) {
      console.log(`[integrations] disconnecting ${c.integrationKey} discarded ${forgotten} action-evidence row(s)`);
    }
  }
  return { verdict: 'ok' };
}
