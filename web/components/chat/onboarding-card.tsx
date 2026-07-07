"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Compass, ArrowRight } from "lucide-react";
import { useTranslation } from "@/stores/i18n";
import { useOrchestrationStore } from "@/stores/orchestration";

/**
 * Slim full-width entry banner for the guided onboarding flow. Rendered in the
 * empty chat state (between the header and the artifact stripes), always visible
 * regardless of vertical or the example-cards setting.
 *
 * Fresh state invites the user into guided discovery; once an onboarding session
 * with messages exists, the copy switches to a resume variant. Clicking delegates
 * find-or-create to the store's openOnboardingSession action (one persistent
 * onboarding session per user, most-recently-updated wins) and navigates to it
 * with ZERO query params. If the server create fails, an inline error shows and
 * no navigation happens - no local phantom session is minted.
 */
export function OnboardingCard() {
  const router = useRouter();
  const { onboarding } = useTranslation();
  // Synchronous guard: two clicks in the same tick both read a stale useState
  // value, so a ref is what actually prevents a double open.
  const inFlightRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Resume variant when an owned onboarding session already has real turns.
  const hasResumable = useOrchestrationStore((s) =>
    s.sessions.some((sess) => sess.type === "onboarding" && sess.messageCount > 0),
  );

  const copy = hasResumable
    ? {
        title: onboarding.card.resumeTitle,
        description: onboarding.card.resumeDescription,
        cta: onboarding.card.resumeCta,
      }
    : {
        title: onboarding.card.title,
        description: onboarding.card.description,
        cta: onboarding.card.cta,
      };

  const handleStart = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);

    const { id, persisted } = await useOrchestrationStore
      .getState()
      .openOnboardingSession(onboarding.sessionName);

    if (!persisted) {
      setError(onboarding.card.error);
      setBusy(false);
      inFlightRef.current = false;
      return;
    }

    const store = useOrchestrationStore.getState();
    store.setActiveSession(id);
    router.push(`/chat/${id}`);
    // Intentionally leave busy/inFlight set: this card unmounts once the empty
    // state swaps to the onboarding welcome, so resetting would touch an
    // unmounted component.
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="group flex w-full flex-col gap-3 rounded-2xl border border-teal-100 bg-teal-50/40 px-4 py-3.5 text-left transition-all hover:border-teal-200 hover:bg-teal-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 sm:flex-row sm:items-center sm:gap-4"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-teal-600 shadow-sm ring-1 ring-teal-100">
            <Compass size={18} />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-neutral-900">
              {copy.title}
            </span>
            <span className="mt-0.5 block text-[13px] text-neutral-500 sm:truncate">
              {copy.description}
            </span>
          </span>
        </span>

        <span className="inline-flex w-full shrink-0 items-center justify-center gap-1.5 rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-medium text-white transition-colors group-hover:bg-teal-700 sm:w-auto">
          {copy.cta}
          <ArrowRight
            size={14}
            className="transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </button>

      {error && (
        <p role="alert" className="mt-1.5 px-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
