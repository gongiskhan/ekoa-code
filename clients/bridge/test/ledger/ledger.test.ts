import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import {
  EgressLedger,
  LedgerRow,
  ReadLedgerRow,
  type WriteLedgerRow,
  type CapConsentLedgerRow,
  type DenialLedgerRow,
} from '../../src/ledger/index.js';
import { EgressLedgerRow } from '../../src/wire/index.js';

/**
 * Behavioural coverage for the append-only JSONL egress ledger (§18.5 S6, §18.5.1). Every temp
 * ledger dir is built per-test via mkdtemp under the OS temp root — never a committed fixture and
 * never a real user path. All values are synthetic (no real identifiers).
 */
let dir: string;
let ledger: EgressLedger;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ekoa-ledger-'));
  ledger = new EgressLedger(dir);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A well-formed read row for `session`, deterministic apart from the fields passed in. */
function readRow(session: string, over: Partial<ReadLedgerRow> = {}): ReadLedgerRow {
  return {
    kind: 'read',
    ts: '2026-07-10T00:00:00.000Z',
    session,
    correlationId: 'corr-1',
    path: 'contrato.txt',
    byteRange: '0-42',
    bytesOut: 42,
    sha256: 'a'.repeat(64),
    tool: 'read',
    taskId: 'task-1',
    ...over,
  };
}

describe('EgressLedger — read rows round-trip and match the wire contract', () => {
  it('a read row survives append→readAll byte-for-field identical', () => {
    const row = readRow('sess-A');
    ledger.append(row);
    const { rows, corrupt } = ledger.readAll('sess-A');
    expect(corrupt).toBe(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(row);
  });

  it('a stored read row validates against the wire EgressLedgerRow schema (kind=read)', () => {
    ledger.append(readRow('sess-A', { bytesOut: 1024, byteRange: '0-1024' }));
    const stored = ledger.readAll('sess-A').rows[0]!;
    // The §18.5.1 wire shape is the 8 fields; kind/taskId are the local envelope and are stripped.
    const wire = EgressLedgerRow.parse(stored);
    expect(wire).toEqual({
      ts: '2026-07-10T00:00:00.000Z',
      session: 'sess-A',
      correlationId: 'corr-1',
      path: 'contrato.txt',
      byteRange: '0-1024',
      bytesOut: 1024,
      sha256: 'a'.repeat(64),
      tool: 'read',
    });
    expect(EgressLedgerRow.safeParse(stored).success).toBe(true);
  });

  it('write and cap_consent rows round-trip too', () => {
    const write: WriteLedgerRow = {
      kind: 'write',
      ts: '2026-07-10T00:00:01.000Z',
      session: 'sess-A',
      taskId: 'task-1',
      path: 'notas.txt',
      bytesWritten: 12,
      sha256Before: 'b'.repeat(64),
      sha256After: 'c'.repeat(64),
      tool: 'edit',
    };
    const cap: CapConsentLedgerRow = {
      kind: 'cap_consent',
      ts: '2026-07-10T00:00:02.000Z',
      session: 'sess-A',
      previousBudget: 1000,
      newBudget: 5000,
      taskId: 'task-1',
    };
    ledger.append(write);
    ledger.append(cap);
    const { rows, corrupt } = ledger.readAll('sess-A');
    expect(corrupt).toBe(0);
    expect(rows).toEqual([write, cap]);
  });

  it('ledgerRefs returns opaque <session>:<index> ids over the parsed rows, in append order', () => {
    ledger.append(readRow('sess-A', { correlationId: 'c0' }));
    ledger.append(readRow('sess-A', { correlationId: 'c1' }));
    ledger.append(readRow('sess-A', { correlationId: 'c2' }));
    expect(ledger.ledgerRefs('sess-A')).toEqual(['sess-A:0', 'sess-A:1', 'sess-A:2']);
  });

  it('readAll / ledgerRefs on an unseen session are empty, not an error', () => {
    expect(ledger.readAll('never-written')).toEqual({ rows: [], corrupt: 0 });
    expect(ledger.ledgerRefs('never-written')).toEqual([]);
  });
});

describe('EgressLedger — append-only property (prior bytes are never rewritten)', () => {
  it('every append leaves the previous file content as an exact byte prefix', () => {
    ledger.append(readRow('sess-A', { correlationId: 'c0' }));
    const file = join(dir, readdirSync(dir)[0]!);

    let prev = readFileSync(file); // Buffer of everything written so far
    for (let i = 1; i <= 20; i += 1) {
      ledger.append(readRow('sess-A', { correlationId: `c${i}`, bytesOut: i }));
      const now = readFileSync(file);
      // The new file must START WITH the exact bytes it had before (append-only, no rewrite).
      expect(now.length).toBeGreaterThan(prev.length);
      expect(now.subarray(0, prev.length).equals(prev)).toBe(true);
      prev = now;
    }
    expect(ledger.readAll('sess-A').rows).toHaveLength(21);
  });
});

describe('EgressLedger — denial rows for every denial class serialize', () => {
  // One representative denial per principle the daemon ledgers (S1 containment, S2 binding, S5 cap),
  // plus an S3 execution refusal and a session-less pre-binding denial.
  const denials: DenialLedgerRow[] = [
    { kind: 'denial', ts: '2026-07-10T00:00:00.000Z', session: 'sess-A', taskId: 'task-1', reason: 'path escapes the granted root: ../x', principle: 'S1', tool: 'read' },
    { kind: 'denial', ts: '2026-07-10T00:00:01.000Z', session: 'sess-A', taskId: 'task-1', reason: 'bad signature', principle: 'S2' },
    { kind: 'denial', ts: '2026-07-10T00:00:02.000Z', session: 'sess-A', taskId: 'task-1', reason: 'wrong pairing', principle: 'S2' },
    { kind: 'denial', ts: '2026-07-10T00:00:03.000Z', session: 'sess-A', taskId: 'task-1', reason: 'task expired', principle: 'S2' },
    { kind: 'denial', ts: '2026-07-10T00:00:04.000Z', session: 'sess-A', taskId: 'task-1', reason: 'replayed nonce', principle: 'S2' },
    { kind: 'denial', ts: '2026-07-10T00:00:05.000Z', session: 'sess-A', taskId: 'task-1', reason: 'unknown or foreign-session grant: g9', principle: 'S2' },
    { kind: 'denial', ts: '2026-07-10T00:00:06.000Z', session: 'sess-A', taskId: 'task-1', reason: 'egress cap reached', principle: 'S5' },
    { kind: 'denial', ts: '2026-07-10T00:00:07.000Z', session: 'sess-A', taskId: 'task-1', reason: 'task not executable: unsupported shape', principle: 'S3' },
  ];

  it('every denial class round-trips exactly', () => {
    for (const d of denials) ledger.append(d);
    const { rows, corrupt } = ledger.readAll('sess-A');
    expect(corrupt).toBe(0);
    expect(rows).toEqual(denials);
  });

  it('a denial fired before a task is bound (no session) is still ledgered, in a reserved file', () => {
    const preBind: DenialLedgerRow = {
      kind: 'denial',
      ts: '2026-07-10T00:00:00.000Z',
      reason: 'bad signature',
      principle: 'S2',
    };
    ledger.append(preBind);
    // It must NOT land in any real session's file; readAll('sess-A') stays empty.
    expect(ledger.readAll('sess-A').rows).toEqual([]);
    // It lands in exactly one file, inside the ledger dir, and parses back.
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const stored = JSON.parse(readFileSync(join(dir, files[0]!), 'utf8').trim());
    expect(LedgerRow.parse(stored)).toEqual(preBind);
  });
});

describe('EgressLedger — a corrupt / truncated final line is tolerated on read', () => {
  it('skips a torn trailing partial line and counts it, keeping every complete row', () => {
    ledger.append(readRow('sess-A', { correlationId: 'c0' }));
    ledger.append(readRow('sess-A', { correlationId: 'c1' }));
    const file = join(dir, readdirSync(dir)[0]!);
    // Simulate a crash mid-append: a partial JSON fragment with no terminating newline.
    appendFileSync(file, '{"kind":"read","ts":"2026-07-10T00:00', 'utf8');

    const { rows, corrupt } = ledger.readAll('sess-A');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => (r.kind === 'read' ? r.correlationId : ''))).toEqual(['c0', 'c1']);
    expect(corrupt).toBe(1);
  });

  it('a line that parses as JSON but is not a valid row is skipped and counted', () => {
    ledger.append(readRow('sess-A', { correlationId: 'c0' }));
    const file = join(dir, readdirSync(dir)[0]!);
    appendFileSync(file, `${JSON.stringify({ kind: 'read', not: 'a valid row' })}\n`, 'utf8');
    const { rows, corrupt } = ledger.readAll('sess-A');
    expect(rows).toHaveLength(1);
    expect(corrupt).toBe(1);
  });
});

describe('EgressLedger — opaque session ids are sanitized to safe filenames', () => {
  it('a traversal-shaped session id cannot escape the ledger directory', () => {
    const hostile = '../../evil';
    ledger.append(readRow(hostile));

    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const full = resolve(dir, files[0]!);
    // The written file must be a direct child of the ledger dir — no traversal, no escape.
    expect(dirname(full)).toBe(resolve(dir));
    expect(full.startsWith(resolve(dir))).toBe(true);
    // And the id still round-trips: it is used opaquely as the readAll/ref key, not as a path.
    expect(ledger.readAll(hostile).rows).toHaveLength(1);
    expect(ledger.ledgerRefs(hostile)).toEqual(['../../evil:0']);
  });

  it('an absolute-path-shaped session id also stays inside the ledger directory', () => {
    const hostile = '/etc/passwd';
    ledger.append(readRow(hostile));
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(existsSync(join(dir, files[0]!))).toBe(true);
    // No absolute file was created outside the ledger dir.
    expect(existsSync('/etc/passwd.jsonl')).toBe(false);
    expect(ledger.readAll(hostile).rows).toHaveLength(1);
  });

  it('distinct session ids never collide on the same file', () => {
    ledger.append(readRow('sess-A', { correlationId: 'a' }));
    ledger.append(readRow('sess-B', { correlationId: 'b' }));
    expect(readdirSync(dir)).toHaveLength(2);
    expect(ledger.readAll('sess-A').rows).toHaveLength(1);
    expect(ledger.readAll('sess-B').rows).toHaveLength(1);
  });
});

describe('EgressLedger — durability under a tight sequential loop', () => {
  it('500 sequential appends produce exactly 500 lines and 500 parsed rows', () => {
    const N = 500;
    for (let i = 0; i < N; i += 1) {
      ledger.append(readRow('sess-A', { correlationId: `c${i}`, bytesOut: i }));
    }
    const file = join(dir, readdirSync(dir)[0]!);
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(N);

    const { rows, corrupt } = ledger.readAll('sess-A');
    expect(corrupt).toBe(0);
    expect(rows).toHaveLength(N);
    expect(ledger.ledgerRefs('sess-A')).toHaveLength(N);
  });
});

describe('EgressLedger — the ledger constructor creates its directory', () => {
  it('a not-yet-existing nested ledger dir is created on construction', () => {
    const nested = join(dir, 'a', 'b', 'ledger');
    expect(existsSync(nested)).toBe(false);
    const l = new EgressLedger(nested);
    l.append(readRow('sess-A'));
    expect(existsSync(nested)).toBe(true);
    expect(l.readAll('sess-A').rows).toHaveLength(1);
  });
});

describe('EgressLedger — a pathologically long session id (review fix)', () => {
  it('a session id whose base64url stem exceeds the filename limit still appends + reads back', () => {
    // DelegatedTask.session is an unbounded wire string; a ~400-char id base64url-expands past the
    // 255-byte filename limit, which used to make every append ENAMETOOLONG. It must now hash to a
    // short, stable stem instead — 1:1 per session, so round-tripping still works.
    const longSession = 'S'.repeat(400);
    expect(() => ledger.append(readRow(longSession))).not.toThrow();
    expect(() => ledger.append(readRow(longSession))).not.toThrow();
    const { rows, corrupt } = ledger.readAll(longSession);
    expect(corrupt).toBe(0);
    expect(rows).toHaveLength(2);
    // The stem stays well under the filename limit.
    const files = readdirSync(dir);
    expect(files.every((f) => f.length <= 255)).toBe(true);
  });

  it('two DISTINCT long session ids do not collide on one file', () => {
    ledger.append(readRow('A'.repeat(400)));
    ledger.append(readRow('B'.repeat(400)));
    expect(ledger.readAll('A'.repeat(400)).rows).toHaveLength(1);
    expect(ledger.readAll('B'.repeat(400)).rows).toHaveLength(1);
  });
});
