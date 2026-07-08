"use client";

import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

/**
 * Blocked-state guard (Amendment 2, FC-508). Renders a blocking overlay carrying
 * the CONV-2 activation copy when the session is valid but the account is blocked:
 *   - ACCOUNT_DISABLED (403) — or a cached user flagged inactive
 *   - BILLING_LOCKED (402)
 * The code is captured by the auth store while validating the session
 * (`GET /auth/me`). Renders nothing when the account is in good standing.
 */

const COPY: Record<string, string> = {
  ACCOUNT_DISABLED: "A sua conta está bloqueada. Contacte o suporte.",
  BILLING_LOCKED: "A sua conta tem um problema de faturação. Contacte o suporte.",
};

export function BlockedAccountGuard() {
  const blockedCode = useAuthStore((s) => s.blockedCode);
  const userInactive = useAuthStore((s) => s.user != null && s.user.active === false);

  const code = blockedCode ?? (userInactive ? "ACCOUNT_DISABLED" : null);
  if (!code) return null;

  const message = COPY[code] ?? COPY.ACCOUNT_DISABLED;

  return (
    <div
      data-testid="blocked-account-guard"
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-neutral-950/70 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-8 text-center shadow-overlay">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-red-200 bg-red-50">
          <ShieldAlert size={24} className="text-red-500" aria-hidden />
        </div>
        <p className="text-sm leading-relaxed text-neutral-700">{message}</p>
      </div>
    </div>
  );
}
