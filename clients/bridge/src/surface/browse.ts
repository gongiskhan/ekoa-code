/**
 * surface/browse.ts — the directory listing behind `GET /browse` (decisions.md 2026-07-11): the
 * in-app folder picker the hosted dashboard renders so non-technical users never type a path or a
 * grantRef. Supersedes the C4 native-picker idea.
 *
 * Posture: this is the PAIRED USER browsing their own machine over the loopback-only, CORS-gated
 * surface — a viewing convenience, not the containment boundary. Listing stays inside `roots`
 * (default: the user's home) by LOGICAL path prefix; symlinked directories render as plain entries
 * and are not navigated through. Actual read access is still decided per-task by the containment
 * resolver (realpath, grant-scoped) — nothing browse shows widens what a delegation may read.
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';

export interface BrowseEntry {
  name: string;
  kind: 'dir' | 'file';
  size?: number;
}

export interface BrowseResult {
  path: string;
  /** The parent directory, present only while still inside the allowed roots. */
  parent?: string;
  entries: BrowseEntry[];
  truncated: boolean;
}

export type BrowseOutcome =
  | { ok: true; result: BrowseResult }
  | { ok: false; status: 403 | 404; error: string };

/** Entries beyond this count are dropped and `truncated` is set — the dialog is a picker, not a file manager. */
const MAX_ENTRIES = 500;

export function defaultBrowseRoots(): string[] {
  return [homedir()];
}

function withinRoots(target: string, roots: string[]): boolean {
  return roots.some((root) => target === root || target.startsWith(root + sep));
}

/** List a directory for the picker. `requested` empty/absent → the first allowed root. */
export function browseDirectory(requested: string | undefined, roots = defaultBrowseRoots()): BrowseOutcome {
  const target = resolve(requested && requested.length > 0 ? requested : roots[0]!);
  if (!withinRoots(target, roots)) return { ok: false, status: 403, error: 'outside allowed roots' };

  let dirents;
  try {
    dirents = readdirSync(target, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES' || code === 'EPERM') return { ok: false, status: 403, error: 'permission denied' };
    return { ok: false, status: 404, error: 'not a directory' };
  }

  // Hidden entries stay hidden (dotfiles are never what a lawyer is looking for); symlinks render
  // as plain files (isDirectory() is lstat-based) so the picker cannot walk through one.
  const visible = dirents.filter((d) => !d.name.startsWith('.'));
  visible.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name, 'pt');
  });

  const truncated = visible.length > MAX_ENTRIES;
  const entries: BrowseEntry[] = visible.slice(0, MAX_ENTRIES).map((d) => {
    if (d.isDirectory()) return { name: d.name, kind: 'dir' };
    let size: number | undefined;
    try {
      size = statSync(join(target, d.name)).size;
    } catch {
      size = undefined; // a broken symlink — still listed, just sizeless
    }
    return { name: d.name, kind: 'file', ...(size !== undefined ? { size } : {}) };
  });

  const parent = dirname(target);
  return {
    ok: true,
    result: {
      path: target,
      ...(parent !== target && withinRoots(parent, roots) ? { parent } : {}),
      entries,
      truncated,
    },
  };
}
