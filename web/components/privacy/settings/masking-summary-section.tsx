'use client';

import { EyeOff } from 'lucide-react';
import { Card, CardTitle, CardDescription } from '@/components/ui/card';
import { PRIVACY_COPY } from '@/lib/privacy-claims';

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
      <CardDescription>{PRIVACY_COPY.maskingSectionDesc}</CardDescription>

      <Card className="mt-3">
        <p className="text-sm text-neutral-500">{PRIVACY_COPY.maskingPending}</p>
      </Card>
    </section>
  );
}
