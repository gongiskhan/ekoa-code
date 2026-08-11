/**
 * Chat-attachment upload staging - the two operations the rest of the platform needs:
 * `stageUpload` (routes/uploads.ts, WRITE the blob a composer just posted) and
 * `stageRunAttachments` (agents/chat.ts, READ a run's referenced blobs into a fresh, run-scoped
 * directory the Agent SDK subprocess can see). Nothing else is exposed - there is no list/delete
 * surface (`shared/src/uploads.ts` declares `create` only); a staged file lives until its host
 * volume is reclaimed, which is a known, accepted gap for v1 (composer attachments are small and
 * few; see docs/decisions.md if a retention job becomes worth building).
 */
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { isSafeSegment, sanitizeRelativePath, folderRoot as folderRootPath, uploadDir, userUploadsDir } from './paths.js';
import { resolveWithinJail, UnsafePathError } from '../services/safe-path.js';

export interface StageUploadInput {
  /** As sent by the client (X-Filename), decoded but NOT yet sanitized. */
  filename: string;
  /** X-Folder, present when this blob is one file of a picked folder. */
  folder?: string;
  bytes: Buffer;
}

export interface StagedUpload {
  uploadId: string;
  displayName: string;
  size: number;
  folderRoot?: string;
}

/** Persist one staged blob under the caller's per-user upload area. Folder uploads share ONE
 *  stable directory per (user, folder) across the whole batch (every file in a picked folder
 *  posts with the same `X-Folder` header) so `folderRoot` is identical for all of them; a plain
 *  file gets its OWN fresh directory named by its uploadId. */
export async function stageUpload(userId: string, input: StageUploadInput, deps: { genId: () => string }): Promise<StagedUpload> {
  const uploadId = deps.genId();
  const relPath = sanitizeRelativePath(input.filename);

  if (input.folder) {
    const root = folderRootPath(userId, input.folder);
    const segments = relPath.split('/');
    const dest = join(root, ...segments);
    await mkdir(join(root, ...segments.slice(0, -1)), { recursive: true });
    await writeFile(dest, input.bytes);
    return { uploadId, displayName: relPath, size: input.bytes.length, folderRoot: root };
  }

  const dir = uploadDir(userId, uploadId);
  const displayName = basename(relPath) || 'unnamed';
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, displayName), input.bytes);
  return { uploadId, displayName, size: input.bytes.length };
}

/** Resolve a single-file upload back to its absolute blob path + original display name. Folder
 *  uploads are addressed by `folderRoot`, never by `uploadId` (WS4b's concern, not this one).
 *  Returns null for an unknown, foreign (another user's) or malformed id - never throws, so a
 *  stale/garbage-collected reference degrades gracefully instead of erroring the whole run.
 *
 *  DOUBLE-GATED (belt-and-braces, matching the F25 sandbox comment's posture): the charset guard
 *  (`isSafeSegment`) rejects a `uploadId` shaped like a traversal before it ever touches a path
 *  (the primary gate - `uploadId` is a flat, server-minted id, never legitimately more than one
 *  segment); `resolveWithinJail` (`services/safe-path.ts`, the SAME primitive `apps/` and
 *  `automation/` use) then re-confines the resolved directory by REALPATH, so even a directory
 *  that turned out to be a symlink pointing at another tenant's tree - planted by some means
 *  outside this module's own write path, which never creates one - fails closed instead of being
 *  trusted. */
export async function resolveUpload(userId: string, uploadId: string): Promise<{ path: string; displayName: string } | null> {
  if (!isSafeSegment(uploadId)) return null;
  let dir: string;
  try {
    dir = resolveWithinJail(userUploadsDir(userId), uploadId);
  } catch (e) {
    if (e instanceof UnsafePathError) return null;
    throw e;
  }
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const displayName = entries[0];
  if (!displayName || entries.length !== 1) return null; // exactly one blob per upload dir, by construction
  let path: string;
  try {
    path = resolveWithinJail(userUploadsDir(userId), join(uploadId, displayName));
  } catch (e) {
    if (e instanceof UnsafePathError) return null;
    throw e;
  }
  try {
    await stat(path);
  } catch {
    return null;
  }
  return { path, displayName };
}

export interface RunAttachment {
  displayName: string;
}
export interface RunAttachments {
  /** A FRESH temp directory containing ONLY the files referenced by this run's attachments -
   *  never the user's whole upload history (that would hand a Glob/Read-capable run every file
   *  the user ever attached in any session, not just this turn's). Caller owns cleanup. */
  dir: string;
  files: RunAttachment[];
}

/** Copy the blobs behind a run's `UploadRef`s into a run-scoped staging directory the Agent SDK
 *  subprocess can be pointed at via `cwd`/`homeDir` (agents/chat.ts's text-attachments class).
 *  Unknown/foreign refs are silently dropped; returns null when nothing resolved (the caller
 *  then leaves `cwd` unset and the run gets the ordinary empty F25 sandbox). */
export async function stageRunAttachments(userId: string, refs: Array<{ uploadId: string }>): Promise<RunAttachments | null> {
  if (!refs.length) return null;
  const dir = await mkdtemp(join(tmpdir(), 'ekoa-attach-'));
  const files: RunAttachment[] = [];
  try {
    for (const ref of refs) {
      const resolved = await resolveUpload(userId, ref.uploadId);
      if (!resolved) continue;
      const bytes = await readFile(resolved.path);
      await writeFile(join(dir, resolved.displayName), bytes);
      files.push({ displayName: resolved.displayName });
    }
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
  if (!files.length) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    return null;
  }
  return { dir, files };
}

/** Discard a run-attachments directory (fire-and-forget from the caller's cleanup path, same
 *  shape as llm/client.ts's F25 `discardSandbox` - a cleanup failure is logged, never silent). */
export async function discardRunAttachments(dir: string | undefined): Promise<void> {
  if (!dir) return;
  await rm(dir, { recursive: true, force: true }).catch((err) =>
    console.warn('[uploads] run-attachments cleanup failed:', err instanceof Error ? err.message : err),
  );
}
