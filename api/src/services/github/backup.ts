/**
 * GitHub backup + lazy-hydration orchestration (spec/07 §7.9, GitHub mirror +
 * lazy hydration).
 *
 * backupAppRepo: after a snapshot, ensure the app's private repo exists and push to
 * it. GATED behind GITHUB_PUSH_ENABLED (default OFF) - critical, because auto-commit
 * fires for every real build; we must never push real apps unintentionally.
 *
 * hydrateAppRepoIfMissing: if a wiped volume no longer has the working copy on disk,
 * clone it back from GitHub on next open (lazy hydration).
 *
 * BLOCKED FOR PROD E2E: needs the registered App (or a dev token). The gating and
 * orchestration are unit-tested with injected git; real push/clone are proven only
 * via the opt-in dev smoke.
 */

import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { getGitHubProvider, isPushEnabled, isGitHubConfigured, readGitHubConfig } from './provider.js';
import { ensureAppRepo, repoNameForApp } from './repos.js';
import { ensureRemote, pushRepo, cloneRepo, type RemoteDeps } from './git-remote.js';
import { withRepoLock } from '../repo-lock.js';

export interface BackupResult {
  pushed: boolean;
  reason?: 'push-disabled' | 'not-configured' | 'error';
  repo?: string;
  error?: string;
}

export interface BackupOpts extends RemoteDeps {
  appId?: string;
  appName?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Ensure the repo exists and push the working copy. Serialized on the same per-repo
 * lock as commits so a push can't interleave with a commit.
 */
export async function backupAppRepo(projectDir: string, opts: BackupOpts = {}): Promise<BackupResult> {
  if (!isPushEnabled()) return { pushed: false, reason: 'push-disabled' };
  const provider = getGitHubProvider();
  if (!provider) return { pushed: false, reason: 'not-configured' };

  const appId = opts.appId ?? basename(projectDir);
  const appName = opts.appName ?? appId;

  return withRepoLock(projectDir, async () => {
    const token = await provider.getToken();
    const ref = await ensureAppRepo(provider, { appId, appName, fetchImpl: opts.fetchImpl });
    await ensureRemote(projectDir, ref.cloneUrl, { run: opts.run });
    await pushRepo(projectDir, {
      url: ref.cloneUrl,
      token,
      branch: 'main',
      force: false,
      run: opts.run,
    });
    return { pushed: true, repo: ref.repo };
  });
}

/**
 * Fire-and-forget backup that never throws — safe to call after any snapshot. No-op
 * (and silent) when push is disabled or GitHub isn't configured.
 */
export function backupAppRepoSafe(projectDir: string, opts: BackupOpts = {}): void {
  if (!isPushEnabled()) return; // cheap early-out: no logging noise on every commit
  void backupAppRepo(projectDir, opts)
    .then((r) => {
      if (r.pushed) console.log(`[github-backup] pushed ${r.repo}`);
      else if (r.reason === 'error') console.warn('[github-backup] failed:', r.error);
    })
    .catch((err) => console.warn('[github-backup] failed:', err instanceof Error ? err.message : err));
}

export interface HydrateResult {
  hydrated: boolean;
  reason?: 'present' | 'not-configured';
}

/**
 * If the working copy is missing on disk (wiped volume), clone it back from GitHub.
 * Returns {hydrated:false, reason:'present'} when nothing to do.
 */
export async function hydrateAppRepoIfMissing(
  projectDir: string,
  appId: string,
  deps: RemoteDeps = {},
): Promise<HydrateResult> {
  if (existsSync(projectDir)) return { hydrated: false, reason: 'present' };
  if (!isGitHubConfigured()) return { hydrated: false, reason: 'not-configured' };

  const provider = getGitHubProvider()!;
  const cfg = readGitHubConfig();
  const repo = repoNameForApp(appId, cfg.repoPrefix);
  const url = `https://github.com/${provider.owner}/${repo}.git`;
  const token = await provider.getToken();
  await cloneRepo({ url, token, dir: projectDir, run: deps.run });
  return { hydrated: true };
}
