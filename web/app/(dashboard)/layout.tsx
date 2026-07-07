"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/useIsMobile";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import BillingWarningBanner from "@/components/billing-warning-banner";
import PauseForUserOverlay from "@/components/automations/pause-for-user-overlay";
import { DemoTourProvider } from "@/components/demos/DemoTourProvider";
import { LoadingState } from "@/components/ui/spinner";
import { useAuthStore } from "@/stores/auth";
import { useSettingsStore } from "@/stores/settings";
import { useAutomationRun } from "@/hooks/useAutomationRun";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Subscribe to automation_run_* SSE events at the layout level so
  // the PauseForUserOverlay reacts no matter which page the user is on.
  useAutomationRun();

  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const checkAuth = useAuthStore((s) => s.checkAuth);

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const fetchSettings = useSettingsStore((s) => s.fetchSettings);
  const isSettingsLoaded = useSettingsStore((s) => s.isLoaded);

  const closeMobileSidebar = useCallback(() => setIsMobileSidebarOpen(false), []);

  const handleToggleSidebar = useCallback(() => {
    if (isMobile) {
      setIsMobileSidebarOpen((prev) => !prev);
    } else {
      setIsSidebarExpanded((prev) => !prev);
    }
  }, [isMobile]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileSidebarOpen(false);
  }, [pathname]);

  // Auth check: redirect to login if not authenticated
  useEffect(() => {
    if (hasHydrated && !isAuthenticated) {
      router.push("/login");
    }
  }, [hasHydrated, isAuthenticated, router]);

  // Refresh the cached user from the server once per mount so role/profile
  // changes since last login (e.g. super-admin migration) are picked up
  // without forcing a logout.
  useEffect(() => {
    if (hasHydrated && isAuthenticated) {
      void checkAuth();
    }
  }, [hasHydrated, isAuthenticated, checkAuth]);

  // Fetch settings on auth
  useEffect(() => {
    if (isAuthenticated && !isSettingsLoaded) {
      fetchSettings();
    }
  }, [isAuthenticated, isSettingsLoaded, fetchSettings]);

  // Auto-collapse sidebar on smaller screens
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setIsSidebarExpanded(false);
      }
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Show loading screen while hydrating auth state
  if (!hasHydrated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <LoadingState />
      </div>
    );
  }

  // Don't render dashboard if not authenticated (redirect is in progress)
  if (!isAuthenticated) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-surface">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full bg-canvas text-neutral-900 font-sans overflow-hidden">
      {/* Desktop sidebar */}
      {!isMobile && (
        <Sidebar
          isExpanded={isSidebarExpanded}
          onToggle={() => setIsSidebarExpanded(!isSidebarExpanded)}
        />
      )}

      {/* Mobile sidebar overlay */}
      {isMobile && isMobileSidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/50"
            onClick={closeMobileSidebar}
          />
          <div className="fixed left-0 top-0 bottom-0 z-50 w-[256px]">
            <Sidebar
              isExpanded={true}
              onToggle={closeMobileSidebar}
              onNavigate={closeMobileSidebar}
            />
          </div>
        </>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <Header onToggleSidebar={handleToggleSidebar} />
        <BillingWarningBanner />
        <motion.main
          key={pathname.startsWith("/chat") ? "/chat" : pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="flex flex-1 overflow-hidden bg-canvas"
        >
          {children}
        </motion.main>
      </div>

      {/* Global pause-for-user modal overlay. Sits above sidebar +
          header and blocks the entire UI behind a backdrop whenever a
          run is paused waiting for the user to act in the headed
          browser. Mounted here so it shows from any dashboard page. */}
      <PauseForUserOverlay />

      {/* Tutorial Bridge: activates on ?demo=<appId>, renders nothing otherwise. */}
      <DemoTourProvider />
    </div>
  );
}
