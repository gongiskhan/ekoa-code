/**
 * Symlink-hardened path-confinement helper (ch09 invariant 10, FIXED-8).
 *
 * Every filesystem path derived from user input must resolve through this helper,
 * which jails it to an owner sandbox root. Both consumers import it: `apps/` (the
 * artifact file routes, the git/versions pipeline, the archive/download path) and
 * `automation/` (the P-15 `file.read`/`file.write` operations). `automation/` may
 * not import `apps/`, so the primitive is homed here in `services/` (ch02 §2.6).
 *
 * Extracted and generalised from the old `artifact-files.resolveSafePath` (which
 * hard-coded the sandbox root). Hardened against three escape classes, all of
 * which throw `UnsafePathError` so the route maps them to a uniform not-found:
 *   - `..` traversal out of the jail,
 *   - absolute paths pointing outside the jail,
 *   - a symlink component inside the jail redirecting the eventual read/write out
 *     of it (re-checked via realpath on the deepest existing ancestor).
 */

import { existsSync, realpathSync } from 'node:fs';
import { resolve, normalize, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/** The owner sandbox root: `SANDBOX_ROOT` or `~/.ekoa/sandboxes`. */
export function sandboxRoot(): string {
  return process.env.SANDBOX_ROOT || resolve(homedir(), '.ekoa', 'sandboxes');
}

/** Is `p` the jail root itself or a path strictly beneath it? */
function confined(p: string, root: string): boolean {
  return p === root || p.startsWith(root + sep);
}

/**
 * Resolve `candidate` and confine it to `jailRoot`. A relative candidate resolves
 * against the jail; an absolute candidate is taken as-is and rejected if it lands
 * outside the jail. Throws `UnsafePathError` on any escape (traversal, absolute
 * outside, or symlink redirect). Returns the confined absolute path.
 */
export function resolveWithinJail(jailRoot: string, candidate: string): string {
  const root = resolve(normalize(jailRoot));
  const resolved = isAbsolute(candidate)
    ? resolve(normalize(candidate))
    : resolve(root, normalize(candidate));

  const deny = (): UnsafePathError => new UnsafePathError(`Access denied: path outside jail (${resolved})`);
  if (!confined(resolved, root)) throw deny();

  // Realpath re-check: walk up to the deepest existing ancestor (the target itself
  // when it exists) and confine ITS realpath, so a symlinked path component cannot
  // redirect the eventual read/write outside the jail.
  let probe = resolved;
  while (!existsSync(probe)) {
    const parent = probe.slice(0, probe.lastIndexOf(sep)) || sep;
    if (parent === probe) break;
    probe = parent;
  }
  if (existsSync(probe)) {
    let realProbe: string;
    let realRoot: string;
    try {
      realProbe = realpathSync(probe);
      realRoot = existsSync(root) ? realpathSync(root) : root;
    } catch {
      throw deny();
    }
    // The existing ancestor may be ABOVE the root (e.g. probing the sandbox parent
    // when the sandbox dir does not exist yet) - fine, as long as it is the root's
    // own ancestry and not a symlink escape below the root.
    if (confined(probe, root) && !confined(realProbe, realRoot)) throw deny();
  }
  return resolved;
}

/** Convenience: confine a user-derived path to the owner sandbox root. */
export function resolveSafePath(candidate: string): string {
  return resolveWithinJail(sandboxRoot(), candidate);
}

/** The featured-builds root: `EKOA_FEATURED_BUILDS_DIR` or `~/.ekoa/data/featured-builds`.
 *  Featured artifacts store a projectDir under this root, outside the owner sandboxes. */
export function featuredBuildsRoot(): string {
  return process.env.EKOA_FEATURED_BUILDS_DIR || resolve(homedir(), '.ekoa', 'data', 'featured-builds');
}

/**
 * Resolve a stored artifact projectDir against BOTH legitimate roots (owner sandboxes,
 * then featured builds — same dual-jail rule as apps/serving). Returns the confined
 * absolute path, or null when the path escapes both jails, so read-only consumers can
 * treat an alien path as "no repo" instead of a thrown 500.
 */
export function resolveProjectDirInAnyJail(candidate: string): string | null {
  for (const root of [sandboxRoot(), featuredBuildsRoot()]) {
    try {
      return resolveWithinJail(root, candidate);
    } catch {
      /* not under this root — try the next jail */
    }
  }
  return null;
}
