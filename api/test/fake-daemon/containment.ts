/**
 * Fake-daemon containment resolver (ch18 §18.5 S1). The single path resolver every file tool
 * goes through, daemon-side: a request to read outside a grant, follow a symlink out of a grant,
 * or traverse above a granted root is REJECTED. This is the daemon-side enforcement the harness
 * runs so it is a faithful adversarial target, not a stub (§18.7.1).
 *
 * Self-contained (no api/src imports): this is the shippable daemon contract the ekoa-local run
 * implements against (§18.7.1).
 */
import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

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

/**
 * Resolve `requested` (which may be absolute, relative, or contain traversal/symlinks) and assert
 * the REAL path stays within the REAL grant root. Returns the safe real path, or throws
 * ContainmentError. Symlink-escape is caught because we realpath BOTH the root and the target.
 */
export function resolveWithinGrant(grantRoot: string, requested: string): string {
  const root = realRoot(grantRoot);
  // Join then resolve the lexical path first (handles ../ traversal before touching the fs).
  const lexical = resolve(root, requested);
  let real: string;
  try {
    real = realpathSync(lexical); // follows symlinks — an escape link resolves OUTSIDE the root
  } catch {
    // A non-existent path: fall back to the lexical resolution for the containment check (a read
    // of a missing file is denied downstream, but traversal must still be rejected here).
    real = lexical;
  }
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (real !== root && !real.startsWith(rootWithSep)) {
    throw new ContainmentError(`path escapes the granted root: ${requested}`);
  }
  return real;
}
