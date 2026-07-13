import { describe, it, expect } from 'vitest';
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
    // FC-500: the users page is now visible to org-admins (manage own org), not super-admin only.
    const users = NAV_ITEMS.find((i) => i.href === '/users');
    expect(users?.adminOnly).toBe(true);
  });

  it('exposes the H4 change-requests queue as an admin-only surface (raw PT label, like registo)', () => {
    const pedidos = NAV_ITEMS.find((i) => i.href === '/pedidos');
    expect(pedidos).toBeTruthy();
    expect(pedidos?.adminOnly).toBe(true);
    expect(pedidos?.superAdminOnly).toBeFalsy(); // org-admin AND super-admin, like registo
    expect(pedidos?.label).toBe('Pedidos');
    expect(pedidos?.icon).toBeTruthy();
  });
});
