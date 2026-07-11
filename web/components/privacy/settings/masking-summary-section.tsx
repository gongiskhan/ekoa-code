'use client';

import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { api, tryCall } from '@/lib/api';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { GatedClaim } from '../gated-claim';

interface Summary {
  classes: Record<string, number>;
  entityCount: number;
  events: number;
}

/**
 * FC-408 masking activity summary. The counts come from the caller's own hosted
 * anonymisation audit (entity classes and counts, never bodies, never the vault — §17.6)
 * via GET /api/v1/registo/masking-summary (run s5). Zero audited events renders the
 * pending copy — the mechanism may simply not have run for this account yet; never an
 * invented count. The section DESCRIPTION asserts the masking mechanism, so it stays
 * ship-gated (§17.9 A7.4); the numbers themselves are mechanism output, not claims.
 */
export function MaskingSummarySection() {
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await tryCall(() => api.registo.maskingSummary());
      if (res.ok) setSummary(res.data as Summary);
    })();
  }, []);

  const hasActivity = summary !== null && summary.events > 0 && Object.keys(summary.classes).length > 0;

  return (
    <section data-testid="privacy-masking-summary">
      <CardTitle icon={EyeOff}>{PRIVACY_COPY.maskingSectionTitle}</CardTitle>
      {/* The description asserts the masking mechanism ("foram mascaradas antes de cada pedido
          chegar ao fornecedor de IA") - a claim, so it is ship-gated (§17.9 A7.4) like the rest. */}
      <CardDescription>
        <GatedClaim inline>{PRIVACY_COPY.maskingSectionDesc}</GatedClaim>
      </CardDescription>

      <Card className="mt-3">
        {hasActivity ? (
          <ul className="divide-y divide-line" data-testid="masking-classes">
            {Object.entries(summary.classes)
              .sort(([, a], [, b]) => b - a)
              .map(([cls, count]) => (
                <li key={cls} className="flex items-center justify-between py-2 text-sm first:pt-0 last:pb-0">
                  <span className="text-neutral-700">{cls}</span>
                  <span className="font-mono text-neutral-500">{count}</span>
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-neutral-500">{PRIVACY_COPY.maskingPending}</p>
        )}
      </Card>
    </section>
  );
}
