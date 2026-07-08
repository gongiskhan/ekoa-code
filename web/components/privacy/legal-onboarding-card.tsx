'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, X, Laptop, Cloud } from 'lucide-react';
import { PRIVACY_COPY, PRIVACY_CLAIMS, PRIVACY_SETTINGS_HREF } from '@/lib/privacy-claims';
import { GatedClaim } from './gated-claim';

const DISMISS_KEY = 'ekoa_privacy_onboarding_dismissed';

/**
 * FC-412 one-time onboarding card for Ekoa Legal orgs. Introduces the two-boundary
 * model (diagram 10) in plain language - one card, not a tour. Two variants:
 *  - "onboarding": the dismissible, once-per-user card shown on first use (chat
 *    empty state). Dismissal persists in localStorage.
 *  - "reference": the always-visible copy re-homed in the settings privacy surface,
 *    so the card is reachable again after dismissal (§12.6.4).
 *
 * The two-boundary STRUCTURE (your machine; the AI provider) is neutral framing and
 * ships; the custody CLAIM (the §17.9 ceiling) is DRAFTED but SHIP-GATED and shown
 * only through <GatedClaim> - never asserted while CLAIMS_SHIP_GATED is true.
 */
export function LegalOnboardingCard({
  variant = 'onboarding',
}: {
  variant?: 'onboarding' | 'reference';
}) {
  const dismissible = variant === 'onboarding';
  const [dismissed, setDismissed] = useState(dismissible);

  // Read the persisted dismissal only after mount (avoids an SSR mismatch). The
  // localStorage read is an external-system sync deferred to a microtask so it is
  // not a synchronous in-effect setState.
  useEffect(() => {
    if (!dismissible) return;
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      try {
        setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
      } catch {
        setDismissed(false);
      }
    });
    return () => {
      active = false;
    };
  }, [dismissible]);

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  if (dismissible && dismissed) return null;

  return (
    <div
      className="rounded-2xl border border-teal-100 bg-teal-50/40 p-4"
      data-testid="legal-onboarding-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-teal-600 ring-1 ring-teal-100">
            <ShieldCheck size={16} aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">{PRIVACY_COPY.onboardingTitle}</h3>
            <p className="mt-0.5 text-[13px] text-neutral-500">{PRIVACY_COPY.onboardingIntro}</p>
          </div>
        </div>
        {dismissible && (
          <button
            type="button"
            onClick={dismiss}
            aria-label={PRIVACY_COPY.onboardingDismiss}
            className="rounded p-1 text-neutral-400 transition-colors hover:text-neutral-700 focus-ring"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {/* Two-boundary structure - neutral framing, ships. */}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-neutral-700">
          <Laptop size={14} className="text-teal-600" aria-hidden />
          {PRIVACY_COPY.onboardingBoundary1Label}
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 text-xs font-medium text-neutral-700">
          <Cloud size={14} className="text-teal-600" aria-hidden />
          {PRIVACY_COPY.onboardingBoundary2Label}
        </div>
      </div>

      {/* Custody claim - ship-gated. */}
      <div className="mt-3">
        <GatedClaim>
          <p className="text-xs leading-relaxed text-neutral-600">{PRIVACY_CLAIMS.ceiling}</p>
        </GatedClaim>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Link
          href={PRIVACY_SETTINGS_HREF}
          className="text-xs font-medium text-teal-700 hover:text-teal-800"
        >
          {PRIVACY_COPY.onboardingLearnMore}
        </Link>
        {dismissible && (
          <button
            type="button"
            onClick={dismiss}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
          >
            {PRIVACY_COPY.onboardingDismiss}
          </button>
        )}
      </div>
    </div>
  );
}
