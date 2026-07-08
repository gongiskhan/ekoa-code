"use client";

import { ShieldAlert } from "lucide-react";
import { useAuthStore } from "@/stores/auth";

/**
 * AdminGate wraps pages that require elevated access. By default only a
 * super-admin passes. Amendment 2 (FC-500/FC-502): pass `allowOrgAdmin` for the
 * surfaces an org-admin also manages (scoped server-side to its own org) - the
 * users page and the Registo admin page.
 */
export function AdminGate({
  children,
  allowOrgAdmin = false,
}: {
  children: React.ReactNode;
  allowOrgAdmin?: boolean;
}) {
  const user = useAuthStore((s) => s.user);

  const allowed =
    user?.role === "super-admin" || (allowOrgAdmin && user?.role === "org-admin");

  if (allowed) {
    return <>{children}</>;
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex flex-col items-center text-center max-w-md space-y-4">
        <div className="w-12 h-12 rounded-xl bg-neutral-50 border border-neutral-200 flex items-center justify-center">
          <ShieldAlert size={24} className="text-neutral-400" />
        </div>
        <h2 className="text-lg font-semibold text-neutral-900">Acesso restrito</h2>
        <p className="text-sm text-neutral-500 leading-relaxed">
          Esta página está disponível apenas para administradores. Contacte o administrador da sua
          organização se precisar de acesso.
        </p>
      </div>
    </div>
  );
}
