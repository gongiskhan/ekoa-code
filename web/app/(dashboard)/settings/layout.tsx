"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth";
import { useTranslation } from "@/stores/i18n";
import { Tabs, type TabItem } from "@/components/ui/tabs";

// Labels are resolved from the active locale at render time (below); the
// module-level table carries only the routing/permission shape, which does
// not vary by language.
const ALL_TABS: (Omit<TabItem, "label"> & {
  href: string;
  adminOnly?: boolean;
  superAdminOnly?: boolean;
})[] = [
  { key: "platform", href: "/settings/platform" },
  { key: "pedidos", href: "/settings/pedidos", adminOnly: true },
  { key: "users", href: "/settings/users", adminOnly: true },
  { key: "offices", href: "/settings/offices", superAdminOnly: true },
];

const TAB_ROUTES = ALL_TABS.map((t) => t.href);

function activeKey(pathname: string): string {
  const match = ALL_TABS.find(
    (t) => pathname === t.href || pathname.startsWith(t.href + "/"),
  );
  return match?.key ?? "platform";
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const { pages } = useTranslation();
  const navLabels = pages.settingsNav;
  const isAdmin = user?.role === "org-admin" || user?.role === "super-admin";
  const isSuperAdmin = user?.role === "super-admin";

  const onTabRoute = TAB_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/"),
  );

  if (!onTabRoute) {
    return <>{children}</>;
  }

  const visibleTabs: TabItem[] = ALL_TABS.filter((t) => {
    if (t.superAdminOnly) return isSuperAdmin;
    if (t.adminOnly) return isAdmin;
    return true;
  }).map((t) => ({ ...t, label: navLabels[t.key as keyof typeof navLabels] }));

  const currentKey = activeKey(pathname);

  function handleNavigate(key: string) {
    const tab = ALL_TABS.find((t) => t.key === key);
    if (tab) router.push(tab.href);
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {visibleTabs.length > 1 && (
        <div className="shrink-0 border-b border-line">
          <div className="mx-auto max-w-5xl px-6 pt-4 md:px-8">
            {/* Mobile: native select navigator */}
            <div className="sm:hidden pb-3">
              <select
                value={currentKey}
                onChange={(e) => handleNavigate(e.target.value)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              >
                {visibleTabs.map((tab) => (
                  <option key={tab.key} value={tab.key}>
                    {tab.label}
                  </option>
                ))}
              </select>
            </div>
            {/* Desktop: horizontal tab bar */}
            <div className="hidden sm:block">
              <Tabs
                items={visibleTabs}
                value={currentKey}
                onChange={handleNavigate}
              />
            </div>
          </div>
        </div>
      )}
      {children}
    </div>
  );
}
