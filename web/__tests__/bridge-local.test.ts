// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDaemonGrants,
  fetchDaemonLedger,
  revokeDaemonGrant,
  BridgeLocalUnavailable,
  BRIDGE_LOCAL_ORIGIN,
} from '@/lib/bridge-local';

/** s4 — browser -> daemon loopback client: tolerant parses, honest failures, no invention. */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('fetchDaemonGrants', () => {
  it('parses grants and DROPS unparseable entries (never invents)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ grants: [{ grantRef: 'g-1', label: 'Contratos', scope: 'folder' }, { nope: true }, { grantRef: 'g-2', path: '/x/y' }] }),
    );
    const grants = await fetchDaemonGrants();
    expect(grants.map((g) => g.grantRef)).toEqual(['g-1', 'g-2']);
    expect(fetchMock.mock.calls[0]![0]).toBe(`${BRIDGE_LOCAL_ORIGIN}/grants`);
  });

  it('404 (daemon predates C3) -> BridgeLocalUnavailable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));
    await expect(fetchDaemonGrants()).rejects.toBeInstanceOf(BridgeLocalUnavailable);
  });

  it('network/CORS failure -> BridgeLocalUnavailable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(fetchDaemonGrants()).rejects.toBeInstanceOf(BridgeLocalUnavailable);
  });
});

describe('fetchDaemonLedger', () => {
  it('parses the row-kind union and counts unparseable rows honestly', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        session: 's1',
        rows: [
          { kind: 'read', ts: '2026-07-11T06:00:00Z', session: 's1', path: '/docs/contrato.txt', byteRange: '0-3100', bytesOut: 3100, tool: 'read', correlationId: 'c1', sha256: 'h' },
          { kind: 'write', ts: '2026-07-11T06:01:00Z', session: 's1', path: '/docs/nota.txt', bytesWritten: 42, tool: 'write' },
          { kind: 'denial', ts: '2026-07-11T06:02:00Z', reason: 'fora da autorização', principle: 'S2' },
          { kind: 'martian', ts: 'x' },
          { totally: 'broken' },
        ],
      }),
    );
    const ledger = await fetchDaemonLedger('s1');
    expect(ledger.rows.map((r) => r.kind)).toEqual(['read', 'write', 'denial']);
    expect(ledger.unparseable).toBe(2);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${BRIDGE_LOCAL_ORIGIN}/ledger?session=s1`);
  });

  it('bad envelope shape -> BridgeLocalUnavailable', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ nope: [] }));
    await expect(fetchDaemonLedger('s1')).rejects.toBeInstanceOf(BridgeLocalUnavailable);
  });
});

describe('revokeDaemonGrant', () => {
  it('POSTs the grantRef to /grants/revoke', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await revokeDaemonGrant('g-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${BRIDGE_LOCAL_ORIGIN}/grants/revoke`);
    expect((init as RequestInit).method).toBe('POST');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ grantRef: 'g-1' });
  });
});
