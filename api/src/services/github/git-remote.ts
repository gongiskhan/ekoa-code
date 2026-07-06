/**
 * Git remote operations (push / clone / origin) for app repos, over git's smart
 * HTTP transport (spec/07 §7.9, GitHub mirror).
 *
 * Auth uses the GitHub-recommended token-in-URL basic-auth form
 * (`https://x-access-token:<token>@github.com/...`), passed EXPLICITLY at push/clone
 * time and never persisted into `.git/config` (origin keeps the clean URL).
 *
 * GIT MECHANISM: the old pipeline used `isomorphic-git` (not a dependency here);
 * this ports to system `git` via `execFile` (never `exec`, never a shell), with a
 * `run` seam injectable for unit tests. Real push/clone require a live remote, so
 * against real GitHub they are exercised only by the opt-in dev smoke; the
 * orchestration here (auth shape, ref, force, gating) is what the suites cover.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/** Run `git`; when `dir` is set, operate inside it. Returns stdout. Injectable in tests. */
export type GitRunner = (dir: string | null, args: string[]) => Promise<string>;

export interface RemoteDeps {
  run?: GitRunner;
}

const defaultRun: GitRunner = async (dir, args) => {
  const full = dir ? ['-C', dir, '-c', 'core.hooksPath=/dev/null', ...args] : args;
  const { stdout } = await execFileP('git', full, { maxBuffer: 32 * 1024 * 1024 });
  return stdout;
};

/** Embed the installation token as basic-auth in an https clone URL. */
export function withTokenUrl(url: string, token: string): string {
  const u = new URL(url);
  u.username = 'x-access-token';
  u.password = token;
  return u.toString();
}

/** Ensure `origin` on the repo points at `url` (the clean, token-free URL). */
export async function ensureRemote(projectDir: string, url: string, deps: RemoteDeps = {}): Promise<void> {
  const run = deps.run ?? defaultRun;
  let current: string | null = null;
  try {
    current = (await run(projectDir, ['remote', 'get-url', 'origin'])).trim();
  } catch {
    current = null; // no origin yet
  }
  if (current === null) {
    await run(projectDir, ['remote', 'add', 'origin', url]);
  } else if (current !== url) {
    await run(projectDir, ['remote', 'set-url', 'origin', url]);
  }
}

export async function pushRepo(
  projectDir: string,
  opts: { url: string; token: string; branch?: string; force?: boolean } & RemoteDeps,
): Promise<void> {
  const run = opts.run ?? defaultRun;
  const branch = opts.branch ?? 'main';
  const args = ['push'];
  if (opts.force) args.push('--force');
  // Push to the token-embedded URL explicitly so the credential is never written
  // to .git/config; local branch HEAD -> remote branch.
  args.push(withTokenUrl(opts.url, opts.token), `HEAD:refs/heads/${branch}`);
  await run(projectDir, args);
}

export async function cloneRepo(
  opts: { url: string; token: string; dir: string } & RemoteDeps,
): Promise<void> {
  const run = opts.run ?? defaultRun;
  await run(null, ['clone', '--single-branch', withTokenUrl(opts.url, opts.token), opts.dir]);
}
