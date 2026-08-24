/**
 * Settings tab-group layout. The users / offices / pedidos pages moved OUT of the top-level nav
 * and INTO this tab group, so this layout is now the only way a user reaches three admin surfaces
 * - which makes its two rules worth pinning rather than assuming.
 *
 * RULE 1: the tab strip renders only on the tab routes. `/settings/*` also holds pages that are
 * NOT tabs (branding, bridge), and drawing a "Plataforma | Pedidos | Utilizadores | Escritórios |
 * Privacidade | Dispositivos | Chaves de API" bar above those would claim they belong to a group
 * they do not.
 *
 * DEVICES JOINED THE GROUP on 2026-08-24 with the capability-grant surface. It had been reachable
 * only by the URL the bridge CLI prints, which is how an org-admin surface stayed invisible: the
 * page now carries the machine list where a paired computer is authorised for `desktop.automation`
 * / `local.bash`, and an administrator has no way to guess an address nothing links to. It is
 * UNGATED here because the device-approval half is per-user; the machine section gates itself on
 * role, and that gating is asserted where it lives, not here.
 *
 * RULE 2: role gating is COSMETIC and is deliberately tested as such. Hiding a tab is not
 * authorization - the pages behind them read through the typed client, and the API refuses a
 * non-admin's `users.list` on its own. This suite therefore asserts what a role SEES, and says
 * plainly that it is not asserting what a role may DO.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsLayout from '@/app/(dashboard)/settings/layout';
import { useAuthStore } from '@/stores/auth';
import type { AuthUser } from '@ekoa/shared';

const push = vi.fn();
let pathname = '/settings/platform';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push }),
}));

function asRole(role: AuthUser['role']): void {
  useAuthStore.setState({
    user: { id: 'u1', username: 'admin', role, orgId: 'o1' } as AuthUser,
  } as never);
}

function tabLabels(): string[] {
  // The desktop tab bar and the mobile <select> render the SAME labels, so read the options:
  // one query that does not depend on which breakpoint jsdom reports.
  return screen.queryAllByRole('option').map((o) => o.textContent ?? '');
}

describe('settings tab-group layout', () => {
  beforeEach(() => {
    push.mockClear();
    pathname = '/settings/platform';
  });

  it('shows every tab to a super-admin', () => {
    asRole('super-admin');
    render(<SettingsLayout><div>conteúdo</div></SettingsLayout>);
    expect(tabLabels()).toEqual([
      'Plataforma',
      'Pedidos',
      'Utilizadores',
      'Escritórios',
      'Privacidade',
      'Dispositivos',
      'Chaves de API',
    ]);
  });

  it('hides Escritórios from an org-admin: it is a super-admin surface', () => {
    asRole('org-admin');
    render(<SettingsLayout><div>conteúdo</div></SettingsLayout>);
    const labels = tabLabels();
    expect(labels).toContain('Utilizadores');
    expect(labels).toContain('Pedidos');
    expect(labels).toContain('Privacidade');
    expect(labels).toContain('Chaves de API');
    expect(labels).not.toContain('Escritórios');
  });

  it('shows an ordinary user Privacidade and Chaves de API alongside Plataforma, but no admin tabs', () => {
    // WS1 (2026-08-08): privacy and api-keys are per-user surfaces, not admin ones - they moved
    // off the sidebar into this tab group ungated, same as they were ungated in NAV_ITEMS before.
    asRole('user');
    render(<SettingsLayout><div>conteúdo</div></SettingsLayout>);
    const labels = tabLabels();
    expect(labels).toEqual(['Plataforma', 'Privacidade', 'Dispositivos', 'Chaves de API']);
  });

  it('renders NO tab strip on a settings page outside the group', () => {
    asRole('super-admin');
    pathname = '/settings/branding';
    render(<SettingsLayout><div>marca</div></SettingsLayout>);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('marca')).toBeTruthy();
  });

  it('treats a nested path as still inside its tab', () => {
    asRole('super-admin');
    pathname = '/settings/users/u-123';
    render(<SettingsLayout><div>detalhe</div></SettingsLayout>);
    // The strip is still drawn (we are inside the group) and Utilizadores is the selection.
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('users');
  });

  // NOT asserted here, on purpose: that an org-admin cannot READ the offices data. Hiding a tab is
  // presentation. The refusal lives in the API and `api/tests` is where it is proven - a tautology
  // here claiming otherwise would leave a dropped server-side check still looking covered.
});
