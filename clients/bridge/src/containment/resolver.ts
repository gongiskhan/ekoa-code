/**
 * THE single path containment resolver (ADR-001 / ch18 §18.5 S1). Every request path in the daemon
 * resolves through THIS module and nowhere else: eslint bans realpath/fs access in the other modules
 * so this stays the only place a task's path reaches the filesystem (single-resolver rule).
 *
 * Provenance: semantics are copy-with-review from the authoritative harness
 * `ekoa-code/api/test/fake-daemon/containment.ts`, then HARDENED for the nonexistent-target branch —
 * see the "nearest existing ancestor" note below and the flagged contract correction in
 * docs/decisions.md (2026-07-10, "Containment resolver hardened beyond the harness for write-back").
 * The harness resolves reads only; ekoa-bridge also WRITES (S5 write/edit), so the harness's plain
 * lexical fallback for a missing leaf is a write-escape here and is corrected, not copied.
 */
import { realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';

export class ContainmentError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'ContainmentError';
  }
}

/** Realpath a directory root once (grants name real directories the daemon holds). */
export function realRoot(grantRoot: string): string {
  return realpathSync(grantRoot);
}

/** True when `real` is the root itself or lies within it (root + separator prefix). */
function isWithin(root: string, real: string): boolean {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return real === root || real.startsWith(rootWithSep);
}

/**
 * Compute the REAL filesystem location an absolute path refers to — following every symlink, but
 * tolerating a path (or a symlink target) that does not fully exist yet. This is the write-safe core:
 * it answers "where would a create/write at this path actually land", so a not-yet-existing leaf
 * under (or reached through) an in-grant symlink that points OUTSIDE the grant resolves to its true
 * outside location and is then rejected by the containment check. A read-only "fall back to the
 * lexical path on ENOENT" cannot do this — it hands back an in-grant-looking path and lets a write
 * escape (the harness's read-only shortcut; corrected here per docs/decisions.md).
 *
 * Recursion: realpath the whole path (fast path for fully-existing, non-dangling paths); on failure,
 * resolve the PARENT the same way, then look at the final component under the real parent — a missing
 * entry is a to-be-created target (return it), a symlink is FOLLOWED (readlink → resolve again, so a
 * dangling or escaping link lands on its true target), any other existing entry is taken as real.
 */
function realResolveAllowingMissing(p: string): string {
  try {
    return realpathSync(p); // exists and every link resolves → fully canonical
  } catch {
    /* p is missing, or a symlink somewhere in it dangles — resolve component-wise below */
  }
  const parent = dirname(p);
  if (parent === p) return p; // filesystem root
  const realParent = realResolveAllowingMissing(parent);
  const candidate = resolve(realParent, basename(p));
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch {
    return candidate; // the final component does not exist → a to-be-created entry here
  }
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(candidate); // FOLLOW the link, even if its target is missing/outside
    return realResolveAllowingMissing(resolve(realParent, target));
  }
  return candidate; // exists (realpath threw for some other reason) → treat as its real location
}

/** A resolved request: the safe real path AND the real grant root it was checked against (so callers
 *  do not realpath the root a second time to form a ledger path — the redundant syscall the review
 *  flagged on the hot path). */
export interface ResolvedPath {
  real: string;
  realRoot: string;
}

/**
 * Resolve `requested` (which may be absolute, relative, or contain traversal/symlinks) against the
 * REAL grant root and assert the REAL result stays within it. Returns the safe real path + the real
 * root, or throws ContainmentError. Symlink-escape is caught because we realpath BOTH the root and the
 * target — including the existing ancestor of a not-yet-created target (see realResolveAllowingMissing).
 */
export function resolveWithinGrantDetailed(grantRoot: string, requested: string): ResolvedPath {
  const root = realRoot(grantRoot);
  // Resolve the lexical path first (handles ../ traversal before touching the fs).
  const lexical = resolve(root, requested);
  const real = realResolveAllowingMissing(lexical);
  if (!isWithin(root, real)) {
    throw new ContainmentError(`path escapes the granted root: ${requested}`);
  }
  return { real, realRoot: root };
}

/** Resolve `requested` within the grant, returning only the safe real path (the common case). */
export function resolveWithinGrant(grantRoot: string, requested: string): string {
  return resolveWithinGrantDetailed(grantRoot, requested).real;
}

/**
 * Path of `realPath` relative to the REAL grant root, for ledger rows: a `/var`->`/private/var`
 * symlinked root must not produce spurious `../` prefixes in recorded rows. When `realPath` IS the
 * grant root the relative is empty; we return `'.'` (the grant root) — NEVER the absolute real path.
 * The absolute path carries the username and local directory layout, and ledger rows are forwarded to
 * Cortex as trust-chip metadata, so it must not leak there (the review's privacy finding: grep/glob/
 * list('.') all resolve to the root). Pass `precomputedRealRoot` (from resolveWithinGrantDetailed) to
 * avoid a redundant realpath syscall per ledgered read.
 */
export function relativeToRealRoot(grantRoot: string, realPath: string, precomputedRealRoot?: string): string {
  const root = precomputedRealRoot ?? realRoot(grantRoot);
  const rel = relative(root, realPath);
  return rel === '' ? '.' : rel;
}
