/**
 * Knowledge filesystem layout (ch04 §4.4.1). Everything derives from ONE configured data
 * directory (the carried single-data-dir rule, §4.4). The vault is org-partitioned by a path
 * segment so a firm's markdown corpus never pools across orgs:
 *
 *   <dataDir>/knowledge/vault/<orgId>/<collection>/<docId>.md   (one file per doc, frontmatter)
 *   <dataDir>/knowledge/uploads/<orgId>/<uploadId>              (raw upload blob, P-07)
 *   <dataDir>/knowledge/index/fts.db                            (derived FTS5 index, regenerable)
 *
 * Every path segment that comes from a request (collection) — and, defensively, the orgId and
 * docId — is charset-guarded so no value can escape its org partition via `..` or a separator.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Same charset guard as the collections engine / app-id header (ch04 §4.2.4). */
const SEGMENT_RE = /^[a-zA-Z0-9._-]{1,100}$/;

export class PathSafetyError extends Error {}

/** Reject any segment that could traverse out of its partition (`..`, `.`, separators, empty). */
export function assertSafeSegment(seg: string, what: string): void {
  if (seg === '.' || seg === '..' || !SEGMENT_RE.test(seg)) {
    throw new PathSafetyError(`Unsafe ${what} segment: ${JSON.stringify(seg)}`);
  }
}

export function isSafeSegment(seg: string): boolean {
  return seg !== '.' && seg !== '..' && SEGMENT_RE.test(seg);
}

/** The operational data root (carried convention, identical to apps/app-files.ts): ~/.ekoa/data,
 *  NEVER a path inside the repo. Read live (not memoized) so tests can point EKOA_DATA_DIR at a
 *  temp dir per suite. */
export function dataDir(): string {
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}

export function knowledgeRoot(): string {
  return join(dataDir(), 'knowledge');
}
export function vaultRoot(): string {
  return join(knowledgeRoot(), 'vault');
}
export function orgVaultDir(orgId: string): string {
  assertSafeSegment(orgId, 'orgId');
  return join(vaultRoot(), orgId);
}
export function collectionDir(orgId: string, collection: string): string {
  assertSafeSegment(collection, 'collection');
  return join(orgVaultDir(orgId), collection);
}
export function docPath(orgId: string, collection: string, docId: string): string {
  assertSafeSegment(docId, 'docId');
  return join(collectionDir(orgId, collection), `${docId}.md`);
}
export function uploadsDir(orgId: string): string {
  assertSafeSegment(orgId, 'orgId');
  return join(knowledgeRoot(), 'uploads', orgId);
}
export function uploadBlobPath(orgId: string, uploadId: string): string {
  assertSafeSegment(uploadId, 'uploadId');
  return join(uploadsDir(orgId), uploadId);
}
export function indexDbPath(): string {
  return join(knowledgeRoot(), 'index', 'fts.db');
}
