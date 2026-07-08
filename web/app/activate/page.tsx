"use client";

/**
 * Device activation page for the Ekoa Local TUI browser login.
 *
 * The TUI opens this page at /activate?code=XXXX-XXXX. If the visitor isn't
 * signed in, we bounce them through the normal Ekoa login (?next= back here).
 * Once authenticated, they verify the code matches their terminal and Approve —
 * which binds the pending device to *their* account, so the terminal logs in as
 * them. Approve/deny call ekoa.auth/device-approve with the session token.
 */

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { ShieldCheck, Terminal, Check, X, AlertTriangle } from "lucide-react";
import { useAuthStore } from "@/stores/auth";
import { api, tryCall } from "@/lib/api";

type Phase = "loading" | "ready" | "working" | "approved" | "denied" | "error";

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <Activate />
    </Suspense>
  );
}

function Activate() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAuthenticated, hasHydrated, user } = useAuthStore();

  const code = (searchParams.get("code") || "").trim();

  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState<string>("");

  // Gate: wait for hydration, require a code, and require an authenticated
  // session (bouncing through /login with ?next= back to this exact URL).
  useEffect(() => {
    if (!hasHydrated) return;
    if (!code) {
      setPhase("error");
      setMessage("No device code in the link. Re-run the login from your terminal.");
      return;
    }
    if (!isAuthenticated) {
      const next = encodeURIComponent(`/activate?code=${encodeURIComponent(code)}`);
      router.replace(`/login?next=${next}`);
      return;
    }
    setPhase((p) => (p === "loading" ? "ready" : p));
  }, [hasHydrated, isAuthenticated, code, router]);

  const decide = useCallback(
    async (deny: boolean) => {
      setPhase("working");
      const res = await tryCall(() => api.auth.deviceApprove({ userCode: code, deny }));
      if (res.ok) {
        setPhase(deny ? "denied" : "approved");
      } else {
        setPhase("error");
        setMessage(res.error.message || "Could not authorize the device. The code may have expired.");
      }
    },
    [code],
  );

  return (
    <div className="min-h-screen bg-[#080c14] flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a1020] via-[#080c14] to-[#0a0e1a]" />
      <div className="absolute top-[20%] left-[20%] w-[600px] h-[600px] bg-teal-500/[0.04] rounded-full blur-[150px]" />
      <div className="absolute bottom-[15%] right-[15%] w-[500px] h-[500px] bg-cyan-500/[0.03] rounded-full blur-[130px]" />

      <div className="w-full max-w-[420px] relative z-10">
        <div className="flex justify-center mb-8">
          <Image src="/ekoa_logo.png" alt="Ekoa" width={56} height={56} className="object-contain" />
        </div>

        <div className="bg-white/[0.03] backdrop-blur-2xl border border-white/[0.07] rounded-2xl overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
          <div className="px-8 pt-8 pb-2 text-center">
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                <Terminal size={22} className="text-teal-400" />
              </div>
            </div>
            <h1 className="text-[22px] font-semibold text-white tracking-tight">Authorize this device</h1>
            <p className="text-[13px] text-slate-400 mt-1.5">
              Ekoa Local (your terminal) is asking to sign in to your Ekoa account.
            </p>
          </div>

          <div className="p-8 pt-4">
            {phase === "loading" && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-white/20 border-t-teal-400 rounded-full animate-spin" />
              </div>
            )}

            {phase === "ready" && (
              <div className="space-y-5">
                <div className="text-center">
                  <p className="text-xs text-slate-500 mb-2">Confirm this matches the code shown in your terminal</p>
                  <div className="font-mono text-2xl tracking-[0.3em] text-white bg-white/[0.04] border border-white/[0.08] rounded-xl py-3">
                    {code}
                  </div>
                </div>
                {user?.username && (
                  <p className="text-center text-[13px] text-slate-400">
                    Signing in as <span className="text-teal-400 font-medium">{user.username}</span>
                  </p>
                )}
                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => decide(true)}
                    className="flex-1 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-medium py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <X size={15} /> Deny
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(false)}
                    className="flex-1 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-500 hover:to-teal-400 text-white font-medium py-2.5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-teal-900/25"
                  >
                    <ShieldCheck size={15} /> Approve
                  </button>
                </div>
              </div>
            )}

            {phase === "working" && (
              <div className="flex justify-center py-6">
                <div className="w-6 h-6 border-2 border-white/20 border-t-teal-400 rounded-full animate-spin" />
              </div>
            )}

            {phase === "approved" && (
              <div className="text-center py-2 space-y-3">
                <div className="w-12 h-12 rounded-full bg-teal-500/10 border border-teal-500/25 flex items-center justify-center mx-auto">
                  <Check size={24} className="text-teal-400" />
                </div>
                <h2 className="text-white font-medium text-[17px]">Device approved</h2>
                <p className="text-[13px] text-slate-400">You can return to your terminal — it&apos;s signing in now.</p>
              </div>
            )}

            {phase === "denied" && (
              <div className="text-center py-2 space-y-3">
                <div className="w-12 h-12 rounded-full bg-slate-500/10 border border-slate-500/25 flex items-center justify-center mx-auto">
                  <X size={24} className="text-slate-400" />
                </div>
                <h2 className="text-white font-medium text-[17px]">Request denied</h2>
                <p className="text-[13px] text-slate-400">The terminal was not signed in. You can close this tab.</p>
              </div>
            )}

            {phase === "error" && (
              <div className="text-center py-2 space-y-3">
                <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/25 flex items-center justify-center mx-auto">
                  <AlertTriangle size={22} className="text-red-400" />
                </div>
                <p className="text-[13px] text-red-300/90 leading-relaxed">{message}</p>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-[11px] text-slate-600 mt-6">
          Only approve if you started this login. The code must match your terminal.
        </p>
      </div>
    </div>
  );
}
