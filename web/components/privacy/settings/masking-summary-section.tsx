'use client';

import { EyeOff } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { PRIVACY_COPY } from '@/lib/privacy-claims';
import { GatedClaim } from '../gated-claim';

/**
 * FC-408 masking activity summary. The counts come from the hosted anonymisation
 * audit log (entity classes and counts, never bodies, never the vault - §17.6).
 * That audit surface has no dedicated hosted read endpoint in this build, so the
 * section renders its pending state rather than an invented one; it fills in once
 * the audit read lands and the anonymisation gate is green (§17.9 ship-gate).
 */
export function MaskingSummarySection() {
  return (
    <section data-testid="privacy-masking-summary">
      <CardTitle icon={EyeOff}>{PRIVACY_COPY.maskingSectionTitle}</CardTitle>
      {/* The description asserts the masking mechanism ("foram mascaradas antes de cada pedido
          chegar ao fornecedor de IA") - a claim, so it is ship-gated (§17.9 A7.4) like the rest. */}
      <CardDescription>
        <GatedClaim inline>{PRIVACY_COPY.maskingSectionDesc}</GatedClaim>
      </CardDescription>

      <Card className="mt-3">
        <p className="text-sm text-neutral-500">{PRIVACY_COPY.maskingPending}</p>
      </Card>
    </section>
  );
}
