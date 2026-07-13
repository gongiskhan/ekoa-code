/**
 * Change-requests domain contract (operator-run H4; BRIEF Phase 9d). GREENFIELD — the
 * request-changes queue: a user files a change request from INSIDE a served app; the app
 * OWNER's org-admins see it in a dashboard queue and convert one into a patch run (a
 * follow-up build). Additive only.
 *
 * The security crux is CROSS-ORG ISOLATION: a `ChangeRequest.orgId` is stamped SERVER-SIDE
 * (never from the caller's body) — the app OWNER's org for a served-app filing, the
 * requester's OWN org for a dashboard refused-build filing. `GET /api/v1/change-requests`
 * returns ONLY the caller-org's requests for an org-admin (super-admin across orgs), mirroring
 * registo.ts exactly. An org-admin MUST NEVER see another org's requests.
 */
import { z } from 'zod';
import { Id, IsoTimestamp, listResponse } from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

/** The lifecycle of a queued request: open (awaiting an admin), converted (an admin started a
 *  patch run — carries the resulting jobId), dismissed (an admin declined it). */
export const ChangeRequestStatus = z.enum(['open', 'converted', 'dismissed']);
export type ChangeRequestStatus = z.infer<typeof ChangeRequestStatus>;

/**
 * A single change request. `appId`/`route`/`screenState` are OPTIONAL because the refused-build
 * feed (a dashboard first-build refusal) has no served app or screen yet — the panel filing
 * always carries them. `orgId`/`requesterUserId`/`requesterName` are server-stamped. `jobId` is
 * set only once an admin converts it (the follow-up build the convert started).
 */
export const ChangeRequest = z
  .object({
    id: Id,
    /** The served app the request is about (absent for a dashboard first-build refusal). */
    appId: Id.optional(),
    /** The OWNER org (served-app filing) or the requester's own org (refused-build filing).
     *  Always server-resolved — this is the cross-org isolation boundary. */
    orgId: Id,
    requesterUserId: Id,
    requesterName: z.string(),
    /** The served-app route/screen the request was filed from (best-effort, panel-captured). */
    route: z.string().optional(),
    /** A short captured screen-context descriptor (panel-captured; org-internal, never egressed). */
    screenState: z.string().optional(),
    text: z.string(),
    status: ChangeRequestStatus,
    createdAt: IsoTimestamp,
    /** The patch-run job an admin's convert produced (present only when status === 'converted'). */
    jobId: Id.optional(),
  })
  .strict();
export type ChangeRequest = z.infer<typeof ChangeRequest>;

/**
 * The file-a-request body (`POST /api/v1/change-requests`). `text` is the only required field;
 * `route`/`screenState` are the panel-captured context. `appId` is honoured ONLY on the
 * dashboard (no `X-Ekoa-App-Id` header) path — for a served-app filing the header resolves the
 * app + owner org server-side and any body `appId` is ignored (never trusted for org routing).
 */
export const ChangeRequestFileRequest = z.object({
  text: z.string().min(1).max(4000),
  route: z.string().max(1000).optional(),
  screenState: z.string().max(8000).optional(),
  appId: Id.optional(),
});
export type ChangeRequestFileRequest = z.infer<typeof ChangeRequestFileRequest>;

/** Convert body: the jobId of the follow-up build the dashboard already started (H1-gated). */
export const ChangeRequestConvertRequest = z.object({ jobId: Id });
export type ChangeRequestConvertRequest = z.infer<typeof ChangeRequestConvertRequest>;

/** Queue read query. `status` narrows the list; `orgId` is honoured only for a super-admin
 *  (an org-admin is always pinned to its own org server-side — the isolation boundary). */
export const ChangeRequestQuery = z.object({
  status: ChangeRequestStatus.optional(),
  orgId: Id.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});
export type ChangeRequestQuery = z.infer<typeof ChangeRequestQuery>;

export const ChangeRequestListResponse = listResponse(ChangeRequest);
export type ChangeRequestListResponse = z.infer<typeof ChangeRequestListResponse>;

export const changeRequestsEndpoints = {
  // File a request from inside a served app (X-Ekoa-App-Id resolves app+owner org) OR from the
  // dashboard refused-build feed (own org). Requires a logged-in platform user (auth 'user').
  file: {
    method: 'POST',
    path: '/api/v1/change-requests',
    auth: 'user',
    request: ChangeRequestFileRequest,
    response: ChangeRequest,
  },
  // The org-admin queue read. org-admin sees own org; super-admin across orgs (mirrors registo).
  list: {
    method: 'GET',
    path: '/api/v1/change-requests',
    auth: 'org-admin',
    query: ChangeRequestQuery,
    response: ChangeRequestListResponse,
  },
  // Mark a request converted (the dashboard already POSTed /jobs; this links the resulting jobId).
  convert: {
    method: 'POST',
    path: '/api/v1/change-requests/:id/convert',
    auth: 'org-admin',
    request: ChangeRequestConvertRequest,
    response: ChangeRequest,
  },
  // Decline a request (status -> dismissed). org-admin own org; super-admin across orgs.
  dismiss: {
    method: 'POST',
    path: '/api/v1/change-requests/:id/dismiss',
    auth: 'org-admin',
    response: ChangeRequest,
  },
} as const satisfies DomainDescriptorMap;
