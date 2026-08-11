/**
 * Chat-attachment upload staging (WS4a, 2026-08-08). A composer file/screenshot/folder pick is
 * staged here BEFORE it rides a chat/build run as an `UploadRef` (`shared/src/common.ts`) - the
 * server never trusts a client-supplied filesystem path, only an opaque `uploadId` it minted.
 *
 * Layout (carried convention, identical in spirit to `knowledge/paths.ts` / `apps/app-files.ts` -
 * each module keeps its own copy rather than sharing one, ch04 §4.4):
 *
 *   <dataDir>/uploads/<userId>/<uploadId>/<sanitized-filename>        (single file)
 *   <dataDir>/uploads/<userId>/folders/<sanitized-folder>/<relPath>   (a picked folder's files)
 *
 * Per-USER, not per-org: these are ephemeral single-turn composer attachments, not the org
 * knowledge vault - a colleague in the same org must not be able to address another user's
 * staged upload by guessing its id.
 *
 * `uploadId` is server-generated (`deps.genId()`), so it is inherently safe as a path segment;
 * `userId` is the verified JWT subject, likewise server-controlled. `filename` and `folder` are
 * the only request-derived segments and are charset-guarded/sanitized before they touch a path.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

const SEGMENT_RE = /^[a-zA-Z0-9._-]{1,200}$/;

/** Same charset guard as knowledge/paths.ts's assertSafeSegment - rejects `.`/`..`/separators. */
export function isSafeSegment(seg: string): boolean {
  return seg !== '.' && seg !== '..' && SEGMENT_RE.test(seg);
}

/** Unicode-preserving display-name sanitizer (carried from apps/app-files.ts's
 *  sanitizeFilename): keeps letters/digits in any script plus `._-() `, replaces everything
 *  else (path separators, quotes, control chars) with `_`, caps at 200 chars. */
function sanitizeSegment(raw: string): string {
  const safe = raw.replace(/[^\p{L}\p{N}._\-() ]/gu, '_').trim().slice(0, 200);
  return safe && safe !== '.' && safe !== '..' ? safe : '_';
}

/** Split on any path separator the client might have sent (a folder pick's relative path uses
 *  `/`; be defensive about `\` too) and sanitize each segment independently, so a relative path
 *  can never smuggle a `..` traversal or an absolute-path escape through one dirty segment. */
export function sanitizeRelativePath(raw: string): string {
  const parts = raw.split(/[\\/]+/).map(sanitizeSegment).filter(Boolean);
  return parts.length ? parts.join('/') : 'unnamed';
}

export { sanitizeSegment };

/** The operational data root (carried convention): ~/.ekoa/data, NEVER a path inside the repo.
 *  Read live (not memoized) so tests can point EKOA_DATA_DIR at a temp dir per suite. */
export function dataDir(): string {
  return process.env.EKOA_DATA_DIR || join(homedir(), '.ekoa', 'data');
}
export function uploadsRoot(): string {
  return join(dataDir(), 'uploads');
}
export function userUploadsDir(userId: string): string {
  return join(uploadsRoot(), userId);
}
/** Single-file upload directory: one upload id, one blob inside it (the directory's only file
 *  IS the blob - no metadata sidecar, so `resolveUpload` recovers the filename via readdir). */
export function uploadDir(userId: string, uploadId: string): string {
  return join(userUploadsDir(userId), uploadId);
}
export function folderRoot(userId: string, folder: string): string {
  return join(userUploadsDir(userId), 'folders', sanitizeSegment(folder));
}
