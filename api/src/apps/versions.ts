/**
 * Artifact versions (ch03 §3.8.9, ch07 §7.9). Git is the system of record; this
 * lists commits and restores the working tree to a prior commit. Ported from the
 * old handlers/artifacts-handler.ts (versionsList / versionsRestore) + tools/vcs.ts
 * (vcsRestore), adapted to system `git` (execFile) to match the ekoa-code
 * commit-guard mechanism.
 *
 * The LIST reuses `readVersions` from the ported commit-guard (services/commit-guard.ts).
 * RESTORE is a FORWARD restore: the working tree is rewritten to match the target
 * commit and committed as a NEW head tagged `[restored]` (users may roll back a
 * restore) - HEAD never moves backwards, so the audit trail is preserved. All git
 * writes run under the shared per-repo lock (§7.9) shared with commit-on-save.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync } from 'node:fs';
import * as fs from 'node:fs';
import { join } from 'node:path';
import { readVersions } from '../services/commit-guard.js';
import { withRepoLock } from '../services/repo-lock.js';
import { resolveWithinJail, sandboxRoot } from '../services/safe-path.js';
import { backupAppRepoSafe } from '../services/github/backup.js';
import { appBuilder } from './builder.js';
import type { ArtifactVersion } from '@ekoa/shared';

const execFileP = promisify(execFile);
const RESTORE_PREFIX = '[restored]';
const FAILED_PREFIX = '[build-failed]';

function gitArgs(dir: string, args: string[]): string[] {
  return ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args];
}

async function runGit(dir: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execFileP('git', gitArgs(dir, args), {
    env: env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

function isRepo(projectDir: string): boolean {
  return existsSync(join(projectDir, '.git'));
}

/** Confine the repo path to the owner sandbox and assert it is a directory. */
function validateProjectDir(projectDir: string): string {
  const resolved = resolveWithinJail(sandboxRoot(), projectDir);
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    throw new Error(`projectDir does not exist or is not a directory: ${resolved}`);
  }
  return resolved;
}

/** List commits (newest first) mapped to the shared ArtifactVersion shape. */
export async function listVersions(projectDir: string, limit = 100): Promise<ArtifactVersion[]> {
  const entries = await readVersions(projectDir, limit);
  return entries.map((e) => ({
    sha: e.sha,
    message: e.message,
    author: e.authorName,
    createdAt: new Date(e.timestamp).toISOString(),
    buildFailed: e.buildFailed,
    isRestore: e.isRestore,
  }));
}

export interface RestoreParams {
  projectDir: string;
  sha: string;
  authorName: string;
  authorEmail: string;
}

/**
 * Forward-restore the working tree to `sha` and commit a new `[restored]` head.
 * Serialized on the shared per-repo lock. Returns the new head sha (or the current
 * head when the tree already matched the target).
 */
export async function restoreVersion(params: RestoreParams): Promise<{ newHeadSha: string }> {
  const projectDir = validateProjectDir(params.projectDir);
  const { sha, authorName, authorEmail } = params;
  if (!sha) throw new Error('restoreVersion: sha is required');

  return withRepoLock(projectDir, async () => {
    if (!isRepo(projectDir)) throw new Error('restoreVersion: no version history for this artifact');

    // Echo the target commit's message in the restore commit.
    let targetSubject = '';
    try {
      targetSubject = (await runGit(projectDir, ['log', '-1', '--format=%s', sha])).trim();
    } catch {
      throw new Error(`restoreVersion: unknown version ${sha}`);
    }
    const targetMessage = targetSubject
      .replace(new RegExp(`^\\${FAILED_PREFIX}\\s*`), '')
      .replace(new RegExp(`^\\${RESTORE_PREFIX}\\s*`), '');

    // Files present at the target commit vs currently tracked on disk.
    const nul = String.fromCharCode(0);
    const atTarget = new Set(
      (await runGit(projectDir, ['ls-tree', '-r', '-z', '--name-only', sha])).split(nul).filter(Boolean),
    );
    const tracked = (await runGit(projectDir, ['ls-files', '-z'])).split(nul).filter(Boolean);
    // Remove tracked files that don't exist at the target commit.
    for (const rel of tracked) {
      if (!atTarget.has(rel)) {
        try { await fs.promises.rm(join(projectDir, rel), { force: true }); } catch { /* ignore */ }
      }
    }
    // Restore every target file back into the working tree (and index).
    if (atTarget.size > 0) await runGit(projectDir, ['checkout', sha, '--', '.']);
    await runGit(projectDir, ['add', '-A']);

    // Nothing to commit → tree already matched the target; return current head.
    if ((await runGit(projectDir, ['status', '--porcelain'])).trim() === '') {
      return { newHeadSha: (await runGit(projectDir, ['rev-parse', 'HEAD'])).trim() };
    }

    const shortSha = sha.slice(0, 7);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_AUTHOR_NAME: authorName,
      GIT_AUTHOR_EMAIL: authorEmail,
      GIT_COMMITTER_NAME: 'ekoa-agent',
      GIT_COMMITTER_EMAIL: 'agent@ekoa.local',
    };
    await runGit(
      projectDir,
      ['commit', '-m', `${RESTORE_PREFIX} Restored to ${shortSha}: ${targetMessage}`, '--no-verify', '--no-gpg-sign'],
      env,
    );
    return { newHeadSha: (await runGit(projectDir, ['rev-parse', 'HEAD'])).trim() };
  });
}

/**
 * Restore + rebuild + gated GitHub mirror push. The store update (clearing any
 * cached session, bumping updatedAt) is left to the caller so this stays free of
 * artifact-store coupling; the route owns the metadata write.
 */
export async function restoreAndRebuild(
  artifactId: string,
  params: RestoreParams,
  appName?: string,
): Promise<{ newHeadSha: string }> {
  const result = await restoreVersion(params);
  try {
    await appBuilder.unwatch(artifactId);
    await appBuilder.build(artifactId, params.projectDir);
  } catch (err) {
    console.warn(`[versions] post-restore build failed for ${artifactId}:`, err instanceof Error ? err.message : err);
  }
  // Fire-and-forget GitHub mirror push (gated by the push-enabled toggle; §7.9).
  backupAppRepoSafe(params.projectDir, { appId: artifactId, appName });
  return result;
}
