'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Info, X } from 'lucide-react';
import {
  PRIVACY_COPY,
  PRIVACY_CLAIMS,
  PRIVACY_SETTINGS_HREF,
  maskedCountsClaim,
  type LocalFileActivity,
} from '@/lib/privacy-claims';
import { GatedClaim } from './gated-claim';

/** PT-PT byte formatting (comma decimal): 3100 -> "3,1 KB". */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace('.', ',')} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1).replace('.', ',')} MB`;
}

function readSummary(files: LocalFileActivity['files']): string {
  const [first] = files;
  if (!first) return '';
  const name = first.path.split('/').pop() || first.path;
  const range = first.range ? ` (${first.range})` : '';
  const more = files.length > 1 ? ` +${files.length - 1}` : '';
  return `${PRIVACY_COPY.chipReadPrefix} ${name}${range}${more}`;
}

/**
 * FC-402 per-turn trust chip + FC-403 "i" custody panel.
 *
 * Rendered ONLY on a hosted chat turn that touched local files - i.e. when the
 * turn carries `activity`, joined hosted-side from the daemon egress ledger
 * (bytes-out) and the anonymisation audit (masked counts) on the correlation id
 * (§12.6.2). In the hosted-only build that data is absent, so the chip stays
 * dormant; when present it may be bytes-only until the audit-join lands (§12.6.2
 * cut-line). The mechanism halves (read summary, bytes-out) are honest two-boundary
 * copy and ship; the masked-count clause and the custody panel are CLAIMS and are
 * ship-gated (§17.9 A7.4) - shown through <GatedClaim>, never asserted, while
 * CLAIMS_SHIP_GATED is true.
 */
export function TrustChip({ activity }: { activity?: LocalFileActivity | null }) {
  const [panelOpen, setPanelOpen] = useState(false);

  if (!activity || activity.files.length === 0) return null;

  const maskClaim = activity.maskedCounts
    ? maskedCountsClaim(activity.maskedCounts)
    : null;

  return (
    <div className="relative mt-1.5 inline-flex max-w-full flex-col" data-testid="trust-chip">
      <div className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1.5 text-[11px] text-neutral-600">
        <ShieldCheck size={12} className="shrink-0 text-teal-600" aria-hidden />

        {/* Mechanism, ships: what was read + bytes out (Boundary 1 honest). */}
        <span className="font-medium text-neutral-700">{readSummary(activity.files)}</span>

        {typeof activity.bytesOut === 'number' && (
          <>
            <span className="text-neutral-300">{PRIVACY_COPY.chipSeparator.trim()}</span>
            <span>
              {formatBytes(activity.bytesOut)} {PRIVACY_COPY.chipBytesSuffix}
            </span>
          </>
        )}

        {/* Claim, ship-gated: masked-entity counts (Boundary 2). */}
        {maskClaim && (
          <>
            <span className="text-neutral-300">{PRIVACY_COPY.chipSeparator.trim()}</span>
            <GatedClaim inline>
              <span>{maskClaim}</span>
            </GatedClaim>
          </>
        )}

        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={PRIVACY_COPY.chipInfoLabel}
          aria-expanded={panelOpen}
          className="ml-0.5 rounded p-0.5 text-neutral-400 transition-colors hover:text-neutral-700 focus-ring"
          data-testid="trust-chip-info"
        >
          <Info size={12} aria-hidden />
        </button>
      </div>

      {/* FC-403 custody panel: claims are ship-gated. */}
      {panelOpen && (
        <div
          className="absolute left-0 top-full z-40 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-neutral-200 bg-white p-3 shadow-lg"
          data-testid="trust-chip-panel"
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-xs font-semibold text-neutral-900">
              {PRIVACY_COPY.chipInfoLabel}
            </span>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label={PRIVACY_COPY.firstGrantCancel}
              className="rounded p-0.5 text-neutral-400 hover:text-neutral-700 focus-ring"
            >
              <X size={12} aria-hidden />
            </button>
          </div>

          <div className="mt-2">
            <GatedClaim>
              <p className="text-[11px] leading-relaxed text-neutral-600">
                {PRIVACY_CLAIMS.ceiling}
              </p>
            </GatedClaim>
          </div>

          <Link
            href={PRIVACY_SETTINGS_HREF}
            onClick={() => setPanelOpen(false)}
            className="mt-2 inline-block text-[11px] font-medium text-teal-700 hover:text-teal-800"
          >
            {PRIVACY_COPY.onboardingLearnMore}
          </Link>
        </div>
      )}
    </div>
  );
}
