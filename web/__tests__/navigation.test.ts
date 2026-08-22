import { describe, it, expect } from 'vitest';
import { Vault } from 'lucide-react';
import { NAV_ITEMS } from '@/lib/navigation';
import { en } from '@/locales';

describe('lib/navigation NAV_ITEMS', () => {
  it('is a non-empty single source with unique, absolute hrefs', () => {
    expect(NAV_ITEMS.length).toBeGreaterThan(0);
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(href.startsWith('/')).toBe(true);
  });

  it('every item carries an icon and a resolvable label (a sidebar locale key or a raw label)', () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon).toBeTruthy();
      // An item labels itself either by a sidebar i18n key OR a raw `label` (admin items kept out
      // of the locale files, by design - Amendment 2 FC-502/FC-501 registo/orgs).
      const label = item.labelKey ? en.sidebar[item.labelKey] : item.label;
      expect(label).toBeTruthy();
    }
  });

  it('leads with chat and anchors settings at the bottom; users is admin-visible (Amendment 2 FC-500)', () => {
    expect(NAV_ITEMS[0].href).toBe('/chat');
    const settings = NAV_ITEMS.find((i) => i.href === '/settings/platform');
    expect(settings?.bottom).toBe(true);
    // FC-500: users moved to /settings/users (settings tab); still admin-only.
    const users = NAV_ITEMS.find((i) => i.href === '/settings/users');
    expect(users?.adminOnly).toBe(true);
  });

  it('H4 change-requests queue is no longer a top-level nav item (moved to a settings tab)', () => {
    // Pedidos moved to /settings/pedidos as a tab under the settings area.
    const pedidosTopLevel = NAV_ITEMS.find((i) => i.href === '/pedidos');
    expect(pedidosTopLevel).toBeUndefined();
    // The settings entry still covers the /settings subtree.
    const settings = NAV_ITEMS.find((i) => i.href === '/settings/platform');
    expect(settings?.activePrefix).toBe('/settings');
  });

  it('WS1 (2026-08-08): Escritórios, privacy and API keys are no longer sidebar rows - they moved into settings tabs', () => {
    for (const href of ['/settings/offices', '/settings/privacy', '/settings/api-keys']) {
      expect(NAV_ITEMS.find((i) => i.href === href)).toBeUndefined();
    }
  });

  it('S8 (2026-08-22): Automations is no longer a nav row - integrations is the single surface', () => {
    // The row's removal is otherwise only observable through an e2e run against a live boot, and
    // "put the row back" is a one-line change. Pinned here so CI answers it deterministically.
    expect(NAV_ITEMS.find((i) => i.href === '/automations')).toBeUndefined();
    // …and the sidebar locale slice lost its key with it, so a restored row could not even label
    // itself through `labelKey` without the locale change coming back too.
    expect('automations' in en.sidebar).toBe(false);
  });

  it('WS1: Cofre uses the Vault (safe) icon, not the privacy ShieldCheck icon it used to share', () => {
    const cofre = NAV_ITEMS.find((i) => i.href === '/cofre');
    expect(cofre?.icon).toBe(Vault);
  });
});
