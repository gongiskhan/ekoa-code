/**
 * Platform CRUD services (ch03 §3.8.4/5/6/24). Cross-domain conventional business logic for
 * org, settings, sessions, and the Registo read — owns the store access so routes/ never
 * touches data/ directly (ch02 §2.7; `services/` may import `data/`).
 */
import type { Actor } from '@ekoa/shared';
import { orgs, settings, userSettings, sessions, messages, activityLogs, type OrgDoc, type SettingsDoc, type UserSettingsDoc, type SessionDoc, type SessionSheetDoc, type SheetRevisionDoc, type ActivityLogDoc } from '../data/stores.js';
import { logActivity, type ActivityActor } from '../data/activity.js';
import { listSessionSheets, appendSheetRevision, renameSheet } from '../data/session-sheets.js';
import type { Doc } from '../data/store.js';

export interface Deps { now: () => number; genId: () => string }

/** Registo (F3): emit an audit row for a covered CRUD mutation, metadata-only (ids only, never
 *  names/content). Best-effort — the single audit write path (FIXED-8), never fails the mutation.
 *  A missing actor (a direct service call in a test) skips logging. */
function audit(actor: ActivityActor | undefined, category: string, type: string, deps: Deps, metadata?: Record<string, unknown>): void {
  if (!actor) return;
  void logActivity(actor, category, type, deps, metadata).catch(() => undefined);
}

// ---- Org ----
export const orgView = (o: OrgDoc) => ({
  id: o._id,
  name: o.name,
  displayName: o.displayName,
  branding: o.branding,
  settings: o.settings,
  ...(o.updatedAt ? { updatedAt: o.updatedAt } : {}),
});
export const getOrg = (id: string) => orgs.get(id);
// Every org patch stamps `updatedAt`: the web's branding page re-syncs its local editor state
// only when this fingerprint changes (an open page must reflect a research merge without a
// reload — the field was read client-side but never written, so the sync never re-fired).
export const updateOrg = (id: string, patch: Partial<OrgDoc>) =>
  orgs.update(id, (o) => ({ ...o, ...patch, updatedAt: new Date().toISOString() }));
export async function createOrg(input: { name: string; displayName?: string }, deps: Deps, actor?: ActivityActor): Promise<OrgDoc> {
  const id = deps.genId();
  await orgs.insert({ _id: id, name: input.name, displayName: input.displayName, createdAt: new Date(deps.now()).toISOString() });
  audit(actor, 'org', 'create', deps, { orgId: id });
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
// The store keeps the carried shapes (`title`, message `timestamp`, `_id`); ch03 owns the
// API-visible reshaping (ch04 §4.3.1 preamble), so the views below are the ONLY place the
// wire names (`name`, `createdAt`, `id`) are produced. They must satisfy the shared
// Session / SessionSummary / SessionMessage schemas exactly — the web validates every
// response against them and treats a mismatch as a failed call.
export const sessionView = (s: SessionDoc) => ({
  id: s._id,
  userId: s.userId,
  ...(s.title != null ? { name: s.title } : {}),
  ...(s.type != null ? { type: s.type } : {}),
  ...(s.artifactId != null ? { artifactId: s.artifactId } : {}),
  status: s.status,
  messageCount: s.messageCount ?? 0,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});
/** Wire view of a message doc: `_id`→`id`, `timestamp`→`createdAt`. Built field-by-field so no
 *  store internal (`_rev`, and anything added later) can leak onto the wire. */
export const messageView = (m: Doc) => {
  const d = m as Doc & { sessionId?: string; role?: unknown; content?: unknown; metadata?: Record<string, unknown>; timestamp?: string };
  return {
    id: d._id,
    sessionId: d.sessionId,
    role: d.role,
    content: d.content,
    ...(d.metadata ? { metadata: d.metadata } : {}),
    createdAt: d.timestamp,
  };
};
export const listSessions = (userId: string) => sessions.find({ userId });
export async function ownedSession(userId: string, id: string): Promise<SessionDoc | null> {
  const s = await sessions.get(id);
  return s && s.userId === userId ? s : null;
}
export async function createSession(
  userId: string,
  input: { name?: string; type?: string; artifactId?: string },
  deps: Deps,
  actor?: ActivityActor,
): Promise<SessionDoc> {
  const id = deps.genId();
  const ts = new Date(deps.now()).toISOString();
  const doc: SessionDoc = {
    _id: id,
    userId,
    ...(input.name !== undefined ? { title: input.name } : {}),
    ...(input.type !== undefined ? { type: input.type } : {}),
    ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
    status: 'active',
    messageCount: 0,
    createdAt: ts,
    updatedAt: ts,
  };
  await sessions.insert(doc);
  audit(actor, 'session', 'create', deps, { sessionId: id });
  return doc;
}
/** Rename and/or touch. An empty patch stamps `updatedAt` only (ch03 §3.8.6, carried). */
export async function updateSession(id: string, patch: { name?: string }, deps: Deps, actor?: ActivityActor) {
  const updated = await sessions.update(id, (x) => ({
    ...x,
    ...(patch.name !== undefined ? { title: patch.name } : {}),
    updatedAt: new Date(deps.now()).toISOString(),
  }));
  audit(actor, 'session', 'update', deps, { sessionId: id });
  return updated;
}
export async function deleteSession(id: string, deps?: Deps, actor?: ActivityActor) {
  const ok = await sessions.delete(id);
  if (deps) audit(actor, 'session', 'delete', deps, { sessionId: id });
  return ok;
}
export const listMessages = (sessionId: string) => messages.find({ sessionId }, { timestamp: 1 });
export async function addMessage(session: SessionDoc, body: { role: unknown; content: unknown; metadata?: unknown }, deps: Deps): Promise<Doc> {
  const id = deps.genId();
  const now = new Date(deps.now()).toISOString();
  const doc: Doc = { _id: id, sessionId: session._id, role: body.role, content: body.content, timestamp: now, ...(body.metadata ? { metadata: body.metadata } : {}) };
  await messages.insert(doc);
  // A new turn touches the session: the web sorts the session list by `updatedAt`.
  await sessions.update(session._id, (x) => ({ ...x, messageCount: (x.messageCount ?? 0) + 1, updatedAt: now }));
  return doc;
}

// ---- Session sheets (Part B decision B.B: subdocuments on the session record; legacy
// sessions read as derived one-sheet-per-assistant-message views - data/session-sheets.ts).
// The views below are the ONLY place sheet wire bodies are produced; they must satisfy the
// shared Sheet / SheetRevision schemas exactly (the web validates every response). Built
// field-by-field so no store internal added later can leak onto the wire. ----
const sheetRevisionView = (r: SheetRevisionDoc) => ({
  revisionId: r.revisionId,
  content: r.content,
  createdAt: r.createdAt,
  editSource: r.editSource,
  ...(r.editedBy != null ? { editedBy: r.editedBy } : {}),
  ...(r.instruction != null ? { instruction: r.instruction } : {}),
});
export const sheetView = (s: SessionSheetDoc) => ({
  sheetId: s.sheetId,
  title: s.title,
  createdFromMessageId: s.createdFromMessageId,
  revisions: s.revisions.map(sheetRevisionView),
});
export async function listSessionSheetViews(session: SessionDoc) {
  return (await listSessionSheets(session)).map(sheetView);
}
/** A USER edit: server stamps editSource/editedBy/createdAt - never taken from the body. */
export async function addSessionSheetRevision(
  session: SessionDoc,
  sheetId: string,
  input: { content: string; instruction?: string },
  editedBy: string,
  deps: Deps,
  actor?: ActivityActor,
) {
  const sheet = await appendSheetRevision(session._id, sheetId, { ...input, editedBy, editSource: 'user' }, deps);
  if (!sheet) return null;
  audit(actor, 'session', 'sheet_revision', deps, {
    sessionId: session._id,
    sheetId,
    revisionId: sheet.revisions[sheet.revisions.length - 1]!.revisionId,
  });
  return sheetView(sheet);
}
export async function renameSessionSheet(session: SessionDoc, sheetId: string, title: string, deps: Deps, actor?: ActivityActor) {
  const sheet = await renameSheet(session._id, sheetId, title, deps);
  if (!sheet) return null;
  audit(actor, 'session', 'sheet_rename', deps, { sessionId: session._id, sheetId });
  return sheetView(sheet);
}

// ---- Registo (org-scoped activity read; metadata only) ----
/** The shared `RegistoEntry` requires `targetIds` to be an ARRAY of ids (`z.array(Id).optional()`),
 *  but the audit row's `metadata` is an OBJECT (`{ jobId, entryId, ... }`), so emitting it directly
 *  as `targetIds` made every metadata-carrying row fail `RegistoListResponse` validation (F3/F22
 *  class). Derive `targetIds` from the string-valued metadata fields (the ids) and carry the full
 *  detail under the passthrough `metadata` key. */
export function registoEntry(a: ActivityLogDoc) {
  const meta = (a.metadata ?? {}) as Record<string, unknown>;
  // `targetIds` is the shared contract's `z.array(Id)` — derive it from the ID-keyed metadata
  // values only (`*Id`/`*id`), so a mode/timestamp/email string is not misrepresented as a target
  // id (A10). The full detail still rides the passthrough `metadata` key below.
  const targetIds = Object.entries(meta)
    .filter(([k, v]) => typeof v === 'string' && /id$/i.test(k))
    .map(([, v]) => v as string);
  return {
    id: a._id,
    actor: a.userId,
    username: a.username,
    actionType: `${a.category}.${a.type}`,
    timestamp: a.timestamp,
    ...(targetIds.length > 0 ? { targetIds } : {}),
    ...(a.metadata ? { metadata: a.metadata } : {}),
    // Per-event usage amounts (C2): counter names verbatim from the metering ledger
    // (voice.turn -> voice_stt_ms, voice.tts -> voice_tts_chars) - the shared RegistoEntry
    // `usageCounts` field, previously never emitted.
    ...(a.usageCounts ? { usageCounts: a.usageCounts } : {}),
    orgId: a.orgId,
  };
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

// ---- Anonymisation-audit reads (run s5; §17.6 metadata-only) ----------------------------

/** Sum `classes` maps from anonymisation-audit rows. Metadata only — never bodies. */
function sumClasses(rows: ActivityLogDoc[]): { classes: Record<string, number>; entityCount: number } {
  const classes: Record<string, number> = {};
  let entityCount = 0;
  for (const r of rows) {
    const md = (r.metadata ?? {}) as { classes?: Record<string, unknown>; entityCount?: unknown };
    for (const [cls, n] of Object.entries(md.classes ?? {})) {
      if (typeof n === 'number') classes[cls] = (classes[cls] ?? 0) + n;
    }
    if (typeof md.entityCount === 'number') entityCount += md.entityCount;
  }
  return { classes, entityCount };
}

/** FC-408: the caller's OWN masking-activity aggregate (per-user surface — least privilege;
 *  org-wide views stay on the admin Registo). Counts by entity class, never values. */
export async function maskingSummary(actor: Actor): Promise<{ classes: Record<string, number>; entityCount: number; events: number }> {
  const rows = (await activityLogs.find({ orgId: actor.orgId, category: 'anonymisation', userId: actor.userId })) as ActivityLogDoc[];
  const { classes, entityCount } = sumClasses(rows);
  return { classes, entityCount, events: rows.length };
}

/** FC-402 audit-join (D3; §18.6 S6): mask counts for the correlation ids a turn's delegation
 *  touched. Joined on the daemon-minted correlationId recorded by the anon-audit. */
export async function maskedCountsForCorrelations(orgId: string, correlationIds: string[]): Promise<Record<string, number>> {
  if (correlationIds.length === 0) return {};
  const rows = (await activityLogs.find({
    orgId,
    category: 'anonymisation',
    'metadata.correlationId': { $in: correlationIds },
  })) as ActivityLogDoc[];
  return sumClasses(rows).classes;
}
