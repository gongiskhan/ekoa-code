/**
 * Platform CRUD services (ch03 §3.8.4/5/6/24). Cross-domain conventional business logic for
 * org, settings, sessions, and the Registo read — owns the store access so routes/ never
 * touches data/ directly (ch02 §2.7; `services/` may import `data/`).
 */
import type { Actor } from '@ekoa/shared';
import { orgs, settings, userSettings, sessions, messages, activityLogs, type OrgDoc, type SettingsDoc, type UserSettingsDoc, type SessionDoc, type ActivityLogDoc } from '../data/stores.js';
import { logActivity } from '../data/activity.js';
import type { Doc } from '../data/store.js';

export interface Deps { now: () => number; genId: () => string }

// ---- Org ----
export const orgView = (o: OrgDoc) => ({ id: o._id, name: o.name, displayName: o.displayName, branding: o.branding, settings: o.settings });
export const getOrg = (id: string) => orgs.get(id);
export const updateOrg = (id: string, patch: Partial<OrgDoc>) => orgs.update(id, (o) => ({ ...o, ...patch }));
export async function createOrg(input: { name: string; displayName?: string }, deps: Deps): Promise<OrgDoc> {
  const id = deps.genId();
  await orgs.insert({ _id: id, name: input.name, displayName: input.displayName, createdAt: new Date(deps.now()).toISOString() });
  return (await orgs.get(id)) as OrgDoc;
}
export const listOrgs = () => orgs.find({});

// ---- Settings (merged view: the caller's ORG settings + per-user toggles, both default ON).
// Org settings live on the caller's `orgs[orgId].settings` — NOT a global singleton — so one
// org's settings never leak to or overwrite another's (ch03 §3.8.4/5, org-scoped). The global
// `settings` singleton holds platform defaults only and is never mutated by org-admins. ----
export async function mergedSettings(userId: string, orgId: string) {
  const platform = (await settings.get('default')) ?? ({ _id: 'default' } as SettingsDoc);
  const org = await orgs.get(orgId);
  const orgSettings = (org?.settings ?? {}) as Record<string, unknown>;
  const perUser = (await userSettings.get(userId)) ?? ({ _id: userId } as UserSettingsDoc);
  const orgInteg = (orgSettings as { integration?: { pipedreamEnabled?: boolean } }).integration;
  return {
    ...(platform as Record<string, unknown>),
    ...orgSettings,
    _id: undefined,
    build: { verifyBuilds: perUser.build?.verifyBuilds ?? true },
    memory: { autoExtract: perUser.memory?.autoExtract ?? true },
    integration: { pipedreamEnabled: orgInteg?.pipedreamEnabled ?? false },
  };
}
export async function patchOrgSettings(orgId: string, patch: Record<string, unknown>) {
  await orgs.update(orgId, (o) => ({ ...o, settings: { ...(o.settings ?? {}), ...patch } }));
}
export async function patchUserSettings(userId: string, patch: Record<string, unknown>) {
  const cur = (await userSettings.get(userId)) ?? ({ _id: userId } as UserSettingsDoc);
  await userSettings.put({ ...cur, ...patch, _id: userId } as UserSettingsDoc);
}

// ---- Sessions (user-scoped; ownership miss → null → uniform 404) ----
export const sessionView = (s: SessionDoc) => ({ id: s._id, userId: s.userId, title: s.title, status: s.status, messageCount: s.messageCount ?? 0 });
export const listSessions = (userId: string) => sessions.find({ userId });
export async function ownedSession(userId: string, id: string): Promise<SessionDoc | null> {
  const s = await sessions.get(id);
  return s && s.userId === userId ? s : null;
}
export async function createSession(userId: string, name: string | undefined, deps: Deps): Promise<SessionDoc> {
  const id = deps.genId();
  const doc: SessionDoc = { _id: id, userId, title: name, status: 'active', messageCount: 0 };
  await sessions.insert(doc);
  return doc;
}
export const updateSession = (id: string, patch: Partial<SessionDoc>) => sessions.update(id, (x) => ({ ...x, ...patch }));
export const deleteSession = (id: string) => sessions.delete(id);
export const listMessages = (sessionId: string) => messages.find({ sessionId }, { timestamp: 1 });
export async function addMessage(session: SessionDoc, body: { role: unknown; content: unknown; metadata?: unknown }, deps: Deps): Promise<Doc> {
  const id = deps.genId();
  const doc: Doc = { _id: id, sessionId: session._id, role: body.role, content: body.content, timestamp: new Date(deps.now()).toISOString(), ...(body.metadata ? { metadata: body.metadata } : {}) };
  await messages.insert(doc);
  await sessions.update(session._id, (x) => ({ ...x, messageCount: (x.messageCount ?? 0) + 1 }));
  return doc;
}

// ---- Registo (org-scoped activity read; metadata only) ----
export function registoEntry(a: ActivityLogDoc) {
  return { id: a._id, actor: a.userId, username: a.username, actionType: `${a.category}.${a.type}`, timestamp: a.timestamp, targetIds: a.metadata, orgId: a.orgId };
}
export async function readRegisto(actor: Actor, username: string, q: { userId?: string; type?: string; orgId?: string; limit?: number; offset?: number }, deps: Deps) {
  let rows = actor.role === 'super-admin' ? await activityLogs.find(q.orgId ? { orgId: q.orgId } : {}) : await activityLogs.find({ orgId: actor.orgId });
  if (q.userId) rows = rows.filter((x) => x.userId === q.userId);
  if (q.type) rows = rows.filter((x) => `${x.category}.${x.type}` === q.type || x.type === q.type);
  const total = rows.length;
  const page = rows.slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 100));
  await logActivity({ userId: actor.userId, username, orgId: actor.orgId }, 'registo', 'read', deps);
  return { items: page.map(registoEntry), total };
}
