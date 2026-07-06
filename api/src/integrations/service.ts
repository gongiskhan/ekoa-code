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
}

export interface Deps { now: () => number; genId: () => string }

/** Client-safe summary — NEVER includes credentials/sessionState (ch03 §3.8.13). */
export function configSummary(c: IntegrationConfigDoc) {
  return { id: c._id, integrationKey: c.integrationKey, name: c.name, enabled: c.enabled, needsReauth: c.needsReauth ?? false, ownerUserId: c.ownerUserId };
}

/** List configs visible to the actor: org-shared (ownerUserId undefined) + own. */
export async function listConfigs(actor: Actor): Promise<IntegrationConfigDoc[]> {
  const inOrg = await integrationConfigs.find({ orgId: actor.orgId });
  return (inOrg as IntegrationConfigDoc[]).filter((c) => c.ownerUserId == null || c.ownerUserId === actor.userId);
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
