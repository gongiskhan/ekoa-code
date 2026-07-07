"use client";

import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

/**
 * AdminGate wraps pages that require admin access.
 * When the current user is an admin, renders children normally.
 * When not admin, shows an access-denied message.
 */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);

  if (user?.role === "super-admin") {
    return <>{children}</>;
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center text-center max-w-md space-y-4">
        <div className="w-12 h-12 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-center">
          <ShieldAlert size={24} className="text-neutral-400" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">Access Restricted</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">
          This page is only available to administrators. Contact your admin if you need access.
        </p>
      </div>
    </div>
  );
}
