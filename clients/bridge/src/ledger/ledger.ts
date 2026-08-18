/**
 * The append-only local egress ledger (ch18 §18.5 S6, §18.5.1). Every read that emits bytes across
 * Boundary 1, every denial on any rejection path, every write-back, and every cap-raise consent is
 * recorded here as one JSON line, fsync'd before the call returns. The authoritative copy stays
 * local; Cortex only ever receives rows as display metadata (§18.6).
 *
 * PATH-PARAMETERISED BY DESIGN: the constructor takes the ledger directory; this module reads NO
 * environment (config wiring is the CLI slice's job) and — unlike the containment resolver — it
 * NEVER resolves a request path. It realpaths nothing; it only appends to files under its own
 * configured directory. Session ids are opaque and are base64url-encoded into safe filenames so a
 * hostile id (e.g. `../evil`) can never escape the ledger dir (base64url emits only [A-Za-z0-9-_],
 * never a path separator or `.`).
 *
 * Row shape provenance: the `read` row is the §18.5.1 EgressLedgerRow (re-exported by wire/index.ts
 * from `@ekoa/shared`, the authoritative wire shape) plus the `kind`/`taskId` envelope; denial/write/cap_consent rows are
 * the daemon-side audit records the v2 brief (A2.4) requires the ledger to keep alongside reads.
 * Durability over throughput: each append is its own open('a') → writeSync → fsyncSync → close.
 */
import { mkdirSync, openSync, writeSync, fsyncSync, closeSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { EgressLedgerRow } from '../wire/index.js';

/** A read that emitted bytes: the §18.5.1 wire row + the `kind` discriminant and its owning task. */
export const ReadLedgerRow = EgressLedgerRow.extend({
  kind: z.literal('read'),
  taskId: z.string(),
});
export type ReadLedgerRow = z.infer<typeof ReadLedgerRow>;

/** A ledgered rejection. `session`/`taskId` are optional: some denials fire before a task is bound
 *  (e.g. a bad-signature drop). `principle` is a free string so an S3 execution refusal ledgers too. */
export const DenialLedgerRow = z.object({
  kind: z.literal('denial'),
  ts: z.string(),
  session: z.string().optional(),
  taskId: z.string().optional(),
  reason: z.string(),
  principle: z.string(),
  tool: z.string().optional(),
});
export type DenialLedgerRow = z.infer<typeof DenialLedgerRow>;

/** A write-back (§18.2.2 patch applied daemon-side): the sha256 precondition (before) and result
 *  (after) are both recorded so the audit trail is reconstructable. */
export const WriteLedgerRow = z.object({
  kind: z.literal('write'),
  ts: z.string(),
  session: z.string(),
  taskId: z.string(),
  path: z.string(),
  bytesWritten: z.number(),
  sha256Before: z.string(),
  sha256After: z.string(),
  tool: z.enum(['write', 'edit']),
});
export type WriteLedgerRow = z.infer<typeof WriteLedgerRow>;

/** An explicit user consent to raise the per-session egress cap (§18.2.1 soft-stop raise): the cap
 *  can only ever move with a ledgered consent, never silently. */
export const CapConsentLedgerRow = z.object({
  kind: z.literal('cap_consent'),
  ts: z.string(),
  session: z.string(),
  previousBudget: z.number(),
  newBudget: z.number(),
  taskId: z.string().optional(),
});
export type CapConsentLedgerRow = z.infer<typeof CapConsentLedgerRow>;

/** A Tier-2 automation invocation (ADR-002). Build-only this run: EVERY bash command / browser
 *  navigation is ledgered with its full command / target, kept SEPARATE from the file tier's rows
 *  (it is excluded from the custody map and all claims). `bytesOut` is 0 — automation output is NOT
 *  egress-metered through the file tier's cap (a shell/browser can exfiltrate by nature; S5 does not
 *  hold inside this tier — that is the whole reason it is tiered). */
export const AutomationLedgerRow = z.object({
  kind: z.literal('automation'),
  ts: z.string(),
  session: z.string(),
  taskId: z.string().optional(),
  tool: z.enum(['bash', 'browser']),
  /** The full bash command line, or the browser navigation target — recorded in full (§ADR-002). */
  detail: z.string(),
  exitCode: z.number().optional(),
  outcome: z.enum(['ran', 'denied', 'timeout', 'error']),
  reason: z.string().optional(),
});
export type AutomationLedgerRow = z.infer<typeof AutomationLedgerRow>;

/** Every row the ledger can hold, discriminated on `kind`. */
export const LedgerRow = z.discriminatedUnion('kind', [
  ReadLedgerRow,
  DenialLedgerRow,
  WriteLedgerRow,
  CapConsentLedgerRow,
  AutomationLedgerRow,
]);
export type LedgerRow = z.infer<typeof LedgerRow>;

/** Result of reading a session's ledger back: the parsed rows plus a count of skipped corrupt lines
 *  (a torn/partial final line from a crash mid-append is tolerated, not fatal). */
export interface LedgerReadResult {
  rows: LedgerRow[];
  corrupt: number;
}

/** Filename stem for rows that are not attributable to a session (a denial before a task is bound).
 *  Starts with `~`, which base64url never emits, so it can never collide with an encoded session. */
const UNATTRIBUTED_STEM = '~unattributed';
/** Max base64url stem length before we fall back to a fixed-length sha256 stem (255-byte filename
 *  limit minus headroom for the `.jsonl` suffix and the `h-` hash prefix). */
const MAX_STEM_LEN = 200;

/**
 * The append-only JSONL egress ledger, one file per session under a configured directory. Rows are
 * only ever appended and fsync'd; existing bytes are never rewritten (the append-only property).
 */
export class EgressLedger {
  constructor(private readonly dir: string) {
    // Create the ledger directory (its own configured directory — never a request path).
    mkdirSync(dir, { recursive: true });
  }

  /** `<dir>/<stem>.jsonl`. Opaque session ids are encoded to a filesystem-safe stem that cannot
   *  contain a path separator, so no id can escape the ledger directory (base64url emits only
   *  [A-Za-z0-9-_]). A session id long enough to blow the 255-byte filename limit (DelegatedTask.session
   *  is an UNBOUNDED wire string) would make every append ENAMETOOLONG, so a base64url stem over a safe
   *  bound is replaced by a deterministic sha256 stem — still 1:1 per session, always short. */
  private fileFor(session: string | undefined): string {
    if (session === undefined) return join(this.dir, `${UNATTRIBUTED_STEM}.jsonl`);
    const encoded = Buffer.from(session, 'utf8').toString('base64url');
    // Leave headroom under the 255-byte limit for the `.jsonl` suffix; hash anything longer.
    const stem = encoded.length <= MAX_STEM_LEN ? encoded : `h-${createHash('sha256').update(session, 'utf8').digest('hex')}`;
    return join(this.dir, `${stem}.jsonl`);
  }

  /**
   * Append one row, durably. The row is validated (well-formed rows only ever land), serialised as a
   * single line, written, and fsync'd before returning — durability over throughput (§18.5 the
   * authoritative ledger stays local). Never mutates prior bytes. On the FIRST append to a session
   * (the file did not exist yet) the directory is fsync'd too, so the new file's dirent is durable —
   * otherwise a crash could lose a just-appended session file's very existence.
   */
  append(row: LedgerRow): void {
    const validated = LedgerRow.parse(row);
    const line = `${JSON.stringify(validated)}\n`;
    const file = this.fileFor(validated.session);
    const isNewFile = !existsSync(file);
    const fd = openSync(file, 'a');
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (isNewFile) this.fsyncDir();
  }

  /** fsync the ledger directory so a newly created session file's dirent is durable (best-effort:
   *  a platform that refuses to open a directory read-only is not fatal to the just-written data). */
  private fsyncDir(): void {
    try {
      const dfd = openSync(this.dir, 'r');
      try {
        fsyncSync(dfd);
      } finally {
        closeSync(dfd);
      }
    } catch {
      /* directory fsync unsupported here — the file data itself was already fsync'd */
    }
  }

  /**
   * Read a session's rows back in append order. A trailing partial line (a write torn by a crash)
   * or any line that fails to parse/validate is skipped and counted in `corrupt` rather than
   * throwing, so a single torn append can never make the whole ledger unreadable.
   */
  readAll(session: string): LedgerReadResult {
    return this.parseFile(this.fileFor(session));
  }

  /**
   * Read EVERY session's rows back (the C3 all-sessions viewer read, decisions.md 2026-07-11):
   * every `.jsonl` under the ledger dir — including the unattributed stem — merged and sorted by
   * `ts` ascending (ties keep file append order). Rows carry their own `session` field, so stems
   * never need decoding. Same tolerance as readAll: corrupt lines are counted, never fatal.
   */
  readEverything(): LedgerReadResult {
    let files: string[];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      return { rows: [], corrupt: 0 };
    }
    const rows: LedgerRow[] = [];
    let corrupt = 0;
    for (const f of files.sort()) {
      const result = this.parseFile(join(this.dir, f));
      rows.push(...result.rows);
      corrupt += result.corrupt;
    }
    rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
    return { rows, corrupt };
  }

  /** The tolerant JSONL read both readAll and readEverything share. */
  private parseFile(file: string): LedgerReadResult {
    if (!existsSync(file)) return { rows: [], corrupt: 0 };
    const content = readFileSync(file, 'utf8');
    const rows: LedgerRow[] = [];
    let corrupt = 0;
    for (const line of content.split('\n')) {
      if (line.length === 0) continue; // the trailing newline (or a blank line) — not corruption
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        corrupt += 1; // a torn/partial line
        continue;
      }
      const result = LedgerRow.safeParse(parsed);
      if (!result.success) {
        corrupt += 1;
        continue;
      }
      rows.push(result.data);
    }
    return { rows, corrupt };
  }

  /**
   * Opaque row references for a session's rows, as `<session>:<index>` (§18.2.2 ledgerRefs the
   * hosted result carries so the user can resolve them in the daemon-served viewer). Indices are
   * 0-based over the successfully parsed rows, in append order.
   */
  ledgerRefs(session: string): string[] {
    const { rows } = this.readAll(session);
    return rows.map((_row, index) => `${session}:${index}`);
  }
}
