/**
 * Users page behavior test (§13.6 "Dashboard pages beyond rendering - user
 * management"; FC-500). The page-level e2e is unreachable (the web e2e harness
 * boots api-only, no served dashboard), so this committed component spec is the
 * durable regression for the migrated users surface: it renders the user table
 * from the typed client and pins the two FC-500 controls - the activate switch
 * (`api.users.update { active }`) and the builder<->org-admin role toggle
 * (`api.users.update { role }`) - plus the super-admin/org-admin scoping of the
 * admin-only affordances. The client is mocked (no network); the real stores run
 * against it, so this exercises page -> store -> typed-client wiring end to end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsersPage from '@/app/(dashboard)/users/page';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { useAuthStore } from '@/stores/auth';
import { useUsersStore } from '@/stores/users';
import { useCompanyStore } from '@/stores/company';
import { useOrgsStore } from '@/stores/orgs';
import { useBillingStore } from '@/stores/billing';
import { api } from '@/lib/api';
import type { AuthUser } from '@ekoa/shared';

// FC-307: mock the typed client. The stores call api.<domain>.<op> through tryCall,
// so the mocked methods resolve the RAW payload (tryCall wraps it as { ok, data });
// tryCall is the real wrapper. setToken/clearToken/ApiError are the auth store's imports.
vi.mock('@/lib/api', () => ({
  api: {
    users: {
      list: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
      resetPassword: vi.fn(),
    },
    billing: { adminListUsage: vi.fn() },
    org: { listOrgs: vi.fn(), getOrg: vi.fn() },
  },
  tryCall: async (fn: () => Promise<unknown>) => {
    try {
      return { ok: true as const, data: await fn() };
    } catch (error) {
      return { ok: false as const, error };
    }
  },
  setToken: vi.fn(),
  clearToken: vi.fn(),
  ApiError: class ApiError extends Error {},
  isApiError: () => false,
}));

const mocked = api as unknown as {
  users: { list: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  billing: { adminListUsage: ReturnType<typeof vi.fn> };
  org: { listOrgs: ReturnType<typeof vi.fn>; getOrg: ReturnType<typeof vi.fn> };
};

const OWN_ORG = { id: 'org1', name: 'lisboa', displayName: 'Escritório de Lisboa' };

function user(partial: Partial<AuthUser>): AuthUser {
  return {
    id: 'u',
    username: 'user',
    role: 'user',
    orgId: 'org1',
    active: true,
    ...partial,
  } as AuthUser;
}

const SUPER = user({ id: 'u-super', username: 'admin', role: 'super-admin' });
const MARIA = user({ id: 'u-maria', username: 'maria', role: 'org-admin' });
const JOAO = user({ id: 'u-joao', username: 'joao', role: 'user' });

function seedAuth(role: AuthUser['role']) {
  useAuthStore.setState({ user: user({ id: 'me', username: 'me', role }), hasHydrated: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.users.list.mockResolvedValue({ items: [SUPER, MARIA, JOAO] });
  mocked.billing.adminListUsage.mockResolvedValue({ items: [] });
  mocked.org.listOrgs.mockResolvedValue({ items: [OWN_ORG] });
  mocked.org.getOrg.mockResolvedValue(OWN_ORG);
  mocked.users.update.mockImplementation(async (arg: { id: string; role?: string; active?: boolean }) =>
    user({ id: arg.id, username: 'joao', role: (arg.role as AuthUser['role']) ?? 'user', active: arg.active ?? true }),
  );
  useUsersStore.setState({ users: [], isLoading: false, error: null });
  useCompanyStore.setState({ company: OWN_ORG as never, isLoading: false, error: null });
  useOrgsStore.setState({ orgs: [], isLoading: false, error: null });
  useBillingStore.setState({ allUsage: null });
});

function renderPage() {
  return render(
    <ConfirmProvider>
      <UsersPage />
    </ConfirmProvider>,
  );
}

describe('UsersPage', () => {
  it('renders users from the typed client with the super-admin affordances', async () => {
    seedAuth('super-admin');
    renderPage();

    expect(await screen.findByTestId('user-row-maria')).toBeInTheDocument();
    expect(screen.getByTestId('user-row-joao')).toBeInTheDocument();
    // super-admin-only: create action + the token-usage column.
    expect(screen.getByRole('button', { name: 'Adicionar Utilizador' })).toBeInTheDocument();
    expect(screen.getByText('Tokens utilizados')).toBeInTheDocument();
    // The org-assignment column resolves the org id to its display name (FC-500).
    expect(screen.getByTestId('user-org-maria')).toHaveTextContent('Escritório de Lisboa');
  });

  it('deactivating a user calls api.users.update with { active: false }', async () => {
    seedAuth('super-admin');
    renderPage();

    const activeCell = await screen.findByTestId('user-active-joao');
    await userEvent.click(within(activeCell).getByRole('switch'));

    await waitFor(() => expect(mocked.users.update).toHaveBeenCalledWith({ id: 'u-joao', active: false }));
  });

  it('promoting a user calls api.users.update with { role: org-admin }', async () => {
    seedAuth('super-admin');
    renderPage();

    const toggle = await screen.findByTestId('role-toggle-joao');
    await userEvent.click(within(toggle).getByRole('button', { name: 'Administrador' }));

    await waitFor(() => expect(mocked.users.update).toHaveBeenCalledWith({ id: 'u-joao', role: 'org-admin' }));
  });

  it('scopes the admin-only affordances away from an org-admin', async () => {
    seedAuth('org-admin');
    renderPage();

    // The org-admin still manages its own org's users (row + role toggle render)...
    expect(await screen.findByTestId('role-toggle-joao')).toBeInTheDocument();
    // ...but create-user and the token-usage column are super-admin only.
    expect(screen.queryByRole('button', { name: 'Adicionar Utilizador' })).toBeNull();
    expect(screen.queryByText('Tokens utilizados')).toBeNull();
    // An org-admin never lists other orgs' usage.
    expect(mocked.billing.adminListUsage).not.toHaveBeenCalled();
  });
});
