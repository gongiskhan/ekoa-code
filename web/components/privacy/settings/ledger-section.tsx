'use client';

import { ScrollText } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { useBridgePresence } from '@/hooks/use-bridge-presence';

/**
 * FC-407 local egress-ledger viewer. The ledger is kept and served LIVE by the
 * daemon; hosted persistence of ledger rows is off by default (§18.2 - folder paths
 * can themselves be sensitive). There is no hosted endpoint, so this renders the
 * viewer chrome plus the offline/empty state rather than inventing one. An export
 * (print/CSV) is a named fast-follow, not this run (§12.6.3).
 */
export function LedgerSection() {
  const { connected } = useBridgePresence();

  return (
    <section data-testid="privacy-ledger">
      <CardTitle icon={ScrollText}>{PRIVACY_COPY.ledgerSectionTitle}</CardTitle>
      <CardDescription>{PRIVACY_COPY.ledgerSectionDesc}</CardDescription>

      <Card className="mt-3" padding="none">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
          <span>{PRIVACY_COPY.ledgerColPath}</span>
          <span>{PRIVACY_COPY.ledgerColRange}</span>
          <span className="text-right">{PRIVACY_COPY.ledgerColBytes}</span>
        </div>
        <div className="px-4 py-6 text-center text-sm text-neutral-500">
          {connected ? PRIVACY_COPY.ledgerEmpty : PRIVACY_COPY.ledgerOffline}
        </div>
      </Card>
    </section>
  );
}
