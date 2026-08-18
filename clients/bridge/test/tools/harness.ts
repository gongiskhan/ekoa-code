/**
 * test/tools/harness.ts — shared scaffolding for the Tier-1 file-tool suites (NOT a test file itself;
 * vitest only collects `*.test.ts`). Every suite builds a fresh temp grant tree + fresh ledger +
 * fresh per-session egress accountant in `beforeEach` via `makeHarness`, so no state leaks between
 * tests and nothing ever touches a real user path. All fixture contents are synthetic.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { GrantTable, EgressAccounting } from '../../src/session/index.js';
import { EgressLedger, type LedgerRow, type DenialLedgerRow } from '../../src/ledger/index.js';
import type { ToolContext } from '../../src/tools/index.js';

export interface Harness {
  root: string;
  grantRoot: string;
  ledgerDir: string;
  grantTable: GrantTable;
  egress: EgressAccounting;
  ledger: EgressLedger;
  /** A ToolContext for the granted session, with an injected deterministic clock. Override any field. */
  ctx(over?: Partial<ToolContext>): ToolContext;
  /** Create a fixture file at `relPath` under the grant root (creating parent dirs). */
  file(relPath: string, content: string): void;
  /** Create a fixture dir at `relPath` under the grant root. */
  dir(relPath: string): void;
  /** All rows the ledger holds for the granted session, in append order. */
  rows(): LedgerRow[];
  /** All denial rows for the granted session. */
  denials(): DenialLedgerRow[];
  cleanup(): void;
}

export const SESSION = 'sess-A';
export const GRANT = 'g1';

export function makeHarness(session: string = SESSION): Harness {
  const root = mkdtempSync(join(tmpdir(), 'ekoa-tools-'));
  const grantRoot = join(root, 'granted');
  mkdirSync(grantRoot, { recursive: true });
  const ledgerDir = mkdtempSync(join(tmpdir(), 'ekoa-tools-ledger-'));
  const grantTable = new GrantTable([{ grantRef: GRANT, root: grantRoot, session }]);
  const egress = new EgressAccounting();
  const ledger = new EgressLedger(ledgerDir);

  let tick = 0;
  const now = (): number => 1_700_000_000_000 + tick++ * 1000;

  const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
    grantTable,
    egress,
    ledger,
    session,
    taskId: 'task-1',
    correlationId: 'corr-1',
    budgetBytes: 1_000_000,
    now,
    ...over,
  });

  return {
    root,
    grantRoot,
    ledgerDir,
    grantTable,
    egress,
    ledger,
    ctx,
    file(relPath, content) {
      const abs = join(grantRoot, relPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    dir(relPath) {
      mkdirSync(join(grantRoot, relPath), { recursive: true });
    },
    rows() {
      return ledger.readAll(session).rows;
    },
    denials() {
      return ledger.readAll(session).rows.filter((r): r is DenialLedgerRow => r.kind === 'denial');
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

/** sha256 (hex) of a utf8 string — the same digest the tools compute over file bytes. */
export function sha256(text: string): string {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
