/**
 * tools/list.ts — the `list` tool (directory listing within a grant).
 *
 * LEDGER SEMANTICS (a design choice — documented per the slice spec): a listing carries no file
 * CONTENT, so it is not egress-ledgered as "bytes read from a file". But the serialized listing IS
 * derived content that leaves the machine, so `list` emits ONE egress row through the shared `emit`
 * path with `tool='list'` and `bytesOut` = the byte length of the serialized dirent array — and it is
 * capped exactly like any other emission. This keeps a single, uniform "nothing leaves un-ledgered,
 * un-capped" rule across every read-shaped tool, rather than carving out a metadata exception.
 *
 * Symlinks are classified, never followed: each entry is typed from the directory's own lstat-based
 * dirent (a symlink reports as `symlink`, not as whatever it points at), and `size` comes from an
 * lstat of the entry itself. Entries are sorted by name so the serialization — and thus the ledgered
 * byte count and sha256 — is deterministic across platforms. `size` is omitted for directories
 * (directory byte sizes are platform noise) and reported for files and symlinks.
 */
import { readdirSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { emit, fsGuard, resolveInGrant, type ToolContext } from './types.js';

export type DirEntryKind = 'file' | 'dir' | 'symlink';

export interface DirEntry {
  name: string;
  kind: DirEntryKind;
  size?: number;
}

export interface ListResult {
  entries: DirEntry[];
}

export function list(ctx: ToolContext, grantRef: string, relPath = '.'): ListResult {
  const { real, ledgerPath } = resolveInGrant(ctx, grantRef, relPath, 'list');

  // A missing dir, or a `real` that is a file not a directory (ENOTDIR), the S1-hardened resolver
  // admits → a ledgered S1 ToolError, not a raw throw. The lstat per entry is inside the guard too.
  const entries: DirEntry[] = fsGuard(ctx, 'list', () =>
    readdirSync(real, { withFileTypes: true })
      .map((d): DirEntry => {
        const kind: DirEntryKind = d.isSymbolicLink() ? 'symlink' : d.isDirectory() ? 'dir' : 'file';
        // lstat the entry itself (never follow): a symlink's size is the link's own size, not the
        // target's, and a dead symlink still lstats fine.
        const size = kind === 'dir' ? undefined : lstatSync(join(real, d.name)).size;
        return size === undefined ? { name: d.name, kind } : { name: d.name, kind, size };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  );

  const payload = Buffer.from(JSON.stringify(entries), 'utf8');
  emit(ctx, 'list', ledgerPath, `0-${payload.length}`, payload);
  return { entries };
}
