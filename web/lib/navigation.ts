import {
  MessageSquare,
  Play,
  Box,
  Plug2,
  Brain,
  Library,
  Palette,
  Users,
  ScrollText,
  Inbox,
  Building2,
  ShieldCheck,
  KeyRound,
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
  /** i18n key into the sidebar slice. Omit when a raw PT-PT `label` is supplied. */
  labelKey?: keyof Translations["sidebar"];
  /**
   * Raw PT-PT label for net-new Amendment 2 surfaces that have no sidebar i18n
   * key (kept out of the locale files). Takes precedence over `labelKey`.
   */
  label?: string;
  superAdminOnly?: boolean;
  /** Visible to org-admin AND super-admin (Amendment 2 admin surfaces). */
  adminOnly?: boolean;
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
  // FC-500: the users page is now managed by org-admins (own org) and super-admins.
  { href: "/users", icon: Users, labelKey: "users", adminOnly: true },
  // FC-502: the Registo admin read surface (metadata + artifacts only).
  { href: "/registo", icon: ScrollText, label: "Registo", adminOnly: true },
  // H4: the request-changes queue (users' change requests; org-admin converts one to a patch run).
  { href: "/pedidos", icon: Inbox, label: "Pedidos", adminOnly: true },
  // FC-501: super-admin org management.
  { href: "/orgs", icon: Building2, label: "Escritórios", superAdminOnly: true },
  // FC-404 (RESOLVED Q-07): the "Privacidade e ponte local" surface, absorbing the
  // old orphan /settings/bridge. One settings-navigation entry.
  {
    href: "/settings/privacy",
    icon: ShieldCheck,
    label: "Privacidade e ponte local",
    bottom: true,
    activePrefix: "/settings/privacy",
  },
  // S4b (run 20260717): per-user gateway API keys for Anthropic-compatible clients.
  {
    href: "/settings/api-keys",
    icon: KeyRound,
    label: "Chaves de API",
    bottom: true,
    activePrefix: "/settings/api-keys",
  },
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
