'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { api, tryCall } from '@/lib/api';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { useBridgePresence } from '@/hooks/use-bridge-presence';
import { fetchDaemonLedger, type DaemonLedgerRow } from '@/lib/bridge-local';

/**
 * FC-407 local egress-ledger viewer. The ledger is kept and served LIVE by the daemon's
 * loopback surface and rendered straight from it (run D2) — hosted persistence of ledger
 * rows is off by default (§18.2: folder paths can themselves be sensitive), so nothing
 * fetched here ever goes back to the hosted API. The daemon serves rows per hosted
 * session (`GET /ledger?session=`), so the viewer carries a session picker fed by the
 * user's own session list; an all-sessions view is a flagged counterpart follow-up
 * (docs/bridge-counterpart-changes.md). An export (print/CSV) is a named fast-follow,
 * not this run (§12.6.3).
 */

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace('.', ',')} KB`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString('pt-PT');
}

function rowPath(row: DaemonLedgerRow): string {
  if (row.kind === 'read' || row.kind === 'write') return row.path;
  if (row.kind === 'denial') return row.reason;
  if (row.kind === 'automation') return row.detail;
  return '';
}

function rowRange(row: DaemonLedgerRow): string {
  if (row.kind === 'read') return row.byteRange;
  if (row.kind === 'denial') return row.principle;
  if (row.kind === 'automation') return row.outcome;
  return '';
}

function rowBytes(row: DaemonLedgerRow): string {
  if (row.kind === 'read') return fmtBytes(row.bytesOut);
  if (row.kind === 'write') return fmtBytes(row.bytesWritten);
  return '';
}

export function LedgerSection() {
  const { connected } = useBridgePresence();
  const [sessions, setSessions] = useState<Array<{ id: string; name: string }>>([]);
  const [session, setSession] = useState<string>('');
  const [rows, setRows] = useState<DaemonLedgerRow[] | null>(null);
  const [unparseable, setUnparseable] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  // The user's sessions feed the picker (ids only — the hosted API already owns them).
  useEffect(() => {
    if (!connected) return;
    void (async () => {
      const res = await tryCall(() => api.sessions.list());
      if (res.ok) {
        const items = (res.data as { items?: Array<{ id: string; name?: string }> }).items ?? [];
        setSessions(items.map((s) => ({ id: s.id, name: s.name || s.id })));
        if (items.length > 0) setSession((cur) => cur || items[0]!.id);
      }
    })();
  }, [connected]);

  const load = useCallback(async (sid: string) => {
    try {
      const ledger = await fetchDaemonLedger(sid);
      setRows(ledger.rows);
      setUnparseable(ledger.unparseable);
      setUnavailable(false);
    } catch {
      setRows(null);
      setUnavailable(true);
    }
  }, []);

  useEffect(() => {
    if (!connected || !session) {
      setRows(null);
      setUnavailable(false);
      return;
    }
    void load(session);
  }, [connected, session, load]);

  return (
    <section data-testid="privacy-ledger">
      <CardTitle icon={ScrollText}>{PRIVACY_COPY.ledgerSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.ledgerSectionDesc}</CardDescription>

      {connected && sessions.length > 0 && (
        <div className="mt-3 max-w-xs">
          <Select
            label={PRIVACY_COPY.ledgerSessionLabel}
            value={session}
            onChange={(e) => setSession(e.target.value)}
            data-testid="ledger-session-select"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <Card className="mt-3" padding="none">
        <div className="grid grid-cols-[auto_auto_1fr_auto_auto] gap-x-4 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          <span>{PRIVACY_COPY.ledgerColTime}</span>
          <span>{PRIVACY_COPY.ledgerColKind}</span>
          <span>{PRIVACY_COPY.ledgerColPath}</span>
          <span>{PRIVACY_COPY.ledgerColRange}</span>
          <span className="text-right">{PRIVACY_COPY.ledgerColBytes}</span>
        </div>

        {!connected ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-500">{PRIVACY_COPY.ledgerOffline}</div>
        ) : unavailable ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-500" data-testid="ledger-unavailable">
            {PRIVACY_COPY.ledgerUnavailable}
          </div>
        ) : rows === null || rows.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-neutral-500">{PRIVACY_COPY.ledgerEmpty}</div>
        ) : (
          <div data-testid="ledger-rows">
            {rows.map((row, i) => (
              <div
                key={i}
                className="grid grid-cols-[auto_auto_1fr_auto_auto] gap-x-4 border-b border-line px-4 py-2 text-xs text-neutral-600 last:border-b-0"
                data-testid={`ledger-row-${row.kind}`}
              >
                <span className="whitespace-nowrap text-neutral-400">{fmtTime(row.ts)}</span>
                <span className="whitespace-nowrap font-medium">
                  {PRIVACY_COPY.ledgerKindLabels[row.kind] ?? row.kind}
                </span>
                <span className="truncate font-mono" title={rowPath(row)}>
                  {rowPath(row)}
                </span>
                <span className="whitespace-nowrap text-neutral-400">{rowRange(row)}</span>
                <span className="whitespace-nowrap text-right">{rowBytes(row)}</span>
              </div>
            ))}
            {unparseable > 0 && (
              <div className="px-4 py-2 text-[11px] text-neutral-400" data-testid="ledger-unparseable">
                {PRIVACY_COPY.ledgerUnparseable(unparseable)}
              </div>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
