/**
 * Usage (billing) page behavior test (§13.6 "Billing and observability pages":
 * usage display + admin controls). The user-facing overage/credit surface was
 * not migrated as a rendered component (the API rules stay pinned by the ported
 * billing gate unit test), so the achievable billing PAGE regression is the
 * super-admin usage view: it renders per-user consumption from
 * `api.billing.adminListUsage`, the per-origin breakdown from
 * `api.billing.getBreakdown` (collapsing `pipedream:*` origins), pins the reset
 * flow (`api.billing.adminResetUsage { userId }` behind a confirm), and pins the
 * non-super redirect. The typed client is mocked; the real billing store runs
 * against it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UsagePage from '@/app/(dashboard)/usage/page';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { useAuthStore } from '@/stores/auth';
import { useBillingStore } from '@/stores/billing';
import { api } from '@/lib/api';
import type { AuthUser } from '@ekoa/shared';

const { replaceMock } = vi.hoisted(() => ({ replaceMock: vi.fn() }));

// The page redirects non-super callers via next/navigation's useRouter.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), prefetch: vi.fn() }),
}));

// FC-307: mock the typed client; the real billing store calls it through tryCall.
vi.mock('@/lib/api', () => ({
  api: {
    billing: {
      adminListUsage: vi.fn(),
      getBreakdown: vi.fn(),
      adminResetUsage: vi.fn(),
    },
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
  billing: {
    adminListUsage: ReturnType<typeof vi.fn>;
    getBreakdown: ReturnType<typeof vi.fn>;
    adminResetUsage: ReturnType<typeof vi.fn>;
  };
};

const USAGE_ROWS = [
  {
    userId: 'u-maria',
    username: 'maria',
    role: 'user',
    tokensUsed: 4_200_000,
    tokensBase: 10_000_000,
    tokensRemaining: 5_800_000,
    tokenLimit: null,
    isCustomLimit: false,
    percentage: 42,
    currentPeriodStart: '2026-06-01T00:00:00Z',
    lastLoginAt: '2026-07-01T09:00:00Z',
  },
];

const BREAKDOWN_ROWS = [
  { agentType: 'user_work', tokens: 3_000_000, percentage: 71 },
  { agentType: 'pipedream:gmail:send', tokens: 1_200_000, percentage: 29 },
];

function seedAuth(role: AuthUser['role']) {
  useAuthStore.setState({
    user: { id: 'me', username: 'me', role, orgId: 'org1', active: true } as AuthUser,
    hasHydrated: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.billing.adminListUsage.mockResolvedValue({ items: USAGE_ROWS });
  mocked.billing.getBreakdown.mockResolvedValue({ items: BREAKDOWN_ROWS });
  mocked.billing.adminResetUsage.mockResolvedValue({ userId: 'u-maria' });
  useBillingStore.setState({ allUsage: null, breakdown: [], isAllUsageLoading: false });
});

function renderPage() {
  return render(
    <ConfirmProvider>
      <UsagePage />
    </ConfirmProvider>,
  );
}

describe('UsagePage', () => {
  it('renders per-user usage and the per-origin breakdown', async () => {
    seedAuth('super-admin');
    renderPage();

    await screen.findByTestId('usage-page');
    // Usage row rendered from api.billing.adminListUsage.
    await waitFor(() => expect(screen.getByText('maria')).toBeInTheDocument());
    expect(screen.getByText('42%')).toBeInTheDocument();

    // Breakdown section rendered from api.billing.getBreakdown; pipedream:* origins collapse.
    const breakdown = await screen.findByTestId('usage-breakdown');
    expect(breakdown).toHaveTextContent('Consumo por origem');
    expect(within(breakdown).getByText('Pipedream')).toBeInTheDocument();
    expect(within(breakdown).getByText('user_work')).toBeInTheDocument();
  });

  it('resetting a user calls api.billing.adminResetUsage with the userId after confirm', async () => {
    seedAuth('super-admin');
    renderPage();

    await waitFor(() => expect(screen.getByText('maria')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Repor' }));

    // Confirm dialog with the PT-PT prompt, then take the destructive action.
    // Two "Repor" buttons exist now (row + dialog confirm); the portaled dialog
    // is appended to body, so its confirm button is the last match.
    expect(await screen.findByText('Repor consumo de maria?')).toBeInTheDocument();
    const reporButtons = screen.getAllByRole('button', { name: 'Repor' });
    await userEvent.click(reporButtons[reporButtons.length - 1]);

    await waitFor(() => expect(mocked.billing.adminResetUsage).toHaveBeenCalledWith({ userId: 'u-maria' }));
  });

  it('redirects a non-super-admin to /chat', async () => {
    seedAuth('org-admin');
    renderPage();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/chat'));
    // The gated page never loads usage for a non-super caller.
    expect(mocked.billing.adminListUsage).not.toHaveBeenCalled();
  });
});
