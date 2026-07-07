/**
 * Integrations service (ch03 §3.8.13). Org-scoped integration configs with credentials
 * encrypted at rest (ch09; the one crypto module). Credentials are NEVER returned to any
 * client — the summary omits them. `ownerUserId` undefined means org-scoped/org-admin-authored
 * (shared to the org); else owner-only (Amendment 2 Part 4).
 */
import { integrationConfigs } from '../data/stores.js';
import { encrypt } from '../data/crypto.js';
import type { Actor } from '@ekoa/shared';
import type { Doc } from '../data/store.js';

export interface IntegrationConfigDoc extends Doc {
  orgId: string;
  ownerUserId?: string;
  integrationKey: string;
  name?: string;
  enabled: boolean;
  credentialsCiphertext?: string; // never returned
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
    credentialsCiphertext: encrypt(JSON.stringify(input.configValues)), // encrypted at rest
  };
  await integrationConfigs.insert(doc as never);
  return doc;
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
  const config = (await integrationConfigs.update(id, (cur) => ({
    ...cur,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.configValues ? { credentialsCiphertext: encrypt(JSON.stringify(patch.configValues)) } : {}),
  }))) as IntegrationConfigDoc;
  return { verdict: 'ok', config };
}

export async function deleteConfig(actor: Actor, integrationKey: string): Promise<{ verdict: WriteVerdict }> {
  const rows = (await integrationConfigs.find({ orgId: actor.orgId, integrationKey })) as IntegrationConfigDoc[];
  if (rows.length === 0) return { verdict: 'notfound' };
  const writable = rows.filter((c) => canWriteConfig(actor, c));
  if (writable.length === 0) return { verdict: 'forbidden' };
  for (const c of writable) await integrationConfigs.delete(c._id);
  return { verdict: 'ok' };
}
