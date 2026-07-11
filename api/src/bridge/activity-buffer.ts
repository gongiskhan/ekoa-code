/**
 * bridge/activity-buffer.ts — the BOUNDED, IN-MEMORY, per-session buffer of daemon
 * `ledger_row` frames (run s5, D3; ch18 §18.2). The daemon streams each egress ledger row
 * to the hosted side as display metadata; the chat pipeline joins them per turn into the
 * FC-402 trust chip's `local_activity` event.
 *
 * INVARIANT (never-cut, §18.2 / FC-407): rows are NEVER persisted hosted-side — paths can
 * themselves be sensitive (client names in folder names). This module is a Map with a TTL
 * and hard caps; nothing here touches a store, and nothing exports the raw map.
 */
import type { EgressLedgerRow } from '@ekoa/shared';

const TTL_MS = 15 * 60_000;
const MAX_ROWS_PER_SESSION = 200;
const MAX_SESSIONS = 500;

interface Buffered {
  row: EgressLedgerRow;
  at: number;
}

const bySession = new Map<string, Buffered[]>();

function sweep(now: number): void {
  for (const [session, rows] of bySession) {
    const kept = rows.filter((b) => now - b.at < TTL_MS);
    if (kept.length === 0) bySession.delete(session);
    else if (kept.length !== rows.length) bySession.set(session, kept);
  }
  // Hard session cap: drop the oldest sessions outright (a daemon flooding distinct
  // session ids must not grow hosted memory unboundedly).
  while (bySession.size > MAX_SESSIONS) {
    const oldest = bySession.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    bySession.delete(oldest);
  }
}

/** The composition root wires this as `attachBridgeServer`'s `onLedgerRow` (server.ts). */
export function bufferLedgerRow(_taskId: string, row: EgressLedgerRow, deps?: { now?: () => number }): void {
  const now = deps?.now?.() ?? Date.now();
  sweep(now);
  const rows = bySession.get(row.session) ?? [];
  rows.push({ row, at: now });
  if (rows.length > MAX_ROWS_PER_SESSION) rows.splice(0, rows.length - MAX_ROWS_PER_SESSION);
  bySession.set(row.session, rows);
}

/**
 * The buffered rows for one session, optionally narrowed to the correlation ids a turn's
 * delegation results referenced (`ledgerRefs`). Read-only: rows stay buffered until TTL —
 * a session may render several turns' chips.
 */
export function rowsForSession(session: string, correlationIds?: string[], deps?: { now?: () => number }): EgressLedgerRow[] {
  const now = deps?.now?.() ?? Date.now();
  const rows = (bySession.get(session) ?? []).filter((b) => now - b.at < TTL_MS).map((b) => b.row);
  if (!correlationIds || correlationIds.length === 0) return rows;
  const wanted = new Set(correlationIds);
  return rows.filter((r) => wanted.has(r.correlationId));
}

/** Test-only. */
export function __resetActivityBufferForTests(): void {
  bySession.clear();
}
