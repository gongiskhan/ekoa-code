/**
 * Change-requests service (operator-run H4; BRIEF Phase 9d). Owns the store access for the
 * request-changes queue so routes/ never touches data/ directly (ch02 §2.7; `services/` may
 * import `data/`). GREENFIELD — mirrors the registo read's org scoping EXACTLY.
 *
 * CROSS-ORG ISOLATION is the security crux: `orgId` is stamped SERVER-SIDE here (the app OWNER's
 * org for a served-app filing, the requester's OWN org for a dashboard refused-build filing) and
 * every read/convert/dismiss is org-scoped — an org-admin sees ONLY its own org, a super-admin
 * across orgs (registo.ts's exact rule). The org-admin/super-admin ROLE gate lives on the route
 * (requireRole, like registo); this module enforces the org SCOPE.
 */
import type { Actor, ChangeRequest, ChangeRequestStatus } from '@ekoa/shared';
import { changeRequests, users, type ChangeRequestDoc } from '../data/stores.js';

export interface Deps { now: () => number; genId: () => string }

/** Store doc -> wire shape. The wire schema is `.strict()`, so optional fields are spread only
 *  when present (never emit a key the contract does not allow). */
export function changeRequestView(d: ChangeRequestDoc): ChangeRequest {
  return {
    id: d._id,
    orgId: d.orgId,
    requesterUserId: d.requesterUserId,
    requesterName: d.requesterName,
    text: d.text,
    status: d.status,
    createdAt: d.createdAt,
    ...(d.appId ? { appId: d.appId } : {}),
    ...(d.route ? { route: d.route } : {}),
    ...(d.screenState ? { screenState: d.screenState } : {}),
    ...(d.jobId ? { jobId: d.jobId } : {}),
  };
}

/**
 * File a change request. Two documented modes, distinguished by `target`:
 *  - served-app filing (`target` set): the app OWNER's org is the queue owner (isolation
 *    boundary) — resolved from the owner user record, NEVER the requester's org or the body.
 *  - dashboard refused-build filing (`target` null): no served app; the request lands in the
 *    REQUESTER's OWN org, with the body `appId` kept only as an informational label (an
 *    edit-refusal artifactId) — convert re-gates it via H1 (loadWritable), so a planted id leaks
 *    nothing.
 * Returns the created request plus the org-admin userIds to live-notify (the caller — the route,
 * which may import agents/streaming — fires the SSE; this module only reads data/).
 */
export async function fileChangeRequest(
  requester: { userId: string; username: string; orgId: string },
  target: { ownerUserId: string; appId: string } | null,
  body: { text: string; route?: string; screenState?: string; appId?: string },
  deps: Deps,
): Promise<{ request: ChangeRequest; notifyUserIds: string[] }> {
  let orgId: string;
  let appId: string | undefined;
  if (target) {
    const owner = await users.get(target.ownerUserId);
    orgId = owner?.orgId ?? '';
    appId = target.appId;
  } else {
    orgId = requester.orgId;
    appId = body.appId;
  }
  const doc: ChangeRequestDoc = {
    _id: deps.genId(),
    orgId,
    requesterUserId: requester.userId,
    requesterName: requester.username,
    text: body.text,
    status: 'open',
    createdAt: new Date(deps.now()).toISOString(),
    ...(appId ? { appId } : {}),
    ...(body.route ? { route: body.route } : {}),
    ...(body.screenState ? { screenState: body.screenState } : {}),
  };
  await changeRequests.insert(doc);
  // Live push to the OWNER org's admins only (org-scoped fan-in — never another org's admins).
  const admins = orgId ? await users.find({ orgId, role: 'org-admin' }) : [];
  return { request: changeRequestView(doc), notifyUserIds: admins.map((a) => a._id) };
}

/**
 * Queue read. org-admin: OWN org ONLY (the isolation crux). super-admin: across orgs, optionally
 * narrowed by `orgId`. Mirrors registo.ts's readRegisto scoping exactly. Newest first.
 */
export async function readChangeRequests(
  actor: Actor,
  query: { status?: ChangeRequestStatus; orgId?: string; limit?: number; offset?: number },
): Promise<{ items: ChangeRequest[]; total: number }> {
  const filter =
    actor.role === 'super-admin'
      ? (query.orgId ? { orgId: query.orgId } : {})
      : { orgId: actor.orgId };
  let rows = await changeRequests.find(filter, { createdAt: -1 });
  if (query.status) rows = rows.filter((r) => r.status === query.status);
  const total = rows.length;
  const page = rows.slice(query.offset ?? 0, (query.offset ?? 0) + (query.limit ?? 100));
  return { items: page.map(changeRequestView), total };
}

/** org-scope guard shared by convert + dismiss: a missing row OR a cross-org row reads as the
 *  SAME not-found (no existence oracle across orgs — an org-admin cannot probe another org's ids). */
async function loadOwnOrg(actor: Actor, id: string): Promise<ChangeRequestDoc | null> {
  const row = await changeRequests.get(id);
  if (!row) return null;
  if (actor.role !== 'super-admin' && row.orgId !== actor.orgId) return null;
  return row;
}

/** Mark a request converted, linking the follow-up-build job the dashboard already started
 *  (H1-gated at POST /jobs). org-scoped: an org-admin converts only its own org's requests. */
export async function convertChangeRequest(
  actor: Actor,
  id: string,
  jobId: string,
): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'converted', jobId }));
  if (!updated) return { status: 'not-found' };
  return { status: 'ok', request: changeRequestView(updated) };
}

/** Decline a request (status -> dismissed). org-scoped, like convert. */
export async function dismissChangeRequest(
  actor: Actor,
  id: string,
): Promise<{ status: 'ok'; request: ChangeRequest } | { status: 'not-found' }> {
  if (!(await loadOwnOrg(actor, id))) return { status: 'not-found' };
  const updated = await changeRequests.update(id, (r) => ({ ...r, status: 'dismissed' }));
  if (!updated) return { status: 'not-found' };
  return { status: 'ok', request: changeRequestView(updated) };
}
