/**
 * Template-based fork ("Use this app") — spec/07 §7.10 (reuses §7.9 remote ops).
 *
 * Fork = generate-from-template, NOT a literal fork: mark a featured app's repo as
 * a template, then create a fresh private repo for the new user from it (a clean
 * copy, no upstream link), and clone it into the new sandbox.
 *
 * Additive + gated: when GitHub isn't configured this is a no-op and the caller
 * falls back to the existing on-disk clone. The on-disk fork stays live.
 *
 * BLOCKED FOR PROD E2E: needs the registered App and featured repos marked as
 * templates. Orchestration is unit-tested with injected fetch/git.
 */

import { getGitHubProvider, isGitHubConfigured, readGitHubConfig } from './provider.js';
import { generateFromTemplate, setRepoTemplate, repoNameForApp, waitForRepoReady } from './repos.js';
import { cloneRepo, type RemoteDeps } from './git-remote.js';

export interface MarkTemplateResult {
  marked: boolean;
  reason?: 'not-configured' | 'error';
  error?: string;
}

/** Mark a featured app's repo as a GitHub template. Gated; never throws. */
export async function markAppAsTemplate(appId: string, fetchImpl?: typeof fetch): Promise<MarkTemplateResult> {
  if (!isGitHubConfigured()) return { marked: false, reason: 'not-configured' };
  const provider = getGitHubProvider()!;
  const repo = repoNameForApp(appId, readGitHubConfig().repoPrefix);
  try {
    await setRepoTemplate(provider, repo, true, fetchImpl ?? fetch);
    return { marked: true };
  } catch (err) {
    return { marked: false, reason: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

export interface ForkViaTemplateResult {
  forked: boolean;
  reason?: 'not-configured';
  repo?: string;
}

export interface ForkViaTemplateOpts extends RemoteDeps {
  sourceAppId: string;
  newAppId: string;
  description: string;
  newProjectDir: string;
  fetchImpl?: typeof fetch;
}

/**
 * Generate a fresh repo from the source app's template repo and clone it into
 * `newProjectDir`. Returns {forked:false, reason:'not-configured'} when GitHub
 * isn't set up, so the caller can fall back to the on-disk clone.
 */
export async function forkAppViaTemplate(opts: ForkViaTemplateOpts): Promise<ForkViaTemplateResult> {
  if (!isGitHubConfigured()) return { forked: false, reason: 'not-configured' };
  const provider = getGitHubProvider()!;
  const cfg = readGitHubConfig();
  const templateRepo = repoNameForApp(opts.sourceAppId, cfg.repoPrefix);

  const ref = await generateFromTemplate(provider, {
    templateOwner: provider.owner,
    templateRepo,
    newAppId: opts.newAppId,
    description: opts.description,
    fetchImpl: opts.fetchImpl,
  });

  // GitHub copies the template asynchronously — wait until the new repo has a
  // commit, otherwise the clone below would fetch an empty repo.
  await waitForRepoReady(provider, ref.repo, { fetchImpl: opts.fetchImpl });

  const token = await provider.getToken();
  await cloneRepo({
    url: ref.cloneUrl,
    token,
    dir: opts.newProjectDir,
    run: opts.run,
  });

  return { forked: true, repo: ref.repo };
}
