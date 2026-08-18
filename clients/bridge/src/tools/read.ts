/**
 * tools/read.ts — the `read` tool (ch18 §18.5 S1/S5; parity: fake-daemon `read`).
 *
 * Reads a file within a grant and emits its bytes (or a byte range of them) across Boundary 1. The
 * whole raw file is read once, the requested range is taken on the RAW buffer BEFORE any utf8 decode
 * (so a range that splits a multibyte sequence still costs exactly its raw bytes against the egress
 * cap), and only the sliced bytes are counted, sha256'd, ledgered, and finally decoded to text.
 *
 * byteRange is the half-open `${start}-${end}`; a whole-file read is `0-${len}` (byte-identical to
 * the harness). An over-the-end range clamps to the file length; a start past the end yields an empty
 * emission. Range bounds are clamped to the buffer, never used to index outside it.
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { emit, fsGuard, resolveInGrant, type ToolContext } from './types.js';

/** A half-open byte range on the raw file buffer: `[start, end)`. */
export interface ByteRange {
  start: number;
  end: number;
}

export interface ReadResult {
  text: string;
  byteRange: string;
  bytesOut: number;
}

export function read(
  ctx: ToolContext,
  grantRef: string,
  relPath: string,
  range?: ByteRange,
): ReadResult {
  const { real, ledgerPath } = resolveInGrant(ctx, grantRef, relPath, 'read');

  // fsGuard converts a raw fs error on the resolver-approved path (a missing leaf the S1-hardened
  // resolver admits for write-back, or a directory) into a LEDGERED S1 ToolError instead of an
  // unclassified throw that would crash the daemon.
  let slice: Buffer;
  let byteRange: string;
  if (range) {
    // Read ONLY the requested window via a file descriptor — never load a whole (possibly huge) file
    // to hand back a small range (the review's efficiency/OOM finding). Bounds are clamped to the
    // real file size so the ledgered byteRange never claims bytes that were not emitted.
    ({ slice, byteRange } = fsGuard(ctx, 'read', () => {
      const fd = openSync(real, 'r');
      try {
        const size = fstatSync(fd).size;
        const start = Math.min(Math.max(0, range.start), size);
        const end = Math.min(Math.max(start, range.end), size);
        const length = end - start;
        const out = Buffer.alloc(length);
        if (length > 0) readSync(fd, out, 0, length, start);
        return { slice: out, byteRange: `${start}-${end}` };
      } finally {
        closeSync(fd);
      }
    }));
  } else {
    const buf = fsGuard(ctx, 'read', () => readFileSync(real));
    slice = buf;
    byteRange = `0-${buf.length}`;
  }

  // Count/cap/sha256/ledger the RAW sliced bytes BEFORE decoding to text (S5: raw pre-decode bytes).
  const { bytesOut } = emit(ctx, 'read', ledgerPath, byteRange, slice);
  return { text: slice.toString('utf8'), byteRange, bytesOut };
}
