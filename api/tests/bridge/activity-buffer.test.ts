import { describe, it, expect, beforeEach } from 'vitest';
import type { EgressLedgerRow } from '@ekoa/shared';
import { bufferLedgerRow, rowsForSession, __resetActivityBufferForTests } from '../../src/bridge/activity-buffer.js';

/**
 * s5 — the FC-402 in-memory ledger-row buffer (§18.2). Bounded (per-session cap + TTL +
 * session cap), never persisted (it is a Map — this suite asserts the behavioral bounds;
 * the no-store invariant is structural: the module imports no store).
 */

function row(session: string, correlationId: string, bytesOut = 100): EgressLedgerRow {
  return {
    ts: '2026-07-11T06:00:00Z',
    session,
    correlationId,
    path: `/docs/${correlationId}.txt`,
    byteRange: '0-100',
    bytesOut,
    sha256: 'h',
    tool: 'read',
  };
}

beforeEach(() => __resetActivityBufferForTests());

describe('activity buffer', () => {
  it('buffers rows per session and narrows by correlation ids', () => {
    bufferLedgerRow('t1', row('s1', 'c1', 10));
    bufferLedgerRow('t1', row('s1', 'c2', 20));
    bufferLedgerRow('t2', row('s2', 'c3', 30));

    expect(rowsForSession('s1').map((r) => r.correlationId)).toEqual(['c1', 'c2']);
    expect(rowsForSession('s1', ['c2']).map((r) => r.correlationId)).toEqual(['c2']);
    expect(rowsForSession('s2').map((r) => r.correlationId)).toEqual(['c3']);
    expect(rowsForSession('missing')).toEqual([]);
  });

  it('TTL: rows older than 15 minutes are gone', () => {
    let t = 1_000_000;
    const deps = { now: () => t };
    bufferLedgerRow('t1', row('s1', 'c1'), deps);
    t += 14 * 60_000;
    expect(rowsForSession('s1', undefined, deps)).toHaveLength(1);
    t += 2 * 60_000;
    expect(rowsForSession('s1', undefined, deps)).toHaveLength(0);
  });

  it('per-session cap: only the newest 200 rows survive', () => {
    for (let i = 0; i < 250; i++) bufferLedgerRow('t1', row('s1', `c${i}`));
    const rows = rowsForSession('s1');
    expect(rows).toHaveLength(200);
    expect(rows[0]!.correlationId).toBe('c50');
    expect(rows[199]!.correlationId).toBe('c249');
  });

  it('session cap: a flood of distinct sessions cannot grow memory unboundedly', () => {
    for (let i = 0; i < 600; i++) bufferLedgerRow('t1', row(`s${i}`, `c${i}`));
    let alive = 0;
    for (let i = 0; i < 600; i++) if (rowsForSession(`s${i}`).length > 0) alive += 1;
    expect(alive).toBeLessThanOrEqual(501);
  });
});
