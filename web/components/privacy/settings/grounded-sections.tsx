'use client';

import { useState } from 'react';
import { ChevronDown, Scale } from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import {
  PRIVACY_COPY,
  PRIVACY_CLAIMS,
  PRIVACY_CITATIONS,
} from '@/lib/privacy-claims';
import { GatedClaim } from '../gated-claim';

/**
 * FC-410 grounded expandable sections. Each grounds a claim already licensed in
 * §17.9's A1/A6 lists - never a new claim drafted at the UI layer. The primary
 * one-line title is plain-language and carries no citation; the grounded claim,
 * its citation, and the "isto não é aconselhamento jurídico" line live inside the
 * "saiba mais" expansion. Every claim is DRAFTED but SHIP-GATED: while
 * CLAIMS_SHIP_GATED is true the expansions show the pending placeholder via
 * <GatedClaim>, never the assertion (§17.9 A7.4).
 */

interface Grounded {
  key: string;
  title: string;
  /** The licensed claim texts (§12.6.3 A6 verbatim ceiling). */
  claims: string[];
  citation: string;
}

const SECTIONS: Grounded[] = [
  {
    key: 'segredo',
    title: PRIVACY_COPY.groundedSegredoTitle,
    claims: [PRIVACY_CLAIMS.custodySegredo, PRIVACY_CLAIMS.custodyLedger, PRIVACY_CLAIMS.limites],
    citation: PRIVACY_CITATIONS.segredo,
  },
  {
    key: 'authority',
    title: PRIVACY_COPY.groundedAuthorityTitle,
    claims: [PRIVACY_CLAIMS.jurisdiction, PRIVACY_CLAIMS.limites],
    citation: PRIVACY_CITATIONS.authority,
  },
  {
    key: 'data-location',
    title: PRIVACY_COPY.groundedDataLocationTitle,
    claims: [PRIVACY_CLAIMS.minimizacao, PRIVACY_CLAIMS.limites],
    citation: PRIVACY_CITATIONS.dataLocation,
  },
];

function GroundedRow({ section }: { section: Grounded }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line last:border-b-0" data-testid={`grounded-${section.key}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 py-3 text-left focus-ring"
      >
        <span className="text-sm font-medium text-neutral-800">{section.title}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-teal-700">
          {PRIVACY_COPY.groundedSaibaMais}
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
      </button>

      {open && (
        <div className="pb-3">
          <GatedClaim>
            <div className="space-y-2">
              {section.claims.map((claim, i) => (
                <p key={i} className="text-xs leading-relaxed text-neutral-600">
                  {claim}
                </p>
              ))}
            </div>
          </GatedClaim>
          <p className="mt-2 text-[11px] text-neutral-400">{section.citation}</p>
          <p className="mt-1 text-[11px] font-medium italic text-neutral-500">
            {PRIVACY_COPY.groundedLegalDisclaimer}
          </p>
        </div>
      )}
    </div>
  );
}

export function GroundedSections() {
  return (
    <section data-testid="privacy-grounded">
      <CardTitle icon={Scale}>{PRIVACY_COPY.groundedSectionTitle}</CardTitle>
      <Card className="mt-3" padding="none">
        <div className="px-4">
          {SECTIONS.map((s) => (
            <GroundedRow key={s.key} section={s} />
          ))}
        </div>
      </Card>
    </section>
  );
}
