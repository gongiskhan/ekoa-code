/**
 * Artifact source-file service (ch03 §3.8.9, ch07 §7.9 commit-on-save). Ported
 * from the old services/artifact-files.ts + handlers/artifacts-handler.ts
 * (read-file / write-file / list-files), adapted to the ekoa-code path-confinement
 * helper (services/safe-path.ts) and commit pipeline (services/commit-guard.ts).
 *
 * PATH MODEL (spec P-15): the path is PROJECT-RELATIVE and confined server-side to
 * the artifact's own project dir - the old sandbox-absolute path input is retired
 * (ch03 §3.8.9). Every read/write resolves through `resolveWithinJail(projectDir,
 * path)`, which rejects traversal, absolute escapes, and symlink redirects.
 *
 * WRITE is commit-on-save: after the file lands on disk, the change is committed
 * under the shared per-repo lock through the secret-guarded snapshot path; a
 * detected credential blocks the version (loudly, with a `commit-blocked` audit
 * row) but never loses the file, and a successful commit fires the gated GitHub
 * mirror push.
 */
import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { resolveWithinJail, UnsafePathError } from '../services/safe-path.js';
import { commitSnapshot, SecretCommitError, type SnapshotAudit } from '../services/commit-guard.js';
import { backupAppRepoSafe } from '../services/github/backup.js';
import type { ArtifactFile } from '@ekoa/shared';

/** Directories excluded from the Files panel tree (build output, VCS, per-app data). */
const FILE_TREE_EXCLUDE = new Set([
  'node_modules', 'dist', 'dist-backend', '.git', '.versions', '.sdk-session', '.claude', 'session-env', 'app-data',
]);

export class FilePathError extends Error {}

/** Confine a project-relative path to the artifact's project dir. */
function confine(projectDir: string, path: string): string {
  try {
    return resolveWithinJail(projectDir, path);
  } catch (e) {
    if (e instanceof UnsafePathError) throw new FilePathError('Access denied: path outside project');
    throw e;
  }
}

/** Read a project file's UTF-8 contents. Throws FilePathError on escape/missing. */
export async function readArtifactFile(projectDir: string, path: string): Promise<string> {
  const abs = confine(projectDir, path);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new FilePathError(`File not found: ${path}`);
  return fsReadFile(abs, 'utf-8');
}

export interface WriteResult {
  path: string;
  size: number;
  committed: boolean;
  warning?: string;
}

/**
 * Write UTF-8 content to a project file, then commit-on-save. `audit` (actor +
 * deps) lets a blocked commit write the `commit-blocked` row. Never throws for a
 * commit failure - the file is already saved.
 */
export async function writeArtifactFile(
  projectDir: string,
  path: string,
  content: string,
  authorName: string,
  audit: SnapshotAudit,
  opts: { appId?: string; appName?: string } = {},
): Promise<WriteResult> {
  const abs = confine(projectDir, path);
  await mkdir(dirname(abs), { recursive: true });
  await fsWriteFile(abs, content, 'utf-8');
  const size = Buffer.byteLength(content);

  let committed = false;
  let warning: string | undefined;
  try {
    const r = await commitSnapshot({
      projectDir,
      message: `Edição manual: ${path}`,
      authorName,
      authorEmail: `${authorName}@ekoa.local`,
      audit,
    });
    committed = r.createdNew;
    // Gated GitHub mirror push after a successful new commit (§7.9).
    if (r.createdNew) backupAppRepoSafe(projectDir, { appId: opts.appId, appName: opts.appName });
  } catch (err) {
    if (err instanceof SecretCommitError) {
      warning =
        'Ficheiro guardado, mas não foi adicionado ao histórico: detetámos uma credencial. Remova-a para guardar esta versão.';
    } else {
      console.warn(`[artifact-files] commit after save failed for ${projectDir}:`, err instanceof Error ? err.message : err);
    }
  }
  return { path, size, committed, ...(warning ? { warning } : {}) };
}

/**
 * Walk an app's project dir and return the files a user recognises as their own
 * (build output, VCS state, per-app data excluded), capped and sorted.
 */
export async function listArtifactFiles(projectDir: string, maxFiles = 500): Promise<ArtifactFile[]> {
  const out: ArtifactFile[] = [];
  async function walk(dir: string): Promise<void> {
    if (out.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (FILE_TREE_EXCLUDE.has(entry.name)) continue;
      if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        let size = 0;
        try { size = (await stat(full)).size; } catch { /* keep 0 */ }
        out.push({ path: relative(projectDir, full).split(sep).join('/'), size });
      }
    }
  }
  await walk(projectDir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
