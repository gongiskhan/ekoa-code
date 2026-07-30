/**
 * memvault path jail (slice E2) — THE single path-resolution point for the per-user notes
 * tree. Every filesystem path the memvault module touches is minted HERE from
 * `memvaultConfig().root` + a validated userId + a validated permalink; nothing else in
 * api/src/memvault/ may import node:path or read the memvault root config (enforced by a
 * grep test in api/tests/security/memvault-isolation.test.ts).
 *
 * Two layers, both fail-closed with JailViolationError:
 *   1. Charset validation. userId is system-supplied (the verified JWT / key owner) but is
 *      jailed anyway (defense in depth); permalinks re-check the shared contract grammar,
 *      which has no '.' at all — so '.', '..', dotfiles, absolute paths, '\' and null bytes
 *      are structurally unrepresentable, not merely filtered.
 *   2. Realpath containment. The deepest EXISTING ancestor of the target is realpath'd and
 *      must land inside the (equally realpath'd) user root — a pre-planted symlink anywhere
 *      in the existing portion of the path (including the note file itself) that points
 *      outside the user's own tree fails closed. A residual TOCTOU window between check and
 *      use is accepted: exploiting it already requires local filesystem write access.
 */
import { mkdir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { NOTE_PERMALINK_MAX, NOTE_PERMALINK_RE } from '@ekoa/shared';
import { memvaultConfig } from '../config.js';

export class JailViolationError extends Error {}

/** Same charset family as the knowledge partition guard (knowledge/paths.ts SEGMENT_RE). */
const USER_ID_RE = /^[a-zA-Z0-9._-]{1,100}$/;

function assertSafeUserId(userId: string): void {
  if (typeof userId !== 'string' || userId === '.' || userId === '..' || !USER_ID_RE.test(userId)) {
    throw new JailViolationError(`memvault jail: unsafe userId ${JSON.stringify(userId)}`);
  }
}

/** Structural permalink guard. Mirrors the shared zod grammar and re-checks the properties
 *  the jail depends on explicitly (belt and braces — never trust the caller validated). */
function assertSafePermalink(permalink: string): string[] {
  if (
    typeof permalink !== 'string' ||
    permalink.length === 0 ||
    permalink.length > NOTE_PERMALINK_MAX ||
    permalink.includes('\0') ||
    permalink.includes('\\') ||
    permalink.startsWith('/') ||
    !NOTE_PERMALINK_RE.test(permalink)
  ) {
    throw new JailViolationError(`memvault jail: unsafe permalink`);
  }
  const segments = permalink.split('/');
  for (const seg of segments) {
    // The grammar has no '.' so these are unreachable; asserted anyway so the jail never
    // depends on the regex alone.
    if (seg === '' || seg === '.' || seg === '..') throw new JailViolationError('memvault jail: unsafe segment');
  }
  return segments;
}

function memvaultRoot(): string {
  return resolve(memvaultConfig().root);
}

/** Realpath of the deepest EXISTING ancestor of `p`, plus the not-yet-existing remainder.
 *  The reconstructed `realpath(ancestor)/remainder` is where the kernel would actually land. */
async function realTargetOf(p: string): Promise<string> {
  let cur = p;
  let remainder = '';
  for (;;) {
    try {
      const real = await realpath(cur);
      return remainder ? join(real, remainder) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) throw new JailViolationError('memvault jail: unresolvable path');
      remainder = remainder ? join(basename(cur), remainder) : basename(cur);
      cur = parent;
    }
  }
}

/** Symlink-escape check: where `target` REALLY lands must be inside where `root` really is. */
async function assertContained(target: string, root: string): Promise<void> {
  const realTarget = await realTargetOf(target);
  const realRoot = await realTargetOf(root);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
    throw new JailViolationError('memvault jail: path escapes the user root');
  }
}

/** The user's vault root, `<memvaultRoot>/<userId>`. Validated join only — no fs touch. */
export function userRoot(userId: string): string {
  assertSafeUserId(userId);
  return join(memvaultRoot(), userId);
}

/** Create (if needed) and containment-check the user's vault root. */
export async function ensureUserRoot(userId: string): Promise<string> {
  const root = userRoot(userId);
  await mkdir(root, { recursive: true });
  await assertContained(root, memvaultRoot());
  return root;
}

export interface JailedNotePath {
  /** Absolute path of the note file, `<userRoot>/<permalink>.md`. */
  file: string;
  /** Absolute path of the note file's parent directory (for mkdir before write). */
  dir: string;
}

/**
 * Resolve a permalink to its jailed note-file path: validate, join under the user root,
 * then realpath-containment-check the deepest existing ancestor. Throws JailViolationError
 * on any charset violation or symlink escape; never returns a path outside the user root.
 */
export async function notePath(userId: string, permalink: string): Promise<JailedNotePath> {
  const root = userRoot(userId);
  const segments = assertSafePermalink(permalink);
  const file = `${join(root, ...segments)}.md`;
  await assertContained(file, root);
  return { file, dir: dirname(file) };
}
