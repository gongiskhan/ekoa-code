/**
 * GitHub repo operations for the per-app repo model (spec/07 §7.9; ports as-is).
 *
 * One private repo per app, deterministically named `${prefix}{appId}` (app IDs
 * are stable; slugs change/collide), with the human-readable app name in the
 * description. "Fork" of a featured app = generate-from-template, not a literal
 * fork.
 *
 * All calls go through a GitHubProvider token (App installation token in prod, dev
 * token in dev). No PAT client-side, no github.com URL surfaced to users.
 *
 * BLOCKED FOR PROD E2E: real repo creation needs the registered GitHub App. These
 * are unit-tested against a mocked fetch; the create/generate paths run for real
 * only via the opt-in dev smoke.
 */

import type { GitHubProvider, OwnerType } from './provider.js';
import { readGitHubConfig } from './provider.js';

const GITHUB_API = 'https://api.github.com';

export interface RepoRef {
  owner: string;
  repo: string;
  htmlUrl: string;
  cloneUrl: string;
  isTemplate: boolean;
  created: boolean;
}

export function repoNameForApp(appId: string, prefix = readGitHubConfig().repoPrefix): string {
  // App IDs are uuids/slugs already safe for repo names; normalize defensively.
  return `${prefix}${appId}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100);
}

async function ghFetch(
  provider: GitHubProvider,
  path: string,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const token = await provider.getToken();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  return fetchImpl(`${GITHUB_API}${path}`, { ...init, headers });
}

function toRepoRef(data: Record<string, unknown>, created: boolean): RepoRef {
  return {
    owner: ((data.owner as Record<string, unknown> | undefined)?.login as string) || '',
    repo: (data.name as string) || '',
    htmlUrl: (data.html_url as string) || '',
    cloneUrl: (data.clone_url as string) || '',
    isTemplate: Boolean(data.is_template),
    created,
  };
}

/**
 * Ensure a private repo exists for this app. Returns the existing repo (created:
 * false) or creates it (created: true). Idempotent.
 */
export async function ensureAppRepo(
  provider: GitHubProvider,
  opts: { appId: string; appName: string; ownerType?: OwnerType; fetchImpl?: typeof fetch },
): Promise<RepoRef> {
  const cfg = readGitHubConfig();
  const ownerType = opts.ownerType ?? cfg.ownerType;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const repo = repoNameForApp(opts.appId, cfg.repoPrefix);
  const owner = provider.owner;

  const existing = await ghFetch(provider, `/repos/${owner}/${repo}`, {}, fetchImpl);
  if (existing.ok) {
    return toRepoRef((await existing.json()) as Record<string, unknown>, false);
  }
  if (existing.status !== 404) {
    const body = await existing.text().catch(() => '');
    throw new Error(`GitHub repo lookup failed (${existing.status}): ${body}`);
  }

  // Create. Org and user accounts use different endpoints.
  const createPath = ownerType === 'org' ? `/orgs/${owner}/repos` : `/user/repos`;
  const created = await ghFetch(
    provider,
    createPath,
    {
      method: 'POST',
      body: JSON.stringify({
        name: repo,
        private: true,
        description: opts.appName,
        auto_init: false,
        has_issues: false,
        has_wiki: false,
        has_projects: false,
      }),
    },
    fetchImpl,
  );
  if (!created.ok) {
    const body = await created.text().catch(() => '');
    throw new Error(`GitHub repo create failed (${created.status}): ${body}`);
  }
  return toRepoRef((await created.json()) as Record<string, unknown>, true);
}

/** Whether a repo has at least one commit (i.e. content has landed). */
export async function repoHasCommits(
  provider: GitHubProvider,
  repo: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const res = await ghFetch(provider, `/repos/${provider.owner}/${repo}/commits?per_page=1`, {}, fetchImpl);
  if (!res.ok) return false;
  const arr = (await res.json()) as unknown;
  return Array.isArray(arr) && arr.length >= 1;
}

/**
 * Wait until a repo has content. generate-from-template populates the new repo
 * ASYNCHRONOUSLY on GitHub's side, so cloning immediately after the create call
 * returns can clone an empty repo. Poll until a commit exists. Returns true when
 * ready, false on timeout (caller may proceed anyway). `sleep` is injectable for tests.
 */
export async function waitForRepoReady(
  provider: GitHubProvider,
  repo: string,
  opts: { tries?: number; delayMs?: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const tries = opts.tries ?? 30;
  const delayMs = opts.delayMs ?? 1000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < tries; i++) {
    if (await repoHasCommits(provider, repo, fetchImpl)) return true;
    if (i < tries - 1) await sleep(delayMs);
  }
  return false;
}

/** Mark (or unmark) a repo as a template — used for featured apps. */
export async function setRepoTemplate(
  provider: GitHubProvider,
  repo: string,
  isTemplate: boolean,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await ghFetch(
    provider,
    `/repos/${provider.owner}/${repo}`,
    { method: 'PATCH', body: JSON.stringify({ is_template: isTemplate }) },
    fetchImpl,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub set-template failed (${res.status}): ${body}`);
  }
}

/**
 * Generate a fresh private repo from a template repo (the "Use this app" path). A
 * clean copy with no upstream link — none of the private-fork quirks.
 */
export async function generateFromTemplate(
  provider: GitHubProvider,
  opts: {
    templateOwner: string;
    templateRepo: string;
    newAppId: string;
    description: string;
    ownerType?: OwnerType;
    fetchImpl?: typeof fetch;
  },
): Promise<RepoRef> {
  const cfg = readGitHubConfig();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const newRepo = repoNameForApp(opts.newAppId, cfg.repoPrefix);
  const res = await ghFetch(
    provider,
    `/repos/${opts.templateOwner}/${opts.templateRepo}/generate`,
    {
      method: 'POST',
      body: JSON.stringify({
        owner: provider.owner,
        name: newRepo,
        description: opts.description,
        private: true,
        include_all_branches: false,
      }),
    },
    fetchImpl,
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub generate-from-template failed (${res.status}): ${body}`);
  }
  return toRepoRef((await res.json()) as Record<string, unknown>, true);
}
