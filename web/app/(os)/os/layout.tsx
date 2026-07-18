"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PauseForUserOverlay from "@/components/automations/pause-for-user-overlay";
import { BlockedAccountGuard } from "@/components/blocked-account-guard";
import { ChatRuntimeProvider } from "@/components/chat/chat-runtime";
import { LoadingState } from "@/components/ui/spinner";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { useSettingsStore } from "@/stores/settings";
import { isOsModeEnabled } from "@/lib/navigation";

/**
 * The OS-mode shell layout (surface contract 4.5): its own route group - no
 * classic sidebar/header chrome - behind the NEXT_PUBLIC_OS_MODE beta flag.
 * Shares the client auth guard (useRequireAuth) and the chat runtime with the
 * classic shell; provides the same height-bounded `h-dvh` root the pages
 * expect, and the shell-root `@container` (contract 2.3.4).
 */
export default function OsLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const enabled = isOsModeEnabled();
  const { hasHydrated, isAuthenticated } = useRequireAuth();

  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const isSettingsLoaded = useSettingsStore((s) => s.isLoaded);

  // Beta flag off: the route does not exist for this deployment.
  useEffect(() => {
    if (!enabled) router.replace("/chat");
  }, [enabled, router]);

  useEffect(() => {
    if (isAuthenticated && !isSettingsLoaded) {
      fetchSettings();
    }
  }, [isAuthenticated, isSettingsLoaded, fetchSettings]);

  if (!enabled || !hasHydrated || !isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <LoadingState />
      </div>
    );
  }

  return (
    <ChatRuntimeProvider>
      <div className="@container flex h-dvh w-full flex-col overflow-hidden bg-canvas text-neutral-900 font-sans">
        {children}
        {/* App-blocking overlays follow the user into OS mode (contract 1.2). */}
        <PauseForUserOverlay />
        <BlockedAccountGuard />
      </div>
    </ChatRuntimeProvider>
  );
}
