import {
  MessageSquare,
  Play,
  Box,
  Plug2,
  Brain,
  Library,
  Palette,
  Users,
  Settings as SettingsIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Translations } from "@/locales/types";

/**
 * Single source of truth for the dashboard's primary navigation.
 * Consumed by the sidebar (and anything else that needs the nav map).
 * `labelKey` is typed against the sidebar i18n slice so labels stay in sync.
 */
export interface NavItem {
  href: string;
  icon: LucideIcon;
  labelKey: keyof Translations["sidebar"];
  superAdminOnly?: boolean;
  /** Bottom-anchored items (e.g. Settings) render below the flex spacer. */
  bottom?: boolean;
  /**
   * Route prefix that lights this item when the exact href doesn't match
   * (e.g. Settings owns the whole /settings subtree). When several items
   * match, the LONGEST prefix wins, so /settings/branding lights Branding,
   * not Settings.
   */
  activePrefix?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/chat", icon: MessageSquare, labelKey: "chat" },
  { href: "/automations", icon: Play, labelKey: "automations" },
  { href: "/artifacts", icon: Box, labelKey: "artifacts" },
  { href: "/integrations", icon: Plug2, labelKey: "integrations" },
  { href: "/memory", icon: Brain, labelKey: "memory" },
  { href: "/knowledge", icon: Library, labelKey: "knowledge" },
  { href: "/settings/branding", icon: Palette, labelKey: "branding" },
  { href: "/users", icon: Users, labelKey: "users", superAdminOnly: true },
  {
    href: "/settings/platform",
    icon: SettingsIcon,
    labelKey: "settings",
    bottom: true,
    activePrefix: "/settings",
  },
];

/**
 * Resolve which nav item is active for a pathname: exact/child href match
 * first, then the longest matching activePrefix.
 */
export function activeNavHref(pathname: string): string | null {
  const byHref = NAV_ITEMS.find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
  if (byHref) return byHref.href;
  const byPrefix = NAV_ITEMS.filter(
    (i) => i.activePrefix && (pathname === i.activePrefix || pathname.startsWith(`${i.activePrefix}/`)),
  ).sort((a, b) => (b.activePrefix!.length - a.activePrefix!.length))[0];
  return byPrefix ? byPrefix.href : null;
}
