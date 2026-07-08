"use client";
import { X } from "lucide-react";
import Link from "next/link";
import { useBillingStore } from "@/stores/billing";
import { useTranslation } from "@/stores/i18n";

function fmtTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  return n.toLocaleString("pt-PT");
}

export default function BillingWarningBanner() {
  const usage = useBillingStore((s) => s.usage);
  const warningDismissed = useBillingStore((s) => s.warningDismissed);
  const dismissWarning = useBillingStore((s) => s.dismissWarning);
  const { pages_billing, common } = useTranslation();

  if (!usage?.showWarning || warningDismissed) return null;

  // FC-033: the provisional mid-run ticker is dropped; the gauge reflects the
  // last completed usage figure only.
  const used = usage.tokensUsed;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-amber-800">
        <span className="font-medium">
          {fmtTokens(used)} / {fmtTokens(usage.tokensBase)} tokens
        </span>
        <Link href="/users" className="underline hover:text-amber-900 font-medium">
          {pages_billing.manageBilling}
        </Link>
      </div>
      <button onClick={dismissWarning} className="text-amber-600 hover:text-amber-800 cursor-pointer p-1" aria-label={common.close}>
        <X size={16} />
      </button>
    </div>
  );
}
