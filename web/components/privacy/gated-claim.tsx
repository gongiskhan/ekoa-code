'use client';

import type { ReactNode } from 'react';
import { Clock } from 'lucide-react';
import { CLAIMS_SHIP_GATED, PRIVACY_COPY } from '@/lib/privacy-claims';

/**
 * Renders a claims-bearing string ONLY when the mechanism it describes has passed
 * its gate. While `CLAIMS_SHIP_GATED` is true (§12.6 ship-gate; §17.9 A7.4) the
 * child claim is withheld and a visibly-pending "verificação em curso" placeholder
 * is shown in its place - so a custody assertion is never presented as fact ahead
 * of its enforcement. The mechanism UI around a gated claim (bridge status, grants,
 * ledger, masking counts) renders normally; only the claim text is gated.
 *
 * `inline` swaps the block placeholder for a compact inline badge, for claims that
 * sit inside a line of running copy.
 */
export function GatedClaim({
  children,
  inline = false,
  className,
}: {
  children: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  if (!CLAIMS_SHIP_GATED) return <>{children}</>;

  if (inline) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-amber-700 bg-amber-50 ${className ?? ''}`}
        data-testid="gated-claim"
        data-claim-gated="true"
      >
        <Clock className="h-3 w-3" aria-hidden />
        {PRIVACY_COPY.claimPending}
      </span>
    );
  }

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border border-dashed border-amber-200 bg-amber-50/50 px-3 py-2 text-xs text-amber-700 ${className ?? ''}`}
      data-testid="gated-claim"
      data-claim-gated="true"
    >
      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{PRIVACY_COPY.claimPending}</span>
    </div>
  );
}
