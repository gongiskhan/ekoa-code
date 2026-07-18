"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, Globe, ChevronDown, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/stores/i18n";
import { useSettingsStore } from "@/stores/settings";
import { useCompanyStore } from "@/stores/company";
import { useBillingStore } from "@/stores/billing";
import { useAuthStore } from "@/stores/auth";
import { api } from "@/lib/api";
import { useApi } from "@/components/providers/api-provider";

interface HeaderProps {
  onToggleSidebar: () => void;
}

// Spring shared by the header's floating layers (dropdown + tooltip).
const popSpring = { type: "spring", stiffness: 520, damping: 38 } as const;

function resolveLogoUrl(url: string | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("data:") || url.startsWith("http")) return url;
  if (url.startsWith("/brand-assets/")) return api.resolveUrl(url);
  return url;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function gaugeColor(pct: number): string {
  if (pct >= 85) return "bg-red-600";
  if (pct >= 70) return "bg-amber-500";
  return "bg-teal-600";
}

function gaugeTextColor(pct: number): string {
  if (pct >= 85) return "text-red-600";
  if (pct >= 70) return "text-amber-600";
  return "text-neutral-800";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Header({ onToggleSidebar }: HeaderProps) {
  const { language, setLanguage, header } = useTranslation();
  const router = useRouter();
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const logoUrl = useCompanyStore((s) => s.company?.branding?.logo ?? null);
  // FC-509: with the default design system (no org logo) the header falls back
  // to the org DISPLAY NAME, never the vendor's brand.
  const orgName = useCompanyStore((s) => s.company?.displayName ?? s.company?.name ?? null);
  const hasCompany = useCompanyStore((s) => s.company !== null);
  const fetchCompany = useCompanyStore((s) => s.fetchCompany);
  const usage = useBillingStore((s) => s.usage);
  const fetchUsage = useBillingStore((s) => s.fetchUsage);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { notifications } = useApi();
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  // FC-509: ensure the org config is loaded so the no-logo fallback (org display
  // name) is available on every page, not only after visiting branding.
  useEffect(() => { if (!hasCompany) fetchCompany(); }, [hasCompany, fetchCompany]);

  // Live-refresh the gauge whenever the server reports usage has changed (after each
  // agent turn, after admin resets) via the notifications stream. FC-033: the cosmetic
  // mid-run provisional ticker is dropped - the gauge updates on completion only.
  useEffect(() => {
    if (!notifications) return;
    return notifications.on('usage_updated', () => {
      fetchUsage();
    });
  }, [notifications, fetchUsage]);

  // Live brand refresh: when brand research applies new branding, refetch the company
  // config so the header logo + theme update without a page reload.
  useEffect(() => {
    if (!notifications) return;
    return notifications.on('branding_updated', () => {
      fetchCompany();
    });
  }, [notifications, fetchCompany]);

  // Close user menu on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    }
    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showUserMenu]);

  function toggleLanguage() {
    const newLang = language === 'en' ? 'pt' : 'en';
    setLanguage(newLang);
    updateSettings({ general: { language: newLang } });
  }

  async function handleLogout() {
    await logout();
    router.push('/login');
  }

  const tokensUsedDisplayed = usage?.tokensUsed ?? 0;
  const pct = usage && usage.tokensBase > 0
    ? Math.min(100, (tokensUsedDisplayed / usage.tokensBase) * 100)
    : 0;

  return (
    <header className="relative z-30 h-14 bg-surface/90 backdrop-blur-md border-b border-line flex items-center justify-between px-3 md:px-6 flex-shrink-0">
      {/* Left side */}
      <div className="flex items-center">
        <button
          onClick={onToggleSidebar}
          className="mr-4 text-neutral-500 hover:text-teal-700 transition-colors cursor-pointer focus-ring rounded-lg p-1 md:hidden"
          aria-label={header.toggleSidebar}
        >
          <Menu size={20} />
        </button>
        {(logoUrl || orgName) && (
          logoUrl ? (
            <img
              src={resolveLogoUrl(logoUrl)}
              alt={orgName || "Logo"}
              className="h-6 max-w-[120px] object-contain"
            />
          ) : (
            <span
              data-testid="header-org-name"
              className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500"
            >
              {orgName}
            </span>
          )
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center space-x-3 md:space-x-6">
        {/* Token Gauge -- hidden on mobile */}
        {usage ? (
          <div
            className="relative w-48 text-xs font-medium text-neutral-500 hidden md:block"
            onMouseEnter={() => setTooltipVisible(true)}
            onMouseLeave={() => setTooltipVisible(false)}
          >
            <div className="flex justify-between mb-1">
              <span>{header.tokens}</span>
              <span className={`tabular-nums ${gaugeTextColor(pct)}`}>
                {formatTokens(tokensUsedDisplayed)}/{formatTokens(usage.tokensBase)}
              </span>
            </div>
            <div className="h-1.5 w-full bg-neutral-100 rounded-full overflow-hidden ring-1 ring-inset ring-neutral-950/5">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-[var(--ease-out-quart)] ${gaugeColor(pct)}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>

            {/* Tooltip */}
            <AnimatePresence>
              {tooltipVisible && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={popSpring}
                  className="absolute top-full mt-2 right-0 z-50 origin-top-right bg-surface rounded-xl shadow-overlay ring-1 ring-neutral-950/5 border border-line p-3 w-56 text-xs"
                >
                  <div className="flex justify-between mb-1">
                    <span className="text-neutral-500">{header.tokensUsed}</span>
                    <span className="text-neutral-800 font-medium tabular-nums">
                      {formatTokens(tokensUsedDisplayed)} / {formatTokens(usage.tokensBase)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">{header.tokensRemaining}</span>
                    <span className="text-neutral-800 font-medium tabular-nums">
                      {formatTokens(Math.max(0, usage.tokensBase - tokensUsedDisplayed))}
                    </span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="w-40 h-5 bg-neutral-100 rounded animate-pulse hidden md:block" />
        )}

        {/* Right Tools */}
        <div className="flex items-center space-x-4 border-l border-line pl-4">
          {/* Language selector */}
          <button
            onClick={toggleLanguage}
            className="flex items-center space-x-1 cursor-pointer hover:text-teal-700 text-neutral-600 transition-colors focus-ring rounded-lg p-1"
            aria-label={header.changeLanguage}
            title={header.changeLanguage}
          >
            <Globe size={16} />
            <span className="text-sm font-medium hidden md:inline">{language === 'pt' ? 'PT' : 'EN'}</span>
            <ChevronDown size={14} className="hidden md:block" />
          </button>

          {/* User avatar + dropdown */}
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu((prev) => !prev)}
              className="flex items-center space-x-2 cursor-pointer pressable focus-ring rounded-lg p-1"
              aria-label={header.userMenu}
            >
              <div className="w-8 h-8 rounded-full bg-accent-soft border border-teal-600/15 flex items-center justify-center text-teal-700 font-semibold text-sm">
                {user ? getInitials(user.username) : '??'}
              </div>
              <ChevronDown
                size={14}
                className={`text-neutral-500 hidden md:block transition-transform duration-200 ${showUserMenu ? 'rotate-180' : ''}`}
              />
            </button>

            {/* User dropdown menu */}
            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={popSpring}
                  className="absolute top-full mt-2 right-0 z-50 origin-top-right bg-surface rounded-xl shadow-overlay ring-1 ring-neutral-950/5 border border-line w-56 overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-line">
                    <p className="text-sm font-medium text-neutral-900 truncate">
                      {user?.username ?? '---'}
                    </p>
                    <p className="text-xs text-neutral-500 truncate">
                      {user?.role ?? ''}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center space-x-2 px-4 py-2.5 text-sm text-neutral-700 hover:bg-neutral-50 hover:text-red-600 transition-colors cursor-pointer"
                  >
                    <LogOut size={16} />
                    <span>{header.logout}</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </header>
  );
}
