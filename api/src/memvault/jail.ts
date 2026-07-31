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
 *   2. Realpath containment against a FIXED ANCHOR. The deepest EXISTING ancestor of the target
 *      is realpath'd and must land inside `realpath(<memvaultRoot>) + '/' + userId` — an anchor
 *      built from the REAL base plus the validated userId as a plain name. It is deliberately
 *      NOT `realpath(<memvaultRoot>/<userId>)`: resolving the per-user directory would resolve
 *      away the very symlink being checked, so a user root symlinked at a sibling tenant (or at
 *      /etc) measured itself against itself and passed — the E2 review's F2 cross-tenant breach.
 *      With the anchor fixed, a pre-planted symlink ANYWHERE in the existing portion of the
 *      path — the note file, an intermediate directory, or the user root itself — fails closed.
 *      A residual TOCTOU window between check and use is accepted: exploiting it already
 *      requires local filesystem write access.
 *
 * Every traversal of a user's tree goes through this file: reads and writes via notePath, the
 * recursive walk via resolvedUserRoot, the derived index via indexDbFile. A caller that touched
 * `userRoot()` or `indexDbPath()` directly would be checking nothing — both are validated joins
 * with no fs contact, and both gaps were real breaches (F2, and the E3 review's finding 1).
 * Containment is checked at FILE granularity, not just for the directory above the file.
 */
import { lstat, mkdir, realpath } from 'node:fs/promises';
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

/**
 * Realpath of the deepest EXISTING ancestor of `p`, plus the not-yet-existing remainder. The
 * reconstructed `realpath(ancestor)/remainder` is where the kernel would actually land.
 *
 * DANGLING LINKS FAIL CLOSED. `realpath` fails on a symlink whose target does not exist, and
 * simply walking up to the parent then reconstructs the path as if the component were absent —
 * which reports it as safely inside the tenant. It is not: `open(..., O_CREAT)` follows the
 * link and creates the file AT THE TARGET. That is a write primitive pointing anywhere the
 * process can write, and it is exactly how a planted `.index/notes.db -> /tmp/elsewhere.db`
 * escaped the E3 fix for the *resolvable* case. So when realpath fails on a component that lstat
 * reports as a SYMLINK, we cannot prove where a later open would land, and refuse instead of
 * guessing. The test is `isSymbolicLink()` specifically, not mere existence: concurrent writers
 * mkdir shared folders constantly, so a component that appears between our realpath and our
 * lstat is routine — treating that as an escape turned ordinary two-tenant concurrency into
 * spurious 404s (caught by the E2 concurrency spec). A non-link cannot redirect anywhere.
 */
async function realTargetOf(p: string): Promise<string> {
  let cur = p;
  let remainder = '';
  let rechecks = 0;
  for (;;) {
    try {
      const real = await realpath(cur);
      return remainder ? join(real, remainder) : real;
    } catch {
      const state = await entryStateOf(cur);
      // A symlink realpath could not follow: dangling, or a loop. Fail closed.
      if (state === 'symlink') throw new JailViolationError('memvault jail: unresolvable link in path');
      // Present but NOT a link, yet realpath just failed — it materialised between our two
      // syscalls (concurrent writers mkdir the same folder constantly). Re-resolve rather than
      // treat it as absent; a real directory cannot redirect anywhere, so the bounded retry is
      // purely to get an accurate answer, and falling through after it is still safe.
      if (state === 'present' && rechecks++ < 8) continue;
      const parent = dirname(cur);
      if (parent === cur) throw new JailViolationError('memvault jail: unresolvable path');
      remainder = remainder ? join(basename(cur), remainder) : basename(cur);
      cur = parent;
    }
  }
}

/** What is at `p`, given realpath could not resolve it: a symlink (dangling or looping), some
 *  other entry that exists, or nothing at all. */
async function entryStateOf(p: string): Promise<'symlink' | 'present' | 'absent'> {
  try {
    return (await lstat(p)).isSymbolicLink() ? 'symlink' : 'present';
  } catch {
    return 'absent';
  }
}

/**
 * The containment ANCHOR for a tenant: `realpath(<memvaultRoot>)` + '/' + userId, where userId
 * is appended as a literal name and never resolved. This is the whole fix for F2 — anchoring on
 * the per-user directory itself let a symlinked user root validate against its own target.
 */
async function userAnchor(userId: string): Promise<string> {
  assertSafeUserId(userId);
  return join(await realTargetOf(memvaultRoot()), userId);
}

/** Symlink-escape check: where `target` REALLY lands must be at or under the tenant's anchor. */
async function assertContained(target: string, userId: string): Promise<void> {
  const anchor = await userAnchor(userId);
  const realTarget = await realTargetOf(target);
  if (realTarget !== anchor && !realTarget.startsWith(anchor + sep)) {
    throw new JailViolationError('memvault jail: path escapes the user root');
  }
}

/** The user's vault root, `<memvaultRoot>/<userId>`. Validated join only — NO fs touch and
 *  therefore NO containment check: never traverse this path directly, use {@link resolvedUserRoot}. */
export function userRoot(userId: string): string {
  assertSafeUserId(userId);
  return join(memvaultRoot(), userId);
}

/** Create (if needed) and containment-check the user's vault root. */
export async function ensureUserRoot(userId: string): Promise<string> {
  const root = userRoot(userId);
  // Containment BEFORE mkdir: a dangling symlink at the root makes mkdir throw ENOENT, which
  // would escape as a plain Error (500, audited `error`) instead of the uniform 404 +
  // jail_violation every other refusal answers. Nothing leaks either way; the classification is
  // the point. The check runs again after mkdir because the path can change underneath it.
  await assertContained(root, userId);
  await mkdir(root, { recursive: true });
  await assertContained(root, userId);
  return root;
}

/**
 * The user's vault root, containment-checked — what any caller about to TRAVERSE the tree
 * (the recursive walk behind list/export/reindex) must use. A user root that is itself a
 * symlink into another tenant's tree, or at /etc, throws here; the old code reached readdir
 * with no check at all and happily listed the target (E2 review F2).
 */
export async function resolvedUserRoot(userId: string): Promise<string> {
  const root = userRoot(userId);
  await assertContained(root, userId);
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
  await assertContained(file, userId);
  return { file, dir: dirname(file) };
}

/**
 * Reserved per-user index directory name (slice E3). Dot-prefixed on purpose: the permalink
 * grammar has no '.', so `.index` is UNREACHABLE as a note path, and store.ts's walk skips
 * dot-entries — so the derived index can never be listed as a note, read as a note, or shipped
 * by the export. It is derived data; the markdown is the source of truth.
 */
export const INDEX_DIR_NAME = '.index';

export interface JailedIndexPath {
  /** Absolute path of the user's index directory, `<userRoot>/.index`. */
  dir: string;
  /** Absolute path of the user's FTS database, `<userRoot>/.index/notes.db`. */
  file: string;
}

/**
 * The user's derived FTS index db — ONE FILE PER USER, never a shared table. Validated join
 * ONLY: no fs touch, and therefore NO containment check. Never hand this to anything that
 * opens the file — use {@link indexDbFile}, which is to the index what {@link notePath} is to
 * a note.
 */
export function indexDbPath(userId: string): JailedIndexPath {
  const dir = join(userRoot(userId), INDEX_DIR_NAME);
  return { dir, file: join(dir, 'notes.db') };
}

/** Create (if needed) and containment-check the user's index DIRECTORY. Checking the directory
 *  is not enough on its own — see {@link indexDbFile}. */
export async function ensureIndexDir(userId: string): Promise<string> {
  await ensureUserRoot(userId);
  const { dir } = indexDbPath(userId);
  await assertContained(dir, userId); // before mkdir, for the same reason as ensureUserRoot
  await mkdir(dir, { recursive: true });
  await assertContained(dir, userId);
  return dir;
}

/** The SQLite sidecars that live beside the db and are opened/created by name, not by fd. */
const DB_SIDECAR_SUFFIXES = ['', '-wal', '-shm', '-journal'] as const;

/**
 * Resolve the user's index database to a jailed, openable path: ensure the directory, then
 * containment-check the db FILE and each of its SQLite sidecars at file granularity — the same
 * treatment {@link notePath} gives a note file.
 *
 * A directory check alone is NOT sufficient, and that gap was a live cross-tenant breach (E3
 * review): with `<userRoot>/.index` a perfectly ordinary directory, a pre-planted
 * `<userRoot>/.index/notes.db` symlinked at ANOTHER tenant's database passed every check, so
 * one tenant's search read the other's rows (audited `ok`) and one tenant's write injected rows
 * into the other's database. The sidecars are covered too: SQLite opens `<db>-wal`/`-shm` by
 * PATH, so a symlink there is a write primitive pointing outside the tenant just the same.
 */
export async function indexDbFile(userId: string): Promise<string> {
  await ensureIndexDir(userId);
  const { file } = indexDbPath(userId);
  for (const suffix of DB_SIDECAR_SUFFIXES) await assertContained(`${file}${suffix}`, userId);
  return file;
}
