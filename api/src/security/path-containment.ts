/**
 * security/path-containment.ts — THE path containment resolver for Cortex-side code (Cofre R-1).
 *
 * Provenance: semantics are a copy-with-review of `ekoa-bridge/src/containment/resolver.ts`, which
 * is itself the hardened descendant of the fake-daemon harness. The daemon has had a write-safe,
 * symlink-escape-proof resolver since ADR-001; the CORTEX side had none at all — `resolveUserPath`
 * in automation/platform-primitives.ts read `if (isAbsolute(path)) return path;` with the comment
 * "trust user-issued paths via Ekoa actions, since manifests are authored by the coding agent under
 * our control". That assumption is false in both directions: the manifest recipe is MODEL-authored
 * (invariant I5), and the mid-run rehearsal fixer can choose which capability runs. The result was
 * an unrestricted `file.read`/`file.write` on the API host whose bytes land in the persisted
 * `capturedValues` and in the calling agent's tool result (I1/I2/I4).
 *
 * TWO controls, in this order, and the order matters:
 *   1. CONTAINMENT — the REAL path (every symlink followed, including through a not-yet-created
 *      leaf) must stay inside the caller's root. This is the control.
 *   2. DENYLIST — credential-bearing basenames are refused even INSIDE the root. This is defence in
 *      depth; it is not sufficient alone and must never ship without (1), because a denylist only
 *      knows the names someone thought of.
 */
import { realpathSync, lstatSync, readlinkSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';

export class PathContainmentError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = 'PathContainmentError';
  }
}

/** True when `real` is the root itself or lies within it (root + separator prefix). */
function isWithin(root: string, real: string): boolean {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  return real === root || real.startsWith(rootWithSep);
}

/**
 * Where a create/read at `p` would ACTUALLY land — following every symlink, tolerating a path (or a
 * symlink target) that does not fully exist yet.
 *
 * The naive "realpath, and on ENOENT fall back to the lexical path" is a write-escape: it hands
 * back an in-root-LOOKING path for a leaf reached through an in-root symlink that points outside.
 * Instead: realpath the whole path (fast path); on failure resolve the PARENT the same way, then
 * inspect the final component under the REAL parent — a missing entry is a to-be-created target, a
 * symlink is FOLLOWED (so a dangling or escaping link lands on its true target), anything else is
 * taken as its real location.
 */
function realResolveAllowingMissing(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    /* missing, or a symlink somewhere in it dangles — resolve component-wise below */
  }
  const parent = dirname(p);
  if (parent === p) return p; // filesystem root
  const realParent = realResolveAllowingMissing(parent);
  const candidate = resolve(realParent, basename(p));
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch {
    return candidate; // final component does not exist → a to-be-created entry here
  }
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(candidate);
    return realResolveAllowingMissing(resolve(realParent, target));
  }
  return candidate;
}

/**
 * Credential-bearing names, refused even inside a contained root. A workspace can legitimately hold
 * a user's uploaded documents; it can never legitimately need to read an SSH private key.
 *
 * Kept as basename/segment patterns rather than absolute paths so the same list applies under any
 * root. `ekoa-bridge`'s containment resolver needs this identical list (Cofre H-7); it should be
 * shared through the release artifact rather than copy-pasted once both sides land.
 */
const SENSITIVE_BASENAMES = [
  /^\.env(\..+)?$/i,
  /^\.netrc$/i,
  /^\.npmrc$/i,
  /^\.pgpass$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /^credentials$/i,
  /^authorized_keys$/i,
  /^known_hosts$/i,
  /\.(pem|p12|pfx|key|keystore|jks|asc|gpg|kdbx)$/i,
];

/** Directory segments whose entire subtree is credential-bearing. */
const SENSITIVE_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.gpg', '.config/gcloud', '.kube', '.docker']);

/**
 * Throw when `realPath` names credential-bearing material. Checked on the REAL path (post-symlink),
 * so a benign-looking name pointing at `~/.ssh/id_rsa` is caught by its target, not its label.
 */
export function assertNotSensitivePath(realPath: string, requested: string): void {
  const segments = realPath.split(sep).filter(Boolean);
  for (const segment of segments) {
    if (SENSITIVE_SEGMENTS.has(segment)) {
      throw new PathContainmentError(`refusing credential-bearing path (${segment}/): ${requested}`);
    }
  }
  const base = basename(realPath);
  for (const pattern of SENSITIVE_BASENAMES) {
    if (pattern.test(base)) {
      throw new PathContainmentError(`refusing credential-bearing file (${base}): ${requested}`);
    }
  }
}

export interface ContainedPath {
  /** The safe, fully real path the caller may touch. */
  real: string;
  /** The realpath'd root it was checked against. */
  realRoot: string;
}

/**
 * Resolve `requested` against `root` and assert the REAL result stays inside it, then apply the
 * denylist. `requested` may be absolute, relative, or carry traversal and symlinks — an absolute
 * path outside the root is refused rather than honoured, which is precisely the behaviour the old
 * `if (isAbsolute(path)) return path;` inverted.
 *
 * `root` must already exist (realpath needs a real directory); callers create it per owner.
 */
export function resolveContained(root: string, requested: string): ContainedPath {
  if (typeof requested !== 'string' || requested.length === 0) {
    throw new PathContainmentError('empty path');
  }
  if (requested.includes('\0')) {
    throw new PathContainmentError('path contains a NUL byte');
  }
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    throw new PathContainmentError(`workspace root is not available: ${root}`);
  }
  // Resolve traversal lexically against the root BEFORE touching the filesystem. An ABSOLUTE
  // `requested` resolves to itself, so `/etc/passwd` lands outside the root and is refused below
  // rather than being silently reinterpreted as `<root>/etc/passwd` — a reinterpretation would
  // turn a containment breach into a confusing ENOENT and hide what the recipe actually asked for.
  // An absolute path that genuinely IS inside the root still passes.
  const lexical = resolve(realRoot, requested);
  const real = realResolveAllowingMissing(lexical);
  if (!isWithin(realRoot, real)) {
    throw new PathContainmentError(`path escapes the workspace root: ${requested}`);
  }
  assertNotSensitivePath(real, requested);
  return { real, realRoot };
}
