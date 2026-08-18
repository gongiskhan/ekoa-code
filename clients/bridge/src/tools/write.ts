/**
 * tools/write.ts — the `write`/`edit` write-back tool (§18.2.2, §18.5.1; FLOW_PLAN write-back facts).
 *
 * Write-back is guarded so a hosted task can never blindly clobber a local file:
 *   1. sha256 precondition. The caller states what it believes the current bytes hash to via
 *      `expectedSha256`; a CREATE is signalled explicitly by `expectedSha256: null`. A missing file is
 *      NOT silently treated as the empty file -- a create MUST pass `null`, and an existing file MUST
 *      pass the current hash. Any mismatch (stale hash, `null` on an existing file, a hash on a
 *      missing file) is denied 'write conflict' (S1) + ledgered.
 *   2. first-write confirmation. The FIRST successful write to a given file within a session requires
 *      `confirmed === true` (the user assents Cortex-side; enforced here as a state machine). Absent
 *      it, the write is denied 'confirmation required' (S1) + ledgered. Subsequent writes to that file
 *      in the same session do not re-prompt. First-write state is tracked in-memory, keyed by
 *      (session, real path); only a SUCCESSFUL write flips it, so a refused write still counts as
 *      "first" on retry.
 *
 * PATCH PRIMITIVE (a design choice -- documented per the slice spec): `edit` is a single exact-string
 * substitution -- `{find, replace, occurrence?}` -- NOT a unified-diff applier. `occurrence` (1-based)
 * selects which match to replace; omitted means the first. Real diff application is the engine's later
 * concern; the tool stays a primitive so its behaviour is total and inspectable. A patch whose target
 * is absent, or that targets a nonexistent occurrence, is denied 'edit target not found' (S1).
 *
 * Writes are INBOUND: they never emit bytes outward, so they are NOT egress-counted or capped. They
 * ledger a dedicated `write` row {bytesWritten, sha256Before, sha256After, tool}, never a read row.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { denyAndThrow, fsGuard, nowIso, resolveInGrant, type ToolContext } from './types.js';
import type { WriteLedgerRow } from '../ledger/index.js';

/** The new bytes to land: a full-content replacement (`write`) or a single exact-string edit. */
export type WriteBody =
  | { content: string }
  | { patch: { find: string; replace: string; occurrence?: number } };

export interface WritePreconditions {
  /** sha256 of the bytes the caller believes are on disk, or `null` to signal a create. */
  expectedSha256: string | null;
  /** Must be `true` for the first write to this file in this session. */
  confirmed?: boolean;
}

export interface WriteResult {
  bytesWritten: number;
  sha256Before: string;
  sha256After: string;
}

const SHA256_EMPTY = createHash('sha256').update(Buffer.alloc(0)).digest('hex');

/** In-memory first-write state, keyed by (session, real path). Only successful writes are recorded,
 *  so a write refused on a precondition still requires confirmation when it is retried. The key is a
 *  JSON-encoded pair (injective over the two strings) so no separator character can alias two keys. */
class FirstWriteTracker {
  private readonly written = new Set<string>();
  private key(session: string, realPath: string): string {
    return JSON.stringify([session, realPath]);
  }
  isFirst(session: string, realPath: string): boolean {
    return !this.written.has(this.key(session, realPath));
  }
  mark(session: string, realPath: string): void {
    this.written.add(this.key(session, realPath));
  }
  /** Test hygiene: forget all recorded writes. */
  reset(): void {
    this.written.clear();
  }
}

const firstWrites = new FirstWriteTracker();

/** Reset the process-wide first-write state (test hygiene only). */
export function resetFirstWriteState(): void {
  firstWrites.reset();
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function writeFile(
  ctx: ToolContext,
  grantRef: string,
  relPath: string,
  body: WriteBody,
  pre: WritePreconditions,
): WriteResult {
  const tool: WriteLedgerRow['tool'] = 'content' in body ? 'write' : 'edit';
  const { real, ledgerPath } = resolveInGrant(ctx, grantRef, relPath, tool);

  const exists = existsSync(real);
  // A `real` that is a directory (or otherwise unreadable) → a ledgered S1 ToolError, not a raw EISDIR.
  const current = exists ? fsGuard(ctx, tool, () => readFileSync(real)) : undefined;
  const sha256Before = current === undefined ? SHA256_EMPTY : sha256(current);

  // 1. sha256 precondition. A create requires an explicit null; an existing file requires its hash.
  if (exists) {
    if (pre.expectedSha256 === null || pre.expectedSha256 !== sha256Before) {
      denyAndThrow(ctx, 'write conflict', 'S1', tool);
    }
  } else if (pre.expectedSha256 !== null) {
    // A missing file is never implicitly the empty file: a create must pass expectedSha256:null.
    denyAndThrow(ctx, 'write conflict', 'S1', tool);
  }

  // 2. first-write confirmation (per session, per file).
  if (firstWrites.isFirst(ctx.session, real) && pre.confirmed !== true) {
    denyAndThrow(ctx, 'confirmation required', 'S1', tool);
  }

  // 3. compute the new bytes.
  let next: Buffer;
  if ('content' in body) {
    next = Buffer.from(body.content, 'utf8');
  } else {
    if (current === undefined) denyAndThrow(ctx, 'edit target not found', 'S1', tool);
    next = applyPatch(ctx, current.toString('utf8'), body.patch, tool);
  }

  // A write that the fs refuses (target is a directory, permission denied, missing parent) → a
  // ledgered S1 ToolError, not a raw throw that escapes unclassified.
  fsGuard(ctx, tool, () => writeFileSync(real, next));
  const sha256After = sha256(next);
  firstWrites.mark(ctx.session, real);

  const row: WriteLedgerRow = {
    kind: 'write',
    ts: nowIso(ctx),
    session: ctx.session,
    taskId: ctx.taskId,
    path: ledgerPath,
    bytesWritten: next.length,
    sha256Before,
    sha256After,
    tool,
  };
  ctx.ledger.append(row);
  return { bytesWritten: next.length, sha256Before, sha256After };
}

/** Replace one exact-string occurrence (1-based `occurrence`, default the first). A missing target
 *  is a denied 'edit target not found' -- the tool never silently no-ops an edit. */
function applyPatch(
  ctx: ToolContext,
  text: string,
  patch: { find: string; replace: string; occurrence?: number },
  tool: WriteLedgerRow['tool'],
): Buffer {
  const target = patch.occurrence ?? 1;
  let from = 0;
  let seen = 0;
  let at = -1;
  for (;;) {
    const idx = text.indexOf(patch.find, from);
    if (idx === -1) break;
    seen += 1;
    if (seen === target) {
      at = idx;
      break;
    }
    from = idx + Math.max(1, patch.find.length);
  }
  if (at === -1) denyAndThrow(ctx, 'edit target not found', 'S1', tool);
  return Buffer.from(text.slice(0, at) + patch.replace + text.slice(at + patch.find.length), 'utf8');
}
