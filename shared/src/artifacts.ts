/** Artifacts, app-data backups, and artifact backends contract (ch03 §3.8.9-3.8.11). */
import { z } from 'zod';
import {
  Id,
  IsoTimestamp,
  itemsResponse,
  OkResponse,
  PaginationQuery,
  Visibility,
} from './common.js';
import type { DomainDescriptorMap } from './descriptor.js';

export const Artifact = z
  .object({
    id: Id,
    name: z.string(),
    slug: z.string(),
    userId: Id,
    orgId: Id,
    visibility: Visibility,
    featured: z.boolean(),
    featuredRank: z.number().int().optional(),
    shareable: z.boolean().optional(),
    data: z.record(z.unknown()).optional(),
    /**
     * The manifest id this artifact was imported from, surfaced as its OWN field because the
     * client genuinely needs it and `data` is not on the wire.
     *
     * `artifactView` deliberately does not return `data` — it holds server-owned keys like
     * `projectDir`, and shipping the bag wholesale would put a build-sandbox path in every list
     * response. But the import flow's "update the existing app or create a copy?" decision matches
     * on exactly this key, so with `data` absent the client's `i.data?.importedFrom` was always
     * `undefined` and the choice was never offered: every re-import silently made a duplicate.
     * Narrow field, not the whole bag — additive per Rule 7.
     */
    importedFrom: z.string().optional(),
    /** Thumbnail URL (`/artifact-screenshots/<id>.png`), present once a capture exists (§7.11). */
    screenshotUrl: z.string().optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
    /**
     * The chat session this artifact was built/continued from (`data.sessionId`), lifted the same
     * way as `importedFrom`: the client needs it to resolve "continue working" to the right
     * session without ever seeing the rest of the server-owned `data` bag (`projectDir`,
     * `buildSummary`, ...). Set at first build (`prepareFirstBuild`) and re-linked server-side
     * whenever a session is created FOR this artifact (`POST /sessions` with `artifactId`) - never
     * client-writable via the artifact PATCH route (`sessionId` is a reserved `data` key).
     *
     * Follow-up continuity no longer resumes an SDK transcript: the retired `data.sdkSessionId`
     * regrew an unbounded transcript that never compacted under the 1M window (token-economics
     * port, ekoa-dev `docs/token-economics.md`). Continuity now rides `data.buildSummary` — a
     * running ≤600-word engineering summary refreshed after each build — plus the files on disk and
     * a short conversation tail. Both are server-owned, off the wire, and reserved `data` keys.
     */
    sessionId: z.string().optional(),
    /**
     * The build pipeline's classified kind (`data.outputKind`) - web_app/agent_app/landing_page/
     * presentation_html/... Only ever set for FEATURED artifacts today (the seeder stamps it from
     * the catalog manifest); a chat-built own artifact has no producer for it yet and this stays
     * absent, matching pre-existing behaviour. Used for the kind label + accent colour on cards.
     */
    outputKind: z.string().optional(),
    /**
     * The served app's own canonical URL (`data.appUrl`, `/apps/<id>/`), slug-drift-immune. Absent
     * for an artifact that never built (no served app to link).
     */
    appUrl: z.string().optional(),
    /** Short description shown on Starting Point / featured cards (`data.description`). */
    description: z.string().optional(),
    /** Featured update-by-consent badge (`data.updateAvailable`, §7.13): the newer manifest
     *  version offered, or `null`/absent when none is pending. */
    updateAvailable: z.object({ version: z.string().optional() }).nullable().optional(),
    /**
     * In-page health probe verdict (`POST /api/app-health`, §7.11) - a ROW-level field (never
     * inside `data`, so no reserved-key concern), written passively by the served app itself.
     * Never surfaced before this: the "broken" badge on an artifact card has been dead since the
     * probe shipped.
     */
    health: z
      .object({
        status: z.enum(['healthy', 'broken']),
        lastCheckedAt: z.string().optional(),
        lastReason: z.string().optional(),
        lastError: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export type Artifact = z.infer<typeof Artifact>;

export const ArtifactListResponse = z.object({
  items: z.array(Artifact),
  featured: z.array(Artifact),
});
export type ArtifactListResponse = z.infer<typeof ArtifactListResponse>;

export const ArtifactPatch = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  shareable: z.boolean().optional(),
  data: z.record(z.unknown()).optional(),
  visibility: Visibility.optional(),
});
export type ArtifactPatch = z.infer<typeof ArtifactPatch>;

export const ForkArtifactRequest = z.object({ name: z.string().optional() });
export type ForkArtifactRequest = z.infer<typeof ForkArtifactRequest>;

export const ForkArtifactResponse = z.object({ id: Id, slug: z.string() });
export type ForkArtifactResponse = z.infer<typeof ForkArtifactResponse>;

export const SetFeaturedRequest = z.object({
  featured: z.boolean(),
  featuredRank: z.number().int().optional(),
});
export type SetFeaturedRequest = z.infer<typeof SetFeaturedRequest>;

export const ArtifactBundle = z
  .object({
    manifestId: z.string(),
    name: z.string().optional(),
    slug: z.string().optional(),
    /**
     * Canonical artifact id carried for MIGRATION (S3): the converter fills it from the prod
     * envelope's `sourceArtifactId`. Honoured only when the import request opts in with
     * `preserveId: true` — a plain import always mints a fresh id, exactly as before.
     */
    id: z.string().optional(),
    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    data: z.record(z.unknown()).optional(),
    version: z.string().optional(),
  })
  .passthrough();
export type ArtifactBundle = z.infer<typeof ArtifactBundle>;

export const ImportArtifactRequest = z.object({
  bundle: ArtifactBundle,
  /**
   * Explicit migration mode (S3, additive per Rule 7): adopt `bundle.id` as the new artifact's
   * canonical id, so embedded `/api/app-files/<id>/...` URLs and external rows keyed on the prod
   * appId (e.g. webhook routing) stay valid without rewrites. Refused with a 409-class error on
   * collision — never silently remapped. Absent/false keeps today's fresh-id behavior.
   */
  preserveId: z.boolean().optional(),
});
export type ImportArtifactRequest = z.infer<typeof ImportArtifactRequest>;

/** Per-collection outcome of an app-data seed on import (S3): `error` carries the reason for
 *  skipped rows (reserved name, oversized row, id collision, ...) — a skip is never silent. */
export const ImportCollectionReport = z.object({
  name: z.string(),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type ImportCollectionReport = z.infer<typeof ImportCollectionReport>;

/** App-data seeding outcome for one import. A top-level `error` reports a wholesale failure
 *  (e.g. store unavailable) that previously vanished into a console.warn. */
export const ImportAppDataReport = z.object({
  collections: z.array(ImportCollectionReport),
  imported: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type ImportAppDataReport = z.infer<typeof ImportAppDataReport>;

/**
 * What the import actually did with the bundle's identity + data (S3). `slug.fellBack` is true
 * when the bundle asked for a slug the importer could not honour (taken/invalid) and a generated
 * one was applied instead; `id.preserved` is true only in explicit preserveId mode. `appData` is
 * absent when the bundle carried no app-data (the pre-S3 data-less import, unchanged).
 */
export const ImportReport = z.object({
  slug: z.object({
    requested: z.string().optional(),
    applied: z.string(),
    fellBack: z.boolean(),
  }),
  id: z.object({
    requested: z.string().optional(),
    applied: Id,
    preserved: z.boolean(),
  }),
  appData: ImportAppDataReport.optional(),
});
export type ImportReport = z.infer<typeof ImportReport>;

/** Import response = the created Artifact plus the report (additive: `Artifact` still parses it). */
export const ImportArtifactResponse = Artifact.extend({
  importReport: ImportReport.optional(),
});
export type ImportArtifactResponse = z.infer<typeof ImportArtifactResponse>;

export const BundleUpdateRequest = z.object({
  bundle: ArtifactBundle,
  force: z.boolean().optional(),
});
export type BundleUpdateRequest = z.infer<typeof BundleUpdateRequest>;

export const BundleUpdateResponse = z.object({
  artifact: Artifact,
  safetyNetSnapshotId: Id,
  preUpdateVersionId: Id,
});
export type BundleUpdateResponse = z.infer<typeof BundleUpdateResponse>;

export const ArtifactVersion = z
  .object({
    sha: z.string(),
    message: z.string().optional(),
    author: z.string().optional(),
    createdAt: IsoTimestamp.optional(),
  })
  .passthrough();
export type ArtifactVersion = z.infer<typeof ArtifactVersion>;

export const ArtifactVersionListResponse = itemsResponse(ArtifactVersion);
export type ArtifactVersionListResponse = z.infer<typeof ArtifactVersionListResponse>;

export const RestoreVersionResponse = z.object({ newHeadSha: z.string() });
export type RestoreVersionResponse = z.infer<typeof RestoreVersionResponse>;

export const ArtifactFile = z
  .object({
    path: z.string(),
    size: z.number().int().nonnegative().optional(),
    type: z.string().optional(),
  })
  .passthrough();
export type ArtifactFile = z.infer<typeof ArtifactFile>;

export const ArtifactFilesResponse = z.object({
  files: z.array(ArtifactFile),
  projectDir: z.string().nullable(),
});
export type ArtifactFilesResponse = z.infer<typeof ArtifactFilesResponse>;

export const ReadFileQuery = z.object({ path: z.string() });
export type ReadFileQuery = z.infer<typeof ReadFileQuery>;

export const ReadFileResponse = z.object({ content: z.string() });
export type ReadFileResponse = z.infer<typeof ReadFileResponse>;

export const WriteFileRequest = z.object({ path: z.string(), content: z.string() });
export type WriteFileRequest = z.infer<typeof WriteFileRequest>;

export const WriteFileResponse = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});
export type WriteFileResponse = z.infer<typeof WriteFileResponse>;

export const BackupStatus = z
  .object({
    enabled: z.boolean().optional(),
    lastSnapshotAt: IsoTimestamp.nullable().optional(),
    restorePointCount: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type BackupStatus = z.infer<typeof BackupStatus>;

export const BackupRestorePoint = z
  .object({
    pointId: Id,
    source: z.string(),
    at: IsoTimestamp,
    size: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type BackupRestorePoint = z.infer<typeof BackupRestorePoint>;

export const AppDataDump = z
  .object({
    collections: z.record(z.array(z.record(z.unknown()))).optional(),
    at: IsoTimestamp.optional(),
  })
  .passthrough();
export type AppDataDump = z.infer<typeof AppDataDump>;

export const BackupPointRef = z.object({
  pointId: Id,
  source: z.string(),
  at: IsoTimestamp,
});
export type BackupPointRef = z.infer<typeof BackupPointRef>;

export const BackupRestoreResponse = z.object({
  restored: z.number().int().nonnegative(),
  cleared: z.number().int().nonnegative(),
  safetyNetId: Id,
});
export type BackupRestoreResponse = z.infer<typeof BackupRestoreResponse>;

export const BackendStatus = z
  .object({
    hasBackend: z.boolean(),
    status: z.string(),
    declared: z.record(z.unknown()).nullable(),
  })
  .passthrough();
export type BackendStatus = z.infer<typeof BackendStatus>;

export const BackendLogEntry = z
  .object({
    at: IsoTimestamp,
    level: z.string().optional(),
    message: z.string(),
  })
  .passthrough();
export type BackendLogEntry = z.infer<typeof BackendLogEntry>;

export const BackendLogListResponse = itemsResponse(BackendLogEntry);
export type BackendLogListResponse = z.infer<typeof BackendLogListResponse>;

export const BackendInvocation = z
  .object({
    id: Id,
    entrypoint: z.string(),
    at: IsoTimestamp,
    status: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();
export type BackendInvocation = z.infer<typeof BackendInvocation>;

export const BackendInvocationListResponse = itemsResponse(BackendInvocation);
export type BackendInvocationListResponse = z.infer<typeof BackendInvocationListResponse>;

export const BackendSetEnabledRequest = z.object({ enabled: z.boolean() });
export type BackendSetEnabledRequest = z.infer<typeof BackendSetEnabledRequest>;

export const BackendSetEnabledResponse = z.object({ enabled: z.boolean() });
export type BackendSetEnabledResponse = z.infer<typeof BackendSetEnabledResponse>;

export const BackendSampleRunRequest = z.object({
  entrypoint: z.string(),
  input: z.unknown(),
});
export type BackendSampleRunRequest = z.infer<typeof BackendSampleRunRequest>;

export const BackendSampleRunResponse = z
  .object({
    result: z.unknown(),
    dryRunEffects: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();
export type BackendSampleRunResponse = z.infer<typeof BackendSampleRunResponse>;

export const artifactsEndpoints = {
  list: {
    method: 'GET',
    path: '/api/v1/artifacts',
    auth: 'user',
    response: ArtifactListResponse,
  },
  get: {
    method: 'GET',
    path: '/api/v1/artifacts/:id',
    auth: 'user',
    response: Artifact,
  },
  patch: {
    method: 'PATCH',
    path: '/api/v1/artifacts/:id',
    auth: 'user',
    request: ArtifactPatch,
    response: Artifact,
  },
  remove: {
    method: 'DELETE',
    path: '/api/v1/artifacts/:id',
    auth: 'user',
    response: OkResponse,
  },
  fork: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/fork',
    auth: 'user',
    request: ForkArtifactRequest,
    response: ForkArtifactResponse,
  },
  setFeatured: {
    method: 'PUT',
    path: '/api/v1/artifacts/:id/featured',
    auth: 'super-admin',
    request: SetFeaturedRequest,
    response: Artifact,
  },
  export: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/export',
    auth: 'user',
    response: ArtifactBundle,
  },
  import: {
    method: 'POST',
    path: '/api/v1/artifacts/import',
    auth: 'user',
    request: ImportArtifactRequest,
    response: ImportArtifactResponse,
  },
  bundleUpdate: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/bundle-update',
    auth: 'user',
    request: BundleUpdateRequest,
    response: BundleUpdateResponse,
  },
  featuredUpdateApply: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/featured-update/apply',
    auth: 'user',
    response: OkResponse,
  },
  featuredUpdateIgnore: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/featured-update/ignore',
    auth: 'user',
    response: OkResponse,
  },
  versionsList: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/versions',
    auth: 'user',
    query: PaginationQuery,
    response: ArtifactVersionListResponse,
  },
  versionsRestore: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/versions/:sha/restore',
    auth: 'user',
    response: RestoreVersionResponse,
  },
  filesList: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/files',
    auth: 'user',
    response: ArtifactFilesResponse,
  },
  readFile: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/file',
    auth: 'user',
    query: ReadFileQuery,
    response: ReadFileResponse,
  },
  writeFile: {
    method: 'PUT',
    path: '/api/v1/artifacts/:id/file',
    auth: 'user',
    request: WriteFileRequest,
    response: WriteFileResponse,
  },
  download: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/download',
    auth: 'user',
    kind: 'binary',
  },
  pdf: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/pdf',
    auth: 'user',
    kind: 'redirect',
  },
  backupStatus: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/backups',
    auth: 'user',
    response: BackupStatus,
  },
  backupSnapshot: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/backups',
    auth: 'user',
    response: BackupRestorePoint,
  },
  backupExport: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/backups/export',
    auth: 'user',
    response: AppDataDump,
  },
  backupPreview: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/backups/preview',
    auth: 'user',
    request: BackupPointRef,
    response: AppDataDump,
  },
  backupRestore: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/backups/restore',
    auth: 'user',
    request: BackupPointRef,
    response: BackupRestoreResponse,
  },
  backendStatus: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/backend',
    auth: 'user',
    response: BackendStatus,
  },
  backendLogs: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/backend/logs',
    auth: 'user',
    query: PaginationQuery,
    response: BackendLogListResponse,
  },
  backendInvocations: {
    method: 'GET',
    path: '/api/v1/artifacts/:id/backend/invocations',
    auth: 'user',
    query: PaginationQuery,
    response: BackendInvocationListResponse,
  },
  backendSetEnabled: {
    method: 'PUT',
    path: '/api/v1/artifacts/:id/backend/enabled',
    auth: 'user',
    request: BackendSetEnabledRequest,
    response: BackendSetEnabledResponse,
  },
  backendSampleRun: {
    method: 'POST',
    path: '/api/v1/artifacts/:id/backend/sample-run',
    auth: 'user',
    request: BackendSampleRunRequest,
    response: BackendSampleRunResponse,
  },
} as const satisfies DomainDescriptorMap;
