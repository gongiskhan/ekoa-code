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

  it('every item carries an icon and a labelKey that exists in the sidebar locale slice', () => {
    for (const item of NAV_ITEMS) {
      expect(item.icon).toBeTruthy();
      expect(en.sidebar[item.labelKey]).toBeTruthy();
    }
  });

  it('leads with chat and anchors settings at the bottom; users is super-admin only', () => {
    expect(NAV_ITEMS[0].href).toBe('/chat');
    const settings = NAV_ITEMS.find((i) => i.href === '/settings/platform');
    expect(settings?.bottom).toBe(true);
    const users = NAV_ITEMS.find((i) => i.href === '/users');
    expect(users?.superAdminOnly).toBe(true);
  });
});
