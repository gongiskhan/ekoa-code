import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { joinLocalActivity } from '../../src/agents/chat.js';
import { setLocalActivitySources, __resetAgentSeamsForTests, type DelegationToolResult } from '../../src/agents/seams.js';

/**
 * s5 — the FC-402 per-turn join (D3): delegation results + buffered ledger rows + the
 * anon-audit mask counts -> ONE `local_activity` payload, or undefined when the turn
 * touched no local files. Failure modes degrade to bytes-only, never invented counts.
 */

function okResult(over: Partial<DelegationToolResult> = {}): DelegationToolResult {
  return {
    status: 'ok',
    citations: [{ path: '/docs/contrato.txt', range: '3.1' }],
    ledgerRefs: ['c1'],
    telemetry: { egressBytes: 500, maskedCounts: {} },
    ...over,
  };
}

beforeEach(() => __resetAgentSeamsForTests());
afterEach(() => __resetAgentSeamsForTests());

describe('joinLocalActivity', () => {
  it('no ok delegations -> undefined (chip stays dormant)', async () => {
    expect(await joinLocalActivity('s1', 'orgA', [])).toBeUndefined();
    expect(await joinLocalActivity('s1', 'orgA', [okResult({ status: 'unreachable', citations: [], ledgerRefs: [] })])).toBeUndefined();
  });

  it('joins citations + ledger bytes + audit mask counts on the correlation ids', async () => {
    const asked: string[][] = [];
    setLocalActivitySources({
      ledgerRows: (session, ids) => {
        expect(session).toBe('s1');
        expect(ids).toEqual(['c1']);
        return [{ path: '/docs/contrato.txt', byteRange: '0-3100', bytesOut: 3100, correlationId: 'c1' }];
      },
      maskedCounts: async (orgId, ids) => {
        expect(orgId).toBe('orgA');
        asked.push(ids);
        return { nomes: 14, NIF: 3 };
      },
    });
    const a = await joinLocalActivity('s1', 'orgA', [okResult()]);
    expect(a).toEqual({
      files: [{ path: '/docs/contrato.txt', range: '3.1' }],
      bytesOut: 3100,
      maskedCounts: { nomes: 14, NIF: 3 },
      correlationId: 'c1',
    });
    expect(asked).toEqual([['c1']]);
  });

  it('no buffered rows -> telemetry bytes; audit-join failure -> bytes-only (never invented)', async () => {
    setLocalActivitySources({
      ledgerRows: () => [],
      maskedCounts: async () => {
        throw new Error('audit down');
      },
    });
    const a = await joinLocalActivity('s1', 'orgA', [okResult()]);
    expect(a).toEqual({ files: [{ path: '/docs/contrato.txt', range: '3.1' }], bytesOut: 500, correlationId: 'c1' });
  });

  it('citation-less compose still names files from the ledger rows; duplicates dedupe', async () => {
    setLocalActivitySources({
      ledgerRows: () => [
        { path: '/a.txt', byteRange: '0-10', bytesOut: 10, correlationId: 'c1' },
        { path: '/a.txt', byteRange: '0-10', bytesOut: 10, correlationId: 'c1' },
      ],
      maskedCounts: async () => ({}),
    });
    const a = await joinLocalActivity('s1', 'orgA', [okResult({ citations: [] })]);
    expect(a?.files).toEqual([{ path: '/a.txt', range: '0-10' }]);
    expect(a?.bytesOut).toBe(20);
    expect(a?.maskedCounts).toBeUndefined();
  });
});
