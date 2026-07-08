"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { NAV_ITEMS, activeNavHref } from "@/lib/navigation";
import { useSettingsStore } from "@/stores/settings";
import { useOrchestrationStore } from "@/stores/orchestration";
import { useAuthStore } from "@/stores/auth";
import { useTranslation } from "@/stores/i18n";

interface SidebarProps {
  isExpanded: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

/* ---------- Components ---------- */

function NavItem({
  icon: Icon,
  label,
  href,
  isActive,
  isExpanded,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  isActive: boolean;
  isExpanded: boolean;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick}>
      <div
        className={`
          relative mx-2 flex items-center rounded-lg cursor-pointer transition-colors duration-150
          ${
            isActive
              ? "bg-white/[0.06] text-white"
              : "text-neutral-400 hover:text-white hover:bg-white/[0.04]"
          }
          ${isExpanded ? "px-3 py-2" : "justify-center py-2"}
        `}
        title={!isExpanded ? label : undefined}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-teal-400" />
        )}
        <Icon size={18} className={isExpanded ? "mr-3 shrink-0" : "shrink-0"} />
        <AnimatePresence>
          {isExpanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="text-sm font-medium whitespace-nowrap overflow-hidden"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </Link>
  );
}

/* ---------- Main Sidebar ---------- */

export default function Sidebar({ isExpanded, onToggle, onNavigate }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const platformName = useSettingsStore((s) => s.settings.general.platformName);
  const activateMostRecentSession = useOrchestrationStore((s) => s.activateMostRecentSession);
  const activateOrCreateEmptySession = useOrchestrationStore((s) => s.activateOrCreateEmptySession);
  const user = useAuthStore((s) => s.user);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const isSuperAdmin = user?.role === "super-admin";
  const isAdmin = isSuperAdmin || user?.role === "org-admin";
  const { sidebar } = useTranslation();

  const activeHref = activeNavHref(pathname);
  function isRouteActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return activeHref === href;
  }

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly) return hasHydrated && isSuperAdmin;
    if (item.adminOnly) return hasHydrated && isAdmin;
    return true;
  });
  const topItems = visibleItems.filter((item) => !item.bottom);
  const bottomItems = visibleItems.filter((item) => item.bottom);

  return (
    <motion.div
      className="h-dvh bg-neutral-950 border-r border-white/10 flex flex-col shrink-0 overflow-hidden"
      animate={{ width: isExpanded ? 256 : 68 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
    >
      {/* Logo */}
      <div
        className={`h-14 flex items-center border-b border-white/10 shrink-0 ${
          isExpanded ? "px-4" : "justify-center"
        }`}
      >
        <button
          onClick={() => {
            activateOrCreateEmptySession();
            router.push("/chat");
          }}
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 rounded cursor-pointer shrink-0"
          title={sidebar.newConversation}
        >
          <Image
            src="/ekoa_logo.png"
            alt="Ekoa"
            width={32}
            height={32}
            className="w-8 h-8 object-contain"
          />
        </button>
        <AnimatePresence>
          {isExpanded && (
            <motion.span
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2 }}
              className="ml-3 font-display font-semibold text-white tracking-wide text-lg whitespace-nowrap"
            >
              {platformName || "EKOA"}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 scrollbar-dark flex flex-col">
        <div className="flex-1 space-y-1">
          {topItems.map((item) => (
            <NavItem
              key={item.href}
              icon={item.icon}
              label={item.label ?? sidebar[item.labelKey!]}
              href={item.href}
              isActive={isRouteActive(item.href)}
              isExpanded={isExpanded}
              onClick={
                item.href === "/chat"
                  ? () => {
                      activateMostRecentSession();
                      onNavigate?.();
                    }
                  : onNavigate
              }
            />
          ))}
        </div>

        {/* Bottom: Settings */}
        {bottomItems.length > 0 && (
          <div className="mt-auto pt-2 space-y-1">
            <div className="border-t border-white/10 mx-4 mb-2" />
            {bottomItems.map((item) => (
              <NavItem
                key={item.href}
                icon={item.icon}
                label={item.label ?? sidebar[item.labelKey!]}
                href={item.href}
                isActive={isRouteActive(item.href)}
                isExpanded={isExpanded}
                onClick={onNavigate}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div
        className={`p-4 border-t border-white/10 flex items-center text-xs text-neutral-500 shrink-0 ${
          isExpanded ? "justify-between" : "justify-center"
        }`}
      >
        <AnimatePresence>
          {isExpanded && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="whitespace-nowrap"
            >
              {sidebar.footer}
            </motion.span>
          )}
        </AnimatePresence>
        <button
          onClick={onToggle}
          className="cursor-pointer hover:text-white transition-colors shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 rounded p-0.5"
          aria-label={sidebar.toggleSidebar}
        >
          {isExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>
    </motion.div>
  );
}
