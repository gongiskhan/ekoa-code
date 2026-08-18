/**
 * tools/glob.ts — the `glob` tool (pattern-match files within a grant).
 *
 * MATCHER SCOPE (a design choice — documented per the slice spec): a small, dependency-free glob
 * matcher supporting exactly `*` (any run of non-separator chars), `?` (one non-separator char), and
 * `**` (any run of chars including separators; a `**` immediately followed by a slash collapses to
 * "zero or more leading directory segments"). NO brace expansion, NO character classes, NO extglob —
 * deliberately a primitive, so there is no third-party matcher surface to reason about. Every other
 * pattern character is matched literally (regex metacharacters are escaped).
 *
 * WALK: a manual recursive descent from the grant root using lstat-based dirents. Symlinks are never
 * followed and never emitted — a symlinked directory is not recursed into and a symlinked file is not
 * a result — so a glob can neither escape the grant nor loop on a cyclic link. Results are file paths
 * relative to the REAL root, POSIX-normalized (`/` separators) for deterministic, cross-platform
 * output, and sorted. Ledgered like `list`: one egress row (`tool='glob'`) whose `bytesOut` is the
 * serialized result-array length, capped like any emission.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { emit, resolveInGrant, type ToolContext } from './types.js';

export interface GlobResult {
  paths: string[];
}

/** Compile a restricted glob (`*`, `?`, `**`, and `**` + slash) to an anchored RegExp. Separator `/`. */
function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; ) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        // A `**` directly before a slash: zero or more leading directory segments, so the pattern
        // still matches a file at the root (the whole `(?:.*/)?` group can match the empty string).
        re += '(?:.*/)?';
        i += 3;
      } else {
        // A bare `**`: any run of characters, separators included.
        re += '.*';
        i += 2;
      }
    } else if (c === '*') {
      re += '[^/]*';
      i += 1;
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

/** Collect file paths (relative, POSIX-separated) under `dir`, never following/emitting symlinks. */
function walk(dir: string, relBase: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue; // never follow or emit a symlink (no escape, no cycles)
    const childRel = relBase ? `${relBase}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walk(join(dir, entry.name), childRel, out);
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
}

export function glob(ctx: ToolContext, grantRef: string, pattern: string): GlobResult {
  const { real, ledgerPath } = resolveInGrant(ctx, grantRef, '.', 'glob');

  const all: string[] = [];
  walk(real, '', all);
  const rx = globToRegExp(pattern);
  const paths = all.filter((p) => rx.test(p)).sort();

  const payload = Buffer.from(JSON.stringify(paths), 'utf8');
  emit(ctx, 'glob', ledgerPath, `0-${payload.length}`, payload);
  return { paths };
}
