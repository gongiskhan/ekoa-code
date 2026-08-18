/**
 * tools/stat.ts — the `stat` tool (file metadata within a grant).
 *
 * LEDGER SEMANTICS (a design choice — documented per the slice spec, mirroring list/glob): the stat
 * result is derived content that leaves the machine, so it emits ONE egress row through the shared
 * `emit` path with `tool='stat'` and `bytesOut` = the byte length of the serialized `{size, mtime,
 * kind}` object, capped like any emission. Uniformity over a metadata carve-out.
 *
 * The path is already the resolver's realpath (symlinks followed and contained), so `statSync` on it
 * describes the real target; `kind` is `dir` or `file`. `mtime` is emitted as an ISO string so the
 * serialization is deterministic and JSON-stable.
 */
import { statSync } from 'node:fs';
import { emit, fsGuard, resolveInGrant, type ToolContext } from './types.js';

export interface StatResult {
  size: number;
  mtime: string;
  kind: 'file' | 'dir';
}

export function stat(ctx: ToolContext, grantRef: string, relPath: string): StatResult {
  const { real, ledgerPath } = resolveInGrant(ctx, grantRef, relPath, 'stat');
  // A missing leaf the S1-hardened resolver admits → a ledgered S1 ToolError, not a raw ENOENT throw.
  const st = fsGuard(ctx, 'stat', () => statSync(real));
  const result: StatResult = {
    size: st.size,
    mtime: st.mtime.toISOString(),
    kind: st.isDirectory() ? 'dir' : 'file',
  };
  const payload = Buffer.from(JSON.stringify(result), 'utf8');
  emit(ctx, 'stat', ledgerPath, `0-${payload.length}`, payload);
  return result;
}
