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
    /** Thumbnail URL (`/artifact-screenshots/<id>.png`), present once a capture exists (§7.11). */
    screenshotUrl: z.string().optional(),
    createdAt: IsoTimestamp.optional(),
    updatedAt: IsoTimestamp.optional(),
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
    files: z.array(z.object({ path: z.string(), content: z.string() })).optional(),
    data: z.record(z.unknown()).optional(),
    version: z.string().optional(),
  })
  .passthrough();
export type ArtifactBundle = z.infer<typeof ArtifactBundle>;

export const ImportArtifactRequest = z.object({ bundle: ArtifactBundle });
export type ImportArtifactRequest = z.infer<typeof ImportArtifactRequest>;

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
    response: Artifact,
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
